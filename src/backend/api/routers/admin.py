"""FastAPI router for admin document ingestion into ChromaDB (RAG setup)."""
from __future__ import annotations

import logging
from io import BytesIO
from pathlib import Path

import PyPDF2
import docx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from pydantic import BaseModel

from backend.api.auth_dependencies import get_current_user
from backend.models.user import User
from backend.services.chroma_service import ChromaService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"])

_ALLOWED_EXTENSIONS = {".pdf", ".docx"}
_CHUNK_SIZE = 500
_CHUNK_OVERLAP = 50


class IngestResponse(BaseModel):
    success: bool
    filename: str
    chunks_added: int


def _extract_pdf(data: bytes) -> str:
    reader = PyPDF2.PdfReader(BytesIO(data))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _extract_docx(data: bytes) -> str:
    doc = docx.Document(BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs)


def _chunk_text(text: str) -> list[str]:
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + _CHUNK_SIZE, len(text))
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += _CHUNK_SIZE - _CHUNK_OVERLAP
    return chunks


@router.post(
    "/documents",
    response_model=IngestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest PDF or DOCX into RAG knowledge base",
)
async def ingest_document(
    file: UploadFile,
    current_user: User = Depends(get_current_user),
) -> IngestResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{suffix}'. Only PDF and DOCX are accepted.",
        )

    data = await file.read()
    await file.close()  # release temp file immediately after reading

    try:
        text = _extract_pdf(data) if suffix == ".pdf" else _extract_docx(data)
    except Exception as exc:
        logger.exception("Failed to parse document '%s': %s", file.filename, exc)
        raise HTTPException(status_code=422, detail=f"Failed to parse file: {exc}") from exc

    text = text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Document appears to be empty or unreadable.")

    chunks = _chunk_text(text)
    stem = Path(file.filename or "document").stem
    ids = [f"{stem}_{i}" for i in range(len(chunks))]

    ChromaService().add_documents(texts=chunks, ids=ids)

    return IngestResponse(success=True, filename=file.filename or "", chunks_added=len(chunks))
