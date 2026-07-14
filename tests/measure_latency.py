#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
measure_latency.py
==================
Đo độ trễ từng bước trong EmailOrchestrator.
Chạy trong môi trường backend (cùng thư mục với main.py).

YÊU CẦU
--------
  pip install pandas tabulate

CÁCH DÙNG
---------
  # 1. Đặt file này vào thư mục gốc backend (cùng cấp với main.py)
  # 2. Đảm bảo .env đã có GEMINI_API_KEY, GMAIL_* credentials
  # 3. Chạy:
  python measure_latency.py --emails 30 --out latency_results.csv

  # 4. Kết quả CSV dán vào script evaluate_system.py để tổng hợp
  #    hoặc xem bảng in ngay ra terminal

KẾT QUẢ
--------
  - Terminal: bảng per-step avg / p50 / p95 / max
  - latency_results.csv: mỗi hàng = 1 email, mỗi cột = latency 1 bước (ms)
"""

import argparse, csv, time, statistics, sys
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, asdict

# ─── Path setup ──────────────────────────────────────────────────────────────
_BACKEND_DIR = Path(__file__).parent          # src/backend/
_SRC_DIR     = _BACKEND_DIR.parent            # src/
_PROJECT_DIR = _SRC_DIR.parent                # Project1/
sys.path.insert(0, str(_SRC_DIR))

import asyncio

_ENV_FILE = _PROJECT_DIR / ".env"
if _ENV_FILE.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_ENV_FILE)
    except ImportError:
        pass  # pydantic-settings đọc .env trực tiếp

# ─── Imports backend ─────────────────────────────────────────────────────────
from backend.services.agents.privacy_agent import PrivacyAgent
from backend.services.agents.security_agent import EmailSecurityAgent
from backend.services.rule_engine import RuleEngine
from backend.services.agents.classifier_agent import EmailClassifierAgent
from backend.services.agents.scheduling_agent import EmailSchedulingAgent
from backend.services.agents.rag_agent import RagAgent
from backend.services.agents.response_agent import EmailResponseAgent

# ─── Cấu trúc ghi kết quả ────────────────────────────────────────────────────
@dataclass
class EmailLatency:
    email_id:       str
    subject:        str = ""
    privacy_ms:     Optional[float] = None
    security_ms:    Optional[float] = None
    rule_ms:        Optional[float] = None
    classifier_ms:  Optional[float] = None
    scheduling_ms:  Optional[float] = None
    rag_ms:         Optional[float] = None
    response_ms:    Optional[float] = None
    total_ms:       Optional[float] = None
    # pipeline path
    security_blocked: bool = False
    skip_draft:       bool = False
    requires_meeting: bool = False
    requires_response: bool = False
    error:            str = ""

# ─── Wrapper đo thời gian ────────────────────────────────────────────────────
class TimingWrapper:
    def __init__(self):
        self.results: list[EmailLatency] = []

    @staticmethod
    def timed(func, *args, **kwargs) -> tuple:
        """Chạy func đồng bộ, trả về (result, elapsed_ms, error)."""
        t0 = time.perf_counter()
        try:
            result = func(*args, **kwargs)
            elapsed = (time.perf_counter() - t0) * 1000
            return result, elapsed, None
        except Exception as e:
            elapsed = (time.perf_counter() - t0) * 1000
            return None, elapsed, str(e)

    @staticmethod
    async def async_timed(coro) -> tuple:
        """Chạy coroutine bất đồng bộ, trả về (result, elapsed_ms, error)."""
        t0 = time.perf_counter()
        try:
            result = await coro
            elapsed = (time.perf_counter() - t0) * 1000
            return result, elapsed, None
        except Exception as e:
            elapsed = (time.perf_counter() - t0) * 1000
            return None, elapsed, str(e)

    async def measure_pipeline(self, email_data: dict) -> EmailLatency:
        """Đo toàn bộ pipeline cho một email với các Agent thực tế."""
        rec = EmailLatency(
            email_id=email_data.get("id", "unknown"),
            subject=email_data.get("subject", "")[:60],
        )
        t_total = time.perf_counter()

        cls_result = None
        rag_context = ""

        try:
            # ── BƯỚC 1: Privacy ──────────────────────────────────────────────
            masked, ms, err = self.timed(PrivacyAgent().mask_email_dict, email_data)
            rec.privacy_ms = ms
            if err or masked is None:
                rec.error += f"[privacy:{err}]"
                return rec

            # ── BƯỚC 2: Security ─────────────────────────────────────────────
            sec_result, ms, err = await self.async_timed(
                EmailSecurityAgent().analyze(
                    email_subject=masked.get("subject") or "",
                    email_body=masked.get("body") or masked.get("snippet") or "",
                    sender=masked.get("sender"),
                )
            )
            rec.security_ms = ms
            if err or sec_result is None:
                rec.error += f"[security:{err}]"
            else:
                rec.security_blocked = (
                    sec_result.risk_level == "high" or not sec_result.is_safe
                )

            # ── BƯỚC 3: Rule Engine ──────────────────────────────────────────
            _, ms, err = self.timed(RuleEngine().evaluate, masked, [])
            rec.rule_ms = ms
            if err:
                rec.error += f"[rule:{err}]"

            # ── BƯỚC 4: Classifier ───────────────────────────────────────────
            if not rec.security_blocked:
                cls_result, ms, err = await self.async_timed(
                    EmailClassifierAgent().classify(
                        subject=masked.get("subject") or "",
                        body=masked.get("body") or masked.get("snippet") or "",
                        sender=masked.get("sender"),
                    )
                )
                rec.classifier_ms = ms
                if err or cls_result is None:
                    rec.error += f"[classifier:{err}]"
                else:
                    rec.requires_response = EmailResponseAgent.is_eligible(
                        cls_result.category
                    )

            # ── BƯỚC 5: Scheduling ───────────────────────────────────────────
            if not rec.security_blocked:
                sched_result, ms, err = await self.async_timed(
                    EmailSchedulingAgent().extract_schedule(
                        email_subject=masked.get("subject") or "",
                        email_body=masked.get("body") or masked.get("snippet") or "",
                        sender=masked.get("sender") or "",
                    )
                )
                rec.scheduling_ms = ms
                if err or sched_result is None:
                    rec.error += f"[scheduling:{err}]"
                else:
                    rec.requires_meeting = sched_result.is_meeting_request

            # ── BƯỚC 6: RAG ──────────────────────────────────────────────────
            if rec.requires_response and not rec.skip_draft:
                rag_context, ms, err = self.timed(
                    RagAgent().retrieve,
                    masked.get("body") or masked.get("snippet") or "",
                )
                rec.rag_ms = ms
                if err:
                    rec.error += f"[rag:{err}]"
                    rag_context = ""

            # ── BƯỚC 7: Response ─────────────────────────────────────────────
            if rec.requires_response and not rec.skip_draft and cls_result is not None:
                _, ms, err = await self.async_timed(
                    EmailResponseAgent().draft_reply(
                        email_subject=masked.get("subject") or "",
                        email_body=masked.get("body") or "",
                        classification=cls_result,
                        rag_context=rag_context,
                        on_demand=True,
                    )
                )
                rec.response_ms = ms
                if err:
                    rec.error += f"[response:{err}]"

        except Exception as e:
            rec.error += f"[pipeline:{e}]"
        finally:
            rec.total_ms = (time.perf_counter() - t_total) * 1000

        return rec

# ─── Thống kê ────────────────────────────────────────────────────────────────
def percentile(data, pct):
    """Tính percentile của list số (bỏ None)."""
    clean = sorted(x for x in data if x is not None)
    if not clean:
        return None
    k = (len(clean) - 1) * pct / 100
    lo, hi = int(k), min(int(k) + 1, len(clean) - 1)
    return clean[lo] + (clean[hi] - clean[lo]) * (k - lo)

def summarize(records: list[EmailLatency]) -> None:
    """In bảng thống kê ra terminal."""
    STEPS = [
        ("Privacy",    "privacy_ms"),
        ("Security",   "security_ms"),
        ("Rule Engine","rule_ms"),
        ("Classifier", "classifier_ms"),
        ("Scheduling", "scheduling_ms"),
        ("RAG",        "rag_ms"),
        ("Response",   "response_ms"),
        ("TOTAL",      "total_ms"),
    ]

    print("\n" + "=" * 78)
    print(f"KẾT QUẢ ĐO ĐỘ TRỄ  —  {len(records)} emails")
    print("=" * 78)
    print(f"{'Bước':<16}{'N đo':>6}{'Avg (ms)':>10}{'p50 (ms)':>10}{'p95 (ms)':>10}{'Max (ms)':>10}")
    print("-" * 78)

    for label, field_name in STEPS:
        vals = [getattr(r, field_name) for r in records]
        valid = [v for v in vals if v is not None]
        if not valid:
            print(f"{label:<16}{'—':>6}{'—':>10}{'—':>10}{'—':>10}{'—':>10}")
            continue
        avg = statistics.mean(valid)
        p50 = percentile(valid, 50)
        p95 = percentile(valid, 95)
        mx  = max(valid)
        sep = " ◄" if label == "TOTAL" else ""
        print(f"{label:<16}{len(valid):>6}{avg:>10.0f}{p50:>10.0f}{p95:>10.0f}{mx:>10.0f}{sep}")

    print("=" * 78)

    # Pipeline path breakdown
    blocked = sum(1 for r in records if r.security_blocked)
    no_draft = sum(1 for r in records if r.skip_draft and not r.security_blocked)
    with_sched = sum(1 for r in records if r.requires_meeting)
    full = len(records) - blocked - no_draft
    print(f"\nPhân loại pipeline path:")
    print(f"  Bị chặn (security_blocked)  : {blocked:>4}  ({blocked/len(records)*100:.0f}%)")
    print(f"  Bỏ soạn nháp (skip_draft)   : {no_draft:>4}  ({no_draft/len(records)*100:.0f}%)")
    print(f"  Có lịch họp (scheduling)    : {with_sched:>4}  ({with_sched/len(records)*100:.0f}%)")
    print(f"  Pipeline đầy đủ             : {full:>4}  ({full/len(records)*100:.0f}%)")

    errors = [r for r in records if r.error]
    if errors:
        print(f"\n  ⚠ Lỗi: {len(errors)} emails — xem cột 'error' trong CSV")

def save_csv(records: list[EmailLatency], path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=asdict(records[0]).keys())
        writer.writeheader()
        writer.writerows(asdict(r) for r in records)
    print(f"\nĐã lưu chi tiết vào: {path}")

# ─── Giả lập (dùng để test cấu trúc khi chưa kết nối backend thực) ──────────
def mock_measure(n: int) -> list[EmailLatency]:
    """
    TẠO DỮ LIỆU GIẢ để kiểm tra cấu trúc script.
    XÓA HÀM NÀY khi đo với backend thực.
    Thay bằng: gọi TimingWrapper().measure_pipeline() với email thật.
    """
    import random
    rng = random.Random(42)
    results = []
    for i in range(n):
        is_phishing = rng.random() < 0.15
        is_newsletter = rng.random() < 0.20
        needs_meeting = rng.random() < 0.30 and not is_phishing
        needs_response = rng.random() < 0.50 and not is_phishing and not is_newsletter

        r = EmailLatency(
            email_id=f"email_{i:03d}",
            subject=f"Subject {i}",
            privacy_ms=rng.uniform(1, 8),
            security_ms=rng.uniform(1400, 3800),
            rule_ms=rng.uniform(0.5, 3),
            security_blocked=is_phishing,
        )
        if not is_phishing:
            r.classifier_ms = rng.uniform(1300, 3200)
            r.scheduling_ms = rng.uniform(2000, 5500)
            r.requires_meeting = needs_meeting
            r.requires_response = needs_response
            if needs_response:
                r.rag_ms = rng.uniform(20, 80)
                r.response_ms = rng.uniform(1800, 4200)
        r.total_ms = sum(v for v in [
            r.privacy_ms, r.security_ms, r.rule_ms,
            r.classifier_ms, r.scheduling_ms, r.rag_ms, r.response_ms
        ] if v is not None)
        results.append(r)
    return results

# ─── Email mẫu để đo thực tế ─────────────────────────────────────────────────
_SAMPLE_EMAILS = [
    {
        "id": "sample_urgent_01",
        "subject": "GẤP: Server production down — cần xử lý ngay",
        "body": "Hệ thống đang lỗi nghiêm trọng. Anh xác nhận phương án xử lý ngay hôm nay được không?",
        "sender": "devops@company.com",
        "snippet": "",
    },
    {
        "id": "sample_meeting_01",
        "subject": "Mời họp dự án Q3 chiều mai 14h",
        "body": "Anh/chị ơi, mình mời họp dự án Q3 vào chiều mai, 14:00 tại phòng họp B. Anh xác nhận giúp nhé.",
        "sender": "manager@company.vn",
        "snippet": "",
    },
    {
        "id": "sample_phishing_01",
        "subject": "⚠️ Tài khoản của bạn bị khóa — xác minh ngay",
        "body": "Phát hiện đăng nhập bất thường. Nhấn để xác minh: http://vietcombank-verify.net/login Không xác minh trong 24h tài khoản sẽ bị đóng vĩnh viễn.",
        "sender": "security-alert@vietcombank-verify.net",
        "snippet": "",
    },
    {
        "id": "sample_newsletter_01",
        "subject": "Bản tin sản phẩm hằng tuần — số tháng 6",
        "body": "Tổng hợp bài viết nổi bật và ghi chú phát hành tuần này. Quản lý tùy chọn | Hủy đăng ký tại đây.",
        "sender": "newsletter@product.io",
        "snippet": "",
    },
    {
        "id": "sample_reply_01",
        "subject": "Re: Hợp đồng dự án ABC — cần xác nhận",
        "body": "Chào anh, bên mình đã xem xét hợp đồng và có một vài điểm cần trao đổi thêm. Anh có thể gặp mặt vào thứ Năm tuần này không?",
        "sender": "client@partner.com",
        "snippet": "",
    },
]

# ─── Runner thực tế ───────────────────────────────────────────────────────────
async def run_real(n_emails: int) -> list[EmailLatency]:
    """Đo latency thực tế với các Agent backend."""
    wrapper = TimingWrapper()
    sample_pool = _SAMPLE_EMAILS * (n_emails // len(_SAMPLE_EMAILS) + 1)
    emails_to_test = [
        {**email, "id": f"{email['id']}_{i:03d}"}
        for i, email in enumerate(sample_pool[:n_emails])
    ]

    records = []
    for i, email_data in enumerate(emails_to_test, 1):
        print(f"  [{i:>3}/{n_emails}] {email_data['subject'][:50]}", end="", flush=True)
        rec = await wrapper.measure_pipeline(email_data)
        records.append(rec)
        status = "✗" if rec.error else ("🔒" if rec.security_blocked else "✓")
        print(f" {status} {rec.total_ms:.0f}ms")
    return records

# ─── Main ────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="Đo latency pipeline xử lý email")
    ap.add_argument("--emails", type=int, default=30,
                    help="Số email cần đo (mặc định: 30)")
    ap.add_argument("--out",  default="latency_results.csv",
                    help="File CSV xuất kết quả")
    ap.add_argument("--mock", action="store_true",
                    help="Dùng dữ liệu giả để kiểm tra cấu trúc (không cần backend)")
    args = ap.parse_args()

    if args.mock:
        print(f"[MOCK MODE] Sinh {args.emails} email giả để kiểm tra cấu trúc...")
        print("CẢNH BÁO: Đây là DỮ LIỆU GIẢ. Bỏ --mock khi đo thực tế.\n")
        records = mock_measure(args.emails)
    else:
        print(f"[THỰC TẾ] Đo {args.emails} email từ backend...")
        print(f"  Nguồn: {len(_SAMPLE_EMAILS)} email mẫu lặp lại đến {args.emails} lần\n")
        records = asyncio.run(run_real(args.emails))

    summarize(records)
    if records:
        save_csv(records, args.out)
        print("\nSao chép bảng thống kê trên vào Bảng 3.6 của báo cáo.")

if __name__ == "__main__":
    main()
