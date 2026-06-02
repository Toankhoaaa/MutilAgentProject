"""CrewAI-based email response drafting agent."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import date
from typing import Any

from crewai import Agent, Crew, Process, Task
from crewai.llms.base_llm import BaseLLM
from pydantic import ValidationError

from backend.schemas.agent_schemas import (
    EmailCategory,
    EmailClassificationOutput,
    EmailResponseOutput,
)
from backend.services.agents.gemini_crew_llm import build_crew_llm
from backend.services.llm_service import GeminiService, LLMServiceError

logger = logging.getLogger(__name__)

_ELIGIBLE_CATEGORIES: frozenset[EmailCategory] = frozenset(
    {EmailCategory.URGENT, EmailCategory.NEED_REPLY}
)

_RESPONSE_FEW_SHOT: str = """
Few-shot examples (match the output JSON schema):

Example 1 — Urgent (Vietnamese):
Category: urgent | Summary: Hóa đơn quá hạn cần thanh toán hôm nay
Output:
{
  "subject": "Re: Hóa đơn #2048 quá hạn — xác nhận kế hoạch thanh toán",
  "body_content": "Chào anh/chị,\\n\\nCảm ơn anh/chị đã nhắc về hóa đơn #2048. Em xác nhận đã ghi nhận yêu cầu và sẽ hoàn tất thanh toán trước 17:00 hôm nay. Nếu cần thêm chứng từ, em sẽ gửi ngay sau khi xử lý xong.\\n\\nTrân trọng,"
}

Example 2 — Need reply (English, mirror language):
Category: need_reply | Summary: Reschedule call from tomorrow to Thursday
Output:
{
  "subject": "Re: Can we reschedule our client call?",
  "body_content": "Hi,\\n\\nThanks for your message. Thursday works for me — would 2:00 PM still suit you? Please confirm and I will send an updated calendar invite.\\n\\nBest regards,"
}

Example 3 — Urgent, missing info (Vietnamese):
Category: urgent | Summary: Sự cố hệ thống nhưng thiếu mã lỗi
Output:
{
  "subject": "Re: Sự cố hệ thống — cần thêm thông tin để xử lý gấp",
  "body_content": "Chào anh/chị,\\n\\nEm đã tiếp nhận sự cố và ưu tiên xử lý trong hôm nay. Để hỗ trợ nhanh nhất, anh/chị vui lòng gửi giúp mã lỗi, thời điểm phát sinh và ảnh chụp màn hình (nếu có). Em cam kết phản hồi phương án xử lý trong vòng 2 giờ sau khi nhận đủ thông tin.\\n\\nTrân trọng,"
}
""".strip()

_RESPONSE_TASK_TEMPLATE: str = """
Draft a professional reply email based on the original message and classification context.

Constraints:
- Default tone: professional Vietnamese, UNLESS the original email is clearly in another
  language — then mirror that language naturally.
- Writing style: concise, polite, human-like; prioritize the sender's request.
- If category is URGENT:
  + Go straight to the solution or concrete next step.
  + Propose a specific handling timeline (date/time) when possible.
  + If information is insufficient, politely request the missing details while stating
    when you will follow up once received.
- If category is NEED_REPLY:
  + Answer the sender's question directly.
  + Confirm decisions, schedules, or action items clearly.
- Do NOT include markdown fences, XML, or commentary outside the JSON object.
- Output ONLY valid JSON with keys: "subject", "body_content".
- Sử dụng giọng văn: {tone}. Thêm chữ ký này vào cuối thư: {signature}

{few_shot}

Relevant knowledge base context (use to improve reply accuracy; empty if unavailable):
{rag_context}

Classification context:
- Category: {email_category}
- Priority score (1-5): {priority_score}
- Summary: {email_summary}
- Deadline (if any): {email_deadline}

