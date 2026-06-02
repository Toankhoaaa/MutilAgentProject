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
