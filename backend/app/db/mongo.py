from pymongo import AsyncMongoClient
from beanie import init_beanie

from app.core.config import settings
from app.models.health import HealthCheck

client = AsyncMongoClient(settings.mongodb_uri)

db = client[settings.mongodb_db]

async def init_db():
    await init_beanie(
        database=db,
        document_models=[HealthCheck],
    )