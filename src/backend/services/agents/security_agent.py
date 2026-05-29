"""CrewAI-based email security agent for phishing and fraud detection."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from crewai import Agent, Crew, Process, Task
from crewai.llms.base_llm import BaseLLM
from pydantic import ValidationError

from backend.schemas.agent_schemas import SecurityAnalysisOutput
from backend.services.agents.gemini_crew_llm import build_crew_llm
from backend.services.llm_service import GeminiService, LLMServiceError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Few-shot prompt — each example maps a concrete threat pattern to the output
# ---------------------------------------------------------------------------
_FEW_SHOT_EXAMPLES: str = """
Few-shot examples (follow the same JSON schema exactly):

Example 1 — CEO fraud / BEC (Business Email Compromise):
From: "Nguyen Van A CEO" <ceo.nguyenvana@gmail.com>
Subject: "Gấp: chuyển tiền ngay cho đối tác mới"
Body: "Tôi đang họp không tiện nghe máy. Em chuyển ngay 200 triệu vào TK 012345678 Vietcombank
       tên Trần Văn B trước 15h hôm nay. Tuyệt đối bảo mật, không báo ai. Sếp."
Expected JSON:
{
  "is_safe": false,
  "risk_level": "high",
  "warnings": [
    "Giả mạo cấp trên yêu cầu chuyển tiền gấp (CEO Fraud / BEC)",
    "Yêu cầu bảo mật tuyệt đối, không báo ai — dấu hiệu điển hình của lừa đảo",
    "Tên miền người gửi là Gmail cá nhân, không phải email công ty",
    "Không có thời gian xác minh — tạo áp lực thời hạn giả tạo"
  ]
}

Example 2 — Credential harvesting / fake login page:
From: "security-alert@vietcombank-verify.net"
Subject: "⚠️ Tài khoản của bạn bị khóa — xác minh ngay"
Body: "Chúng tôi phát hiện đăng nhập bất thường. Nhấn vào đây để xác minh:
       http://vietcombank-verify.net/login?token=abc123
       Nếu không xác minh trong 24h, tài khoản sẽ bị đóng vĩnh viễn."
Expected JSON:
{
  "is_safe": false,
  "risk_level": "high",
  "warnings": [
    "Tên miền giả mạo ngân hàng: 'vietcombank-verify.net' không phải vietcombank.com.vn",
    "Link dẫn đến trang thu thập thông tin đăng nhập (Credential Harvesting)",
    "Đe dọa khóa tài khoản để tạo áp lực hành động ngay",
    "Tổ chức tài chính thực sự không yêu cầu xác minh qua email như vậy"
  ]
}

Example 3 — Lottery / prize scam:
From: "prize@international-lottery-winner.com"
Subject: "🎉 Chúc mừng! Bạn đã trúng $500,000 USD"
Body: "Bạn được chọn ngẫu nhiên để nhận $500,000. Để nhận thưởng, hãy thanh toán phí xử lý
       $200 USD qua Western Union và gửi thông tin CMND + số tài khoản về địa chỉ này."
Expected JSON:
{
  "is_safe": false,
  "risk_level": "high",
  "warnings": [
    "Lừa đảo trúng thưởng giả mạo (Advance Fee / Lottery Scam)",
    "Yêu cầu nộp tiền trước để nhận giải thưởng — không có xổ số hợp pháp nào làm vậy",
    "Yêu cầu thông tin CMND và số tài khoản ngân hàng",
    "Địa chỉ người gửi là tên miền không xác định, không liên quan đến tổ chức chính thống"
  ]
}

Example 4 — Sextortion / blackmail:
From: "anonymous@protonmail.com"
Subject: "Tôi đã quay video bạn — trả tiền hoặc tôi gửi cho danh bạ của bạn"
Body: "Tôi đã cài phần mềm vào máy tính của bạn và thu thập video nhạy cảm. Chuyển 0.05 Bitcoin
       vào địa chỉ ví 1A2B3C... trong 48h hoặc tôi gửi cho toàn bộ danh bạ và mạng xã hội."
Expected JSON:
{
  "is_safe": false,
  "risk_level": "high",
  "warnings": [
    "Tống tiền qua email (Sextortion / Blackmail Scam)",
    "Tuyên bố giả về việc xâm nhập thiết bị và thu thập dữ liệu — thường không có thật",
    "Yêu cầu thanh toán bằng tiền điện tử (không truy vết được)",
    "Tạo áp lực thời gian 48h để ngăn nạn nhân suy nghĩ kỹ"
  ]
}

Example 5 — Suspicious but medium risk (domain mismatch + urgency):
From: "invoices@microsoft-billing.info"
Subject: "Hóa đơn Microsoft 365 của bạn — thanh toán ngay để tránh gián đoạn dịch vụ"
Body: "Gói Microsoft 365 của bạn sẽ hết hạn trong 24h. Nhấn đây để gia hạn ngay:
       http://microsoft-billing.info/renew. Nếu không, toàn bộ dữ liệu sẽ bị xóa."
