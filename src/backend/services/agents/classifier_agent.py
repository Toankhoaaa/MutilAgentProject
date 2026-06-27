"""CrewAI-based email classifier agent with structured Gemini output."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from crewai import Agent, Crew, Process, Task
from crewai.llms.base_llm import BaseLLM
from pydantic import ValidationError

from backend.schemas.agent_schemas import EmailClassificationOutput, EmailCategory
from backend.services.agents.gemini_crew_llm import build_crew_llm
from backend.services.llm_service import GeminiService, LLMServiceError

logger = logging.getLogger(__name__)

_FEW_SHOT_EXAMPLES: str = """
Few-shot examples (tuân thủ chính xác JSON schema; deadline ở dạng YYYY-MM-DD hoặc null):

Example 1 — Khẩn cấp (nợ/hạn trong ngày). current_date=2026-06-20:
Subject: "GẤP: Hóa đơn #2048 quá hạn — cần thanh toán hôm nay"
Body: "Hóa đơn của bạn đã quá hạn 30 ngày. Thanh toán trước 17h hôm nay nếu không dịch vụ sẽ bị tạm ngưng."
Expected JSON:
{
  "category": "urgent",
  "priority_score": 5,
  "summary": "Hóa đơn #2048 quá hạn, cần thanh toán trong hôm nay để tránh bị ngưng dịch vụ.",
  "deadline": "2026-06-20",
  "confidence": 0.95
}

Example 2 — Spam / quảng cáo:
Subject: "🎉 TRÚNG iPhone MIỄN PHÍ — Nhấn NGAY!!!"
Body: "Chúc mừng! Bạn đã được chọn. Link hủy đăng ký ở cuối thư."
Expected JSON:
{
  "category": "spam",
  "priority_score": 1,
  "summary": "Email quảng cáo spam tặng iPhone miễn phí với ngôn ngữ tiếp thị đáng ngờ.",
  "deadline": null,
  "confidence": 0.97
}

Example 3 — Cần trả lời (đổi lịch). current_date=2026-06-20:
Subject: "Mình dời cuộc gọi với khách được không?"
Body: "Chào bạn, mình cần dời cuộc gọi 14h ngày mai sang thứ Năm. Bạn xác nhận giúp mình nhé."
Expected JSON:
{
  "category": "need_reply",
  "priority_score": 3,
  "summary": "Người gửi đề nghị dời cuộc gọi từ ngày mai sang thứ Năm và cần xác nhận.",
  "deadline": "2026-06-21",
  "confidence": 0.9
}

Example 4 — Newsletter:
Subject: "Bản tin sản phẩm hằng tuần — số tháng 3"
Body: "Tổng hợp bài viết nổi bật và ghi chú phát hành tuần này. Quản lý tùy chọn | Hủy đăng ký"
Expected JSON:
{
  "category": "newsletter",
  "priority_score": 2,
  "summary": "Bản tin sản phẩm hằng tuần gồm bài viết và ghi chú phát hành.",
  "deadline": null,
  "confidence": 0.93
}

Example 5 — Quan trọng nhưng không khẩn:
Subject: "Tài liệu kế hoạch Q2 cần xem xét"
Body: "Bạn xem giúp bản kế hoạch Q2 đính kèm khi rảnh trong tuần nhé. Chưa cần xử lý ngay."
Expected JSON:
{
  "category": "important",
  "priority_score": 4,
  "summary": "Tài liệu kế hoạch Q2 đính kèm cần xem xét trong tuần, chưa cần xử lý ngay.",
  "deadline": null,
  "confidence": 0.88
}

Example 6 — Mơ hồ → confidence THẤP (dạy model thừa nhận khi không chắc):
Subject: "Re: cập nhật"
Body: "Ok bạn. Để mình xem lại rồi báo."
Expected JSON:
{
  "category": "need_reply",
  "priority_score": 2,
  "summary": "Email ngắn, nội dung không rõ ràng, có thể cần theo dõi phản hồi.",
  "deadline": null,
  "confidence": 0.45
}

