import asyncio
from pathlib import Path

from fastapi import HTTPException
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document as LCDocument

from app.core.config import settings
from app.models.memory import MemoryEntry, MEMORY_TYPES

_INDEX_DIR = Path(settings.faiss_index_path)

class MemoryService:
    _store: FAISS | None = None
    _embeddings: GoogleGenerativeAIEmbeddings | None =None
    # _add_to_index is read-modify-write (load -> add -> save_local) with no
    # atomicity. Reflection, the workflow's persist step and the scheduler all
    # write concurrently, so without this lock interleaved writes drop entries.
    # NOTE: this only serialises writes within ONE process — running more than a
    # single uvicorn worker still races on the index files.
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
        user_id: str = "default_user",
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
            async with cls._write_lock:
                await asyncio.to_thread(cls._add_to_index, content, meta)
        except Exception as e:
            # Mongo already holds the durable record; don't fail the write if the
            # embedding call errors — just note it.
            entry.metadata["_index_error"] = str(e)
        return entry
    
    @classmethod
    async def search(
        cls,
        query: str,
        k: int = 5,
        type: str | None = None,
        ticker: str | None = None,
        user_id: str = "default_user",
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
            # LangChain's FAISS applies `filter` AFTER retrieving fetch_k nearest
            # neighbours (default 20). Scoped searches — e.g. lessons for one
            # ticker — would silently return nothing once the store fills up with
            # unrelated agent_output entries that crowd out the top 20. Widen the
            # candidate pool so the filter has something to select from.
            hits = store.similarity_search_with_score(
                query, k=k, filter=filt, fetch_k=max(k * 20, 200)
            )
            return [
                {"content": d.page_content, "score": round(float(s), 4), **d.metadata}
                for d, s in hits
            ]
        try:
            return await asyncio.to_thread(_do)
        except Exception as e:
            raise HTTPException(502, f"Memory search failed: {e}")
    
    @classmethod
    async def recent(
        cls,
        type: str | None = None,
        ticker: str | None = None,
        user_id: str = "default_user",
        limit: int = 20,
    ) -> list[MemoryEntry]:
        q = MemoryEntry.find(MemoryEntry.user_id == user_id)
        if type:
            q = q.find(MemoryEntry.type == type)
        if ticker:
            q = q.find(MemoryEntry.ticker == ticker.upper())
        return await q.sort("-created_at").limit(limit).to_list()