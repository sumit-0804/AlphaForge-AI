from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
   
    )

    app_name:str = "AlphaForge AI"
    app_env : str = "development"
    api_prefix : str = "/api"
    mongodb_uri : str = "mongodb://localhost:27017"
    mongodb_db : str = "alphaforge"
    cors_origin : str ="http://localhost:3000"
    # Gemini powers both the reasoning/chat agents and the memory embeddings.
    google_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    embedding_model: str = "models/text-embedding-004"
    faiss_index_path: str = "data/faiss_memory"
    news_lang: str = "en"
    news_country: str = ""
    scheduler_enabled: bool = True
    scheduler_timezone: str = "Asia/Kolkata"   # NSE hours; use e.g. "America/New_York" for US

    # --- Currency -----------------------------------------------------------
    # The book is denominated in ONE currency: cash, total value and total P&L
    # are all held here. Positions keep their own listing currency (₹ for .NS /
    # .BO, $ for US) and are converted into this only for the portfolio total.
    base_currency: str = "INR"
    # Frankfurter serves ECB reference rates — free, keyless, unmetered.
    forex_api_url: str = "https://api.frankfurter.dev/v1/latest"
    forex_cache_ttl: int = 3600   # ECB publishes once per working day
    forex_timeout: float = 10.0

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origin.split(",") if o.strip()]

settings = Settings()