Example 7 — Vừa khẩn vừa cần trả lời → ưu tiên urgent (xử lý chồng nhãn). current_date=2026-06-20:
Subject: "Server production down — cần phản hồi gấp"
Body: "Hệ thống đang lỗi nghiêm trọng. Anh xác nhận phương án xử lý ngay trong hôm nay được không?"
Expected JSON:
{
  "category": "urgent",
  "priority_score": 5,
  "summary": "Sự cố server production nghiêm trọng, cần xác nhận phương án xử lý ngay hôm nay.",
  "deadline": "2026-06-20",
  "confidence": 0.92
}
""".strip()


_CLASSIFIER_TASK_TEMPLATE: str = """
Phân loại email dưới đây và trả về CHỈ một JSON object đúng schema:
- category: một trong [urgent, important, need_reply, newsletter, spam]
- priority_score: số nguyên 1-5
- summary: tối đa 2 câu, bằng cùng ngôn ngữ với email
- deadline: chuỗi ISO "YYYY-MM-DD" nếu email có nhắc tới mốc thời gian cụ thể, ngược lại null
- confidence: số thực 0.0-1.0

Hôm nay là: {current_date}. Dùng giá trị này để quy đổi "hôm nay", "ngày mai", "thứ Sáu"
thành ngày ISO thật. Nếu email không nhắc mốc thời gian nào, deadline = null.

ĐỊNH NGHĨA CATEGORY (chọn DUY NHẤT một):
- urgent      — đòi hành động trong ngày / sự cố khẩn / nợ-hạn cùng ngày / họp khẩn
- need_reply  — có câu hỏi trực tiếp hoặc yêu cầu xác nhận, cần người nhận trả lời
- important   — việc quan trọng nhưng KHÔNG gấp, không cần phản hồi ngay
- newsletter  — bản tin, digest, thông báo định kỳ, có nút hủy đăng ký
- spam        — quảng cáo không mời, lừa đảo, tiếp thị rác

QUY TẮC KHI CHỒNG NHÃN (áp theo thứ tự ưu tiên, dừng ở mục khớp đầu tiên):
1. Nếu vừa khẩn vừa cần trả lời  → urgent
2. Nếu vừa quảng cáo vừa có dạng bản tin → newsletter nếu là nguồn hợp lệ có hủy đăng ký,
   ngược lại spam
3. Nếu vừa cần trả lời vừa quan trọng-không-gấp → need_reply
4. Còn lại → chọn nhãn mô tả đúng nhất mục đích chính của email

THANG priority_score:
5 = khẩn trong ngày | 4 = quan trọng, hạn trong tuần | 3 = cần trả lời thường
2 = thông tin/đọc khi rảnh | 1 = spam/rác

confidence: chấm THẬT theo độ chắc chắn. Email rõ ràng → 0.85-0.99.
Email ngắn/mơ hồ/thiếu ngữ cảnh → 0.3-0.6 để hệ thống biết cần người xem lại.

KHÔNG markdown fence, KHÔNG giải thích ngoài JSON.

{few_shot}

