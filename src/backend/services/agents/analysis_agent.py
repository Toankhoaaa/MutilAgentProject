"""CrewAI-based deep-analysis agent: language detection, summary, translation, sentiment."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from crewai import Agent, Crew, Process, Task
from crewai.llms.base_llm import BaseLLM
from pydantic import ValidationError

from backend.schemas.agent_schemas import EmailAnalysisOutput
from backend.services.agents.gemini_crew_llm import build_crew_llm
from backend.services.llm_service import GeminiService, LLMServiceError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Few-shot examples — 5 cases covering language variety, sentiment, actions
# ---------------------------------------------------------------------------
_FEW_SHOT_EXAMPLES: str = """
Few-shot examples (follow the exact JSON schema):

Example 1 — English email with action items, Negative sentiment:
From: manager@company.com
Subject: "URGENT: Production outage — immediate action required"
Body: "We have a critical production outage affecting all customers since 2 AM.
      The payments service is completely down. I need the on-call engineer to join
      the war-room call NOW, check the database logs, and deploy the hotfix
      within 30 minutes. Every minute of downtime costs us $10,000."
Expected JSON:
{
  "detected_language": "en",
  "summary": [
    "Hệ thống thanh toán bị sập từ 2 giờ sáng, ảnh hưởng toàn bộ khách hàng.",
    "Mỗi phút ngừng hoạt động gây thiệt hại 10.000 USD.",
    "Cần triển khai bản vá khẩn cấp trong 30 phút."
  ],
  "translation": "Hệ thống production đang gặp sự cố nghiêm trọng ảnh hưởng đến tất cả khách hàng từ 2 giờ sáng. Dịch vụ thanh toán hoàn toàn ngừng hoạt động. Kỹ sư trực cần tham gia cuộc họp chiến tranh ngay lập tức, kiểm tra nhật ký cơ sở dữ liệu và triển khai bản vá trong 30 phút. Mỗi phút ngừng hoạt động gây thiệt hại 10.000 USD.",
  "action_items": [
    "Tham gia cuộc họp war-room ngay lập tức",
    "Kiểm tra nhật ký cơ sở dữ liệu (database logs)",
    "Triển khai hotfix trong vòng 30 phút"
  ],
  "sentiment": "Negative"
}

Example 2 — Vietnamese email, no action items, Positive sentiment:
From: hr@congty.vn
Subject: "Thông báo: Kết quả đánh giá hiệu suất Q2 — Xuất sắc!"
Body: "Chúc mừng anh/chị! Kết quả đánh giá hiệu suất quý II của anh/chị đạt mức
      Xuất sắc — top 5% toàn công ty. Ban lãnh đạo ghi nhận những đóng góp nổi bật
      của anh/chị trong dự án chuyển đổi số. Mức lương thưởng Q2 sẽ được chi trả
      cùng kỳ lương tháng 7."
Expected JSON:
{
  "detected_language": "vi",
  "summary": [
    "Nhân viên đạt đánh giá Xuất sắc Q2, xếp top 5% toàn công ty.",
    "Ban lãnh đạo ghi nhận đóng góp trong dự án chuyển đổi số.",
    "Thưởng Q2 sẽ thanh toán cùng lương tháng 7."
  ],
  "translation": null,
  "action_items": [],
  "sentiment": "Positive"
}

Example 3 — Chinese email with action items, Neutral sentiment:
From: supplier@vendor.cn
Subject: "采购订单确认 — PO #20240815"
Body: "您好，感谢您的采购订单 PO #20240815。请确认以下信息：
      1) 收货地址是否正确？2) 付款条款：30天净额，是否同意？
      3) 预计交货日期为2024年9月15日。请在3个工作日内回复确认，
      否则订单将自动取消。谢谢。"
