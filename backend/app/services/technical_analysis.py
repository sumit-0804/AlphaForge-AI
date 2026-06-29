import yfinance as yf
import pandas as pd
import pandas_ta as ta
from fastapi import HTTPException
from cachetools import TTLCache, cached

ta_cache = TTLCache(maxsize=100,ttl=300)
def safe_round(val):
    if(pd.isna(val)):
        return None
    return round(float(val),2)

class TechnicalAnalysisService:
    @staticmethod
    @cached(cache=ta_cache)
    def get_technical_indicators(ticker:str, period:str ="6mo", interval:str ="1d") ->dict:
        try:
            stock = yf.Ticker(ticker)
            df = stock.history(period=period, interval=interval)

            if df.empty:
                raise HTTPException(status_code=404, detail=f"No data found for {ticker}")
            
            df.ta.rsi(length=14, append=True)
            df.ta.ema(length=20, append=True)
            df.ta.ema(length=50, append=True)
            df.ta.macd(fast=12, slow=26, signal=9, append=True)
            df.ta.atr(length=14, append=True)
            df.ta.adx(length=14, append=True)
            df.ta.bbands(length=20, std=2, append=True)

            history = []
            for index, row in df.iterrows():
                row = row.to_dict()
                history.append({
                    "time": index.strftime('%Y-%m-%d'),
                    "close": safe_round(row.get("Close")),
                    "rsi": safe_round(row.get("RSI_14")),
                    "ema_20": safe_round(row.get("EMA_20")),
                    "ema_50": safe_round(row.get("EMA_50")),
                    "macd": safe_round(row.get("MACD_12_26_9")),
                    "macd_signal": safe_round(row.get("MACDs_12_26_9")),
                    "macd_hist": safe_round(row.get("MACDh_12_26_9")),
                    "atr": safe_round(row.get("ATRr_14")),
                    "adx": safe_round(row.get("ADX_14")),
                    "bb_upper": safe_round(row.get("BBU_20_2.0")),
                    "bb_middle": safe_round(row.get("BBM_20_2.0")),
                    "bb_lower": safe_round(row.get("BBL_20_2.0"))
                })
            df_valid = df.dropna()

            latest = df_valid.iloc[-1] if not df_valid.empty else df.iloc[-1]

            return {
                "symbol": ticker.upper(),
                "latest": {
                    "price" : safe_round(latest.get("Close")),
                    "rsi" : safe_round(latest.get("RSI_14")),
                    "ema_20": safe_round(latest.get("EMA_20")),
                    "ema_50": safe_round(latest.get("EMA_50")),
                    "macd": safe_round(latest.get("MACD_12_26_9")),
                    "adx": safe_round(latest.get("ADX_14"))
                },
                "history" : history
            }
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=404, detail=f"Failed to calculate indicators: {str(e)}")
            
