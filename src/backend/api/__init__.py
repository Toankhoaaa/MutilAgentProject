"""API router package."""

from backend.api.routers.admin import router as admin_router
from backend.api.routers.agents import router as agents_router
from backend.api.routers.audit import router as audit_router
from backend.api.routers.auth import router as auth_router
from backend.api.routers.chat import router as chat_router
from backend.api.routers.config import router as config_router
from backend.api.routers.emails import router as emails_router
from backend.api.routers.knowledge import router as knowledge_router
from backend.api.routers.rules import router as rules_router
from backend.api.routers.scheduler import router as scheduler_router
from backend.api.routers.stats import router as stats_router
from backend.api.routers.tasks import router as tasks_router
from backend.api.routers.users import router as users_router
from backend.api.routers.websockets import router as websockets_router

__all__ = [
    "admin_router",
    "agents_router",
    "audit_router",
    "auth_router",
    "chat_router",
    "config_router",
    "emails_router",
    "knowledge_router",
    "rules_router",
    "scheduler_router",
    "stats_router",
    "tasks_router",
    "users_router",
    "websockets_router",
]
