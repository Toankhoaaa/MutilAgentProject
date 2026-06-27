"""CrewAI-based delegation agent: splits multi-department work from an email."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from crewai import Agent, Crew, Process, Task
from crewai.llms.base_llm import BaseLLM
from pydantic import ValidationError

from backend.schemas.agent_schemas import DelegationOutput
from backend.services.agents.gemini_crew_llm import build_crew_llm
from backend.services.llm_service import GeminiService, LLMServiceError

logger = logging.getLogger(__name__)

_FEW_SHOT_EXAMPLES: str = """
Few-shot examples (all assignments include matched_department_id, confidence, reason):

Example A — AI infers departments from keywords (departments NOT named in email):
Subject: "Tổng hợp công nợ, dự toán ngân sách và chiến lược quý mới"
Body: "Cần tổng hợp công nợ khách hàng tháng 6, lập dự toán ngân sách Q3, và xây dựng chiến lược kinh doanh."
known_departments: [{"id": "d1", "name": "Kế toán", "keywords": "công nợ,ngân sách,hóa đơn"},
                    {"id": "d2", "name": "Marketing", "keywords": "chiến dịch,quảng cáo,truyền thông"}]
Expected JSON:
{
  "is_delegation": true,
  "assignments": [
    {
      "department_name": "Kế toán",
      "matched_department_id": "d1",
      "work_items": ["Tổng hợp công nợ khách hàng tháng 6", "Lập dự toán ngân sách Q3"],
      "priority": 3,
      "suggested_deadline": null,
      "confidence": 0.95,
      "reason": "Khớp keywords 'công nợ' và 'ngân sách' với phòng Kế toán"
    },
    {
      "department_name": "Chưa xác định",
      "matched_department_id": null,
      "work_items": ["Xây dựng chiến lược kinh doanh quý tới"],
      "priority": 3,
      "suggested_deadline": null,
      "confidence": 0.3,
      "reason": "Không khớp rõ với phòng nào trong danh sách"
    }
  ]
}

Example B — Ambiguous task touches keywords of two departments → "Chưa xác định":
Subject: "Dự toán ngân sách cho chiến dịch marketing Q3"
Body: "Cần lập dự toán ngân sách cho chiến dịch quảng cáo mạng xã hội quý 3."
known_departments: [{"id": "d1", "name": "Kế toán", "keywords": "ngân sách,công nợ,hóa đơn"},
                    {"id": "d2", "name": "Marketing", "keywords": "chiến dịch,quảng cáo,truyền thông"}]
Expected JSON:
{
  "is_delegation": true,
  "assignments": [
    {
      "department_name": "Chưa xác định",
      "matched_department_id": null,
      "work_items": ["Lập dự toán ngân sách cho chiến dịch quảng cáo mạng xã hội Q3"],
      "priority": 3,
      "suggested_deadline": null,
      "confidence": 0.4,
      "reason": "Chạm keywords của cả Kế toán ('ngân sách') lẫn Marketing ('chiến dịch','quảng cáo') — không xác định rõ phòng chủ trì"
    }
  ]
}

Example C — Single department only (is_delegation=true):
Subject: "Yêu cầu kiểm tra hệ thống mạng"
Body: "Nhờ phòng IT kiểm tra lại toàn bộ hệ thống mạng nội bộ và cập nhật firmware router."
known_departments: [{"id": "d3", "name": "IT", "keywords": "mạng,server,phần mềm,firmware"}]
Expected JSON:
{
  "is_delegation": true,
  "assignments": [
    {
      "department_name": "IT",
      "matched_department_id": "d3",
      "work_items": ["Kiểm tra hệ thống mạng nội bộ", "Cập nhật firmware router"],
      "priority": 3,
      "suggested_deadline": null,
      "confidence": 0.92,
      "reason": "Tên phòng 'IT' đúng trong danh sách và khớp keyword 'mạng', 'firmware'"
    }
  ]
}

Example D — No task matches any department:
Subject: "Chuẩn bị sự kiện khai trương"
Body: "Phòng Sự kiện cần đặt địa điểm và in ấn băng-rôn trước 15/07."
known_departments: [{"id": "d1", "name": "Kế toán", "keywords": "công nợ,ngân sách"},
                    {"id": "d2", "name": "IT", "keywords": "mạng,server"}]
