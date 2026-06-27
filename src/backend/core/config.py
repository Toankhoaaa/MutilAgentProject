import sys

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_gemini_model(model: str) -> str:
    """
    Normalize a Gemini model id for google-genai v1beta.

    Strips whitespace and the legacy ``models/`` prefix so callers always pass
    bare ids such as ``gemini-2.5-flash``.
    """
    cleaned = model.strip()
    if cleaned.startswith("models/"):
        cleaned = cleaned.removeprefix("models/")
    return cleaned


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    DATABASE_URL: str = "sqlite:///./email_orchestrator.db"
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"
    GMAIL_CREDENTIALS_PATH: str = "credentials.json"
    GMAIL_TOKEN_PATH: str = "token.json"
    GMAIL_MOCK_MODE: bool = False
    GMAIL_IMPERSONATE_USER: str = ""
    JWT_SECRET_KEY: str = "dev-change-me-in-production-32b!"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    SECRET_KEY: str = "your-super-secret-key-make-it-long"
    # Optional override; leave empty to derive from request host (recommended for local dev).
    GOOGLE_OAUTH_REDIRECT_URI: str = ""
    FRONTEND_URL: str = "http://localhost:3000"
    CHROMA_PERSIST_PATH: str = "./chroma_db"
    ADMIN_REGISTRATION_SECRET: str = "change-me-admin-secret"
    ENVIRONMENT: str = "development"

    model_config = SettingsConfigDict(
        env_file=[".env", "../.env"],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("GEMINI_MODEL", mode="before")
    @classmethod
    def _normalize_gemini_model_field(cls, value: str) -> str:
        if isinstance(value, str):
            return normalize_gemini_model(value)
        return value

    @model_validator(mode="after")
    def _check_weak_secrets(self) -> "Settings":
        _WEAK_DEFAULTS = {
            "JWT_SECRET_KEY": "dev-change-me-in-production-32b!",
            "SECRET_KEY": "your-super-secret-key-make-it-long",
            "ADMIN_REGISTRATION_SECRET": "change-me-admin-secret",
        }
        for name, default in _WEAK_DEFAULTS.items():
            if getattr(self, name) == default:
                msg = f"[SECURITY] {name} is using the default insecure value — set it in .env"
                if self.ENVIRONMENT.lower() == "production":
                    raise ValueError(msg + " (cannot start in production with default secrets)")
                print(f"\n⚠️  WARNING: {msg}\n", file=sys.stderr, flush=True)
        return self


settings = Settings()
