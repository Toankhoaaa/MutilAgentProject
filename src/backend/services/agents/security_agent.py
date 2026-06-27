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
# Few-shot prompt — CÂN BẰNG: cả ca nguy hiểm lẫn ca an toàn dễ nhầm
# ---------------------------------------------------------------------------
_FEW_SHOT_EXAMPLES: str = """
Few-shot examples (tuân thủ chính xác cùng JSON schema):

Example 1 — CEO fraud / BEC:
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
    "Tạo áp lực thời hạn để ngăn xác minh"
  ]
}

Example 2 — Credential harvesting:
From: "security-alert@vietcombank-verify.net"
Subject: "⚠️ Tài khoản của bạn bị khóa — xác minh ngay"
Body: "Phát hiện đăng nhập bất thường. Nhấn để xác minh:
       http://vietcombank-verify.net/login?token=abc123
       Không xác minh trong 24h, tài khoản sẽ bị đóng vĩnh viễn."
Expected JSON:
{
  "is_safe": false,
  "risk_level": "high",
  "warnings": [
    "Tên miền giả mạo ngân hàng: 'vietcombank-verify.net' không phải vietcombank.com.vn",
    "Link dẫn đến trang thu thập thông tin đăng nhập (credential harvesting)",
    "Đe dọa khóa tài khoản để tạo áp lực"
  ]
}

Example 3 — Lottery / advance-fee scam:
From: "prize@international-lottery-winner.com"
Subject: "🎉 Chúc mừng! Bạn đã trúng $500,000 USD"
Body: "Bạn được chọn nhận $500,000. Thanh toán phí xử lý $200 qua Western Union
       và gửi CMND + số tài khoản để nhận thưởng."
Expected JSON:
{
  "is_safe": false,
  "risk_level": "high",
  "warnings": [
    "Lừa đảo trúng thưởng (Advance Fee / Lottery Scam)",
    "Yêu cầu nộp phí trước để nhận giải — không xổ số hợp pháp nào làm vậy",
    "Yêu cầu thông tin CMND và số tài khoản ngân hàng"
  ]
}

Example 4 — Sextortion:
From: "anonymous@protonmail.com"
Subject: "Trả tiền hoặc tôi gửi video cho danh bạ của bạn"
Body: "Tôi đã thu thập video nhạy cảm. Chuyển 0.05 Bitcoin vào ví 1A2B3C... trong 48h
       hoặc tôi gửi cho toàn bộ danh bạ."
Expected JSON:
{
  "is_safe": false,
  "risk_level": "high",
  "warnings": [
    "Tống tiền qua email (Sextortion)",
    "Yêu cầu thanh toán bằng tiền điện tử không truy vết",
    "Tạo áp lực 48h để ngăn nạn nhân suy nghĩ"
  ]
}

Example 5 — Medium: GIẢ MẠO THƯƠNG HIỆU + nhiều tín hiệu (≥2):
From: "invoices@microsoft-billing.info"
Subject: "Hóa đơn Microsoft 365 — thanh toán ngay tránh gián đoạn"
Body: "Gói của bạn hết hạn trong 24h. Gia hạn ngay: http://microsoft-billing.info/renew.
       Nếu không, toàn bộ dữ liệu sẽ bị xóa."
Expected JSON:
{
  "is_safe": false,
  "risk_level": "medium",
  "warnings": [
    "Tên miền 'microsoft-billing.info' cố tình gợi thương hiệu Microsoft nhưng không phải microsoft.com",
    "Link thanh toán dẫn tới tên miền bên thứ ba không xác minh",
    "Đe dọa xóa dữ liệu để tạo áp lực"
  ]
}
# Lý do medium (không phải high): có 3 tín hiệu kết hợp (giả thương hiệu + link thanh toán lạ
# + đe dọa), nhưng chưa trực tiếp đòi mật khẩu/OTP hay chuyển khoản cá nhân.

Example 6 — AN TOÀN: email nội bộ thông thường:
From: "hr@company.com"
Subject: "Lịch họp toàn công ty — Thứ 6 lúc 14:00"
Body: "Kính gửi toàn thể nhân viên, công ty họp định kỳ quý II vào thứ 6, 14:00 tại phòng
       họp tầng 3. Xác nhận tham dự qua: intranet.company.com/rsvp"
Expected JSON:
{ "is_safe": true, "risk_level": "low", "warnings": [] }

Example 7 — AN TOÀN: tuyển dụng từ Gmail (DOMAIN KHÁC công ty nhưng hợp lệ):
From: "Trần Thị HR" <tranthi.recruiter@gmail.com>
Subject: "Mời ứng tuyển vị trí Backend Developer tại Công ty ABC"
Body: "Chào bạn, mình là HR công ty ABC. Qua hồ sơ trên TopCV, mình thấy bạn phù hợp vị trí
       Backend Developer. Bạn gửi CV cập nhật và sắp xếp một buổi phỏng vấn online tuần này
       nhé? Thông tin công ty: abc.com.vn."
Expected JSON:
{ "is_safe": true, "risk_level": "low", "warnings": [] }
# QUAN TRỌNG: tên miền là Gmail cá nhân, KHÁC công ty ABC. Đây KHÔNG phải mối đe dọa:
# thư tuyển dụng bình thường, không đòi thông tin nhạy cảm, không link đăng nhập/thanh toán.
# Domain mismatch ĐỨNG MỘT MÌNH không bao giờ đủ để cảnh báo.

Example 8 — AN TOÀN: thông báo dịch vụ bên thứ ba:
From: "notifications@github.com"
Subject: "[GitHub] Build completed successfully"
Body: "Workflow CI của repository your-project đã chạy thành công. Xem chi tiết tại tab
       Actions trên GitHub."
Expected JSON:
{ "is_safe": true, "risk_level": "low", "warnings": [] }

Example 9 — AN TOÀN: hóa đơn hợp lệ có yêu cầu thanh toán (KHÔNG flag chỉ vì nhắc tiền):
From: "billing@fpt.com.vn"
Subject: "Hóa đơn cước Internet tháng 5"
Body: "Cước tháng 5 của quý khách là 250.000đ. Vui lòng thanh toán trước 10/6 qua ứng dụng
       Hi FPT hoặc tại điểm giao dịch. Chi tiết tại hoadon.fpt.com.vn."
Expected JSON:
{ "is_safe": true, "risk_level": "low", "warnings": [] }
# Lý do: nhà cung cấp thật, kênh thanh toán chính thống, không link lạ, không đòi OTP/mật khẩu.
""".strip()


