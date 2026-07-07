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
    ollama_base_url: str = "http://localhost:11434"
    llm_model: str = "llama3.1:latest"
    news_lang: str = "en"
    news_country: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origin.split(",") if o.strip()]

settings = Settings()