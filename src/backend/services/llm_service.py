"""Gemini LLM integration with structured JSON output and rule-based fallback."""

from __future__ import annotations

import asyncio
import json
import logging
from enum import Enum
from typing import Any, get_args, get_origin

from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel, ValidationError

from backend.core.config import normalize_gemini_model, settings

logger = logging.getLogger(__name__)

_CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "urgent": ("urgent", "asap", "immediately", "deadline", "critical", "khẩn", "overdue"),
    "important": ("important", "priority", "action required", "cần xử lý"),
    "need_reply": ("please reply", "waiting for your", "follow up", "phản hồi", "?"),
    "newsletter": ("newsletter", "weekly digest", "unsubscribe", "bản tin"),
    "spam": ("lottery", "winner", "viagra", "click here", "spam", "quảng cáo"),
}

_PRIORITY_KEYWORDS: tuple[tuple[str, int], ...] = (
    ("urgent", 5),
    ("asap", 5),
    ("critical", 5),
    ("deadline", 4),
    ("important", 4),
    ("reply", 3),
    ("reminder", 3),
    ("newsletter", 2),
    ("unsubscribe", 1),
)


class LLMServiceError(Exception):
    """Base exception for LLM service failures."""


class LLMRateLimitError(LLMServiceError):
    """Raised when the Gemini API reports rate limiting (HTTP 429)."""


class LLMNetworkError(LLMServiceError):
    """Raised when a network or transport error prevents an API call."""


class LLMParseError(LLMServiceError):
    """Raised when model output cannot be parsed into the target schema."""


