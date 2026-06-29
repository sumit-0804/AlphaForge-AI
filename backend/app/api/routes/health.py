from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import settings
from app.models.health import HealthCheck

router = APIRouter(tags=["health"])

class HealthResponse(BaseModel):
    status:str
    service:str
    environment:str
    mongodb:str
    timestamp:datetime

@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    mongo_status = "connected"
    try: 
        await HealthCheck(status="ok").insert()
    except Exception:
        mongo_status = "disconnected"
    
    return HealthResponse(
        status = "ok" if mongo_status == "connected" else "degraded",
        service=settings.app_name,
        environment=settings.app_env,
        mongodb=mongo_status,
        timestamp=datetime.now(timezone.utc), 
    )
