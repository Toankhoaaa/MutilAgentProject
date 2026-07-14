"""CrewAI LLM factory backed by LangChain ``ChatGoogleGenerativeAI``."""

from __future__ import annotations

from crewai.llms.base_llm import BaseLLM
from crewai.utilities.llm_utils import create_llm
from langchain_google_genai import ChatGoogleGenerativeAI

from backend.core.config import settings


def build_crew_llm(temperature: float = 0.2) -> BaseLLM:
    """
    Build a CrewAI-native LLM from LangChain's ``ChatGoogleGenerativeAI``.

    CrewAI's ``create_llm`` bridges the LangChain model into the official
    ``GeminiCompletion`` provider, which implements the full ``call()`` contract
    (including ``from_task`` / ``from_agent`` kwargs required by CrewAI 1.14+).
    """
    if not settings.GEMINI_API_KEY:
        raise ValueError(
            "GEMINI_API_KEY is not configured. Set it in the environment or .env file."
        )

    langchain_llm = ChatGoogleGenerativeAI(
        model=settings.GEMINI_MODEL,
        google_api_key=settings.GEMINI_API_KEY,
        temperature=temperature,
        request_timeout=30,  # hard 30s per HTTP call — prevents TCP-level stalls
        max_retries=0,       # disable LangChain's own retry; our loop controls backoff
    )

    crew_llm = create_llm(langchain_llm)
    if crew_llm is None:
        raise ValueError("Failed to initialize CrewAI LLM from ChatGoogleGenerativeAI.")
    return crew_llm
