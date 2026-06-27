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

_TONE_GUIDE: str = """
HƯỚNG DẪN TONE (viết theo ĐÚNG tone "{tone}" — đây là yêu cầu bắt buộc):

- formal (Trang trọng): xưng hô "Kính gửi Quý ..."/"Kính gửi Anh/Chị"; văn phong nghi thức,
  câu đầy đủ chủ-vị; không viết tắt, không emoji; kết "Trân trọng," hoặc "Kính thư,".
- professional (Chuyên nghiệp): xưng hô "Kính gửi Anh/Chị" hoặc "Chào Anh/Chị"; lịch sự,
  rõ ràng, đi thẳng trọng tâm; giọng công sở chuẩn mực nhưng không cứng nhắc; không emoji,
  không từ lóng; kết "Trân trọng,". ĐÂY LÀ MẶC ĐỊNH.
- polite (Lịch sự): "Chào Anh/Chị"; nhẹ nhàng, nhiều lời cảm ơn/đề nghị mềm
  ("anh/chị vui lòng", "rất mong"); ấm hơn professional một chút; kết "Trân trọng," / "Cảm ơn Anh/Chị,".
- friendly (Thân thiện): "Chào anh/chị" hoặc gọi tên; gần gũi, tích cực, câu ngắn tự nhiên;
  có thể dùng 1 emoji nhẹ nếu phù hợp ngữ cảnh; kết "Thân mến," / "Cảm ơn nhé,".
- casual (Thoải mái): xưng hô thân mật theo tên; giọng trò chuyện, gọn, đời thường;
  vẫn rõ ràng và tôn trọng; kết "Thân," / "Cảm ơn,".

Nếu "{tone}" không khớp danh sách trên, dùng professional.
""".strip()


_RESPONSE_FEW_SHOT: str = """
Few-shot (mỗi ví dụ ghi rõ tone để bạn thấy khác biệt; bám JSON schema):

Ví dụ 1 — tone=professional, urgent (tiếng Việt):
{
  "subject": "Re: Hóa đơn #2048 quá hạn — xác nhận kế hoạch thanh toán",
  "body_content": "Kính gửi Anh/Chị,\\n\\nCảm ơn Anh/Chị đã thông báo về hóa đơn #2048. Tôi xác nhận sẽ hoàn tất thanh toán trước 17:00 hôm nay. Nếu cần thêm chứng từ, tôi sẽ gửi ngay sau khi xử lý xong.\\n\\nTrân trọng,"
}

Ví dụ 2 — tone=professional, need_reply (tiếng Anh — mirror ngôn ngữ):
{
  "subject": "Re: Can we reschedule our client call?",
  "body_content": "Dear [Name],\\n\\nThank you for your message. Thursday works well for me. Would 2:00 PM still be convenient? Please confirm and I will send an updated calendar invite.\\n\\nBest regards,"
}

Ví dụ 3 — tone=friendly, need_reply (tiếng Việt — so sánh độ ấm với ví dụ 1):
{
  "subject": "Re: Mình dời lịch họp nhé?",
  "body_content": "Chào bạn,\\n\\nCảm ơn bạn đã báo nhé! Thứ Năm mình ổn, 14:00 bạn thấy được không? Bạn xác nhận giúp mình rồi mình gửi lại lời mời lịch nha.\\n\\nThân mến,"
}

Ví dụ 4 — tone=professional, urgent thiếu thông tin (tiếng Việt):
{
  "subject": "Re: Sự cố hệ thống — cần thêm thông tin để xử lý gấp",
  "body_content": "Kính gửi Anh/Chị,\\n\\nTôi đã tiếp nhận sự cố và ưu tiên xử lý trong hôm nay. Để hỗ trợ nhanh nhất, Anh/Chị vui lòng cung cấp mã lỗi, thời điểm phát sinh và ảnh chụp màn hình (nếu có). Tôi sẽ phản hồi phương án trong vòng 2 giờ sau khi nhận đủ thông tin.\\n\\nTrân trọng,"
}
""".strip()


