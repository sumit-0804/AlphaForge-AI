from fastapi import APIRouter
from app.services.technical_analysis import TechnicalAnalysisService

router = APIRouter(prefix="/analysis", tags=["Technical Analysis"])

@router.get("/indicators/{ticker}")
async def get_technical_analysis(ticker:str, period:str="6mo", interval:str="1d"):
    # get calculated technical indicators

    return TechnicalAnalysisService.get_technical_indicators(ticker.upper(),period,interval) 