class GeminiService:
    """Async wrapper around the Gemini API for schema-constrained agent responses."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        max_retries: int = 3,
        retry_base_delay_seconds: float = 1.0,
    ) -> None:
        """
        Initialize the Gemini client.

        Args:
            api_key: Optional override for ``settings.GEMINI_API_KEY``.
            model: Optional override for ``settings.GEMINI_MODEL``.
            max_retries: Number of API attempts before activating fallback.
            retry_base_delay_seconds: Base delay for exponential backoff on retries.
        """
        resolved_api_key = api_key or settings.GEMINI_API_KEY
        if not resolved_api_key:
            raise ValueError(
                "GEMINI_API_KEY is not configured. Set it in the environment or .env file."
            )

        self._model = normalize_gemini_model(model or settings.GEMINI_MODEL)
        self._max_retries = max_retries
        self._retry_base_delay_seconds = retry_base_delay_seconds
        self._client = genai.Client(api_key=resolved_api_key)

    async def generate_structured_response(
        self,
        prompt: str,
        schema: type[BaseModel],
    ) -> BaseModel:
        """
        Generate a JSON response from Gemini and validate it against ``schema``.

        Retries transient API failures. After repeated failures, applies a
        deterministic keyword-based fallback so downstream agents can continue.

        Args:
            prompt: User or system prompt sent to the model.
            schema: Pydantic model class describing the required response shape.

        Returns:
            A validated instance of ``schema``.

        Raises:
            LLMServiceError: If all retries and fallback logic fail unexpectedly.
        """
        last_error: Exception | None = None

        for attempt in range(1, self._max_retries + 1):
            try:
                return await self._invoke_gemini(prompt, schema)
            except LLMRateLimitError as exc:
                last_error = exc
                if attempt >= self._max_retries:
                    break
                delay = self._retry_base_delay_seconds * (2 ** (attempt - 1))
                logger.warning(
                    "Gemini rate limit hit (attempt %s/%s). Retrying in %.1fs.",
                    attempt,
                    self._max_retries,
                    delay,
                )
                await asyncio.sleep(delay)
            except (LLMNetworkError, LLMParseError) as exc:
                last_error = exc
                if attempt >= self._max_retries:
                    break
                delay = self._retry_base_delay_seconds * (2 ** (attempt - 1))
                logger.warning(
                    "Gemini call failed (attempt %s/%s): %s. Retrying in %.1fs.",
                    attempt,
                    self._max_retries,
                    exc,
                    delay,
                )
                await asyncio.sleep(delay)
            except genai_errors.APIError as exc:
                last_error = exc
                if self._is_rate_limit_error(exc):
                    wrapped = LLMRateLimitError(str(exc))
                    if attempt >= self._max_retries:
                        break
                    delay = self._retry_base_delay_seconds * (2 ** (attempt - 1))
                    logger.warning(
                        "Gemini API rate limit (attempt %s/%s). Retrying in %.1fs.",
                        attempt,
                        self._max_retries,
                        delay,
                    )
                    await asyncio.sleep(delay)
                    last_error = wrapped
                    continue
                if self._is_network_error(exc):
                    wrapped = LLMNetworkError(str(exc))
                    if attempt >= self._max_retries:
                        break
                    delay = self._retry_base_delay_seconds * (2 ** (attempt - 1))
                    logger.warning(
                        "Gemini network error (attempt %s/%s). Retrying in %.1fs.",
                        attempt,
                        self._max_retries,
                        delay,
                    )
                    await asyncio.sleep(delay)
                    last_error = wrapped
                    continue
                raise LLMServiceError(str(exc)) from exc
            except (ConnectionError, TimeoutError, OSError) as exc:
                last_error = LLMNetworkError(str(exc))
                if attempt >= self._max_retries:
                    break
                delay = self._retry_base_delay_seconds * (2 ** (attempt - 1))
                logger.warning(
                    "Network error calling Gemini (attempt %s/%s). Retrying in %.1fs.",
                    attempt,
                    self._max_retries,
                    delay,
                )
                await asyncio.sleep(delay)

        logger.error(
            "Gemini failed after %s attempts. Activating rule-based fallback. Last error: %s",
            self._max_retries,
            last_error,
        )
        return self._apply_rule_based_fallback(prompt, schema)

    async def generate_text(self, prompt: str, temperature: float = 0.2) -> str:
        """
        Generate a plain-text response from Gemini (used by CrewAI custom LLM).

        Args:
            prompt: Prompt text sent to the model.
            temperature: Sampling temperature for generation.

        Returns:
            Raw text content from the model.
        """
        config = types.GenerateContentConfig(temperature=temperature)

        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=prompt,
                config=config,
            )
        except genai_errors.APIError as exc:
            if self._is_rate_limit_error(exc):
                raise LLMRateLimitError(str(exc)) from exc
            if self._is_network_error(exc):
                raise LLMNetworkError(str(exc)) from exc
            raise LLMServiceError(str(exc)) from exc
        except (ConnectionError, TimeoutError, OSError) as exc:
            raise LLMNetworkError(str(exc)) from exc

        raw_text = (response.text or "").strip()
        if not raw_text:
            raise LLMParseError("Gemini returned an empty response body.")
        return raw_text

    async def _invoke_gemini(self, prompt: str, schema: type[BaseModel]) -> BaseModel:
        """Call Gemini once and parse the response into ``schema``."""
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=schema.model_json_schema(),
            temperature=0.2,
        )

        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=prompt,
                config=config,
            )
        except genai_errors.APIError as exc:
            if self._is_rate_limit_error(exc):
                raise LLMRateLimitError(str(exc)) from exc
            if self._is_network_error(exc):
                raise LLMNetworkError(str(exc)) from exc
            raise LLMServiceError(str(exc)) from exc
        except (ConnectionError, TimeoutError, OSError) as exc:
            raise LLMNetworkError(str(exc)) from exc

        raw_text = (response.text or "").strip()
        if not raw_text:
            raise LLMParseError("Gemini returned an empty response body.")

        try:
            return schema.model_validate_json(raw_text)
        except ValidationError as exc:
            raise LLMParseError(f"Response failed schema validation: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise LLMParseError(f"Response is not valid JSON: {exc}") from exc

    @staticmethod
    def _is_rate_limit_error(exc: genai_errors.APIError) -> bool:
        """Return True when the API error indicates rate limiting."""
        return getattr(exc, "code", None) == 429

    @staticmethod
    def _is_network_error(exc: genai_errors.APIError) -> bool:
        """Return True for transient server or gateway failures."""
        code = getattr(exc, "code", None)
        return code in {500, 502, 503, 504} if code is not None else False

    def _apply_rule_based_fallback(self, prompt: str, schema: type[BaseModel]) -> BaseModel:
        """
        Build a best-effort response using keyword heuristics.

        Field names drive inference (e.g. ``category``, ``priority_score``).
        Remaining required fields receive type-safe defaults.
        """
        prompt_lower = prompt.lower()
        payload: dict[str, Any] = {}

        for field_name, field_info in schema.model_fields.items():
            if field_name in payload:
                continue

            inferred = self._infer_field_value(field_name, prompt_lower, field_info.annotation)
            if inferred is not MISSING:
                payload[field_name] = inferred

        for field_name, field_info in schema.model_fields.items():
            if field_name not in payload:
                payload[field_name] = self._default_for_annotation(field_info.annotation)

        try:
            return schema.model_validate(payload)
        except ValidationError as exc:
            raise LLMServiceError(
                f"Rule-based fallback could not satisfy schema {schema.__name__}: {exc}"
            ) from exc

    def _infer_field_value(
        self,
        field_name: str,
        prompt_lower: str,
        annotation: Any,
    ) -> Any:
        """Infer a single field value from prompt keywords and field metadata."""
        normalized_name = field_name.lower()

        if normalized_name in {"category", "email_category", "label"}:
            return self._match_category(prompt_lower, annotation)

        if normalized_name in {"priority", "priority_score", "priority_level"}:
            return min(5, max(1, self._match_priority(prompt_lower)))

        if normalized_name == "deadline":
            if any(word in prompt_lower for word in ("today", "tomorrow", "hôm nay", "deadline", "due")):
                return "unknown"

        if normalized_name in {"detected_language", "language", "lang"}:
            # Safest fallback: return a valid ISO 639-1 code instead of empty string.
            return "en"

        if normalized_name in {"summary", "description", "reasoning"}:
            # Never put the prompt itself into the summary — just return a clear
            # fallback message so users don't see system-prompt text in the UI.
            return ["Không thể phân tích email lúc này. Vui lòng thử lại."]

        if normalized_name == "subject":
            return self._infer_reply_subject(prompt_lower)

        if normalized_name in {"body_content", "body", "draft_content"}:
            return self._infer_reply_body(prompt_lower)

        if normalized_name in {"requires_hitl", "fallback_used", "is_spam"}:
            if any(word in prompt_lower for word in ("legal", "confidential", "password", "hr")):
                return True
            if normalized_name == "is_spam":
                return any(word in prompt_lower for word in _CATEGORY_KEYWORDS["spam"])
            return False

        if normalized_name in {"confidence", "score"}:
            return 0.55

        if normalized_name == "sentiment":
            # Return title-cased values to satisfy Literal["Positive","Neutral","Negative"].
            if any(word in prompt_lower for word in ("thank", "great", "excellent", "cảm ơn", "xuất sắc")):
                return "Positive"
            if any(word in prompt_lower for word in ("angry", "complaint", "terrible", "khiếu nại", "urgent", "critical")):
                return "Negative"
            return "Neutral"

        return MISSING

    @staticmethod
    def _match_category(prompt_lower: str, annotation: Any) -> str:
        """Pick the highest-signal category keyword bucket."""
        for category, keywords in _CATEGORY_KEYWORDS.items():
            if category == "general":
                continue
            if any(keyword in prompt_lower for keyword in keywords):
                enum_value = GeminiService._coerce_enum_value(annotation, category)
                return enum_value if enum_value is not None else category
        enum_value = GeminiService._coerce_enum_value(annotation, "general")
        return enum_value if enum_value is not None else "general"

    @staticmethod
    def _match_priority(prompt_lower: str) -> int:
        """Derive a priority score from urgency keywords."""
        for keyword, score in _PRIORITY_KEYWORDS:
            if keyword in prompt_lower:
                return score
        return 5

    @staticmethod
    def _infer_reply_subject(prompt_lower: str) -> str:
        """Build a deterministic reply subject from the original email subject in the prompt."""
        marker = "subject:"
        if marker in prompt_lower:
            segment = prompt_lower.split(marker, 1)[1].split("\n", 1)[0].strip()
            cleaned = segment.strip("\"' ")
            if cleaned:
                return f"Re: {cleaned[:120]}"
        return "Re: Your message"

    @staticmethod
    def _infer_reply_body(prompt_lower: str) -> str:
        """Build a polite default reply body when the LLM is unavailable."""
        if any(word in prompt_lower for word in ("invoice", "payment", "overdue", "urgent", "hóa đơn")):
            return (
                "Chào anh/chị,\n\n"
                "Cảm ơn email của anh/chị. Em đã ghi nhận yêu cầu khẩn và sẽ xử lý "
                "trong hôm nay, đồng thời gửi xác nhận ngay khi hoàn tất.\n\n"
                "Trân trọng,"
            )
        if any(word in prompt_lower for word in ("reschedule", "confirm", "availability", "reply")):
            return (
                "Chào anh/chị,\n\n"
                "Cảm ơn email của anh/chị. Em xác nhận đã nhận yêu cầu và sẽ phản hồi "
                "lịch hẹn phù hợp trong thời gian sớm nhất.\n\n"
                "Trân trọng,"
            )
        return (
            "Chào anh/chị,\n\n"
            "Cảm ơn email của anh/chị. Em đã ghi nhận nội dung và sẽ phản hồi chi tiết sớm nhất.\n\n"
            "Trân trọng,"
        )

    @staticmethod
    def _truncate_summary(prompt_lower: str, max_length: int = 240) -> str:
        """Use the prompt itself as a deterministic summary fallback."""
        cleaned = " ".join(prompt_lower.split())
        if len(cleaned) <= max_length:
            return cleaned
        return f"{cleaned[: max_length - 3]}..."

    @staticmethod
    def _coerce_enum_value(annotation: Any, raw_value: str) -> str | None:
        """Map a string to a declared ``Enum`` member when applicable."""
        enum_cls = GeminiService._unwrap_optional(annotation)
        if isinstance(enum_cls, type) and issubclass(enum_cls, Enum):
            try:
                return enum_cls(raw_value).value  # type: ignore[call-arg]
            except ValueError:
                for member in enum_cls:
                    if member.value == raw_value:
                        return member.value
        return None

    @staticmethod
    def _unwrap_optional(annotation: Any) -> Any:
        """Return the inner type only for Optional[X] / Union[X, None].

        list[str], dict[str, Any], and other generic aliases are returned
        unchanged so that _default_for_annotation can detect their origin.
        """
        from typing import Union  # noqa: PLC0415

        origin = get_origin(annotation)
        # Only unwrap Union (which includes Optional[X] == Union[X, None]).
        # Do NOT unwrap list[X], dict[K, V], etc.
        if origin is Union:
            args = [arg for arg in get_args(annotation) if arg is not type(None)]
            return args[0] if len(args) == 1 else annotation
        return annotation

    @staticmethod
    def _default_for_annotation(annotation: Any) -> Any:
        """Provide a type-safe default when keyword inference cannot fill a field."""
        # Check the outer origin first so list[str] → [] and dict[...] → {}
        # without accidentally unwrapping the inner type.
        origin = get_origin(annotation)
        if origin is list:
            return []
        if origin is dict:
            return {}

        resolved = GeminiService._unwrap_optional(annotation)
        inner_origin = get_origin(resolved)
        if inner_origin is list:
            return []
        if inner_origin is dict:
            return {}

        if isinstance(resolved, type) and issubclass(resolved, Enum):
            return next(iter(resolved)).value

        if resolved is bool:
            return False
        if resolved is int:
            return 0
        if resolved is float:
            return 0.0
        if resolved is str:
            return ""
        return None


MISSING: Any = object()