Expected JSON:
{
  "is_safe": false,
  "risk_level": "medium",
  "warnings": [
    "Tên miền người gửi 'microsoft-billing.info' không phải microsoft.com",
    "Đe dọa xóa dữ liệu để tạo áp lực — chiến thuật social engineering",
    "Link gia hạn dẫn đến tên miền bên thứ ba không xác minh"
  ]
}

Example 6 — Safe, legitimate business email:
From: "hr@company.com"
Subject: "Lịch họp toàn công ty — Thứ 6 tuần này lúc 14:00"
Body: "Kính gửi toàn thể nhân viên, công ty tổ chức họp định kỳ quý II vào thứ 6, 14:00
       tại phòng họp tầng 3. Vui lòng xác nhận tham dự qua link nội bộ: intranet.company.com/rsvp"
Expected JSON:
{
  "is_safe": true,
  "risk_level": "low",
  "warnings": []
}
""".strip()

# ---------------------------------------------------------------------------
# Task prompt template
# ---------------------------------------------------------------------------
_SECURITY_TASK_TEMPLATE: str = """
Bạn là chuyên gia an ninh mạng. Hãy phân tích email dưới đây và phát hiện các dấu hiệu lừa đảo
(phishing), gian lận tài chính, tống tiền, hoặc liên kết độc hại.

Trả về CHỈ một JSON object hợp lệ theo schema sau:
- is_safe: boolean — true nếu email an toàn, false nếu có rủi ro bảo mật
- risk_level: "low" | "medium" | "high"
  * low   — đáng ngờ nhưng không có bằng chứng rõ ràng
  * medium — nhiều khả năng là lừa đảo hoặc đánh lừa người dùng
  * high  — xác nhận phishing, tống tiền, gian lận tài chính, hoặc malware
- warnings: list[str] — danh sách cảnh báo cụ thể bằng tiếng Việt (rỗng nếu is_safe=true)

Quy tắc phân loại (áp dụng theo mức độ ưu tiên từ cao xuống thấp):
1. risk_level=high nếu:
   - Giả danh cấp trên/CEO/giám đốc yêu cầu chuyển tiền gấp vào tài khoản lạ
   - Đe dọa, tống tiền, hoặc cưỡng bức dưới bất kỳ hình thức nào
   - Tên miền giả mạo ngân hàng, ví điện tử, hoặc dịch vụ lớn (vietcombank-xyz.com ≠ vietcombank.com.vn)
   - Yêu cầu thông tin đăng nhập, OTP, CMND, số tài khoản
   - Link dẫn đến trang thu thập thông tin (credential harvesting)
   - Thông báo trúng thưởng kèm yêu cầu nộp phí trước

2. risk_level=medium nếu:
   - Tên miền người gửi khác với tổ chức tuyên bố trong nội dung
   - Lời mời chào hợp đồng/đầu tư từ người lạ với lợi nhuận bất thường
   - Tạo áp lực thời gian kết hợp với yêu cầu hành động nhạy cảm
   - Cú pháp URL ẩn (văn bản hiển thị ≠ link thực)

3. risk_level=low nếu:
   - Có một số dấu hiệu mơ hồ nhưng không đủ bằng chứng phân loại cao hơn

4. is_safe=true, risk_level=low, warnings=[] nếu:
   - Email thông thường từ đồng nghiệp, tổ chức đã biết, không yêu cầu hành động nhạy cảm

KHÔNG bao gồm markdown fence, giải thích thêm, hoặc text ngoài JSON.

{few_shot}

