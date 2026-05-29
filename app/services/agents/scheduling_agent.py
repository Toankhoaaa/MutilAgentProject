"""CrewAI-based scheduling agent: extracts meeting time and drafts confirmation reply."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from crewai import Agent, Crew, Process, Task
from crewai.llms.base_llm import BaseLLM
from pydantic import ValidationError

from app.schemas.agent_schemas import SchedulingOutput
from app.services.agents.gemini_crew_llm import build_crew_llm
from app.services.llm_service import GeminiService, LLMServiceError

logger = logging.getLogger(__name__)

_VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def _current_time_vn() -> str:
    """Return the current Vietnam time as a human-readable ISO 8601 string."""
    now = datetime.now(_VN_TZ)
    return now.strftime("%Y-%m-%dT%H:%M:%S+07:00")


def _default_end_time(start_iso: str, hours: int = 1) -> str:
    """Add ``hours`` to an ISO 8601 datetime string and return the result."""
    dt = datetime.fromisoformat(start_iso)
    return (dt + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%S+07:00")


_FEW_SHOT_EXAMPLES: str = """
Few-shot examples (current_time = 2026-05-28T09:00:00+07:00, Wednesday):

Example 1 — Explicit date & time (Vietnamese):
Subject: "Mời họp dự án Q3 chiều mai 14h"
Body: "Anh/chị ơi, mình mời họp dự án Q3 vào chiều mai, 14:00. Địa điểm: phòng họp B."
Sender: manager@company.vn
Expected JSON:
{
  "is_meeting_request": true,
  "start_datetime": "2026-05-29T14:00:00+07:00",
  "end_datetime":   "2026-05-29T15:00:00+07:00",
  "event_summary":  "Họp dự án Q3 — phòng họp B",
  "suggested_reply": "Chào anh/chị,\\n\\nEm xác nhận tham gia buổi họp dự án Q3 vào lúc 14:00 ngày 29/05/2026 tại phòng họp B.\\n\\nLink Google Meet: {{meet_link}}\\n\\nTrân trọng,"
}

Example 2 — Relative day + next Monday (English):
Subject: "Team sync next Monday 10 AM"
Body: "Hi, let's sync next Monday at 10 AM for 30 minutes to align on the sprint."
Sender: lead@startup.io
Expected JSON:
{
  "is_meeting_request": true,
  "start_datetime": "2026-06-01T10:00:00+07:00",
  "end_datetime":   "2026-06-01T10:30:00+07:00",
  "event_summary":  "Team sync — sprint alignment",
  "suggested_reply": "Hi,\\n\\nConfirmed for next Monday, 01 June 2026 at 10:00 AM (30 min). I'll send a calendar invite shortly.\\n\\nMeet link: {{meet_link}}\\n\\nBest regards,"
}

Example 3 — Not a meeting request (newsletter):
Subject: "Your weekly digest"
Body: "Here are the top stories this week. Click to read more."
Sender: news@newsletter.com
Expected JSON:
{
  "is_meeting_request": false,
  "start_datetime": null,
  "end_datetime":   null,
  "event_summary":  null,
  "suggested_reply": ""
}

Example 4 — Vague request, no concrete time (needs clarification):
Subject: "Muốn gặp để bàn về dự án"
Body: "Chào, mình muốn gặp để bàn kế hoạch, không biết anh/chị rảnh khi nào?"
Sender: client@corp.com
Expected JSON:
{
  "is_meeting_request": true,
  "start_datetime": null,
  "end_datetime":   null,
  "event_summary":  "Họp trao đổi kế hoạch dự án",
  "suggested_reply": "Chào anh/chị,\\n\\nEm rất vui được sắp xếp buổi gặp. Anh/chị có thể cho em biết khung giờ phù hợp không? Em thường rảnh vào buổi sáng các ngày trong tuần từ 9:00–11:30.\\n\\nTrân trọng,"
}

Example 5 — Vietnamese, this Friday afternoon:
Subject: "Cuộc họp review sprint chiều thứ Sáu"
Body: "Team ơi, mình sẽ review sprint vào chiều thứ Sáu tuần này lúc 15:30 nhé, khoảng 45 phút."
Sender: scrum@team.dev
Expected JSON:
{
  "is_meeting_request": true,
  "start_datetime": "2026-05-29T15:30:00+07:00",
  "end_datetime":   "2026-05-29T16:15:00+07:00",
  "event_summary":  "Sprint review — chiều thứ Sáu",
  "suggested_reply": "Chào team,\\n\\nEm xác nhận tham gia buổi sprint review vào 15:30 thứ Sáu ngày 29/05/2026 (~45 phút).\\n\\nLink Meet: {{meet_link}}\\n\\nTrân trọng,"
}
""".strip()

_SCHEDULING_TASK_TEMPLATE: str = """
You are a smart calendar scheduling assistant. Analyze the email and determine whether it
contains a concrete meeting request, then extract the exact meeting time and compose a
professional confirmation reply.

