"""
Standalone QA script for EmailClassifierAgent and EmailResponseAgent.

Run from project root:
    python test_agents.py
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass

from app.schemas.agent_schemas import EmailCategory, EmailClassificationOutput
from app.services.agents import (
    EmailClassifierAgent,
    EmailResponseAgent,
    ResponseAgentSkippedError,
)
from app.services.llm_service import GeminiService

logging.basicConfig(level=logging.WARNING)


@dataclass(frozen=True)
class MockEmail:
    """Mock inbound email with expected classification hints for QA review."""

    name: str
    sender: str
    subject: str
    body: str
    expected_category: EmailCategory
    expected_priority: int
    expect_deadline: bool = False
    expect_reply: bool = False


MOCK_EMAILS: list[MockEmail] = [
    MockEmail(
        name="Kịch bản 1 — Khẩn cấp (sự cố hệ thống)",
        sender="partner.ops@techvendor.vn",
        subject="[KHẨN CẤP] Hệ thống tích hợp sập — cần xử lý trước 17:00 hôm nay",
        body=(
            "Chào team,\n\n"
            "Hệ thống API tích hợp giữa hai bên đang báo lỗi 503 liên tục từ 10:30 sáng. "
            "Đối tác không thể đồng bộ đơn hàng. Vui lòng ưu tiên điều tra và khắc phục "
            "trước 17:00 (5h chiều) hôm nay để tránh phạt SLA.\n\n"
            "Mã ticket: INC-88421\n"
            "Trân trọng,\n"
            "Nguyễn Văn Hùng — DevOps Lead"
        ),
        expected_category=EmailCategory.URGENT,
        expected_priority=5,
        expect_deadline=True,
        expect_reply=True,
    ),
    MockEmail(
        name="Kịch bản 2 — Cần trả lời (sinh viên hỏi lịch nộp bài)",
        sender="student.leminh@university.edu.vn",
        subject="Hỏi lịch nộp bài tập lớn tuần sau",
        body=(
            "Thầy/cô ơi,\n\n"
            "Em là Lê Minh, lớp KTPM2021. Em xin hỏi deadline nộp báo cáo đồ án "
            "tuần sau là thứ mấy và nộp qua LMS hay email ạ? Em cảm ơn ạ.\n\n"
            "Lê Minh"
        ),
        expected_category=EmailCategory.NEED_REPLY,
        expected_priority=3,
        expect_deadline=False,
        expect_reply=True,
    ),
    MockEmail(
        name="Kịch bản 3 — Spam / quảng cáo",
        sender="promo@get-rich-now.biz",
        subject="🚀 Làm giàu nhanh — Thu nhập 50 triệu/tháng chỉ sau 7 ngày!!!",
        body=(
            "CHÚC MỪNG! Bạn được chọn tham gia khóa học bí mật làm giàu online.\n"
            "Cam kết thu nhập khủng, không cần kinh nghiệm. Click ngay để đăng ký!\n"
            "Hủy đăng ký tại đây (link giả)."
        ),
        expected_category=EmailCategory.SPAM,
        expected_priority=1,
        expect_deadline=False,
        expect_reply=False,
    ),
]


def _print_expectation_check(label: str, passed: bool, detail: str) -> None:
    status = "PASS" if passed else "WARN"
    print(f"  [{status}] {label}: {detail}")


def _review_classification(result: EmailClassificationOutput, mock: MockEmail) -> None:
    """Print soft QA checks against expected edge-case behavior."""
    category_ok = result.category == mock.expected_category
    priority_ok = result.priority_score == mock.expected_priority
    deadline_ok = (result.deadline is not None) == mock.expect_deadline

    _print_expectation_check(
        "category",
        category_ok,
        f"got={result.category.value!r}, expected={mock.expected_category.value!r}",
    )
    _print_expectation_check(
        "priority_score",
        priority_ok,
        f"got={result.priority_score}, expected={mock.expected_priority}",
    )
    _print_expectation_check(
        "deadline",
        deadline_ok,
        f"got={result.deadline!r}, expect_present={mock.expect_deadline}",
    )
    _print_expectation_check(
        "summary",
        bool(result.summary.strip()),
        f"length={len(result.summary)} chars",
    )
    _print_expectation_check(
        "confidence",
        0.0 <= result.confidence <= 1.0,
        f"value={result.confidence}",
    )


async def run_test() -> None:
    """Classify mock emails and draft replies for eligible categories."""
    gemini = GeminiService()
    classifier = EmailClassifierAgent(gemini_service=gemini)
    responder = EmailResponseAgent(gemini_service=gemini)

    print("=" * 50)
    print("AGENT QA — Classifier + Response (mock edge cases)")
    print("=" * 50)

    for index, mock in enumerate(MOCK_EMAILS, start=1):
        print("-" * 50)
        print(f"#{index} {mock.name}")
        print(f"From: {mock.sender}")
        print(f"Subject: {mock.subject}")
        print("-" * 50)

        print("\n[Classifier] Parsed JSON:")
        classification = await classifier.classify(
            subject=mock.subject,
            body=mock.body,
            sender=mock.sender,
        )
        print(json.dumps(classification.model_dump(mode="json"), indent=2, ensure_ascii=False))

        print("\n[Classifier] Expectation review:")
        _review_classification(classification, mock)

        if EmailResponseAgent.is_eligible(classification.category):
            print("\n[Response] Category eligible — drafting reply...")
            try:
                reply = await responder.compose_reply(
                    email_subject=mock.subject,
                    email_body=mock.body,
                    classification=classification,
                )
                print("\n[Response] Parsed JSON:")
                print(json.dumps(reply.model_dump(mode="json"), indent=2, ensure_ascii=False))
                print("\n[Response] Draft preview:")
                print(f"Subject: {reply.subject}")
                print("-" * 30)
                print(reply.body_content)
            except ResponseAgentSkippedError as exc:
                print(f"\n[Response] Skipped unexpectedly: {exc}")
        else:
            print(
                f"\n[Response] Skipped — category '{classification.category.value}' "
                "does not require auto-reply (expected for spam/newsletter/etc.)."
            )
            if mock.expect_reply:
                _print_expectation_check(
                    "auto_reply",
                    False,
                    "expected a reply draft but category was not eligible",
                )

        print()

    print("-" * 50)
    print("Done. Review JSON fields and draft tone above.")
    print("-" * 50)


if __name__ == "__main__":
    asyncio.run(run_test())
