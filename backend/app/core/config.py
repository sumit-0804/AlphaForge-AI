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

    # Auth. jwt_secret MUST be overridden in any deployed environment — the default
    # is a known value, so leaving it means anyone can mint a token for any account.
    jwt_secret: str = "dev-only-insecure-change-me"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 60 * 24 * 7   # a week; this is a paper-trading app
    # Turn off once your accounts exist, so a public URL can't accrue new users.
    allow_registration: bool = True
    # A new book's opening cash, in base_currency.
    starting_cash: float = 100000.0
    # Gemini powers both the chat agents and the memory embeddings.
    google_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    # Changing this invalidates every vector already in the FAISS index. Delete the
    # index directory after; it refills as new memories are written, but entries
    # saved under the old model stay unsearchable.
    embedding_model: str = "models/gemini-embedding-001"
    faiss_index_path: str = "data/faiss_memory"
    # Per-minute request/token caps. Keep below the real quota to leave headroom.
    gemini_rpm: int = 12
    gemini_tpm: int = 200_000
    embedding_rpm: int = 80
    embedding_tpm: int = 24_000

    news_lang: str = "en"
    news_country: str = ""
    scheduler_enabled: bool = True
    scheduler_timezone: str = "Asia/Kolkata"   # NSE hours; use e.g. "America/New_York" for US

    # The one currency cash and totals are held in; positions convert into it.
    base_currency: str = "INR"
    # Frankfurter serves free ECB reference rates.
    forex_api_url: str = "https://api.frankfurter.dev/v1/latest"
    forex_cache_ttl: int = 3600   # ECB publishes once per working day
    forex_timeout: float = 10.0

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origin.split(",") if o.strip()]

    @property
    def jwt_secret_is_default(self) -> bool:
        return self.jwt_secret == "dev-only-insecure-change-me"

settings = Settings()