IMPORTANT — Current system time (Vietnam, UTC+7):
{current_time}
Use this as the reference anchor for all relative expressions such as "chiều mai",
"thứ Hai tới", "next Friday", "in two days", etc.

RULES:
1. Output ONLY a valid JSON object — no markdown fences, no extra commentary.
2. Timezone: ALWAYS use +07:00 offset (Asia/Ho_Chi_Minh). Never output UTC/Z.
3. If the email specifies a duration (e.g. "30 phút", "1 tiếng"), set end_datetime accordingly.
   Otherwise default to start_datetime + 1 hour.
4. If the email asks to meet but gives NO specific time, set start_datetime and end_datetime
   to null and compose a polite reply asking for the sender's availability.
5. If is_meeting_request is False, start_datetime, end_datetime, and event_summary must be null
   and suggested_reply must be an empty string "".
6. suggested_reply must mirror the language of the original email (Vietnamese → Vietnamese,
   English → English). Include the placeholder {{meet_link}} for the Google Meet URL.
7. event_summary must be a concise title for Google Calendar (max 80 characters).

{few_shot}

Email to analyze:
Current time: {current_time}
From: {sender}
Subject: {email_subject}
Body:
{email_body}
""".strip()


class SchedulingAgentError(Exception):
    """Base exception for scheduling agent failures."""


class SchedulingParseError(SchedulingAgentError):
    """Raised when CrewAI or Gemini output cannot be parsed into ``SchedulingOutput``."""


class EmailSchedulingAgent:
    """
    Extracts meeting information from emails and composes confirmation replies.

    Primary path  : CrewAI Agent + Task with ``output_pydantic=SchedulingOutput``.
    Fallback path : ``GeminiService.generate_structured_response``.

    Always pass the current Vietnam time via ``current_time`` so the model can
    correctly resolve relative expressions ("tomorrow", "chiều mai", etc.).
    """

    def __init__(
        self,
        gemini_service: GeminiService | None = None,
        llm: BaseLLM | None = None,
    ) -> None:
        """
        Args:
            gemini_service: Optional shared Gemini service instance.
            llm: Optional CrewAI LLM bridge (defaults to LangChain Gemini).
        """
        self._gemini_service = gemini_service or GeminiService()
        self._llm = llm or build_crew_llm(temperature=0.1)

        self._agent = Agent(
            role="Executive Assistant & Calendar Manager",
            goal=(
                "Trích xuất ngày giờ chính xác từ văn bản tự nhiên (tiếng Việt hoặc tiếng Anh), "
                "chuyển đổi sang định dạng ISO 8601 với múi giờ +07:00, kiểm tra tính hợp lệ, "
                "và soạn thư xác nhận lịch họp chuyên nghiệp."
            ),
            backstory=(
                "Bạn là trợ lý lên lịch thông minh của một công ty công nghệ. "
                "Bạn hiểu rõ các cách diễn đạt thời gian trong tiếng Việt và tiếng Anh: "
                "'chiều mai', 'thứ Hai tuần tới', 'in two weeks', 'end of month', v.v. "
                "Bạn luôn dựa vào thời gian thực tế được cung cấp để tính toán đúng ngày. "
                "Bạn không bao giờ phỏng đoán thời gian khi không có đủ thông tin — "
                "thay vào đó bạn lịch sự xin thêm thông tin từ người gửi."
            ),
            llm=self._llm,
            verbose=False,
            allow_delegation=False,
        )

        self._task = Task(
            description=_SCHEDULING_TASK_TEMPLATE,
            expected_output=(
                "A single JSON object with keys: is_meeting_request, start_datetime, "
                "end_datetime, event_summary, suggested_reply. "
                "No markdown fences or extra text."
            ),
            agent=self._agent,
            output_pydantic=SchedulingOutput,
        )

        self._crew = Crew(
            agents=[self._agent],
            tasks=[self._task],
            process=Process.sequential,
            verbose=False,
        )

    async def extract_schedule(
        self,
        email_subject: str,
        email_body: str,
        sender: str,
        current_time: str | None = None,
    ) -> SchedulingOutput:
        """
        Analyze an email for meeting requests and produce a structured scheduling result.

        Args:
            email_subject: Email subject line.
            email_body:    Plain-text email body.
            sender:        Sender email address or display name.
            current_time:  ISO 8601 string for "now" in Vietnam time.
                           Defaults to the actual current system time.

        Returns:
            ``SchedulingOutput`` with meeting details and a suggested reply.
        """
        now = current_time or _current_time_vn()
        try:
            return await asyncio.to_thread(
                self._extract_with_crew, email_subject, email_body, sender, now
            )
        except (SchedulingParseError, SchedulingAgentError, LLMServiceError) as exc:
            logger.warning(
                "CrewAI scheduling extraction failed, using GeminiService fallback: %s", exc
            )
            return await self._extract_with_gemini(email_subject, email_body, sender, now)

    # ── Internal: CrewAI path ─────────────────────────────────────────────

    def _extract_with_crew(
        self,
        email_subject: str,
        email_body: str,
        sender: str,
        current_time: str,
    ) -> SchedulingOutput:
        """Run the CrewAI scheduling workflow synchronously."""
        try:
            result = self._crew.kickoff(
                inputs={
                    "few_shot": _FEW_SHOT_EXAMPLES,
                    "current_time": current_time,
                    "sender": sender,
                    "email_subject": email_subject,
                    "email_body": email_body,
                }
            )
        except Exception as exc:
            raise SchedulingAgentError(f"CrewAI kickoff failed: {exc}") from exc

        output = self._parse_crew_result(result)
        return self._post_process(output)

    # ── Internal: Gemini fallback ─────────────────────────────────────────

    async def _extract_with_gemini(
        self,
        email_subject: str,
        email_body: str,
        sender: str,
        current_time: str,
    ) -> SchedulingOutput:
        """Fallback extraction via structured Gemini response."""
        prompt = _SCHEDULING_TASK_TEMPLATE.format(
            few_shot=_FEW_SHOT_EXAMPLES,
            current_time=current_time,
            sender=sender,
            email_subject=email_subject,
            email_body=email_body,
        )
        result = await self._gemini_service.generate_structured_response(
            prompt=prompt,
            schema=SchedulingOutput,
        )
        output = (
            result
            if isinstance(result, SchedulingOutput)
            else SchedulingOutput.model_validate(result.model_dump())
        )
        return self._post_process(output)

    # ── Output post-processing ────────────────────────────────────────────

    @staticmethod
    def _post_process(output: SchedulingOutput) -> SchedulingOutput:
        """
        Apply rule-based corrections that the model might miss:
        - Fill end_datetime when start_datetime is set but end is missing.
        - Ensure timezone suffix is present on datetime fields.
        """
        if not output.is_meeting_request:
            return output

        if output.start_datetime and not output.end_datetime:
            try:
                output = output.model_copy(
                    update={"end_datetime": _default_end_time(output.start_datetime)}
                )
                logger.debug(
                    "Post-processed: set end_datetime to start + 1hr → %s",
                    output.end_datetime,
                )
            except (ValueError, OverflowError) as exc:
                logger.warning("Could not compute default end_datetime: %s", exc)

        return output

    # ── Result parsing ────────────────────────────────────────────────────

    def _parse_crew_result(self, result: Any) -> SchedulingOutput:
        """Parse CrewAI output into ``SchedulingOutput``."""
        try:
            pydantic_output = getattr(result, "pydantic", None)
            if pydantic_output is not None:
                return SchedulingOutput.model_validate(pydantic_output)

            if isinstance(result, SchedulingOutput):
                return result

            tasks_output = getattr(result, "tasks_output", None)
            if tasks_output:
                last_output = tasks_output[-1]
                if hasattr(last_output, "pydantic") and last_output.pydantic is not None:
                    return SchedulingOutput.model_validate(last_output.pydantic)
                if hasattr(last_output, "json_dict") and last_output.json_dict:
                    return SchedulingOutput.model_validate(last_output.json_dict)

            raw_output = getattr(result, "raw", None) or str(result)
            json_payload = self._extract_json_object(raw_output)
            return SchedulingOutput.model_validate(json_payload)
        except (ValidationError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise SchedulingParseError(
                f"Unable to parse CrewAI scheduling output: {exc}"
            ) from exc

    @staticmethod
    def _extract_json_object(raw_text: str) -> dict[str, Any]:
        """Extract the first JSON object from a raw model output string."""
        text = raw_text.strip()

        fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if fence_match:
            text = fence_match.group(1)

        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("No JSON object found in scheduling model output.")

        return json.loads(text[start : end + 1])