Original email:
Subject: {email_subject}
Body:
{email_body}
""".strip()


class ResponseAgentError(Exception):
    """Base exception for response agent failures."""


class ResponseAgentSkippedError(ResponseAgentError):
    """Raised when the email category does not require an automated reply."""


class ResponseParseError(ResponseAgentError):
    """Raised when CrewAI or Gemini output cannot be parsed into the response schema."""


class EmailResponseAgent:
    """
    Drafts reply emails for ``urgent`` and ``need_reply`` classifications.

    Uses CrewAI Agent + Task with ``EmailResponseOutput`` schema enforcement.
    Falls back to ``GeminiService.generate_structured_response`` on failure.
    """

    def __init__(
        self,
        gemini_service: GeminiService | None = None,
        llm: BaseLLM | None = None,
    ) -> None:
        """
        Initialize the response agent, CrewAI Agent, and Task.

        Args:
            gemini_service: Optional shared Gemini service instance.
            llm: Optional CrewAI LLM (defaults to LangChain Gemini bridge).
        """
        self._gemini_service = gemini_service or GeminiService()
        self._llm = llm or build_crew_llm()

        self._agent = Agent(
            role="Professional Email Correspondent",
            goal=(
                "Dựa trên nội dung email gốc và kết quả phân loại (đặc biệt là tóm tắt/deadline), "
                "hãy soạn thảo một email phản hồi cực kỳ chuyên nghiệp, lịch sự, đúng trọng tâm "
                "và giải quyết được yêu cầu của người gửi."
            ),
            backstory=(
                "Bạn là một chuyên gia truyền thông và chăm sóc khách hàng. "
                "Bạn viết email rất gãy gọn, hành văn tự nhiên như người thật, "
                "luôn giữ thái độ hòa nhã và biết cách sắp xếp thông tin theo thứ tự ưu tiên hợp lý."
            ),
            llm=self._llm,
            verbose=False,
            allow_delegation=False,
        )

        self._task = Task(
            description=_RESPONSE_TASK_TEMPLATE,
            expected_output=(
                'A JSON object: {"subject": "...", "body_content": "..."} with no extra text.'
            ),
            agent=self._agent,
            output_pydantic=EmailResponseOutput,
        )

        self._crew = Crew(
            agents=[self._agent],
            tasks=[self._task],
            process=Process.sequential,
            verbose=False,
        )

    @staticmethod
    def is_eligible(category: EmailCategory | str) -> bool:
        """Return True when the category should trigger automated reply drafting."""
        if isinstance(category, EmailCategory):
            return category in _ELIGIBLE_CATEGORIES
        try:
            return EmailCategory(category) in _ELIGIBLE_CATEGORIES
        except ValueError:
            return False

    async def compose_reply(
        self,
        email_subject: str,
        email_body: str,
        classification: EmailClassificationOutput,
        tone: str = "professional",
        signature: str = "",
        rag_context: str = "",
    ) -> EmailResponseOutput:
        """
        Compose a reply draft for an eligible email.

        Args:
            email_subject: Original email subject.
            email_body: Original plain-text body.
            classification: Output from the Classifier Agent.
            tone: Writing tone preset (e.g. professional, friendly, concise).
            signature: Plain-text signature appended to the reply body.

        Returns:
            Structured reply with ``subject`` and ``body_content``.

        Raises:
            ResponseAgentSkippedError: If category is not ``urgent`` or ``need_reply``.
        """
        if not self.is_eligible(classification.category):
            raise ResponseAgentSkippedError(
                f"Category '{classification.category.value}' is not eligible for auto-reply. "
                "Only 'urgent' and 'need_reply' are supported."
            )

        try:
            return await asyncio.to_thread(
                self._compose_with_crew,
                email_subject,
                email_body,
                classification,
                tone,
                signature,
                rag_context,
            )
        except (ResponseParseError, ResponseAgentError, LLMServiceError) as exc:
            logger.warning("CrewAI response drafting failed, using GeminiService fallback: %s", exc)
            return await self._compose_with_gemini(
                email_subject,
                email_body,
                classification,
                tone,
                signature,
                rag_context,
            )

    async def draft_reply(
        self,
        email_subject: str,
        email_body: str,
        classification: EmailClassificationOutput,
        tone: str = "professional",
        signature: str = "",
        rag_context: str = "",
    ) -> EmailResponseOutput:
        """Alias for ``compose_reply`` used by the orchestrator pipeline."""
        return await self.compose_reply(
            email_subject=email_subject,
            email_body=email_body,
            classification=classification,
            tone=tone,
            signature=signature,
            rag_context=rag_context,
        )

    def _compose_with_crew(
        self,
        email_subject: str,
        email_body: str,
        classification: EmailClassificationOutput,
        tone: str,
        signature: str,
        rag_context: str = "",
    ) -> EmailResponseOutput:
        """Run the CrewAI response workflow synchronously."""
        try:
            result = self._crew.kickoff(
                inputs={
                    "few_shot": _RESPONSE_FEW_SHOT,
                    "rag_context": rag_context or "(none)",
                    "email_subject": email_subject,
                    "email_body": email_body,
                    "email_summary": classification.summary,
                    "priority_score": classification.priority_score,
                    "email_category": classification.category.value,
                    "email_deadline": self._format_deadline(classification.deadline),
                    "tone": tone,
                    "signature": signature or "(none)",
                }
            )
        except Exception as exc:
            raise ResponseAgentError(f"CrewAI kickoff failed: {exc}") from exc

        return self._parse_crew_result(result)

    async def _compose_with_gemini(
        self,
        email_subject: str,
        email_body: str,
        classification: EmailClassificationOutput,
        tone: str,
        signature: str,
        rag_context: str = "",
    ) -> EmailResponseOutput:
        """Fallback reply drafting via structured Gemini output."""
        prompt = _RESPONSE_TASK_TEMPLATE.format(
            few_shot=_RESPONSE_FEW_SHOT,
            rag_context=rag_context or "(none)",
            email_subject=email_subject,
            email_body=email_body,
            email_summary=classification.summary,
            priority_score=classification.priority_score,
            email_category=classification.category.value,
            email_deadline=self._format_deadline(classification.deadline),
            tone=tone,
            signature=signature or "(none)",
        )
        result = await self._gemini_service.generate_structured_response(
            prompt=prompt,
            schema=EmailResponseOutput,
        )
        if not isinstance(result, EmailResponseOutput):
            return EmailResponseOutput.model_validate(result.model_dump())
        return result

    def _parse_crew_result(self, result: Any) -> EmailResponseOutput:
        """Parse CrewAI output into ``EmailResponseOutput``."""
        try:
            pydantic_output = getattr(result, "pydantic", None)
            if pydantic_output is not None:
                return EmailResponseOutput.model_validate(pydantic_output)

            if isinstance(result, EmailResponseOutput):
                return result

            tasks_output = getattr(result, "tasks_output", None)
            if tasks_output:
                last_output = tasks_output[-1]
                if hasattr(last_output, "pydantic") and last_output.pydantic is not None:
                    return EmailResponseOutput.model_validate(last_output.pydantic)
                if hasattr(last_output, "json_dict") and last_output.json_dict:
                    return EmailResponseOutput.model_validate(last_output.json_dict)

            raw_output = getattr(result, "raw", None) or str(result)
            json_payload = self._extract_json_object(raw_output)
            return EmailResponseOutput.model_validate(json_payload)
        except (ValidationError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise ResponseParseError(f"Unable to parse CrewAI response output: {exc}") from exc

    @staticmethod
    def _format_deadline(deadline: str | date | None) -> str:
        """Normalize deadline for prompt interpolation."""
        if deadline is None:
            return "none"
        if isinstance(deadline, date):
            return deadline.isoformat()
        return str(deadline)

    @staticmethod
    def _extract_json_object(raw_text: str) -> dict[str, Any]:
        """Extract the first JSON object from a CrewAI raw string response."""
        text = raw_text.strip()

        fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if fence_match:
            text = fence_match.group(1)

        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("No JSON object found in model output.")

        return json.loads(text[start : end + 1])
