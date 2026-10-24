"""Environment-based application configuration.

Values come from environment variables (or a local, git-ignored ``.env``).
Every field has a safe default so the service starts with no configuration.

Server-only secrets are typed as ``SecretStr``: their ``repr``/``str`` and
``model_dump()`` output are masked, so they cannot leak through logging or
serialisation by accident. Nothing in this module may be sent to a browser.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import Field, PrivateAttr, SecretStr, ValidationError, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "staging", "production"]
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]

# Chat settings. An invalid value in one of these turns chat off; it never stops the
# rest of the API from starting (see get_settings).
CHAT_FIELDS = frozenset(
    {
        "chat_enabled",
        "chat_safety_policy",
        "chat_signing_key",
        "chat_rate_limit_per_minute",
        "chat_provider",
        "chat_external_provider_approved",
        "groq_api_key",
        "groq_model",
        "chat_demo_curated",
        "chat_demo_allowed_users",
        "chat_demo_access",
        "chat_provider_daily_limit",
        "chat_history_keys",
        "chat_history_retention_days",
        "chat_user_daily_limit",
        "chat_daily_token_budget",
        "chat_context_mode",
        "chat_original_wording_review",
    }
)
_LOWERCASE_FIELDS = frozenset({"environment", "chat_provider", "chat_demo_access"})


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
    # Restricted educational demo (D-48): only predetermined questions, only for the
    # listed accounts (comma-separated emails and/or Supabase user ids). Deployed
    # environments run chat ONLY in this mode.
    chat_demo_curated: bool = False
    chat_demo_allowed_users: str = ""
    # Who may use the curated demo. "allowlist" (default): only CHAT_DEMO_ALLOWED_USERS.
    # "all_consented_adults": every signed-in adult who accepted the current required
    # consent (explicit choice; an empty allow-list never means "everyone").
    chat_demo_access: Literal["allowlist", "all_consented_adults"] = "allowlist"
    # Ceiling on chat requests across ALL users per 24 hours while a real model is
    # the provider, protecting a shared free quota. Over it, chat answers "unavailable".
    chat_provider_daily_limit: int = Field(default=300, gt=0, le=100_000)
    # Fair use (D-56): one account's model requests per 24 hours, inside the global cap.
    chat_user_daily_limit: int = Field(default=25, gt=0, le=10_000)
    # Provider tokens per 24 hours across ALL assistants and users (D-59). Over it,
    # chat answers "unavailable" until usage falls below it again.
    chat_daily_token_budget: int = Field(default=150_000, gt=0, le=10_000_000)
    # What the provider receives about the user's situation (D-59):
    # - "structured" (default): a question composed from recognised topics only.
    # - "minimized": the user's words with identifiers removed, ONLY for users who opted
    #   in to provider processing; everyone else stays on "structured".
    # - "original": the user's own words for users who opted in. Needs
    #   CHAT_ORIGINAL_WORDING_REVIEW (a reference to the completed privacy/legal review).
    chat_context_mode: Literal["structured", "minimized", "original"] = "structured"
    chat_original_wording_review: str = ""
    # Opt-in saved chat history (D-54). Encryption keys for message bodies and titles:
    # "<id>:<base64 32-byte key>[,<older id>:<older key>]" (first encrypts, all decrypt).
    # Unset: history is unavailable and chat stays browser-only.
    chat_history_keys: SecretStr | None = None
    # Saved conversations idle for longer than this are deleted.
    chat_history_retention_days: int = Field(default=90, gt=0, le=365)

    # Chat variables whose value was invalid; chat stays off (names only, never values).
    _invalid_chat_settings: list[str] = PrivateAttr(default_factory=list)

    @field_validator(
        "environment",
        "log_level",
        "chat_enabled",
        "chat_safety_policy",
        "chat_rate_limit_per_minute",
        "chat_provider",
        "chat_external_provider_approved",
        "groq_model",
        "chat_demo_curated",
        "chat_demo_allowed_users",
        "chat_demo_access",
        "chat_provider_daily_limit",
        "chat_user_daily_limit",
        "chat_daily_token_budget",
        "chat_context_mode",
        "chat_history_retention_days",
        mode="before",
    )
    @classmethod
    def _tidy_pasted_value(cls, value: Any, info: ValidationInfo) -> Any:
        # Dashboard values often arrive with a trailing newline, spaces, quotes or
        # capitals ("True", " groq", '"all_consented_adults"'); such a value once failed
        # validation and took the whole API down (2026-10-20).
        if not isinstance(value, str):
            return value
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1].strip()
        if info.field_name == "log_level":
            return value.upper()
        if info.field_name in _LOWERCASE_FIELDS:
            return value.lower()
        if info.field_name == "chat_safety_policy" and not value:
            return None
        return value

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
        "chat_history_keys",
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

    def chat_config_problems(self) -> list[str]:
        """Why chat must stay off with this configuration (empty = chat may start).

        Checked when the chat runtime is built, NOT at startup: an unsafe or incomplete
        chat configuration turns chat off and logs the reason, but never takes down the
        rest of the API (2026-10-20: a startup ValueError made every route fail).
        """
        # Imported lazily to keep config free of import cycles.
        from app.safety.policy import policy_allowed_in

        if self._invalid_chat_settings:
            return [f"invalid value for {name.upper()}" for name in self._invalid_chat_settings]
        if not self.chat_enabled:
            return []
        if self.chat_safety_policy is None:
            return ["CHAT_ENABLED requires CHAT_SAFETY_POLICY"]
        problems: list[str] = []
        if not policy_allowed_in(
            self.chat_safety_policy, self.environment, curated=self.chat_demo_curated
        ):
            problems.append(
                "CHAT_SAFETY_POLICY is not approved for this environment; "
                "chat cannot start (OPEN_DECISIONS D-7)"
            )
        if (
            self.chat_demo_curated
            and self.chat_demo_access == "allowlist"
            and not self.chat_demo_allowed_users.strip()
        ):
            problems.append(
                "CHAT_DEMO_CURATED requires CHAT_DEMO_ALLOWED_USERS "
                "(or CHAT_DEMO_ACCESS=all_consented_adults)"
            )
        if self.chat_context_mode == "original" and not self.chat_original_wording_review.strip():
            problems.append(
                "CHAT_CONTEXT_MODE=original requires CHAT_ORIGINAL_WORDING_REVIEW "
                "(the completed privacy and legal review); use structured or minimized"
            )
        if self.is_deployed and (
            self.chat_signing_key is None or len(self.chat_signing_key.get_secret_value()) < 32
        ):
            # Also needed for correctness on serverless: every instance must share it.
            problems.append(
                "CHAT_SIGNING_KEY (32+ characters) is required in production and staging"
            )
        return problems

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
    """Settings from the environment. An invalid chat variable disables chat only;
    any other invalid variable still stops startup (fail closed)."""
    try:
        return Settings()
    except ValidationError as error:
        invalid = {str(e["loc"][0]) for e in error.errors() if e["loc"]}
        if not invalid or not invalid <= CHAT_FIELDS:
            raise
        defaults: dict[str, Any] = {name: Settings.model_fields[name].default for name in invalid}
        settings = Settings(**{**defaults, "chat_enabled": False})
        settings._invalid_chat_settings = sorted(invalid)
        return settings
