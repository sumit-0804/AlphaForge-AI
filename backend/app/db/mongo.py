import asyncio
import logging

from pymongo import AsyncMongoClient
from pymongo.errors import ConnectionFailure
from beanie import init_beanie

from app.core.config import settings
from app.models.health import HealthCheck
from app.models.trading import Portfolio, Transaction
from app.models.memory import MemoryEntry
from app.models.quota import DailyQuotaUsage
from app.models.recommendation import Recommendation
from app.models.report import DailyReport
from app.models.user import User

logger = logging.getLogger(__name__)

# 30s is pymongo's default, set explicitly because it is load-bearing rather than
# incidental: server selection retries *internally* for the whole window, and that
# is what rides out a replica-set member refusing TLS handshakes. Shortening it
# would make startup fail faster and more often, not less.
client = AsyncMongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=30_000)

db = client[settings.mongodb_db]

_DOCUMENT_MODELS = [
    HealthCheck, Portfolio, Transaction, MemoryEntry, Recommendation,
    DailyReport, DailyQuotaUsage, User,
]


async def init_db(attempts: int = 5):
    """Bind Beanie to the database, retrying transient connection failures.

    Atlas's shared-tier proxy accepts the TCP connection and then aborts the TLS
    handshake while a node is still coming up, so a cluster can refuse roughly
    half its handshakes for minutes after provisioning or resuming from pause.
    Without this loop that is a failed startup — and under a container restart
    policy it becomes a crash loop rather than a few seconds' delay.

    Auth and permission errors are deliberately not caught: those are settled
    facts, and retrying a wrong password five times only delays the diagnosis.
    """
    for attempt in range(1, attempts + 1):
        try:
            await init_beanie(database=db, document_models=_DOCUMENT_MODELS)
            if attempt > 1:
                logger.info("MongoDB connected on attempt %d/%d", attempt, attempts)
            return
        except ConnectionFailure as exc:
            # ConnectionFailure is the shared base of ServerSelectionTimeoutError
            # and AutoReconnect — a TLS handshake abort arrives as the latter, so
            # catching only the former lets it escape as a raw traceback.
            if attempt == attempts:
                logger.error("MongoDB unreachable after %d attempts: %s", attempts, exc)
                raise
            delay = 2 * attempt
            logger.warning(
                "MongoDB connection attempt %d/%d failed (%s) — retrying in %ds",
                attempt, attempts, exc, delay,
            )
            await asyncio.sleep(delay)