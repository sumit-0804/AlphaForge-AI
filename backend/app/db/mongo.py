from pymongo import AsyncMongoClient
from beanie import init_beanie

from app.core.config import settings
from app.models.health import HealthCheck
from app.models.trading import Portfolio, Transaction
from app.models.memory import MemoryEntry
from app.models.report import DailyReport
from app.models.recommendation import Recommendation

client = AsyncMongoClient(settings.mongodb_uri)

db = client[settings.mongodb_db]

async def init_db():
    await init_beanie(
        database=db,
        document_models=[HealthCheck, Portfolio, Transaction, MemoryEntry, DailyReport, Recommendation],
    )