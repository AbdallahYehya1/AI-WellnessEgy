"""Environment-based application configuration.

Values come from environment variables (or a local, git-ignored ``.env``).
Every field has a safe default so the service starts with no configuration.

Server-only secrets are typed as ``SecretStr``: their ``repr``/``str`` and
``model_dump()`` output are masked, so they cannot leak through logging or
serialisation by accident. Nothing in this module may be sent to a browser.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "staging", "production"]
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "AI Wellness Egypt API"
    app_version: str = "0.1.0"
    environment: Environment = "development"
    log_level: LogLevel = "INFO"

    # Server-only secrets. Declared now so later milestones do not change the
    # shape of configuration; nothing reads them in Milestone 1.
    database_url: SecretStr | None = None
    supabase_service_role_key: SecretStr | None = None
    supabase_jwt_secret: SecretStr | None = None

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def docs_enabled(self) -> bool:
        """Interactive API docs are disabled in production."""
        return not self.is_production


@lru_cache
def get_settings() -> Settings:
    return Settings()
