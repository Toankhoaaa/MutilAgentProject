"""FastAPI router for AI-powered multi-department email delegation."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.auth_dependencies import get_current_user
from backend.api.dependencies import get_db, get_gmail_service
from backend.models.audit_log import AuditLog
from backend.models.delegation import Delegation
from backend.models.delegation_item import DelegationItem
from backend.models.delegation_settings import DelegationSettings
from backend.models.department import Department
from backend.models.user import User
from backend.schemas.agent_schemas import EmailResponseOutput
from backend.schemas.api_schemas import (
    DelegateEmailResponse,
    DelegationItemResponse,
    DelegationItemUpdate,
    DelegationResponse,
)
from backend.services.agents.delegation_agent import DelegationAgent
from backend.services.agents.privacy_agent import PrivacyAgent
from backend.services.gmail_service import GmailAPIError, GmailAuthenticationError, GmailService
from backend.services.llm_service import GeminiService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Delegations"])

_privacy = PrivacyAgent()
_gemini = GeminiService()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _item_to_response(item: DelegationItem, already_sent_warning: bool = False) -> DelegationItemResponse:
    work_items: list[str] = []
    if item.work_items:
        try:
            work_items = json.loads(item.work_items)
        except (json.JSONDecodeError, TypeError):
            work_items = [item.work_items]
    return DelegationItemResponse(
        id=item.id,
        delegation_id=item.delegation_id,
        department_name=item.department_name,
        department_id=item.department_id,
        recipient_email=item.recipient_email,
        work_items=work_items,
        draft_subject=item.draft_subject,
        draft_body=item.draft_body,
        gmail_draft_id=item.gmail_draft_id,
        cc_emails=item.cc_emails,
        bcc_emails=item.bcc_emails,
        confidence=item.confidence,
        reason=item.reason,
        status=item.status,
        sent_at=item.sent_at,
        already_sent_warning=already_sent_warning,
    )


def _delegation_to_response(delegation: Delegation, db: Session) -> DelegationResponse:
    items = list(
        db.scalars(select(DelegationItem).where(DelegationItem.delegation_id == delegation.id)).all()
    )
    # Build sets of dept identifiers that already have sent items
    sent_dept_ids: set[uuid.UUID] = set()
    sent_dept_names: set[str] = set()
    for item in items:
        if item.status == "sent":
            if item.department_id is not None:
                sent_dept_ids.add(item.department_id)
            elif item.department_name:
                sent_dept_names.add(item.department_name.lower().strip())

    item_responses = []
    for item in items:
        warn = False
        if item.status == "draft" and (sent_dept_ids or sent_dept_names):
            if item.department_id is not None and item.department_id in sent_dept_ids:
                warn = True
            elif (
                item.department_id is None
                and item.department_name
                and item.department_name.lower().strip() in sent_dept_names
            ):
                warn = True
        item_responses.append(_item_to_response(item, already_sent_warning=warn))

    return DelegationResponse(
        id=delegation.id,
        user_id=delegation.user_id,
        source_email_id=delegation.source_email_id,
        source_thread_id=delegation.source_thread_id,
        original_subject=delegation.original_subject,
        status=delegation.status,
        created_at=delegation.created_at,
        items=item_responses,
    )


def _get_item_owned(db: Session, item_id: uuid.UUID, current_user: User) -> DelegationItem:
    item = db.get(DelegationItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Delegation item not found.")
    delegation = db.get(Delegation, item.delegation_id)
    if delegation is None or delegation.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Delegation item not found.")
    return item


def _get_delegation_owned(db: Session, delegation_id: uuid.UUID, current_user: User) -> Delegation:
    row = db.get(Delegation, delegation_id)
    if row is None or row.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Delegation not found.")
    return row


def _match_department(dept_name: str, departments: list[Department]) -> Department | None:
    """Match assignment department_name to a user's departments by exact name, then by keyword."""
    lower = dept_name.lower().strip()
    for d in departments:
        if d.name.lower() == lower:
            return d
    for d in departments:
        if not d.keywords:
            continue
        for kw in (k.strip().lower() for k in d.keywords.split(",") if k.strip()):
            if kw and kw in lower:
                return d
    return None