Email cần phân loại:
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
        self._llm = llm or build_crew_llm(temperature=0.2)

        self._agent = Agent(
            role="Senior Email Classifier and Analyst",
            goal=(
                "Phân loại email CHÍNH XÁC vào đúng một danh mục, chấm điểm ưu tiên hợp lý, "
                "tóm tắt ngắn gọn và trích xuất deadline. Ưu tiên sự chính xác và nhất quán — "
                "không thổi phồng mức độ khẩn, cũng không bỏ sót việc thật sự gấp."
            ),
            backstory=(
                "Bạn là chuyên gia phân loại email với khả năng đọc hiểu cả tiếng Việt và tiếng Anh. "
                "Bạn phân biệt rõ giữa việc thật sự khẩn và việc chỉ 'nghe có vẻ khẩn', giữa bản tin "
                "hợp lệ và spam. Khi nội dung mơ hồ, bạn thừa nhận sự không chắc chắn bằng confidence "
                "thấp thay vì đoán bừa, để con người có thể xem lại."
            ),
            llm=self._llm,
            verbose=False,
            allow_delegation=False,
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
        current_date = datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d")
        try:
            return await self._classify_with_crew(subject, body, sender, current_date)
        except (ClassifierParseError, ClassifierAgentError, LLMServiceError) as exc:
            logger.warning("CrewAI classification failed, using GeminiService fallback: %s", exc)
        try:
            return await self._classify_with_gemini(subject, body, sender, current_date)
        except Exception as exc:
            logger.warning(
                "Gemini classification fallback also failed: %s — returning safe default.", exc
            )
            return EmailClassificationOutput.model_construct(
                category=EmailCategory.IMPORTANT,
                priority_score=2,
                summary="Classification unavailable — please review manually.",
                deadline=None,
                confidence=0.0,
            )

    async def _classify_with_crew(
        self,
        subject: str,
        body: str,
        sender: str | None,
        current_date: str,
    ) -> EmailClassificationOutput:
        """Create a fresh Crew per call; run via asyncio.to_thread so kickoff's internal
        asyncio.run() gets a clean thread with no running event loop."""
        inputs = {
            "few_shot": _FEW_SHOT_EXAMPLES,
            "subject": subject,
            "body": body,
            "sender": sender or "unknown",
            "current_date": current_date,
        }

        def _run() -> Any:
            task = Task(
                description=_CLASSIFIER_TASK_TEMPLATE,
                expected_output=(
                    "A single JSON object with keys: category, priority_score, summary, "
                    "deadline, confidence. No markdown or extra text."
                ),
                agent=self._agent,
                output_pydantic=EmailClassificationOutput,
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
            raise ClassifierAgentError(f"CrewAI kickoff failed: {exc}") from exc
        return self._parse_crew_result(result)

    async def _classify_with_gemini(
        self,
        subject: str,
        body: str,
        sender: str | None,
        current_date: str,
    ) -> EmailClassificationOutput:
        """Fallback classification using structured Gemini responses."""
        prompt = _CLASSIFIER_TASK_TEMPLATE.format(
            few_shot=_FEW_SHOT_EXAMPLES,
            subject=subject,
            body=body,
            sender=sender or "unknown",
            current_date=current_date,
        )
        result = await self._gemini_service.generate_structured_response(
            prompt=prompt,
            schema=EmailClassificationOutput,
        )
        if not isinstance(result, EmailClassificationOutput):
            return EmailClassificationOutput.model_validate(
                self._normalize(result.model_dump())
            )
        return result

    def _parse_crew_result(self, result: Any) -> EmailClassificationOutput:
        """
        Parse CrewAI output into ``EmailClassificationOutput``.

        Handles ``result.pydantic``, JSON embedded in ``result.raw``, and dict payloads.
        """
        try:
            pydantic_output = getattr(result, "pydantic", None)
            if pydantic_output is not None:
                if isinstance(pydantic_output, EmailClassificationOutput):
                    return pydantic_output
                raw = pydantic_output.model_dump() if hasattr(pydantic_output, "model_dump") else dict(pydantic_output)
                return EmailClassificationOutput.model_validate(self._normalize(raw))

            if isinstance(result, EmailClassificationOutput):
                return result

            tasks_output = getattr(result, "tasks_output", None)
            if tasks_output:
                last_output = tasks_output[-1]
                if hasattr(last_output, "pydantic") and last_output.pydantic is not None:
                    pyd = last_output.pydantic
                    if isinstance(pyd, EmailClassificationOutput):
                        return pyd
                    raw = pyd.model_dump() if hasattr(pyd, "model_dump") else dict(pyd)
                    return EmailClassificationOutput.model_validate(self._normalize(raw))
                if hasattr(last_output, "json_dict") and last_output.json_dict:
                    return EmailClassificationOutput.model_validate(
                        self._normalize(last_output.json_dict)
                    )

            raw_output = getattr(result, "raw", None) or str(result)
            json_payload = self._extract_json_object(raw_output)
            return EmailClassificationOutput.model_validate(self._normalize(json_payload))
        except (ValidationError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise ClassifierParseError(
                f"Unable to parse CrewAI classifier output: {exc}"
            ) from exc

    @staticmethod
    def _normalize(data: dict[str, Any]) -> dict[str, Any]:
        """Fill missing or invalid fields with safe defaults before Pydantic validation."""
        result = dict(data)
        _VALID = {"urgent", "important", "need_reply", "newsletter", "spam"}

        cat = result.get("category")
        result["category"] = cat.strip().lower() if isinstance(cat, str) and cat.strip().lower() in _VALID else "important"

        score = result.get("priority_score")
        try:
            result["priority_score"] = max(1, min(5, int(float(score))))
        except (TypeError, ValueError):
            result["priority_score"] = 2

        conf = result.get("confidence")
        try:
            result["confidence"] = max(0.0, min(1.0, float(conf)))
        except (TypeError, ValueError):
            result["confidence"] = 0.0

        summary = result.get("summary")
        summary = summary.strip() if isinstance(summary, str) and summary.strip() else "Classification completed."
        # Truncate to 2 sentences to satisfy the schema validator (splits on [.!?]+)
        ends = list(re.finditer(r"[.!?]+", summary))
        if len(ends) >= 2:
            summary = summary[: ends[1].end()].strip()
        result["summary"] = summary[:500]

        # Reject relative strings ("today", "ngày mai") — only accept strict ISO YYYY-MM-DD
        deadline = result.get("deadline")
        if isinstance(deadline, str) and not re.match(r"^\d{4}-\d{2}-\d{2}$", deadline.strip()):
            result["deadline"] = None

        return result

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
