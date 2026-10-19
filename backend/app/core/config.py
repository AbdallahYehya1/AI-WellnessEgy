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
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
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

    # Supabase Auth. The project URL is not secret; it determines the token
    # issuer and the JWKS endpoint. When unset, authenticated endpoints fail
    # closed with 503 rather than accepting any token.
    supabase_url: str | None = None
    supabase_jwt_audience: str = "authenticated"
    supabase_jwks_cache_seconds: int = Field(default=600, gt=0)
    supabase_jwks_timeout_seconds: float = Field(default=5.0, gt=0)

    # Server-only secrets.
    # Only for projects still on the legacy shared-secret (HS256) signing key.
    # Projects using asymmetric signing keys are verified through JWKS and
    # must leave this unset.
    supabase_jwt_secret: SecretStr | None = None
    # Declared for later milestones; nothing reads these yet.
    database_url: SecretStr | None = None
    supabase_service_role_key: SecretStr | None = None

    # Conversational assistant (prototype). Off by default.
    chat_enabled: bool = False
    # Identifier of the safety policy the chat pipeline runs under. Production
    # refuses to start chat unless this names a clinically approved policy;
    # none exists yet (OPEN_DECISIONS D-7), so chat cannot run in production.
    chat_safety_policy: str | None = None
    # HMAC key for signing assistant turns held in the browser. Required in
    # production; outside production an ephemeral per-process key is used.
    chat_signing_key: SecretStr | None = None
    # Per-user messages per minute (placeholder until D-21 sets real values).
    chat_rate_limit_per_minute: int = Field(default=10, gt=0, le=600)
    # Generation provider: "fake" (scripted, no network) or "groq". Groq also needs
    # the API key and CHAT_EXTERNAL_PROVIDER_APPROVED=true, the founder's recorded
    # decision that messages may be processed by Groq (OPEN_DECISIONS D-47).
    # Missing either keeps chat off; it never falls back to another provider.
    chat_provider: Literal["fake", "groq"] = "fake"
    chat_external_provider_approved: bool = False
    groq_api_key: SecretStr | None = None
    groq_model: str = "openai/gpt-oss-20b"

    @field_validator("supabase_url")
    @classmethod
    def _normalise_supabase_url(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        value = value.strip().rstrip("/")
        parsed = urlsplit(value)
        is_local = parsed.hostname in {"localhost", "127.0.0.1"}
        if not parsed.hostname or not (
            parsed.scheme == "https" or (parsed.scheme == "http" and is_local)
        ):
            raise ValueError("SUPABASE_URL must use https (http is allowed only for localhost)")
        return value

    @field_validator(
        "supabase_jwt_secret",
        "database_url",
        "supabase_service_role_key",
        "chat_signing_key",
        "groq_api_key",
    )
    @classmethod
    def _blank_secret_is_unset(cls, value: SecretStr | None) -> SecretStr | None:
        # `.env.example` ships these as `NAME=`; an empty string must mean
        # "not configured", never "configured with an empty value".
        if value is None or not value.get_secret_value().strip():
            return None
        # Values pasted into a dashboard often carry a trailing newline or spaces.
        # Never meaningful in a URL or key, and fatal for DATABASE_URL: the database
        # name became "postgres\n" and every connection failed (2026-10-19 outage).
        return SecretStr(value.get_secret_value().strip())

    @field_validator("supabase_jwt_secret")
    @classmethod
    def _legacy_secret_is_long_enough(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and len(value.get_secret_value()) < 32:
            raise ValueError("SUPABASE_JWT_SECRET is too short to be a Supabase JWT secret")
        return value

    @model_validator(mode="after")
    def _chat_policy_is_allowed(self) -> Settings:
        # Imported lazily to keep config free of import cycles.
        from app.safety.policy import policy_allowed_in

        if self.chat_enabled:
            if self.chat_safety_policy is None:
                raise ValueError("CHAT_ENABLED requires CHAT_SAFETY_POLICY")
            if not policy_allowed_in(self.chat_safety_policy, self.environment):
                raise ValueError(
                    "CHAT_SAFETY_POLICY is not approved for this environment; "
                    "chat cannot start (OPEN_DECISIONS D-7)"
                )
            if self.is_deployed and (
                self.chat_signing_key is None or len(self.chat_signing_key.get_secret_value()) < 32
            ):
                # Also needed for correctness on serverless: every instance must share it.
                raise ValueError(
                    "CHAT_SIGNING_KEY (32+ characters) is required in production and staging"
                )
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def is_deployed(self) -> bool:
        """Production or staging: an internet-reachable deployment. Both get the same
        hardening (docs off, verified TLS, a shared chat signing key); only production
        additionally refuses the test-only chat policy."""
        return self.environment in ("production", "staging")

    @property
    def docs_enabled(self) -> bool:
        """Interactive API docs are disabled in every deployed environment."""
        return not self.is_deployed

    @property
    def supabase_issuer(self) -> str | None:
        return f"{self.supabase_url}/auth/v1" if self.supabase_url else None

    @property
    def supabase_jwks_url(self) -> str | None:
        issuer = self.supabase_issuer
        return f"{issuer}/.well-known/jwks.json" if issuer else None


@lru_cache
def get_settings() -> Settings:
    return Settings()