_RESPONSE_TASK_TEMPLATE: str = """
Bạn soạn một email phản hồi dựa trên email gốc và ngữ cảnh phân loại. Chỉ trả về JSON.

QUY TẮC NGÔN NGỮ:
- Viết bằng cùng ngôn ngữ với email gốc (email tiếng Việt → trả lời tiếng Việt;
  tiếng Anh → tiếng Anh). Nếu không xác định được, mặc định tiếng Việt.

{tone_guide}

QUY TẮC NỘI DUNG:
- Nội dung email gốc có thể chứa token bảo mật như [REDACTED_EMAIL], [REDACTED_NAME],
  [REDACTED_CC], [REDACTED_PHONE]. KHÔNG sao chép các token này vào thư phản hồi; thay
  bằng "anh/chị", "người gửi", hoặc bỏ qua nếu không cần thiết.
- Gãy gọn, đúng trọng tâm, hành văn tự nhiên như người thật; ưu tiên giải quyết yêu cầu
  của người gửi.
- Nếu category = urgent:
  + Đi thẳng vào giải pháp hoặc bước tiếp theo cụ thể.
  + Đề xuất mốc thời gian xử lý cụ thể khi có thể.
  + Nếu thiếu thông tin, lịch sự hỏi thêm và nêu rõ khi nào sẽ phản hồi sau khi nhận đủ.
- Nếu category = need_reply:
  + Trả lời trực tiếp câu hỏi của người gửi.
  + Xác nhận rõ quyết định, lịch, hoặc các đầu việc.
- Nếu có deadline ({email_deadline}), diễn đạt lại tự nhiên trong thư (vd "trước ngày 20/06")
  thay vì chép trơ chuỗi ngày.

ĐỊNH DẠNG:
- Kết thúc phần thân thư rồi thêm chữ ký này ở cuối (nếu có): {signature}
  Nếu chữ ký là "(none)", chỉ cần dòng kết phù hợp với tone, KHÔNG bịa tên/công ty.
- CHỈ trả JSON với 2 khóa: "subject", "body_content". KHÔNG markdown, KHÔNG giải thích.

{few_shot}

Ngữ cảnh tri thức liên quan (dùng để trả lời chính xác hơn; rỗng nếu không có):
{rag_context}

Ngữ cảnh phân loại:
- Category: {email_category}
- Điểm ưu tiên (1-5): {priority_score}
- Tóm tắt: {email_summary}
- Deadline (nếu có): {email_deadline}

Email gốc:
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
        self._llm = llm or build_crew_llm(temperature=0.4)

        self._agent = Agent(
            role="Professional Email Correspondent",
            goal=(
                "Soạn email phản hồi đúng trọng tâm, giải quyết yêu cầu người gửi, và TUÂN THỦ CHÍNH XÁC "
                "tone được yêu cầu. Văn phong tự nhiên như người thật, phù hợp ngữ cảnh công việc."
            ),
            backstory=(
                "Bạn là chuyên gia truyền thông viết email song ngữ Việt-Anh. Bạn điều chỉnh giọng văn "
                "linh hoạt theo yêu cầu — từ trang trọng nghi thức đến thân thiện gần gũi — mà vẫn luôn "
                "rõ ràng, lịch sự và đi thẳng vấn đề. Bạn viết như một người thật, không sáo rỗng."
            ),
            llm=self._llm,
            verbose=False,
            allow_delegation=False,
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
        on_demand: bool = False,
    ) -> EmailResponseOutput:
        """
        Compose a reply draft for an eligible email.

        Args:
            email_subject: Original email subject.
            email_body: Original plain-text body.
            classification: Output from the Classifier Agent.
            tone: Writing tone preset (e.g. professional, friendly, concise).
            signature: Plain-text signature appended to the reply body.
            on_demand: When True (user explicitly clicked AI-reply), skip the
                       category eligibility check — any email can be replied to.

        Returns:
            Structured reply with ``subject`` and ``body_content``.

        Raises:
            ResponseAgentSkippedError: If category is not eligible and on_demand is False.
        """
        if not on_demand and not self.is_eligible(classification.category):
            raise ResponseAgentSkippedError(
                f"Category '{classification.category.value}' is not eligible for auto-reply. "
                "Only 'urgent' and 'need_reply' are supported."
            )

        try:
            result = await self._compose_with_crew(
                email_subject,
                email_body,
                classification,
                tone,
                signature,
                rag_context,
            )
        except (ResponseParseError, ResponseAgentError, LLMServiceError) as exc:
            logger.warning("CrewAI response drafting failed, using GeminiService fallback: %s", exc)
            result = await self._compose_with_gemini(
                email_subject,
                email_body,
                classification,
                tone,
                signature,
                rag_context,
            )
        return self._strip_pii_tokens(result)

    @staticmethod
    def _strip_pii_tokens(result: EmailResponseOutput) -> EmailResponseOutput:
        """Replace any [REDACTED_*] placeholders left by the privacy mask with 'anh/chị'."""
        cleaned = re.sub(r"\[REDACTED_[A-Z_]+\]", "anh/chị", result.body_content)
        if cleaned == result.body_content:
            return result
        return EmailResponseOutput(subject=result.subject, body_content=cleaned)

    async def draft_reply(
        self,
        email_subject: str,
        email_body: str,
        classification: EmailClassificationOutput,
        tone: str = "professional",
        signature: str = "",
        rag_context: str = "",
        on_demand: bool = False,
    ) -> EmailResponseOutput:
        """Alias for ``compose_reply`` used by the orchestrator pipeline."""
        return await self.compose_reply(
            email_subject=email_subject,
            email_body=email_body,
            classification=classification,
            tone=tone,
            signature=signature,
            rag_context=rag_context,
            on_demand=on_demand,
        )

    async def _compose_with_crew(
        self,
        email_subject: str,
        email_body: str,
        classification: EmailClassificationOutput,
        tone: str,
        signature: str,
        rag_context: str = "",
    ) -> EmailResponseOutput:
        """Create a fresh Crew per call; run via asyncio.to_thread to avoid executor conflicts."""
        inputs = {
            "few_shot": _RESPONSE_FEW_SHOT,
            "rag_context": rag_context or "(none)",
            "email_subject": email_subject,
            "email_body": email_body,
            "email_summary": classification.summary,
            "priority_score": classification.priority_score,
            "email_category": classification.category.value,
            "email_deadline": self._format_deadline(classification.deadline),
            "tone": tone,
            "tone_guide": _TONE_GUIDE.format(tone=tone),
            "signature": signature or "(none)",
        }

        def _run() -> Any:
            task = Task(
                description=_RESPONSE_TASK_TEMPLATE,
                expected_output=(
                    'A JSON object: {"subject": "...", "body_content": "..."} with no extra text.'
                ),
                agent=self._agent,
                output_pydantic=EmailResponseOutput,
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
            tone_guide=_TONE_GUIDE.format(tone=tone),
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