Expected JSON:
{
  "detected_language": "zh",
  "summary": [
    "Xác nhận đơn hàng PO #20240815 từ nhà cung cấp Trung Quốc.",
    "Điều khoản thanh toán: 30 ngày, giao hàng dự kiến 15/9/2024.",
    "Yêu cầu xác nhận trong 3 ngày làm việc, nếu không đơn hàng bị hủy."
  ],
  "translation": "Xin chào, cảm ơn đơn đặt hàng PO #20240815. Vui lòng xác nhận: (1) Địa chỉ nhận hàng có đúng không? (2) Điều khoản thanh toán 30 ngày thuần có được chấp nhận không? (3) Ngày giao hàng dự kiến là 15/9/2024. Vui lòng phản hồi trong 3 ngày làm việc, nếu không đơn hàng sẽ tự động bị hủy.",
  "action_items": [
    "Xác nhận địa chỉ nhận hàng",
    "Đồng ý hoặc đàm phán điều khoản thanh toán 30 ngày",
    "Phản hồi trong 3 ngày làm việc để tránh đơn hàng bị hủy"
  ],
  "sentiment": "Neutral"
}

Example 4 — English complaint email, Negative sentiment, action items:
From: customer@gmail.com
Subject: "Extremely disappointed — wrong order delivered AGAIN"
Body: "This is the third time in a row that I received the wrong items.
      I ordered a blue jacket size M but received a red shirt size XL.
      I demand a full refund AND free express shipping for the correct item.
      If this is not resolved within 24 hours, I will file a chargeback
      with my bank and leave a 1-star review on every platform."
Expected JSON:
{
  "detected_language": "en",
  "summary": [
    "Khách hàng nhận sai hàng lần thứ 3 liên tiếp (đặt áo khoác xanh M, nhận áo đỏ XL).",
    "Yêu cầu hoàn tiền toàn bộ và giao hàng nhanh miễn phí cho đơn đúng.",
    "Đe dọa hoàn tiền qua ngân hàng và đánh giá 1 sao nếu không giải quyết trong 24h."
  ],
  "translation": "Đây là lần thứ ba liên tiếp tôi nhận sai hàng. Tôi đặt áo khoác xanh cỡ M nhưng nhận được áo sơ mi đỏ cỡ XL. Tôi yêu cầu hoàn tiền đầy đủ VÀ vận chuyển nhanh miễn phí cho hàng đúng. Nếu không giải quyết trong 24 giờ, tôi sẽ yêu cầu hoàn tiền qua ngân hàng và để lại đánh giá 1 sao trên mọi nền tảng.",
  "action_items": [
    "Xử lý hoàn tiền toàn bộ cho đơn hàng sai",
    "Giao hàng đúng (áo khoác xanh M) với dịch vụ nhanh miễn phí",
    "Giải quyết trong vòng 24 giờ để tránh khiếu nại ngân hàng"
  ],
  "sentiment": "Negative"
}

Example 5 — Vietnamese meeting invitation, Neutral sentiment, no action needed:
From: admin@company.vn
Subject: "Lịch họp định kỳ tháng 8 — Thứ 3, 14:00"
Body: "Kính gửi toàn thể nhân viên, phòng Hành chính tổ chức họp giao ban tháng 8
      vào thứ 3 tuần tới lúc 14:00 tại phòng họp A3. Nội dung: cập nhật tiến độ dự án
      và thông báo nhân sự mới. Kính mời tham dự đúng giờ."
Expected JSON:
{
  "detected_language": "vi",
  "summary": [
    "Họp giao ban tháng 8 vào thứ 3 lúc 14:00 tại phòng A3.",
    "Nội dung: cập nhật tiến độ dự án và thông báo nhân sự mới."
  ],
  "translation": null,
  "action_items": [
    "Tham dự họp giao ban tháng 8 — thứ 3 lúc 14:00, phòng A3"
  ],
  "sentiment": "Neutral"
}
""".strip()

# ---------------------------------------------------------------------------
# Task template
# ---------------------------------------------------------------------------
# Markers that indicate the LLM echoed the system prompt instead of analysing the email.
_PROMPT_ECHO_MARKERS: tuple[str, ...] = (
    "bạn là email ai assistant",
    "json object hợp lệ theo schema",
    "detected_language",
    "phân tích email được cung cấp",
)

_ANALYSIS_TASK_TEMPLATE: str = """
Bạn là Email AI Assistant chuyên nghiệp. Phân tích email được cung cấp và trả về
CHỈ một JSON object hợp lệ theo schema sau:

