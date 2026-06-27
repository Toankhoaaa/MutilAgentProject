"""RAG agent — retrieves knowledge context for response drafting.

IMPORTANT: Only call ``retrieve`` with text that has already been processed
by ``PrivacyAgent.mask``. PII must never reach ChromaDB embeddings.
"""

from __future__ import annotations

import logging

from backend.core.constants import SHARED_USER_ID
from backend.services.chroma_service import ChromaService

logger = logging.getLogger(__name__)

_CHUNK_SEPARATOR = "\n---\n"


class RagAgent:
    """Retrieves relevant knowledge chunks from ChromaDB using masked email text."""

    def __init__(self, chroma_service: ChromaService | None = None) -> None:
        self._chroma = chroma_service or ChromaService()

    def retrieve(self, masked_text: str, n_results: int = 3, user_id: str | None = None) -> str:
        """Return a formatted context string from the top-*n_results* knowledge chunks.

        Returns an empty string when the collection is empty or the query is blank.
        Precondition: *masked_text* must be pre-processed by PrivacyAgent.
        Filters to user's own documents + shared documents when user_id is provided.
        """
        if not masked_text.strip():
            return ""
        where = {"user_id": {"$in": [user_id, SHARED_USER_ID]}} if user_id else None
        chunks = self._chroma.search(masked_text, n_results=n_results, where=where)
        if not chunks:
            return ""
        return _CHUNK_SEPARATOR.join(chunks)

    def find_user_cv(self, user_id: str | None = None) -> str:
        """Retrieve the user's CV or résumé from the knowledge base.

        Only searches documents belonging to the specific user — shared documents
        are intentionally excluded (a CV is always personal, never from the shared pool).

        Returns:
            Concatenated CV text chunks separated by ``\\n---\\n``, ready to
            be injected into a prompt. Returns an empty string when no
            CV-like content is found.
        """
        cv_query = "CV resume work experience education skills summary career profile"
        user_filter = {"user_id": user_id} if user_id else None

        metadata_filters = [
            {"$and": [{"user_id": user_id}, {"type": {"$in": ["cv", "resume"]}}]},
            {"$and": [{"user_id": user_id}, {"source": {"$eq": "cv"}}]},
        ] if user_id else []

        for where_filter in metadata_filters:
            try:
                chunks = self._chroma.search(cv_query, n_results=5, where=where_filter)
                if chunks:
                    return _CHUNK_SEPARATOR.join(chunks)
            except Exception:
                pass

        # Fall back: semantic search scoped to this user only
        try:
            chunks = self._chroma.search(cv_query, n_results=5, where=user_filter)
            return _CHUNK_SEPARATOR.join(chunks) if chunks else ""
        except Exception:
            return ""
