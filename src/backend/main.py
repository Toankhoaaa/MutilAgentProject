"""
Multi-Agent Email Orchestrator — FastAPI application entrypoint.

Pure REST API backend. All UI is served by the Next.js SPA (FRONTEND_URL).
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware

from backend.api import (
    admin_router,
    agents_router,
    audit_router,
    auth_router,
    chat_router,
    config_router,
    delegation_settings_router,
    delegations_router,
    departments_router,
    emails_router,
    knowledge_router,
    pipeline_router,
    rules_router,
    scheduler_router,
    stats_router,
    tasks_router,
    users_router,
    websockets_router,
)
from backend.core.config import settings
from backend.core.database import init_db
from backend.core.scheduler import restore_snooze_jobs, restore_task_reminders, start_scheduler, stop_scheduler
from backend.services.calendar_service import CalendarAuthenticationError
from backend.services.gmail_service import GmailAuthenticationError

logger = logging.getLogger(__name__)

API_V1_PREFIX = "/api/v1"

APP_TITLE = "Multi-Agent Email Orchestrator"
APP_DESCRIPTION = (
    "REST API for ingesting Gmail messages, running AI classification and reply "
    "drafting agents, and tracking orchestration runs, configurations, and audit logs."
)
APP_VERSION = "1.0.0"


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    init_db()
    start_scheduler()
    await restore_snooze_jobs()
    await restore_task_reminders()
    yield
    stop_scheduler()


def _error_body(
    error_type: str,
    message: str,
    details: Any | None = None,
) -> dict[str, Any]:
    """Build a uniform JSON error envelope for API clients."""
    body: dict[str, Any] = {
        "success": False,
        "error": {
            "type": error_type,
            "message": message,
        },
    }
    if details is not None:
        body["error"]["details"] = details
    return body


app = FastAPI(
    title=APP_TITLE,
    description=APP_DESCRIPTION,
    version=APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# allow_origins=["*"] + allow_credentials=True is rejected by browsers; use explicit origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "https://mail.google.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY)

app.include_router(admin_router, prefix=API_V1_PREFIX)
app.include_router(users_router, prefix=API_V1_PREFIX)
app.include_router(auth_router, prefix=API_V1_PREFIX)
app.include_router(delegation_settings_router, prefix=API_V1_PREFIX)
app.include_router(delegations_router, prefix=API_V1_PREFIX)
app.include_router(departments_router, prefix=API_V1_PREFIX)
app.include_router(emails_router, prefix=API_V1_PREFIX)
app.include_router(agents_router, prefix=API_V1_PREFIX)
app.include_router(chat_router, prefix=API_V1_PREFIX)
app.include_router(config_router, prefix=API_V1_PREFIX)
app.include_router(audit_router, prefix=API_V1_PREFIX)
app.include_router(knowledge_router, prefix=API_V1_PREFIX)
app.include_router(pipeline_router, prefix=API_V1_PREFIX)
app.include_router(rules_router, prefix=API_V1_PREFIX)
app.include_router(stats_router, prefix=API_V1_PREFIX)
app.include_router(scheduler_router, prefix=API_V1_PREFIX)
app.include_router(tasks_router, prefix=API_V1_PREFIX)
app.include_router(websockets_router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    logger.warning("Validation error on %s: %s", request.url.path, exc.errors())
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=_error_body(
            error_type="validation_error",
            message="Request validation failed.",
            details=exc.errors(),
        ),
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(
    request: Request,
    exc: StarletteHTTPException,
) -> JSONResponse:
    message = exc.detail if isinstance(exc.detail, str) else "Request failed."
    details = None if isinstance(exc.detail, str) else exc.detail
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_body(
            error_type="http_error",
            message=message,
            details=details,
        ),
    )


@app.exception_handler(GmailAuthenticationError)
async def gmail_auth_error_handler(request: Request, exc: GmailAuthenticationError) -> JSONResponse:
    logger.warning("Gmail auth error on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED,
        content=_error_body("reauth_required", "Google credentials expired. Please sign in again."),
    )


@app.exception_handler(CalendarAuthenticationError)
async def calendar_auth_error_handler(request: Request, exc: CalendarAuthenticationError) -> JSONResponse:
    logger.warning("Calendar auth error on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED,
        content=_error_body("reauth_required", "Google credentials expired. Please sign in again."),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(
    request: Request,
    exc: Exception,
) -> JSONResponse:
    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=_error_body(
            error_type="internal_server_error",
            message="An unexpected error occurred. Please try again later.",
        ),
    )


@app.get("/", tags=["Root"])
def root_redirect() -> RedirectResponse:
    """Redirect browser root hits to the Next.js SPA."""
    return RedirectResponse(url=settings.FRONTEND_URL, status_code=status.HTTP_302_FOUND)


@app.get("/api", tags=["Root"])
def api_root() -> dict[str, Any]:
    """API metadata and documentation links."""
    return {
        "success": True,
        "service": APP_TITLE,
        "version": APP_VERSION,
        "status": "running",
        "message": "Multi-Agent Email Orchestrator API is online.",
        "docs": "/docs",
        "api_v1": API_V1_PREFIX,
        "endpoints": {
            "emails": f"{API_V1_PREFIX}/emails",
            "auth": f"{API_V1_PREFIX}/auth",
            "login": f"{API_V1_PREFIX}/auth/login",
            "me": f"{API_V1_PREFIX}/auth/me",
            "agents": f"{API_V1_PREFIX}/agents",
            "config": f"{API_V1_PREFIX}/config",
            "audit": f"{API_V1_PREFIX}/audit",
            "stats": f"{API_V1_PREFIX}/stats",
            "websocket": "/ws/notifications",
        },
    }


@app.get("/health", tags=["Health"])
def health_check() -> dict[str, str]:
    """Liveness probe for load balancers and deployment checks."""
    return {"status": "ok"}
