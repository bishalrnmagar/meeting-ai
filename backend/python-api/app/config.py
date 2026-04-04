from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://meetingai:meetingai_dev@localhost:5433/meetingai"
    redis_url: str = "redis://localhost:6379"
    deepgram_api_key: str = ""
    openai_api_key: str = ""
    jira_url: str = ""
    jira_email: str = ""
    jira_api_token: str = ""
    internal_api_key: str = "shared-secret-change-me"

    model_config = {"env_file": ".env"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
