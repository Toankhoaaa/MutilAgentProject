"""API router package."""

from app.api.routers.agents import router as agents_router
from app.api.routers.audit import router as audit_router
from app.api.routers.auth import router as auth_router
from app.api.routers.config import router as config_router
from app.api.routers.emails import router as emails_router
from app.api.routers.scheduler import router as scheduler_router
from app.api.routers.stats import router as stats_router
from app.api.routers.websockets import router as websockets_router

__all__ = [
    "emails_router",
    "auth_router",
    "agents_router",
    "config_router",
    "audit_router",
    "scheduler_router",
    "stats_router",
    "websockets_router",
]
