"""Long-term agent memory, stored and searched in MongoDB Atlas. The vector lives on
the same document as its text, so there is no second store to fall out of sync with.
"""

import logging

from fastapi import HTTPException
from langchain_google_genai import GoogleGenerativeAIEmbeddings

from app.core.config import settings
from app.core.ratelimit import QuotaExhausted, RateLimiter, estimate_tokens
from app.models.memory import MemoryEntry, MemoryEntryView, MEMORY_TYPES

logger = logging.getLogger(__name__)

# Embeddings have their own, tighter quota than chat, and both saves and searches use it.
_embed_limiter = RateLimiter(
    settings.embedding_rpm,
    settings.embedding_tpm,
    "gemini-embed",
    rpd=settings.embedding_rpd,
    reset_timezone=settings.quota_reset_timezone,
)


class MemoryService:
    _embeddings: GoogleGenerativeAIEmbeddings | None = None

    @classmethod
    def _emb(cls) -> GoogleGenerativeAIEmbeddings:
        if cls._embeddings is None:
            cls._embeddings = GoogleGenerativeAIEmbeddings(
                model=settings.embedding_model,
                google_api_key=settings.google_api_key,
                # Pinned: the Atlas index declares a fixed numDimensions and any
                # other width is rejected at query time.
                output_dimensionality=settings.embedding_dimensions,
            )
        return cls._embeddings

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

        # Embedded before insert so vector and text land in one write. A failure here
        # is not fatal — the entry is stored, just unsearchable until backfilled.
        embedding: list[float] | None = None
        index_error: str | None = None
        try:
            await _embed_limiter.acquire(estimate_tokens(content))
            # RETRIEVAL_DOCUMENT by default, the asymmetric counterpart to the
            # RETRIEVAL_QUERY used in search().
            vectors = await cls._emb().aembed_documents([content])
            embedding = vectors[0]
        except Exception as e:
            index_error = str(e)
            logger.exception(
                "Memory embedding FAILED for type=%s ticker=%s — stored but not searchable",
                type, ticker,
            )

        entry = MemoryEntry(
            user_id=user_id,
            type=type,
            ticker=ticker.upper() if ticker else None,
            content=content,
            metadata=metadata or {},
            embedding=embedding,
        )
        if index_error:
            # Kept on the document so /memory/health can explain a degraded loop.
            entry.metadata["_index_error"] = index_error
        await entry.insert()
        return entry

    @staticmethod
    async def quota_snapshot() -> dict:
        return await _embed_limiter.snapshot()

    @staticmethod
    async def unembedded_count(user_id: str) -> int:
        """Entries stored without a vector, and so invisible to search."""
        return await MemoryEntry.find(
            MemoryEntry.user_id == user_id,
            {"embedding": None},
        ).count()

    @classmethod
    async def vector_index_ready(cls) -> bool:
        """Whether an index of that name accepts a `$vectorSearch` query. Rules out a
        missing index only — a full-text index also accepts it and matches nothing.
        """
        probe = [1.0] + [0.0] * (settings.embedding_dimensions - 1)
        try:
            cursor = await MemoryEntry.get_pymongo_collection().aggregate(
                [
                    {
                        "$vectorSearch": {
                            "index": settings.vector_index_name,
                            "path": "embedding",
                            "queryVector": probe,
                            "numCandidates": 1,
                            "limit": 1,
                        }
                    },
                    {"$project": {"_id": 1}},
                ]
            )
            await cursor.to_list(length=1)
            return True
        except Exception as e:
            logger.warning("Vector index %r not queryable: %s", settings.vector_index_name, e)
            return False

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
        try:
            # The query gets embedded too, so it counts against the quota.
            await _embed_limiter.acquire(estimate_tokens(query))
            query_vector = await cls._emb().aembed_query(query)
        except QuotaExhausted as e:
            # Recall degrades rather than erroring: callers read an empty list as
            # "no prior lessons", far better than a failed analysis.
            logger.warning("Memory search skipped — %s", e)
            return []
        except Exception as e:
            raise HTTPException(502, f"Memory search failed: {e}")

        # Atlas pre-filters before walking the vector graph, so unlike FAISS's
        # post-filtering a narrow scope no longer starves the result set.
        vector_filter: dict = {"user_id": {"$eq": user_id}}
        if type:
            vector_filter["type"] = {"$eq": type}
        if ticker:
            vector_filter["ticker"] = {"$eq": ticker.upper()}

        pipeline = [
            {
                "$vectorSearch": {
                    "index": settings.vector_index_name,
                    "path": "embedding",
                    "queryVector": query_vector,
                    "filter": vector_filter,
                    # Candidates inspected before the top k; trades latency for recall.
                    "numCandidates": max(k * 20, 150),
                    "limit": k,
                }
            },
            {
                "$project": {
                    "_id": 1,
                    "content": 1,
                    "type": 1,
                    "ticker": 1,
                    "user_id": 1,
                    "score": {"$meta": "vectorSearchScore"},
                }
            },
        ]

        try:
            cursor = await MemoryEntry.get_pymongo_collection().aggregate(pipeline)
            docs = await cursor.to_list(length=k)
        except Exception as e:
            raise HTTPException(502, f"Memory search failed: {e}")

        # Cosine similarity, so higher is closer — the reverse of FAISS's L2 distance.
        # No caller thresholds on it; they consume hits in the order returned.
        return [
            {
                "content": d.get("content", ""),
                "score": round(float(d.get("score", 0.0)), 4),
                "id": str(d["_id"]),
                "type": d.get("type"),
                "ticker": d.get("ticker"),
                "user_id": d.get("user_id"),
            }
            for d in docs
        ]

    @classmethod
    async def recent(
        cls,
        type: str | None = None,
        ticker: str | None = None,
        *,
        user_id: str,
        limit: int = 20,
    ) -> list[MemoryEntryView]:
        q = MemoryEntry.find(MemoryEntry.user_id == user_id)
        if type:
            q = q.find(MemoryEntry.type == type)
        if ticker:
            q = q.find(MemoryEntry.ticker == ticker.upper())
        # Projected so the vectors never leave Mongo — see MemoryEntryView.
        return await q.sort("-created_at").limit(limit).project(MemoryEntryView).to_list()
