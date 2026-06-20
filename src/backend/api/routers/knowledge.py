"""FastAPI router for Knowledge Base document management (upload, list, edit, delete)."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from google import genai
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.auth_dependencies import get_current_user
from backend.api.dependencies import require_admin
from backend.core.config import settings
from backend.core.database import SessionLocal, get_db
from backend.core.document_parser import ALLOWED_SUFFIXES, chunk_text, extract_text
from backend.models.knowledge import KnowledgeDocument
from backend.models.user import User
from backend.services.agents.privacy_agent import PrivacyAgent
from backend.services.chroma_service import ChromaService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge", tags=["Knowledge Base"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class KnowledgeDocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    source_email: str | None
    ai_summary: str | None
    notes: str | None
    chroma_collection_id: str | None
    chunk_count: int | None
    status: str
    upload_date: datetime


class KnowledgeListResponse(BaseModel):
    items: list[KnowledgeDocumentResponse]
    total: int


class UpdateDocumentRequest(BaseModel):
    ai_summary: str | None = None
    notes: str | None = None


class SaveFromEmailRequest(BaseModel):
    subject: str
    snippet: str
    sender: str | None = None
    notes: str | None = None


# ── Background processing ─────────────────────────────────────────────────────

def _process_document_bg(
    doc_id: uuid.UUID,
    file_bytes: bytes,
    filename: str,
    suffix: str,
) -> None:
    """Sync background task: parse → mask PII → chunk → embed → summarize → update DB."""
    db = SessionLocal()
    doc: KnowledgeDocument | None = None
    try:
        doc = db.get(KnowledgeDocument, doc_id)
        if not doc:
            return

        try:
            text = extract_text(file_bytes, suffix).strip()
        except Exception as exc:
            logger.exception("Text extraction failed for document %s", doc_id)
            doc.status = "failed"
            db.commit()
            return

        if not text:
            doc.status = "failed"
            db.commit()
            return

        # Mask PII before storing in ChromaDB
        masked = PrivacyAgent().mask(text)
        chunks = chunk_text(masked)

        # Build stable, collision-safe chunk IDs
        safe_stem = re.sub(r"[^a-zA-Z0-9_-]", "_", Path(filename).stem)[:50]
        chroma_prefix = f"{safe_stem}_{doc_id}"
        chunk_ids = [f"{chroma_prefix}_{i}" for i in range(len(chunks))]
        metadatas = [{"document_id": str(doc_id), "filename": filename}] * len(chunks)

        ChromaService().add_documents(texts=chunks, ids=chunk_ids, metadatas=metadatas)

        # Generate AI summary (best-effort; never blocks ingestion)
        summary = _generate_summary(text[:3000])

        doc.ai_summary = summary
        doc.chroma_collection_id = chroma_prefix
        doc.chunk_count = len(chunks)
        doc.status = "ready"
        db.commit()

    except Exception:
        logger.exception("Document processing failed for %s", doc_id)
        if doc is not None:
            try:
                doc.status = "failed"
                db.commit()
            except Exception:
                pass
    finally:
        db.close()


def _generate_summary(text: str) -> str:
    """Call Gemini synchronously to produce a 2–3 sentence document summary."""
    if not settings.GEMINI_API_KEY:
        return ""
    try:
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        prompt = (
            "Summarize this document in 2–3 sentences. "
            "Describe what it is, what topics it covers, and where it may be from.\n\n"
            f"Document (excerpt):\n{text}"
        )
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=prompt,
        )
        return (response.text or "").strip()
    except Exception:
        logger.warning("AI summary generation failed — skipping.")
        return ""


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=KnowledgeDocumentResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload a PDF or DOCX file to the knowledge base",
)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    source_email: str | None = Form(None),
    notes: str | None = Form(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> KnowledgeDocumentResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported file type '{suffix}'. Accepted: .pdf, .docx",
        )

    file_bytes = await file.read()
    await file.close()

    doc = KnowledgeDocument(
        filename=file.filename or "document",
        source_email=source_email,
        notes=notes,
        status="processing",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    background_tasks.add_task(
        _process_document_bg,
        doc.id,
        file_bytes,
        file.filename or "document",
        suffix,
    )

    return KnowledgeDocumentResponse.model_validate(doc)


@router.get(
    "/",
    response_model=KnowledgeListResponse,
    summary="List all knowledge base documents",
)
def list_documents(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeListResponse:
    docs = (
        db.execute(
            select(KnowledgeDocument).order_by(KnowledgeDocument.upload_date.desc())
        )
        .scalars()
        .all()
    )
    return KnowledgeListResponse(
        items=[KnowledgeDocumentResponse.model_validate(d) for d in docs],
        total=len(docs),
    )


@router.put(
    "/{doc_id}",
    response_model=KnowledgeDocumentResponse,
    summary="Update AI summary or notes for a document",
)
def update_document(
    doc_id: uuid.UUID,
    body: UpdateDocumentRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> KnowledgeDocumentResponse:
    doc = db.get(KnowledgeDocument, doc_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    if body.ai_summary is not None:
        doc.ai_summary = body.ai_summary
    if body.notes is not None:
        doc.notes = body.notes
    db.commit()
    db.refresh(doc)
    return KnowledgeDocumentResponse.model_validate(doc)


@router.delete(
    "/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a document from the knowledge base (DB + ChromaDB)",
)
def delete_document(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> None:
    doc = db.get(KnowledgeDocument, doc_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    if doc.chroma_collection_id and doc.chunk_count:
        try:
            ids = [f"{doc.chroma_collection_id}_{i}" for i in range(doc.chunk_count)]
            ChromaService().delete_documents(ids)
        except Exception:
            logger.warning("ChromaDB cleanup failed for document %s — continuing DB delete.", doc_id)

    db.delete(doc)
    db.commit()


@router.post(
    "/save-from-email",
    response_model=KnowledgeDocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Save email content directly to the knowledge base (admin only)",
)
def save_email_to_knowledge(
    body: SaveFromEmailRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> KnowledgeDocumentResponse:
    content = f"Subject: {body.subject}\nFrom: {body.sender or 'Unknown'}\n\n{body.snippet}"
    chunks = chunk_text(content)
    doc_id = uuid.uuid4()
    chroma_prefix = f"email_{doc_id}"
    chunk_ids = [f"{chroma_prefix}_{i}" for i in range(len(chunks))]
    metadatas = [{"document_id": str(doc_id), "source": "email"}] * len(chunks)
    ChromaService().add_documents(texts=chunks, ids=chunk_ids, metadatas=metadatas)

    doc = KnowledgeDocument(
        id=doc_id,
        filename=f"email_{doc_id}.txt",
        source_email=body.sender,
        notes=body.notes or body.subject,
        chroma_collection_id=chroma_prefix,
        chunk_count=len(chunks),
        status="ready",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return KnowledgeDocumentResponse.model_validate(doc)
