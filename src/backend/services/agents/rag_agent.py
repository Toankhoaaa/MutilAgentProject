"""RAG agent — retrieves knowledge context for response drafting.

IMPORTANT: Only call ``retrieve`` with text that has already been processed
by ``PrivacyAgent.mask``. PII must never reach ChromaDB embeddings.
"""

from __future__ import annotations

import logging

from backend.services.chroma_service import ChromaService

logger = logging.getLogger(__name__)

_CHUNK_SEPARATOR = "\n---\n"


class RagAgent:
    """Retrieves relevant knowledge chunks from ChromaDB using masked email text."""

    def __init__(self, chroma_service: ChromaService | None = None) -> None:
        self._chroma = chroma_service or ChromaService()

    def retrieve(self, masked_text: str, n_results: int = 3) -> str:
        """Return a formatted context string from the top-*n_results* knowledge chunks.

        Returns an empty string when the collection is empty or the query is blank.
        Precondition: *masked_text* must be pre-processed by PrivacyAgent.
        """
        if not masked_text.strip():
            return ""
        chunks = self._chroma.search(masked_text, n_results=n_results)
        if not chunks:
            return ""
        return _CHUNK_SEPARATOR.join(chunks)

    def find_user_cv(self) -> str:
        """Retrieve the user's CV or résumé from the knowledge base.

        Tries progressively broader strategies so the agent always gets
        the best available match:

        1. Metadata filter ``{"type": {"$in": ["cv", "resume"]}}`` — matches
           documents explicitly tagged when they were uploaded.
        2. Metadata filter ``{"source": {"$eq": "cv"}}`` — alternative tagging
           convention.
        3. Semantic search with a CV-specific query — catches documents that
           contain CV content but were not tagged with structured metadata.

        Returns:
            Concatenated CV text chunks separated by ``\\n---\\n``, ready to
            be injected into a prompt. Returns an empty string when no
            CV-like content is found in the knowledge base.
        """
        cv_query = "CV resume work experience education skills summary career profile"

        metadata_filters = [
            {"type": {"$in": ["cv", "resume"]}},
            {"source": {"$eq": "cv"}},
        ]
        for where_filter in metadata_filters:
            try:
                chunks = self._chroma.search(cv_query, n_results=5, where=where_filter)
                if chunks:
                    return _CHUNK_SEPARATOR.join(chunks)
            except Exception:
                # Filter fails when no document in the collection has that field
                pass

        # Fall back: pure semantic search
        chunks = self._chroma.search(cv_query, n_results=5)
        return _CHUNK_SEPARATOR.join(chunks) if chunks else ""