Email cần phân tích:
From: {sender}
Subject: {email_subject}
Body:
{email_body}
""".strip()


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------
class SecurityAgentError(Exception):
    """Base exception for security agent failures."""


class SecurityParseError(SecurityAgentError):
    """Raised when CrewAI or Gemini output cannot be parsed into SecurityAnalysisOutput."""


# ---------------------------------------------------------------------------
# Agent class
# ---------------------------------------------------------------------------
class EmailSecurityAgent:
    """
    Analyzes inbound emails for phishing, fraud, and security threats.

    Uses a CrewAI Agent backed by Gemini with a structured few-shot prompt.
    Falls back to direct ``GeminiService`` when CrewAI fails.

    Usage::

        agent = EmailSecurityAgent()
        result = await agent.analyze(
            email_subject="Gấp: chuyển tiền ngay",
            email_body="Sếp yêu cầu chuyển 200tr trước 15h...",
            sender="ceo@gmail.com",
        )
        if not result.is_safe:
            print(result.risk_level, result.warnings)
    """

    def __init__(
        self,
        gemini_service: GeminiService | None = None,
        llm: BaseLLM | None = None,
    ) -> None:
        self._gemini_service = gemini_service or GeminiService()
        self._llm = llm or build_crew_llm(temperature=0.1)  # lower temp → deterministic verdicts

        self._agent = Agent(
            role="Cybersecurity Email Analyst",
            goal=(
                "Phân tích nội dung email, URL và bối cảnh để phát hiện các dấu hiệu lừa đảo "
                "(phishing), lừa tiền, tống tiền, hoặc chứa liên kết độc hại. "
                "Đưa ra phán quyết chính xác, không bỏ sót mối đe dọa thực sự."
            ),
            backstory=(
                "Bạn là chuyên gia an ninh mạng với hơn 10 năm kinh nghiệm điều tra tội phạm "
                "mạng tại Việt Nam và quốc tế. Bạn cực kỳ nhạy bén với mọi mánh khóe lừa đảo "
                "qua email: từ CEO Fraud, credential harvesting, advance-fee scam, sextortion "
                "đến domain spoofing. Bạn hiểu rằng một email 'có vẻ khẩn cấp' từ 'sếp' yêu "
                "cầu chuyển tiền gấp qua Gmail cá nhân là dấu hiệu đỏ rõ ràng nhất của BEC "
                "(Business Email Compromise). Bạn không bao giờ bỏ sót mối đe dọa thực sự và "
                "không phân loại nhầm email an toàn thành nguy hiểm."
            ),
            llm=self._llm,
            verbose=False,
            allow_delegation=False,
        )

        self._task = Task(
            description=_SECURITY_TASK_TEMPLATE,
            expected_output=(
                "A single JSON object with keys: is_safe (bool), risk_level (low|medium|high), "
                "warnings (list of strings in Vietnamese). No markdown or extra text."
            ),
            agent=self._agent,
            output_pydantic=SecurityAnalysisOutput,
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
        sender: str | None = None,
    ) -> SecurityAnalysisOutput:
        """
        Analyze an email for security threats.

        Args:
            email_subject: Subject line of the email.
            email_body: Plain-text body of the email.
            sender: Sender address or display name (improves domain-spoofing detection).

        Returns:
            :class:`SecurityAnalysisOutput` with verdict, risk level, and warnings.
        """
        try:
            return await asyncio.to_thread(
                self._analyze_with_crew, email_subject, email_body, sender
            )
        except (SecurityParseError, SecurityAgentError, LLMServiceError) as exc:
            logger.warning("CrewAI security analysis failed, using fallback: %s", exc)
            return await self._analyze_with_gemini(email_subject, email_body, sender)

    def _analyze_with_crew(
        self,
        email_subject: str,
        email_body: str,
        sender: str | None,
    ) -> SecurityAnalysisOutput:
        """Run the CrewAI workflow synchronously (called from asyncio.to_thread)."""
        try:
            result = self._crew.kickoff(
                inputs={
                    "few_shot": _FEW_SHOT_EXAMPLES,
                    "email_subject": email_subject,
                    "email_body": email_body,
                    "sender": sender or "unknown",
                }
            )
        except Exception as exc:
            raise SecurityAgentError(f"CrewAI kickoff failed: {exc}") from exc

        return self._parse_crew_result(result)

    async def _analyze_with_gemini(
        self,
        email_subject: str,
        email_body: str,
        sender: str | None,
    ) -> SecurityAnalysisOutput:
        """Fallback: call GeminiService directly with the same structured prompt."""
        prompt = _SECURITY_TASK_TEMPLATE.format(
            few_shot=_FEW_SHOT_EXAMPLES,
            email_subject=email_subject,
            email_body=email_body,
            sender=sender or "unknown",
        )
        result = await self._gemini_service.generate_structured_response(
            prompt=prompt,
            schema=SecurityAnalysisOutput,
        )
        if not isinstance(result, SecurityAnalysisOutput):
            return SecurityAnalysisOutput.model_validate(result.model_dump())
        return result

    def _parse_crew_result(self, result: Any) -> SecurityAnalysisOutput:
        """Parse CrewAI output into SecurityAnalysisOutput with multiple fallback paths."""
        try:
            pydantic_output = getattr(result, "pydantic", None)
            if pydantic_output is not None:
                return SecurityAnalysisOutput.model_validate(pydantic_output)

            if isinstance(result, SecurityAnalysisOutput):
                return result

            tasks_output = getattr(result, "tasks_output", None)
            if tasks_output:
                last = tasks_output[-1]
                if getattr(last, "pydantic", None) is not None:
                    return SecurityAnalysisOutput.model_validate(last.pydantic)
                if getattr(last, "json_dict", None):
                    return SecurityAnalysisOutput.model_validate(last.json_dict)

            raw_output = getattr(result, "raw", None) or str(result)
            json_payload = self._extract_json_object(raw_output)
            return SecurityAnalysisOutput.model_validate(json_payload)

        except (ValidationError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise SecurityParseError(
                f"Unable to parse CrewAI security output: {exc}"
            ) from exc

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
            raise ValueError("No JSON object found in security agent output.")

        return json.loads(text[start : end + 1])