Expected JSON:
{
  "is_delegation": true,
  "assignments": [
    {
      "department_name": "Chưa xác định",
      "matched_department_id": null,
      "work_items": ["Đặt địa điểm tổ chức", "In ấn băng-rôn"],
      "priority": 3,
      "suggested_deadline": "2026-07-15",
      "confidence": 0.2,
      "reason": "Phòng 'Sự kiện' không có trong danh sách known_departments"
    }
  ]
}

Example E — Not a delegation email:
Subject: "Thông báo nghỉ lễ 2/9"
Body: "Công ty sẽ nghỉ lễ Quốc khánh từ ngày 01/09 đến 03/09. Chúc mọi người kỳ nghỉ vui vẻ."
known_departments: []
Expected JSON:
{
  "is_delegation": false,
  "assignments": []
}
""".strip()

_TASK_TEMPLATE: str = """
You are a workplace coordinator assistant. Analyze the email and determine:
1. Is it delegating concrete work to one or more departments?
2. For each work item, which department is responsible — inferred from keywords when not stated explicitly?

RULES:
1. Output ONLY a valid JSON object — no markdown fences, no extra text.
2. is_delegation=true when the email assigns concrete tasks to ANY number of departments (even 1).
   is_delegation=false ONLY for announcements, newsletters, or purely personal messages.
3. Each work_item belongs to EXACTLY ONE assignment. Never duplicate across assignments.
4. Infer department from keywords: match each work item's content against known_departments keywords.
5. THREE SAFETY LAYERS — apply strictly:
   LAYER 1 — confidence: every assignment must have confidence 0.0–1.0.
     • ≥0.7: clear keyword match (high confidence).
     • <0.7: vague or inferred (low confidence, needs human review).
   LAYER 2 — "Chưa xác định" instead of guessing:
     • Work item does NOT match any known_department → department_name="Chưa xác định",
       matched_department_id=null, confidence≤0.4.
     • Work item matches keywords of TWO OR MORE departments ambiguously → ALSO "Chưa xác định",
       reason must list all candidate departments. NEVER assign to one arbitrarily.
     • NEVER invent a department not in known_departments.
   LAYER 3 — reason: always provide a brief Vietnamese explanation (≤30 words) for each assignment.
6. matched_department_id: the "id" field from known_departments that matched; null if no match.
7. Do NOT generate recipient_email — that is the caller's responsibility.
8. suggested_deadline: ISO YYYY-MM-DD if explicitly mentioned; null otherwise.
9. priority: 1–5 integer from urgency language in the email (5=highest).

Known departments (name + keywords + id for matching):
{known_departments_json}

{few_shot}

