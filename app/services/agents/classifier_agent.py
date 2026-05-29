"""CrewAI-based email classifier agent with structured Gemini output."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from crewai import Agent, Crew, Process, Task
from crewai.llms.base_llm import BaseLLM
from pydantic import ValidationError

from app.schemas.agent_schemas import EmailClassificationOutput
from app.services.agents.gemini_crew_llm import build_crew_llm
from app.services.llm_service import GeminiService, LLMServiceError

logger = logging.getLogger(__name__)

_FEW_SHOT_EXAMPLES: str = """
Few-shot examples (follow the same JSON schema):

Example 1 — Urgent debt / meeting:
Subject: "URGENT: Invoice #2048 overdue — payment required today"
Body: "Your invoice is 30 days overdue. Pay before 5 PM today or service will be suspended."
Expected JSON:
{
  "category": "urgent",
  "priority_score": 5,
  "summary": "Invoice #2048 is overdue and payment is required today to avoid service suspension.",
  "deadline": "today",
  "confidence": 0.95
}

Example 2 — Spam / promotion:
Subject: "🎉 WIN a FREE iPhone — Click NOW!!!"
Body: "Congratulations! You have been selected. Unsubscribe link at the bottom."
Expected JSON:
{
  "category": "spam",
  "priority_score": 1,
  "summary": "Promotional spam email offering a free iPhone with suspicious marketing language.",
  "deadline": null,
  "confidence": 0.98
}

Example 3 — Needs reply:
Subject: "Can we reschedule our client call?"
Body: "Hi, I need to move tomorrow's 2 PM call to Thursday. Please confirm your availability."
Expected JSON:
{
  "category": "need_reply",
  "priority_score": 3,
  "summary": "Sender requests rescheduling tomorrow's client call to Thursday and needs confirmation.",
  "deadline": "tomorrow",
  "confidence": 0.9
}

Example 4 — Newsletter:
Subject: "Your weekly product digest — March edition"
Body: "Here are this week's top articles and release notes. Manage preferences | Unsubscribe"
Expected JSON:
{
  "category": "newsletter",
  "priority_score": 2,
  "summary": "Weekly product digest newsletter with articles and release notes.",
  "deadline": null,
  "confidence": 0.92
}

Example 5 — Important (not urgent):
Subject: "Q2 planning document for review"
Body: "Please review the attached Q2 plan when you have time this week. No immediate action needed."
Expected JSON:
{
  "category": "important",
  "priority_score": 4,
  "summary": "Q2 planning document attached for review this week without immediate urgency.",
  "deadline": null,
  "confidence": 0.88
}
""".strip()

_CLASSIFIER_TASK_TEMPLATE: str = """
Analyze the email below and produce ONLY a valid JSON object matching this schema:
- category: one of [urgent, important, need_reply, newsletter, spam]
- priority_score: integer 1-5 (5 = highest urgency)
- summary: at most two sentences
- deadline: ISO date string (YYYY-MM-DD) if a deadline is mentioned, otherwise null
- confidence: float between 0.0 and 1.0

Rules:
- Debt collection, same-day deadlines, or emergency client meetings -> urgent
- Marketing blasts, scams, or unsolicited promotions -> spam
- Newsletters and digests -> newsletter
- Direct questions or scheduling requests -> need_reply
- High-value but non-urgent work items -> important
- Do NOT include markdown fences or extra commentary.

{few_shot}

