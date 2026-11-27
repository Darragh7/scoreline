from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


# <project root>/.env (see .env.example). Running uvicorn from backend/ used to look only
# for backend/.env and miss it. A backend/.env (or real environment variables) still wins.
_PROJECT_ENV = Path(__file__).resolve().parents[3] / ".env"

class Settings(BaseSettings):

    football_api_key: str = ""

    # football-data.org v4 API
    football_api_base_url: str = "https://api.football-data.org/v4"

    # seconds to wait for the football API before giving up
    football_api_timeout: float = 10.0

    database_url: str = Field(min_length=1)

    secret_key: str = Field(min_length=1)

    model_config = SettingsConfigDict(
        env_file=(_PROJECT_ENV, ".env"),
        extra="ignore"
    )


settings = Settings()