Email to analyze:
Subject: {email_subject}
Body:
{email_body}
""".strip()


class DelegationAgentError(Exception):
    """Base exception for delegation agent failures."""


class DelegationParseError(DelegationAgentError):
    """Raised when model output cannot be parsed into DelegationOutput."""


class DelegationAgent:
    """
    Extracts per-department work assignments from an email.

    Primary path  : CrewAI Agent + Task with output_pydantic=DelegationOutput.
    Fallback path : GeminiService.generate_structured_response.

    The caller must mask PII before passing email_body.
    """

    def __init__(
        self,
        gemini_service: GeminiService | None = None,
        llm: BaseLLM | None = None,
    ) -> None:
        self._gemini_service = gemini_service or GeminiService()
        self._llm = llm or build_crew_llm(temperature=0.2)

        self._agent = Agent(
            role="Workplace Coordinator",
            goal=(
                "Phân tích email giao việc, xác định đúng phần việc thuộc từng phòng ban, "
                "và trả kết quả cấu trúc JSON chính xác."
            ),
            backstory=(
                "Bạn là điều phối viên nội bộ chuyên đọc email từ ban lãnh đạo và "
                "tách rõ phần việc của từng phòng. Bạn không bao giờ để việc của phòng này "
                "lẫn sang phòng khác, và không bịa ra phòng ban không có trong nội dung email."
            ),
            llm=self._llm,
            verbose=False,
            allow_delegation=False,
        )

    async def analyze(
        self,
        email_subject: str,
        email_body: str,
        known_departments: list[dict[str, str]] | None = None,
    ) -> DelegationOutput:
        """
        Analyze an email for multi-department task delegation.

        Args:
            email_subject: Email subject (PII already masked by caller).
            email_body:    Email body (PII already masked by caller).
            known_departments: list of {name, keywords} from the user's departments table.

        Returns:
            DelegationOutput with is_delegation flag and per-department assignments.
        """
        depts = known_departments or []
        try:
            return await self._analyze_with_crew(email_subject, email_body, depts)
        except (DelegationParseError, DelegationAgentError, LLMServiceError) as exc:
            logger.warning("CrewAI delegation failed, falling back to GeminiService: %s", exc)
            return await self._analyze_with_gemini(email_subject, email_body, depts)

    # ── Internal: CrewAI path ─────────────────────────────────────────────

    async def _analyze_with_crew(
        self,
        email_subject: str,
        email_body: str,
        known_departments: list[dict[str, str]],
    ) -> DelegationOutput:
        inputs = {
            "few_shot": _FEW_SHOT_EXAMPLES,
            "known_departments_json": json.dumps(known_departments, ensure_ascii=False),
            "email_subject": email_subject,
            "email_body": email_body,
        }

        def _run() -> Any:
            task = Task(
                description=_TASK_TEMPLATE,
                expected_output=(
                    "A single JSON object with keys: is_delegation (bool), "
                    "assignments (list). Each assignment has: department_name (str), "
                    "work_items (list[str]), priority (int 1-5), suggested_deadline (str|null). "
                    "No markdown fences or extra text."
                ),
                agent=self._agent,
                output_pydantic=DelegationOutput,
            )
            crew = Crew(
                agents=[self._agent],
                tasks=[task],
                process=Process.sequential,
                verbose=False,
            )
            return crew.kickoff(inputs=inputs)

        try:
            result = await asyncio.to_thread(_run)
        except Exception as exc:
            raise DelegationAgentError(f"CrewAI kickoff failed: {exc}") from exc

        return self._parse_crew_result(result)

    # ── Internal: Gemini fallback ─────────────────────────────────────────

    async def _analyze_with_gemini(
        self,
        email_subject: str,
        email_body: str,
        known_departments: list[dict[str, str]],
    ) -> DelegationOutput:
        prompt = _TASK_TEMPLATE.format(
            few_shot=_FEW_SHOT_EXAMPLES,
            known_departments_json=json.dumps(known_departments, ensure_ascii=False),
            email_subject=email_subject,
            email_body=email_body,
        )
        try:
            result = await self._gemini_service.generate_structured_response(
                prompt=prompt,
                schema=DelegationOutput,
            )
            return (
                result
                if isinstance(result, DelegationOutput)
                else DelegationOutput.model_validate(result.model_dump())
            )
        except (ValidationError, LLMServiceError, Exception) as exc:
            logger.exception("Gemini delegation fallback failed: %s", exc)
            return DelegationOutput(is_delegation=False, assignments=[])

    # ── Result parsing ────────────────────────────────────────────────────

    def _parse_crew_result(self, result: Any) -> DelegationOutput:
        try:
            pydantic_output = getattr(result, "pydantic", None)
            if pydantic_output is not None:
                return DelegationOutput.model_validate(pydantic_output)

            if isinstance(result, DelegationOutput):
                return result

            tasks_output = getattr(result, "tasks_output", None)
            if tasks_output:
                last = tasks_output[-1]
                if hasattr(last, "pydantic") and last.pydantic is not None:
                    return DelegationOutput.model_validate(last.pydantic)
                if hasattr(last, "json_dict") and last.json_dict:
                    return DelegationOutput.model_validate(last.json_dict)

            raw = getattr(result, "raw", None) or str(result)
            return DelegationOutput.model_validate(self._extract_json_object(raw))
        except (ValidationError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise DelegationParseError(f"Unable to parse CrewAI delegation output: {exc}") from exc

    @staticmethod
    def _extract_json_object(raw_text: str) -> dict[str, Any]:
        text = raw_text.strip()
        fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if fence_match:
            text = fence_match.group(1)
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("No JSON object found in delegation model output.")
        return json.loads(text[start : end + 1])