Email to classify:
From: {sender}
Subject: {subject}
Body:
{body}
""".strip()


class ClassifierAgentError(Exception):
    """Base exception for classifier agent failures."""


class ClassifierParseError(ClassifierAgentError):
    """Raised when CrewAI or Gemini output cannot be parsed into the schema."""


class EmailClassifierAgent:
    """
    Classifies inbound emails using a CrewAI Agent backed by ``GeminiService``.

    Primary path: CrewAI Agent + Task with ``output_pydantic``.
    Fallback path: direct ``GeminiService.generate_structured_response``.
    """

    def __init__(
        self,
        gemini_service: GeminiService | None = None,
        llm: BaseLLM | None = None,
    ) -> None:
        """
        Initialize the classifier agent, CrewAI Agent, and Task.

        Args:
            gemini_service: Optional shared Gemini service instance.
            llm: Optional CrewAI LLM (defaults to LangChain Gemini bridge).
        """
        self._gemini_service = gemini_service or GeminiService()
        self._llm = llm or build_crew_llm()

        self._agent = Agent(
            role="Senior Email Classifier and Analyst",
            goal=(
                "Phân tích nội dung email đầu vào một cách chính xác, phân loại danh mục, "
                "chấm điểm ưu tiên và trích xuất các thông tin quan trọng như tóm tắt và deadline."
            ),
            backstory=(
                "Bạn là một trợ lý AI cao cấp sở hữu kỹ năng phân tích ngôn ngữ xuất sắc. "
                "Bạn có khả năng đọc hiểu mọi loại email, lọc bỏ spam, nhận diện các vấn đề "
                "khẩn cấp để giúp người dùng không bỏ lỡ thông tin quan trọng."
            ),
            llm=self._llm,
            verbose=False,
            allow_delegation=False,
        )

        self._task = Task(
            description=_CLASSIFIER_TASK_TEMPLATE,
            expected_output=(
                "A single JSON object with keys: category, priority_score, summary, "
                "deadline, confidence. No markdown or extra text."
            ),
            agent=self._agent,
            output_pydantic=EmailClassificationOutput,
        )

        self._crew = Crew(
            agents=[self._agent],
            tasks=[self._task],
            process=Process.sequential,
            verbose=False,
        )

    async def classify(
        self,
        subject: str,
        body: str,
        sender: str | None = None,
    ) -> EmailClassificationOutput:
        """
        Classify an email and return a validated ``EmailClassificationOutput``.

        Args:
            subject: Email subject line.
            body: Plain-text email body.
            sender: Optional sender address or display name.

        Returns:
            Structured classification result.
        """
        try:
            return await asyncio.to_thread(self._classify_with_crew, subject, body, sender)
        except (ClassifierParseError, ClassifierAgentError, LLMServiceError) as exc:
            logger.warning("CrewAI classification failed, using GeminiService fallback: %s", exc)
            return await self._classify_with_gemini(subject, body, sender)

    def _classify_with_crew(
        self,
        subject: str,
        body: str,
        sender: str | None,
    ) -> EmailClassificationOutput:
        """Run the CrewAI workflow synchronously."""
        try:
            result = self._crew.kickoff(
                inputs={
                    "few_shot": _FEW_SHOT_EXAMPLES,
                    "subject": subject,
                    "body": body,
                    "sender": sender or "unknown",
                }
            )
        except Exception as exc:
            raise ClassifierAgentError(f"CrewAI kickoff failed: {exc}") from exc

        return self._parse_crew_result(result)

    async def _classify_with_gemini(
        self,
        subject: str,
        body: str,
        sender: str | None,
    ) -> EmailClassificationOutput:
        """Fallback classification using structured Gemini responses."""
        prompt = _CLASSIFIER_TASK_TEMPLATE.format(
            few_shot=_FEW_SHOT_EXAMPLES,
            subject=subject,
            body=body,
            sender=sender or "unknown",
        )
        result = await self._gemini_service.generate_structured_response(
            prompt=prompt,
            schema=EmailClassificationOutput,
        )
        if not isinstance(result, EmailClassificationOutput):
            return EmailClassificationOutput.model_validate(result.model_dump())
        return result

    def _parse_crew_result(self, result: Any) -> EmailClassificationOutput:
        """
        Parse CrewAI output into ``EmailClassificationOutput``.

        Handles ``result.pydantic``, JSON embedded in ``result.raw``, and dict payloads.
        """
        try:
            pydantic_output = getattr(result, "pydantic", None)
            if pydantic_output is not None:
                return EmailClassificationOutput.model_validate(pydantic_output)

            if isinstance(result, EmailClassificationOutput):
                return result

            tasks_output = getattr(result, "tasks_output", None)
            if tasks_output:
                last_output = tasks_output[-1]
                if hasattr(last_output, "pydantic") and last_output.pydantic is not None:
                    return EmailClassificationOutput.model_validate(last_output.pydantic)
                if hasattr(last_output, "json_dict") and last_output.json_dict:
                    return EmailClassificationOutput.model_validate(last_output.json_dict)

            raw_output = getattr(result, "raw", None) or str(result)
            json_payload = self._extract_json_object(raw_output)
            return EmailClassificationOutput.model_validate(json_payload)
        except (ValidationError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise ClassifierParseError(
                f"Unable to parse CrewAI classifier output: {exc}"
            ) from exc

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
