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
    jwt_secret: str = "mysecret"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 60 * 24 * 7  
    allow_registration: bool = True
    starting_cash: float = 100000.0
    # Gemini powers both the chat agents and the memory embeddings.
    google_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash-lite"
    embedding_model: str = "models/gemini-embedding-2"
    # Created by hand in the Atlas UI, not by this app — Mongo builds search indexes
    # asynchronously, so there is nothing useful to await on startup.
    vector_index_name: str = "memory_vector_index"
    # Must equal numDimensions in the Atlas index; also passed as the model's
    # output_dimensionality so stored vectors and the index cannot drift apart.
    embedding_dimensions: int = 1536
    gemini_rpm: int = 12
    gemini_tpm: int = 200_000
    embedding_rpm: int = 80
    embedding_tpm: int = 24_000
    
    gemini_rpd: int = 400          
    embedding_rpd: int = 800
    quota_reset_timezone: str = "America/Los_Angeles"

    news_lang: str = "en"
    news_country: str = ""
    base_currency: str = "INR"
    forex_api_url: str = "https://api.frankfurter.dev/v1/latest"
    forex_cache_ttl: int = 3600  
    forex_timeout: float = 10.0

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origin.split(",") if o.strip()]

    @property
    def jwt_secret_is_default(self) -> bool:
        return self.jwt_secret == "mysecret"

settings = Settings()