1. "detected_language": Mã ISO 639-1 của ngôn ngữ email (ví dụ: "vi", "en", "zh", "ja", "ko", "fr").
   - Nhận diện dựa trên nội dung body, không phải subject.

2. "summary": Danh sách tối đa 3 bullet point bằng tiếng Việt.
   - Tổng số từ KHÔNG được vượt quá 80 từ.
   - Mỗi bullet súc tích, đúng trọng tâm, không lặp thông tin.
   - Nếu email rất ngắn, 1-2 bullet là đủ.

3. "translation": Dịch toàn bộ nội dung cốt lõi sang tiếng Việt chuyên nghiệp.
   - Đặt là null nếu detected_language là "vi".
   - Nếu không phải tiếng Việt: dịch đầy đủ, tự nhiên, giữ nguyên ý nghĩa.

4. "action_items": Các hành động cụ thể mà người nhận CẦN THỰC HIỆN, viết bằng tiếng Việt.
   - Chỉ bao gồm hành động rõ ràng được yêu cầu (không suy diễn).
   - Trả về [] nếu không có hành động nào cần thực hiện.

5. "sentiment": Chính xác một trong: "Positive", "Neutral", "Negative".
   - Positive: nội dung tích cực, khen ngợi, tin vui, đề nghị hợp tác tốt.
   - Negative: khiếu nại, đe dọa, khẩn cấp do sự cố, từ chối, tức giận.
   - Neutral: thông báo thông thường, lịch họp, xác nhận đơn hàng, hỏi thông tin.

