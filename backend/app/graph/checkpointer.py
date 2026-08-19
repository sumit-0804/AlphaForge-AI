"""Async LangGraph checkpointer driven by the AsyncMongoClient app.db.mongo already opens.
Same layout as langgraph-checkpoint-mongodb, which is sync-only and pulls in langchain.
"""

import logging
from collections.abc import AsyncIterator, Sequence
from datetime import datetime, timezone
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import (
    WRITES_IDX_MAP,
    BaseCheckpointSaver,
    ChannelVersions,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
    get_checkpoint_id,
)
from langgraph.checkpoint.serde.base import SerializerProtocol
from pymongo import ASCENDING, DESCENDING, AsyncMongoClient, UpdateOne

logger = logging.getLogger(__name__)


def _dumps_meta(serde: SerializerProtocol, meta: Any):
    # Keys stay plain strings so metadata remains queryable; only values are serialised.
    if isinstance(meta, dict):
        return {k: _dumps_meta(serde, v) for k, v in meta.items()}
    return serde.dumps_typed(meta)


def _loads_meta(serde: SerializerProtocol, meta: Any):
    if isinstance(meta, dict):
        return {k: _loads_meta(serde, v) for k, v in meta.items()}
    return serde.loads_typed(meta)


class MongoCheckpointer(BaseCheckpointSaver):
    """Stores graph checkpoints and pending writes in two Mongo collections."""

    def __init__(
        self,
        client: AsyncMongoClient,
        db_name: str,
        checkpoint_collection: str = "checkpoints",
        writes_collection: str = "checkpoint_writes",
        ttl: int | None = None,
        serde: SerializerProtocol | None = None,
    ) -> None:
        super().__init__(serde=serde)
        db = client[db_name]
        self.checkpoints = db[checkpoint_collection]
        self.writes = db[writes_collection]
        self.ttl = ttl

    async def setup(self) -> None:
        """Create the indexes. Idempotent, so it is safe on every startup."""
        await self.checkpoints.create_index(
            [("thread_id", ASCENDING), ("checkpoint_ns", ASCENDING), ("checkpoint_id", DESCENDING)],
            unique=True,
        )
        await self.writes.create_index(
            [
                ("thread_id", ASCENDING), ("checkpoint_ns", ASCENDING),
                ("checkpoint_id", DESCENDING), ("task_id", ASCENDING), ("idx", ASCENDING),
            ],
            unique=True,
        )
        if not self.ttl:
            return
        for coll in (self.checkpoints, self.writes):
            try:
                await coll.create_index([("created_at", ASCENDING)], expireAfterSeconds=self.ttl)
            except Exception:
                # An existing index with a different TTL conflicts; the old value stands.
                logger.warning("Could not set a %ss TTL on %s", self.ttl, coll.name)

    @staticmethod
    def _keys(config: RunnableConfig) -> tuple[str, str]:
        conf = config["configurable"]
        return conf["thread_id"], conf.get("checkpoint_ns", "")

    async def _pending_writes(self, keys: dict) -> list:
        return [
            (d["task_id"], d["channel"], self.serde.loads_typed((d["type"], d["value"])))
            async for d in self.writes.find(keys).sort(
                [("task_id", ASCENDING), ("idx", ASCENDING)]
            )
        ]

    async def _to_tuple(self, doc: dict, thread_id: str, checkpoint_ns: str) -> CheckpointTuple:
        keys = {
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
            "checkpoint_id": doc["checkpoint_id"],
        }
        parent = doc.get("parent_checkpoint_id")
        return CheckpointTuple(
            {"configurable": keys},
            self.serde.loads_typed((doc["type"], doc["checkpoint"])),
            _loads_meta(self.serde, doc["metadata"]),
            {"configurable": {**keys, "checkpoint_id": parent}} if parent else None,
            await self._pending_writes(keys),
        )

    async def aget_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        thread_id, checkpoint_ns = self._keys(config)
        query = {"thread_id": thread_id, "checkpoint_ns": checkpoint_ns}
        if checkpoint_id := get_checkpoint_id(config):
            query["checkpoint_id"] = checkpoint_id

        doc = await self.checkpoints.find_one(query, sort=[("checkpoint_id", DESCENDING)])
        return await self._to_tuple(doc, thread_id, checkpoint_ns) if doc else None

    async def alist(
        self,
        config: RunnableConfig | None,
        *,
        filter: dict[str, Any] | None = None,
        before: RunnableConfig | None = None,
        limit: int | None = None,
    ) -> AsyncIterator[CheckpointTuple]:
        query: dict[str, Any] = {}
        if config is not None:
            thread_id, checkpoint_ns = self._keys(config)
            query.update({"thread_id": thread_id, "checkpoint_ns": checkpoint_ns})
        for key, value in (filter or {}).items():
            query[f"metadata.{key}"] = _dumps_meta(self.serde, value)
        if before is not None:
            query["checkpoint_id"] = {"$lt": get_checkpoint_id(before)}

        cursor = self.checkpoints.find(query).sort("checkpoint_id", DESCENDING)
        if limit is not None:
            cursor = cursor.limit(limit)
        async for doc in cursor:
            yield await self._to_tuple(doc, doc["thread_id"], doc["checkpoint_ns"])

    async def aput(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        thread_id, checkpoint_ns = self._keys(config)
        checkpoint_id = checkpoint["id"]
        type_, blob = self.serde.dumps_typed(checkpoint)

        doc: dict[str, Any] = {
            "parent_checkpoint_id": config["configurable"].get("checkpoint_id"),
            "type": type_,
            "checkpoint": blob,
            "metadata": _dumps_meta(self.serde, {**metadata, **config.get("metadata", {})}),
        }
        if self.ttl:
            doc["created_at"] = datetime.now(timezone.utc)

        keys = {
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
            "checkpoint_id": checkpoint_id,
        }
        await self.checkpoints.update_one(keys, {"$set": doc}, upsert=True)
        return {"configurable": keys}

    async def aput_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        thread_id, checkpoint_ns = self._keys(config)
        checkpoint_id = config["configurable"]["checkpoint_id"]
        # Only error/interrupt writes may overwrite an existing row; normal ones are write-once.
        op = "$set" if all(w[0] in WRITES_IDX_MAP for w in writes) else "$setOnInsert"
        now = datetime.now(timezone.utc)

        operations = []
        for idx, (channel, value) in enumerate(writes):
            type_, blob = self.serde.dumps_typed(value)
            update: dict[str, Any] = {"channel": channel, "type": type_, "value": blob}
            if self.ttl:
                update["created_at"] = now
            operations.append(
                UpdateOne(
                    {
                        "thread_id": thread_id,
                        "checkpoint_ns": checkpoint_ns,
                        "checkpoint_id": checkpoint_id,
                        "task_id": task_id,
                        "task_path": task_path,
                        "idx": WRITES_IDX_MAP.get(channel, idx),
                    },
                    {op: update},
                    upsert=True,
                )
            )
        if operations:
            await self.writes.bulk_write(operations)

    async def adelete_thread(self, thread_id: str) -> None:
        await self.checkpoints.delete_many({"thread_id": thread_id})
        await self.writes.delete_many({"thread_id": thread_id})
