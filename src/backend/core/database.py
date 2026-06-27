from collections.abc import Generator
import logging

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.core.config import settings
from backend.models.base import Base

logger = logging.getLogger(__name__)

engine = create_engine(
    settings.DATABASE_URL,
    future=True,
    connect_args={"check_same_thread": False}
    if settings.DATABASE_URL.startswith("sqlite")
    else {},
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    class_=Session,
    future=True,
)


def init_db() -> None:
    """Create all ORM tables when missing (SQLite dev / first run)."""
    import backend.models  # noqa: F401 — register models on Base.metadata

    Base.metadata.create_all(bind=engine)
    logger.info("Database schema ensured at %s", settings.DATABASE_URL)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that provides a SQLAlchemy session."""
    db: Session = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
