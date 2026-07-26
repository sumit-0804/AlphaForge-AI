import asyncio
import logging
from pathlib import Path

from fastapi import HTTPException
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document as LCDocument

from app.core.config import settings
from app.core.ratelimit import QuotaExhausted, RateLimiter, estimate_tokens
from app.models.memory import MemoryEntry, MEMORY_TYPES

logger = logging.getLogger(__name__)

_INDEX_DIR = Path(settings.faiss_index_path)

# Embeddings have their own, tighter quota than chat, and both saves and searches use it.
_embed_limiter = RateLimiter(
    settings.embedding_rpm,
    settings.embedding_tpm,
    "gemini-embed",
    rpd=settings.embedding_rpd,
    reset_timezone=settings.quota_reset_timezone,
)

class MemoryService:
    _store: FAISS | None = None
    _embeddings: GoogleGenerativeAIEmbeddings | None =None
    # Serialise index writes so concurrent saves don't overwrite each other (single process only).
    _write_lock = asyncio.Lock()

    @classmethod
    def _emb(cls) -> GoogleGenerativeAIEmbeddings:
        if cls._embeddings is None:
            cls._embeddings = GoogleGenerativeAIEmbeddings(
                model=settings.embedding_model,
                google_api_key=settings.google_api_key,
            )
        return cls._embeddings
    
    @classmethod
    def _load_store(cls) -> FAISS | None:
        if cls._store is None and (_INDEX_DIR / "index.faiss").exists():
            cls._store = FAISS.load_local(
                str(_INDEX_DIR), cls._emb(), allow_dangerous_deserialization=True
            )
        return cls._store
    
    @classmethod
    def _add_to_index(cls, text: str, meta: dict) -> None:
        doc = LCDocument(page_content=text, metadata=meta)
        store = cls._load_store()
        if store is None:
            cls._store = FAISS.from_documents([doc], cls._emb())
        else:
            store.add_documents([doc])
            cls._store = store
        _INDEX_DIR.mkdir(parents=True, exist_ok=True)
        cls._store.save_local(str(_INDEX_DIR))

    @classmethod
    async def save(
        cls,
        type: str,
        content: str,
        ticker: str | None = None,
        metadata: dict | None = None,
        *,
        # Keyword-only and required: a memory written to the wrong book leaks one
        # user's trading history into another's agent prompts.
        user_id: str,
    ) -> MemoryEntry:
        if type not in MEMORY_TYPES:
            raise HTTPException(400, f"type must be one of {MEMORY_TYPES}")
        entry = MemoryEntry(
            user_id=user_id,
            type=type,
            ticker=ticker.upper() if ticker else None,
            content=content,
            metadata=metadata or {},
        )
        await entry.insert()
        meta = {"id": str(entry.id), "type": type, "ticker": entry.ticker, "user_id": user_id}
        try:
            await _embed_limiter.acquire(estimate_tokens(content))
            async with cls._write_lock:
                await asyncio.to_thread(cls._add_to_index, content, meta)
        except Exception as e:
            # Mongo has the record; if indexing fails, save the error on the entry
            # so /memory/health can see it rather than failing the whole write.
            entry.metadata["_index_error"] = str(e)
            logger.exception(
                "Memory indexing FAILED for type=%s ticker=%s — in Mongo but not searchable",
                type, entry.ticker,
            )
            try:
                await entry.save()
            except Exception:
                # Don't let a Mongo failure hide the embedding error above.
                logger.exception("Could not persist _index_error on memory %s", entry.id)
        return entry

    @staticmethod
    async def quota_snapshot() -> dict:
        return await _embed_limiter.snapshot()

    @staticmethod
    def index_exists() -> bool:
        # Whether the index file is on disk, using the same check _load_store uses.
        return (_INDEX_DIR / "index.faiss").exists()

    @classmethod
    async def search(
        cls,
        query: str,
        k: int = 5,
        type: str | None = None,
        ticker: str | None = None,
        *,
        user_id: str,
    ) -> list[dict]:
        def _do():
            store = cls._load_store()
            if store is None:
                return []
            filt = {"user_id": user_id}
            if type:
                filt["type"] = type
            if ticker:
                filt["ticker"] = ticker.upper()
            # FAISS filters after fetching, so pull a wide pool or scoped searches come back empty.
            hits = store.similarity_search_with_score(
                query, k=k, filter=filt, fetch_k=max(k * 20, 200)
            )
            return [
                {"content": d.page_content, "score": round(float(s), 4), **d.metadata}
                for d, s in hits
            ]
        try:
            # The query gets embedded too, so it counts against the quota.
            await _embed_limiter.acquire(estimate_tokens(query))
            return await asyncio.to_thread(_do)
        except QuotaExhausted as e:
            # Recall degrades rather than erroring: the callers treat an empty list as
            # "no prior lessons", which is a far better outcome than a failed analysis.
            logger.warning("Memory search skipped — %s", e)
            return []
        except Exception as e:
            raise HTTPException(502, f"Memory search failed: {e}")
    
    @classmethod
    async def recent(
        cls,
        type: str | None = None,
        ticker: str | None = None,
        *,
        user_id: str,
        limit: int = 20,
    ) -> list[MemoryEntry]:
        q = MemoryEntry.find(MemoryEntry.user_id == user_id)
        if type:
            q = q.find(MemoryEntry.type == type)
        if ticker:
            q = q.find(MemoryEntry.ticker == ticker.upper())
        return await q.sort("-created_at").limit(limit).to_list()