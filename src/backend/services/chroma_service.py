"""ChromaDB persistent client for RAG vector storage."""

from __future__ import annotations

import logging
from pathlib import Path

import chromadb

from backend.core.config import settings

logger = logging.getLogger(__name__)

_COLLECTION_NAME = "email_knowledge"


class ChromaService:
    """Persistent ChromaDB client scoped to a single email-knowledge collection."""

    def __init__(self, persist_path: str | None = None) -> None:
        path = persist_path or settings.CHROMA_PERSIST_PATH
        Path(path).mkdir(parents=True, exist_ok=True)
        self._client = chromadb.PersistentClient(path=path)
        self._collection = self._client.get_or_create_collection(
            name=_COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
        logger.info("ChromaDB ready at %s (collection=%s)", path, _COLLECTION_NAME)

    def search(
        self,
        query: str,
        n_results: int = 3,
        where: dict | None = None,
    ) -> list[str]:
        """Return up to *n_results* document chunks most similar to *query*.

        Args:
            query: Natural-language search string.
            n_results: Maximum number of chunks to return.
            where: Optional ChromaDB metadata filter, e.g.
                ``{"type": {"$in": ["cv", "resume"]}}``. Only documents
                whose metadata satisfies the filter are considered.
                Pass ``None`` (default) to search the full collection.

        Returns:
            List of matching document strings. Empty when the collection
            has no documents or when the ``where`` filter matches nothing.
        """
        count = self._collection.count()
        if count == 0:
            return []
        kwargs: dict = {}
        if where:
            kwargs["where"] = where
        results = self._collection.query(
            query_texts=[query],
            n_results=min(n_results, count),
            include=["documents"],
            **kwargs,
        )
        return [d for d in (results.get("documents") or [[]])[0] if d]

    def add_documents(self, texts: list[str], ids: list[str]) -> None:
        """Upsert *texts* with corresponding *ids* into the collection."""
        self._collection.upsert(documents=texts, ids=ids)
        logger.info("Upserted %d documents into ChromaDB.", len(texts))
