"""Utilities for extracting text from PDF/Docx files and chunking it for RAG ingestion."""

from __future__ import annotations

from io import BytesIO

import PyPDF2
import docx

_CHUNK_SIZE = 500
_CHUNK_OVERLAP = 50

ALLOWED_SUFFIXES: frozenset[str] = frozenset({".pdf", ".docx"})


def extract_text(data: bytes, suffix: str) -> str:
    """Return plain text extracted from *data* based on *suffix* ('.pdf' or '.docx').

    Raises:
        ValueError: For unsupported file types.
    """
    s = suffix.lower()
    if s == ".pdf":
        reader = PyPDF2.PdfReader(BytesIO(data))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    if s == ".docx":
        doc = docx.Document(BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs)
    raise ValueError(f"Unsupported file type '{suffix}'. Accepted: .pdf, .docx")


def chunk_text(
    text: str,
    chunk_size: int = _CHUNK_SIZE,
    overlap: int = _CHUNK_OVERLAP,
) -> list[str]:
    """Split *text* into overlapping chunks of roughly *chunk_size* characters."""
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += chunk_size - overlap
    return chunks