def _update_delegation_status(delegation: Delegation, items: list[DelegationItem]) -> None:
    if not items:
        return
    sent = sum(1 for i in items if i.status == "sent")
    processed = sum(1 for i in items if i.status in ("sent", "dismissed"))
    if processed == len(items):
        delegation.status = "completed"
    elif sent > 0:
        delegation.status = "partially_sent"


async def _compose_delegation_draft(
    department_name: str,
    work_items: list[str],
    priority: int,
    suggested_deadline: str | None,
    company_header: str | None = None,
    signature: str | None = None,
) -> tuple[str, str]:
    """Compose (draft_subject, draft_body) for a department's work items via GeminiService."""
    deadline_text = f"Thời hạn: {suggested_deadline}" if suggested_deadline else ""
    numbered_items = "\n".join(f"{i + 1}. {item}" for i, item in enumerate(work_items))

    header_instruction = (
        f"Bắt đầu email bằng header công ty sau (nguyên văn, dòng đầu tiên):\n{company_header}\n\n"
        if company_header
        else ""
    )
    signature_instruction = (
        f"Kết thúc email bằng chữ ký sau (nguyên văn, sau 'Trân trọng,'):\n{signature}"
        if signature
        else "Kết thúc bằng 'Trân trọng,'"
    )

    prompt = (
        f"Soạn email giao việc chuyên nghiệp bằng tiếng Việt.\n\n"
        f"{header_instruction}"
        f"Phòng nhận: {department_name}\n"
        f"Công việc được giao (đánh số):\n{numbered_items}\n"
        f"Độ ưu tiên: {priority}/5\n"
        f"{deadline_text}\n\n"
        "YÊU CẦU:\n"
        "- subject: ngắn gọn, thể hiện giao việc cho phòng này.\n"
        "- body_content: mở đầu 'Kính gửi bộ phận [tên phòng],', câu ngắn về bối cảnh, "
        "sau đó liệt kê 'Các công việc được giao:' với ĐÁNH SỐ thứ tự từng việc, "
        f"{'đề cập thời hạn, ' if deadline_text else ''}"
        f"{signature_instruction}. "
        "KHÔNG thêm việc ngoài danh sách. KHÔNG đề cập phòng ban khác.\n"
        '- CHỈ trả JSON: {"subject": "...", "body_content": "..."}. Không markdown, không giải thích.'
    )
    try:
        result = await _gemini.generate_structured_response(prompt=prompt, schema=EmailResponseOutput)
        if isinstance(result, EmailResponseOutput):
            return result.subject, result.body_content
        validated = EmailResponseOutput.model_validate(result)
        return validated.subject, validated.body_content
    except Exception as exc:
        logger.warning("Delegation draft compose failed for dept '%s': %s", department_name, exc)

    # Fallback: simple template (no LLM)
    subject = f"[Giao việc] Phòng {department_name}"
    parts: list[str] = []
    if company_header:
        parts.append(company_header)
        parts.append("")
    parts.append(f"Kính gửi bộ phận {department_name},")
    parts.append("")
    parts.append("Dưới đây là các công việc được giao đến bộ phận:")
    parts.append("")
    for i, item in enumerate(work_items, 1):
        parts.append(f"{i}. {item}")
    parts.append("")
    if deadline_text:
        parts.append(deadline_text)
        parts.append("")
    parts.append("Vui lòng xác nhận tiếp nhận và cập nhật tiến độ định kỳ.")
    parts.append("")
    parts.append("Trân trọng,")
    if signature:
        parts.append(signature)
    body = "\n".join(parts)
    return subject, body


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post(
    "/emails/{message_id}/delegate",
    response_model=DelegateEmailResponse,
    summary="Analyze email for multi-department delegation and create per-department draft items",
)
async def delegate_email(
    message_id: str,
    force_refresh: bool = Query(default=False, description="Re-run AI delegation: keep sent items, replace draft/dismissed items."),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    gmail_service: GmailService = Depends(get_gmail_service),
) -> DelegateEmailResponse:
    existing = db.scalars(
        select(Delegation).where(
            Delegation.user_id == current_user.id,
            Delegation.source_email_id == message_id,
        )
    ).first()

    # Dedup: return existing when not forcing a refresh
    if existing and not force_refresh:
        return DelegateEmailResponse(
            is_delegation=True,
            delegation=_delegation_to_response(existing, db),
        )

    # Fetch email from Gmail
    try:
        msg = await gmail_service.fetch_message(message_id)
    except GmailAuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except GmailAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    original_subject: str = msg.get("subject") or ""
    thread_id: str | None = msg.get("thread_id") or None
    masked_subject = _privacy.mask(original_subject)
    masked_body = _privacy.mask(msg.get("body") or msg.get("snippet") or "")

    settings_row = db.scalars(
        select(DelegationSettings).where(DelegationSettings.user_id == current_user.id)
    ).first()
    company_header = settings_row.company_header if settings_row else None
    signature = settings_row.signature if settings_row else None

    departments = list(
        db.scalars(select(Department).where(Department.user_id == current_user.id)).all()
    )
    known_depts = [{"id": str(d.id), "name": d.name, "keywords": d.keywords or ""} for d in departments]

    output = await DelegationAgent().analyze(
        email_subject=masked_subject,
        email_body=masked_body,
        known_departments=known_depts,
    )

    if not output.is_delegation:
        return DelegateEmailResponse(
            is_delegation=False,
            message="Email này không được nhận diện là email giao việc.",
        )

    if existing and force_refresh:
        # Keep sent items; delete draft and dismissed items
        for item in list(
            db.scalars(select(DelegationItem).where(DelegationItem.delegation_id == existing.id)).all()
        ):
            if item.status in ("draft", "dismissed"):
                db.delete(item)
        db.flush()
        existing.status = "pending"
        delegation = existing
    else:
        delegation = Delegation(
            user_id=current_user.id,
            source_email_id=message_id,
            source_thread_id=thread_id,
            original_subject=original_subject,
            status="pending",
        )
        db.add(delegation)
        db.flush()

    for assignment in output.assignments:
        matched = None
        if assignment.matched_department_id:
            try:
                ai_dept_uuid = uuid.UUID(assignment.matched_department_id)
                matched = next((d for d in departments if d.id == ai_dept_uuid), None)
            except (ValueError, AttributeError):
                pass
        if matched is None and assignment.department_name != "Chưa xác định":
            matched = _match_department(assignment.department_name, departments)

        draft_subject, draft_body = await _compose_delegation_draft(
            department_name=assignment.department_name,
            work_items=assignment.work_items,
            priority=assignment.priority,
            suggested_deadline=assignment.suggested_deadline,
            company_header=company_header,
            signature=signature,
        )
        db.add(DelegationItem(
            delegation_id=delegation.id,
            department_name=assignment.department_name,
            department_id=matched.id if matched else None,
            recipient_email=matched.email if matched else None,
            work_items=json.dumps(assignment.work_items, ensure_ascii=False),
            draft_subject=draft_subject,
            draft_body=draft_body,
            confidence=assignment.confidence,
            reason=assignment.reason,
            status="draft",
        ))

    # Recalculate aggregate status (kept sent items may already put us at partially_sent)
    db.flush()
    all_items = list(
        db.scalars(select(DelegationItem).where(DelegationItem.delegation_id == delegation.id)).all()
    )
    _update_delegation_status(delegation, all_items)

    db.commit()
    db.refresh(delegation)
    return DelegateEmailResponse(
        is_delegation=True,
        delegation=_delegation_to_response(delegation, db),
    )