# ---------------------------------------------------------------------------
# Task prompt template — thêm NGUYÊN TẮC GỐC + ngưỡng ≥2 cho medium + field lý luận
# ---------------------------------------------------------------------------
_SECURITY_TASK_TEMPLATE: str = """
Bạn là chuyên gia an ninh email. Phân tích email dưới đây để phát hiện lừa đảo (phishing),
gian lận tài chính, tống tiền, hoặc liên kết độc hại — đồng thời TRÁNH báo động nhầm
các email hợp lệ.

NGUYÊN TẮC GỐC (đọc kỹ trước khi phân loại):
- Mặc định mọi email là AN TOÀN. Chỉ nâng mức rủi ro khi có BẰNG CHỨNG CỤ THỂ về ý định gây hại.
- Một email chỉ thực sự nguy hiểm khi nó nhằm khiến người nhận làm điều gây hại, ví dụ:
  lộ thông tin đăng nhập/OTP/mật khẩu/số thẻ; chuyển tiền bất thường; nhấn vào trang
  đăng nhập hoặc thanh toán giả mạo; bị tống tiền/đe dọa.
- Tên miền người gửi KHÁC với tổ chức nhắc trong nội dung là chuyện BÌNH THƯỜNG và KHÔNG
  phải dấu hiệu nguy hiểm nếu đứng một mình. Email hợp lệ rất thường đến từ tên miền cá nhân
  hoặc bên thứ ba: tuyển dụng (HR qua Gmail / TopCV / LinkedIn), thông báo dịch vụ (GitHub,
  SaaS), hóa đơn nhà cung cấp, mời họp từ đối tác, newsletter.
  → Chỉ tính tên miền là dấu hiệu khi nó CỐ TÌNH giả mạo MỘT THƯƠNG HIỆU CỤ THỂ nhằm đánh lừa
    (vd: vietcombank-verify.net giả Vietcombank), HOẶC khi đi KÈM một yêu cầu nhạy cảm.
- Việc nhắc đến tiền/hóa đơn/thanh toán KHÔNG tự động là nguy hiểm — hóa đơn hợp lệ là bình thường.

Trả về CHỈ một JSON object hợp lệ, gồm:
- reasoning: string — 1-2 câu liệt kê các tín hiệu CỤ THỂ quan sát được (hoặc ghi "không có
  tín hiệu nguy hiểm"). Đây là bước suy luận bắt buộc trước khi kết luận.
- is_safe: boolean
- risk_level: "low" | "medium" | "high"
- warnings: list[str] — cảnh báo cụ thể bằng tiếng Việt; PHẢI rỗng nếu is_safe=true

Thang phân loại:
1) high — có MỘT trong các bằng chứng trực tiếp:
   • Giả danh cấp trên/CEO yêu cầu chuyển tiền gấp vào tài khoản lạ
   • Đe dọa, tống tiền
   • Tên miền giả mạo ngân hàng/ví điện tử (vietcombank-xyz.com ≠ vietcombank.com.vn)
   • Yêu cầu thông tin đăng nhập, OTP, mật khẩu, số thẻ, số tài khoản
   • Link tới trang thu thập thông tin đăng nhập / thanh toán giả
   • Trúng thưởng kèm yêu cầu nộp phí trước

2) medium — cần ÍT NHẤT HAI tín hiệu đáng ngờ KẾT HỢP (một tín hiệu đơn lẻ KHÔNG đủ):
   • Tên miền cố tình giả thương hiệu + tạo áp lực thời gian
   • Mời đầu tư/hợp đồng lợi nhuận bất thường + đòi đặt cọc hoặc cung cấp thông tin
   • URL ẩn (văn bản hiển thị ≠ link thực) dẫn tới trang đòi thông tin

3) low (is_safe=false) — có đúng MỘT dấu hiệu mơ hồ, không kèm yêu cầu nhạy cảm,
   nhưng vẫn nên để người dùng lưu ý.

4) is_safe=true, risk_level="low", warnings=[] — email hợp lệ thông thường:
   công việc, tuyển dụng, hóa đơn/thông báo dịch vụ chính thống, mời họp, newsletter…
   KỂ CẢ khi gửi từ tên miền cá nhân hoặc bên thứ ba, miễn KHÔNG đòi hành động nhạy cảm.

Nếu email rỗng hoặc không đọc được nội dung: is_safe=true, risk_level="low", warnings=[],
reasoning="không đủ nội dung để phân tích".

KHÔNG markdown fence, KHÔNG text ngoài JSON.

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
                "Phân tích email để phát hiện lừa đảo, gian lận, tống tiền, liên kết độc hại — "
                "ĐỒNG THỜI tránh báo động nhầm email hợp lệ. Mục tiêu là PHÁN QUYẾT CHÍNH XÁC "
                "theo cả hai chiều: không bỏ sót đe dọa thật, không gắn cờ email an toàn."
            ),
            backstory=(
                "Bạn là chuyên gia an ninh email với hơn 10 năm điều tra tội phạm mạng. Bạn nhận ra "
                "ngay các mánh khóe: CEO Fraud, credential harvesting, advance-fee scam, sextortion, "
                "giả mạo tên miền thương hiệu. Nhưng bạn cũng hiểu rằng đa số email là hợp lệ: thư "
                "tuyển dụng từ Gmail, thông báo dịch vụ, hóa đơn nhà cung cấp, mời họp từ đối tác — "
                "những thứ này KHÔNG phải mối đe dọa dù đến từ tên miền lạ. Một chuyên gia giỏi được "
                "đánh giá bằng cả độ nhạy (bắt đúng kẻ xấu) lẫn độ chính xác (không vu oan người tốt). "
                "Bạn chỉ cảnh báo khi có bằng chứng cụ thể về ý định gây hại."
            ),
            llm=self._llm,
            verbose=False,
            allow_delegation=False,
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
            return await self._analyze_with_crew(email_subject, email_body, sender)
        except (SecurityParseError, SecurityAgentError, LLMServiceError) as exc:
            logger.warning("CrewAI security analysis failed, using fallback: %s", exc)
        try:
            return await self._analyze_with_gemini(email_subject, email_body, sender)
        except Exception as exc:
            logger.warning(
                "Gemini security fallback also failed: %s — failing open with unverified status.", exc
            )
            return SecurityAnalysisOutput(
                is_safe=True,
                risk_level="low",
                warnings=["Security analysis unavailable — manual review recommended."],
            )

    async def _analyze_with_crew(
        self,
        email_subject: str,
        email_body: str,
        sender: str | None,
    ) -> SecurityAnalysisOutput:
        """Create a fresh Crew per call; run via asyncio.to_thread to avoid executor conflicts."""
        inputs = {
            "few_shot": _FEW_SHOT_EXAMPLES,
            "email_subject": email_subject,
            "email_body": email_body,
            "sender": sender or "unknown",
        }

        def _run() -> Any:
            task = Task(
                description=_SECURITY_TASK_TEMPLATE,
                expected_output=(
                    "A single JSON object with keys: is_safe (bool), risk_level (low|medium|high), "
                    "warnings (list of strings in Vietnamese). No markdown or extra text."
                ),
                agent=self._agent,
                output_pydantic=SecurityAnalysisOutput,
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
            return SecurityAnalysisOutput.model_validate(
                self._normalize(result.model_dump())
            )
        return result

    def _parse_crew_result(self, result: Any) -> SecurityAnalysisOutput:
        """Parse CrewAI output into SecurityAnalysisOutput with multiple fallback paths."""
        try:
            pydantic_output = getattr(result, "pydantic", None)
            if pydantic_output is not None:
                if isinstance(pydantic_output, SecurityAnalysisOutput):
                    return pydantic_output
                raw = pydantic_output.model_dump() if hasattr(pydantic_output, "model_dump") else dict(pydantic_output)
                return SecurityAnalysisOutput.model_validate(self._normalize(raw))

            if isinstance(result, SecurityAnalysisOutput):
                return result

            tasks_output = getattr(result, "tasks_output", None)
            if tasks_output:
                last = tasks_output[-1]
                if getattr(last, "pydantic", None) is not None:
                    pyd = last.pydantic
                    if isinstance(pyd, SecurityAnalysisOutput):
                        return pyd
                    raw = pyd.model_dump() if hasattr(pyd, "model_dump") else dict(pyd)
                    return SecurityAnalysisOutput.model_validate(self._normalize(raw))
                if getattr(last, "json_dict", None):
                    return SecurityAnalysisOutput.model_validate(
                        self._normalize(last.json_dict)
                    )

            raw_output = getattr(result, "raw", None) or str(result)
            json_payload = self._extract_json_object(raw_output)
            return SecurityAnalysisOutput.model_validate(self._normalize(json_payload))

        except (ValidationError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise SecurityParseError(
                f"Unable to parse CrewAI security output: {exc}"
            ) from exc

    @staticmethod
    def _normalize(data: dict[str, Any]) -> dict[str, Any]:
        """Fill missing or invalid fields with safe defaults before Pydantic validation."""
        result = dict(data)

        is_safe = result.get("is_safe")
        if not isinstance(is_safe, bool):
            if isinstance(is_safe, str):
                result["is_safe"] = is_safe.strip().lower() not in ("false", "0", "no")
            else:
                result["is_safe"] = True

        level = result.get("risk_level")
        result["risk_level"] = level.strip().lower() if isinstance(level, str) and level.strip().lower() in ("low", "medium", "high") else "low"

        warnings = result.get("warnings")
        if not isinstance(warnings, list):
            result["warnings"] = [str(warnings)] if isinstance(warnings, str) and warnings.strip() else []

        # Drop the "reasoning" field present in the prompt but not in the schema
        result.pop("reasoning", None)

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
            raise ValueError("No JSON object found in security agent output.")

        return json.loads(text[start : end + 1])