TUYỆT ĐỐI không bao gồm markdown fence (```), giải thích, hoặc text ngoài JSON.

{few_shot}

Email cần phân tích:
From: {email_sender}
Subject: {email_subject}
Content:
{email_body}
""".strip()


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------
class AnalysisAgentError(Exception):
    """Base exception for analysis agent failures."""


class AnalysisParseError(AnalysisAgentError):
    """Raised when output cannot be parsed into EmailAnalysisOutput."""


# ---------------------------------------------------------------------------
# Agent class
# ---------------------------------------------------------------------------
class EmailAnalysisAgent:
    """
    Performs deep analysis of inbound emails: language detection, Vietnamese summary,
    translation, action-item extraction, and sentiment classification.

    Primary path: CrewAI Agent + Task with ``output_pydantic``.
    Fallback path: direct ``GeminiService.generate_structured_response``.

    Usage::

        agent = EmailAnalysisAgent()
        result = await agent.analyze(
            email_subject="URGENT: Production outage",
            email_body="We have a critical outage...",
            email_sender="manager@company.com",
        )
        print(result.detected_language)  # "en"
        print(result.sentiment)          # "Negative"
        print(result.action_items)       # ["Join war-room call...", ...]
    """

    def __init__(
        self,
        gemini_service: GeminiService | None = None,
        llm: BaseLLM | None = None,
    ) -> None:
        self._gemini_service = gemini_service or GeminiService()
        self._llm = llm or build_crew_llm(temperature=0.15)

        self._agent = Agent(
            role="Elite Email AI Assistant",
            goal=(
                "Phân tích toàn diện nội dung email: nhận diện ngôn ngữ, tóm tắt bằng tiếng Việt, "
                "dịch thuật khi cần, trích xuất hành động cần thực hiện và đánh giá cảm xúc. "
                "Đầu ra phải chính xác, súc tích và tuân thủ nghiêm ngặt schema JSON."
            ),
            backstory=(
                "Bạn là trợ lý AI email hàng đầu, thành thạo hơn 50 ngôn ngữ với chuyên môn "
                "dịch thuật cấp độ chuyên nghiệp. Bạn có khả năng đọc và phân tích mọi loại "
                "email công việc — từ báo cáo kỹ thuật, hợp đồng thương mại đến thư khiếu nại "
                "khách hàng — và luôn chiết xuất chính xác những điểm cốt lõi nhất. "
                "Bạn hiểu sắc thái cảm xúc tinh tế trong ngôn ngữ và không bao giờ bỏ sót "
                "một hành động cần thiết nào mà người nhận phải thực hiện."
            ),
            llm=self._llm,
            verbose=False,
            allow_delegation=False,
        )

        self._task = Task(
            description=_ANALYSIS_TASK_TEMPLATE,
            expected_output=(
                "A single JSON object with keys: detected_language (ISO 639-1 string), "
                "summary (list of 1-3 Vietnamese bullet strings, ≤80 words total), "
                "translation (Vietnamese string or null), "
                "action_items (list of Vietnamese action strings, may be empty), "
                "sentiment ('Positive' | 'Neutral' | 'Negative'). "
                "No markdown fences or extra text."
            ),
            agent=self._agent,
            output_pydantic=EmailAnalysisOutput,
        )

        self._crew = Crew(
            agents=[self._agent],
            tasks=[self._task],
            process=Process.sequential,
            verbose=False,
        )

    async def analyze(
        self,
        email_subject: str,
        email_body: str,
        email_sender: str | None = None,
    ) -> EmailAnalysisOutput:
        """
        Analyze an email and return a fully structured ``EmailAnalysisOutput``.

        Args:
            email_subject: Subject line of the email.
            email_body: Plain-text body of the email.
            email_sender: Optional sender address or display name for context.

        Returns:
            :class:`EmailAnalysisOutput` with all five analysis fields populated.
        """
        try:
            return await asyncio.to_thread(
                self._analyze_with_crew, email_subject, email_body, email_sender
            )
        except (AnalysisParseError, AnalysisAgentError, LLMServiceError) as exc:
            logger.warning("CrewAI analysis failed, using GeminiService fallback: %s", exc)
            return await self._analyze_with_gemini(email_subject, email_body, email_sender)

    def _analyze_with_crew(
        self,
        email_subject: str,
        email_body: str,
        email_sender: str | None,
    ) -> EmailAnalysisOutput:
        """Run the CrewAI workflow synchronously (called from asyncio.to_thread)."""
        try:
            result = self._crew.kickoff(
                inputs={
                    "few_shot": _FEW_SHOT_EXAMPLES,
                    "email_subject": email_subject,
                    "email_body": email_body,
                    "email_sender": email_sender or "unknown",
                }
            )
        except Exception as exc:
            raise AnalysisAgentError(f"CrewAI kickoff failed: {exc}") from exc

        return self._parse_crew_result(result)

    async def _analyze_with_gemini(
        self,
        email_subject: str,
        email_body: str,
        email_sender: str | None,
    ) -> EmailAnalysisOutput:
        """Fallback: call GeminiService directly with the structured prompt."""
        prompt = _ANALYSIS_TASK_TEMPLATE.format(
            few_shot=_FEW_SHOT_EXAMPLES,
            email_subject=email_subject,
            email_body=email_body,
            email_sender=email_sender or "unknown",
        )
        result = await self._gemini_service.generate_structured_response(
            prompt=prompt,
            schema=EmailAnalysisOutput,
        )
        if isinstance(result, EmailAnalysisOutput):
            return result
        return EmailAnalysisOutput.model_validate(
            self._normalize_raw_dict(result.model_dump())
        )

    def _parse_crew_result(self, result: Any) -> EmailAnalysisOutput:
        """Parse CrewAI output into EmailAnalysisOutput with multiple fallback paths."""
        try:
            pydantic_output = getattr(result, "pydantic", None)
            if pydantic_output is not None:
                if isinstance(pydantic_output, EmailAnalysisOutput):
                    return pydantic_output
                raw = pydantic_output if isinstance(pydantic_output, dict) else vars(pydantic_output)
                return EmailAnalysisOutput.model_validate(self._normalize_raw_dict(raw))

            if isinstance(result, EmailAnalysisOutput):
                return result

            tasks_output = getattr(result, "tasks_output", None)
            if tasks_output:
                last = tasks_output[-1]
                if getattr(last, "pydantic", None) is not None:
                    if isinstance(last.pydantic, EmailAnalysisOutput):
                        return last.pydantic
                    raw = last.pydantic if isinstance(last.pydantic, dict) else vars(last.pydantic)
                    return EmailAnalysisOutput.model_validate(self._normalize_raw_dict(raw))
                if getattr(last, "json_dict", None):
                    return EmailAnalysisOutput.model_validate(
                        self._normalize_raw_dict(last.json_dict)
                    )

            raw_output = getattr(result, "raw", None) or str(result)
            json_payload = self._extract_json_object(raw_output)
            return EmailAnalysisOutput.model_validate(self._normalize_raw_dict(json_payload))

        except (ValidationError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise AnalysisParseError(
                f"Unable to parse CrewAI analysis output: {exc}"
            ) from exc

    @staticmethod
    def _normalize_raw_dict(data: dict[str, Any]) -> dict[str, Any]:
        """
        Coerce LLM output quirks into schema-valid values before Pydantic validation.

        Handles:
        - ``summary`` / ``action_items`` returned as a plain string instead of a list.
        - ``sentiment`` returned in any casing (e.g. ``"positive"`` → ``"Positive"``).
        - ``detected_language`` returned as empty string → defaults to ``"en"``.
        """
        result = dict(data)

        # ── detected_language: must be 2-5 chars ──────────────────────────────
        lang = result.get("detected_language")
        if not isinstance(lang, str) or len(lang.strip()) < 2:
            result["detected_language"] = "en"
        else:
            result["detected_language"] = lang.strip().lower()[:5]

        # ── summary: must be list[str] with 1-3 items ─────────────────────────
        summary = result.get("summary")
        if isinstance(summary, str):
            lower = summary.lower()
            # Discard the string if the LLM echoed back the system prompt.
            if any(m in lower for m in _PROMPT_ECHO_MARKERS):
                result["summary"] = ["Không thể phân tích email lúc này. Vui lòng thử lại."]
            else:
                lines = [
                    ln.strip().lstrip("•-*·")
                    for ln in re.split(r"\n|(?<=[.!?])\s+", summary)
                    if ln.strip()
                ]
                result["summary"] = lines[:3] if lines else ["Không có tóm tắt."]
        elif not isinstance(summary, list) or len(summary) == 0:
            result["summary"] = ["Không có tóm tắt."]
        else:
            # Filter out individual bullets that look like prompt echoes.
            cleaned = [
                b for b in summary
                if not any(m in str(b).lower() for m in _PROMPT_ECHO_MARKERS)
            ]
            result["summary"] = cleaned if cleaned else ["Không có tóm tắt."]

        # ── translation: discard if it looks like a prompt echo ──────────────
        translation = result.get("translation")
        if isinstance(translation, str):
            if any(m in translation.lower() for m in _PROMPT_ECHO_MARKERS):
                result["translation"] = None

        # ── action_items: must be list[str] (may be empty) ────────────────────
        items = result.get("action_items")
        if isinstance(items, str):
            result["action_items"] = (
                [ln.strip().lstrip("•-*·") for ln in items.splitlines() if ln.strip()]
                if items.strip()
                else []
            )
        elif not isinstance(items, list):
            result["action_items"] = []

        # ── sentiment: must be exactly "Positive" | "Neutral" | "Negative" ───
        sentiment = result.get("sentiment", "")
        if isinstance(sentiment, str):
            normalized = sentiment.strip().title()
            if normalized not in {"Positive", "Neutral", "Negative"}:
                normalized = "Neutral"
            result["sentiment"] = normalized

        return result

    @staticmethod
    def _extract_json_object(raw_text: str) -> dict[str, Any]:
        """Extract the first JSON object from a raw model response string."""
        text = raw_text.strip()

        fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if fence_match:
            text = fence_match.group(1)

        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("No JSON object found in analysis agent output.")

        return json.loads(text[start : end + 1])