@router.get(
    "/delegations",
    response_model=list[DelegationResponse],
    summary="List all delegations for the current user",
)
def list_delegations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[DelegationResponse]:
    rows = list(
        db.scalars(
            select(Delegation)
            .where(Delegation.user_id == current_user.id)
            .order_by(Delegation.created_at.desc())
        ).all()
    )
    return [_delegation_to_response(r, db) for r in rows]


@router.get(
    "/delegations/{delegation_id}",
    response_model=DelegationResponse,
    summary="Get a single delegation with its items",
)
def get_delegation(
    delegation_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DelegationResponse:
    delegation = _get_delegation_owned(db, delegation_id, current_user)
    return _delegation_to_response(delegation, db)


@router.patch(
    "/delegation-items/{item_id}",
    response_model=DelegationItemResponse,
    summary="Edit recipient_email / draft_subject / draft_body before creating a Gmail draft",
)
def update_delegation_item(
    item_id: uuid.UUID,
    payload: DelegationItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DelegationItemResponse:
    item = _get_item_owned(db, item_id, current_user)
    if payload.department_id is not None:
        dept = db.get(Department, payload.department_id)
        if dept is None or dept.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Department not found.")
        item.department_id = dept.id
        item.department_name = dept.name
        # Only overwrite recipient_email if user hasn't manually set it
        if not payload.recipient_email:
            item.recipient_email = dept.email
    if payload.recipient_email is not None:
        item.recipient_email = payload.recipient_email
    if payload.draft_subject is not None:
        item.draft_subject = payload.draft_subject
    if payload.draft_body is not None:
        item.draft_body = payload.draft_body
    if payload.cc_emails is not None:
        item.cc_emails = payload.cc_emails or None
    if payload.bcc_emails is not None:
        item.bcc_emails = payload.bcc_emails or None
    db.commit()
    db.refresh(item)
    return _item_to_response(item)


@router.post(
    "/delegation-items/{item_id}/send",
    response_model=DelegationItemResponse,
    summary="Create a Gmail DRAFT for this delegation item (does NOT send the email)",
)
async def send_delegation_item(
    item_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    gmail_service: GmailService = Depends(get_gmail_service),
) -> DelegationItemResponse:
    item = _get_item_owned(db, item_id, current_user)

    if item.department_name == "Chưa xác định":
        raise HTTPException(
            status_code=400,
            detail="Vui lòng gán phòng ban trước khi tạo nháp (PATCH /delegation-items/{id} với department_id).",
        )
    if not item.recipient_email:
        raise HTTPException(
            status_code=400,
            detail="recipient_email is required. Update it via PATCH /delegation-items/{id} first.",
        )

    # Idempotent: return current state if already drafted
    if item.status == "sent" and item.gmail_draft_id:
        return _item_to_response(item)

    try:
        draft_id = await gmail_service.create_draft(
            to=item.recipient_email,
            subject=item.draft_subject or "(no subject)",
            body=item.draft_body or "",
            cc=item.cc_emails or None,
            bcc=item.bcc_emails or None,
        )
    except GmailAuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except GmailAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    item.gmail_draft_id = draft_id
    item.status = "sent"
    item.sent_at = datetime.now(timezone.utc)

    # Update parent delegation aggregate status
    delegation = db.get(Delegation, item.delegation_id)
    if delegation:
        all_items = list(
            db.scalars(select(DelegationItem).where(DelegationItem.delegation_id == delegation.id)).all()
        )
        _update_delegation_status(delegation, all_items)

    db.add(
        AuditLog(
            user_id=current_user.id,
            agent_name="DelegationAgent",
            action="create_gmail_draft",
            status="success",
            details={
                "delegation_item_id": str(item_id),
                "department_name": item.department_name,
                "gmail_draft_id": draft_id,
            },
        )
    )
    db.commit()
    db.refresh(item)
    return _item_to_response(item)


@router.post(
    "/delegation-items/{item_id}/dismiss",
    response_model=DelegationItemResponse,
    summary="Dismiss a delegation item (skip creating Gmail draft for this department)",
)
def dismiss_delegation_item(
    item_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DelegationItemResponse:
    item = _get_item_owned(db, item_id, current_user)
    item.status = "dismissed"

    delegation = db.get(Delegation, item.delegation_id)
    if delegation:
        all_items = list(
            db.scalars(select(DelegationItem).where(DelegationItem.delegation_id == delegation.id)).all()
        )
        _update_delegation_status(delegation, all_items)

    db.commit()
    db.refresh(item)
    return _item_to_response(item)
