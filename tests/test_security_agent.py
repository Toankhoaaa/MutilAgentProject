"""
Bộ kiểm thử Security Agent — chiến lược recall-first (ưu tiên không bỏ sót lừa đảo).

CÁCH DÙNG
---------
1. Đặt file này + security_test_cases.json vào dự án (vd: backend/tests/).
2. Sửa dòng IMPORT bên dưới cho khớp đường dẫn module thật của bạn.
3. Chạy nhanh (in báo cáo ra màn hình):
       python test_security_agent.py
   Hoặc chạy bằng pytest:
       pytest test_security_agent.py -v

Ý nghĩa nhãn (xem _meta trong file JSON):
  fraud      -> BẮT BUỘC is_safe=false   (bỏ sót = lỗi nghiêm trọng nhất)
  benign     -> BẮT BUỘC is_safe=true    (báo nhầm = phá trải nghiệm)
  borderline -> recall-first: is_safe=false (nghiêng cảnh báo)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

# --- SỬA ĐƯỜNG DẪN IMPORT CHO KHỚP DỰ ÁN CỦA BẠN ----------------------------
import pathlib
# Thêm src/ vào sys.path để Python tìm thấy package backend
_SRC = pathlib.Path(__file__).resolve().parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from backend.services.agents.security_agent import EmailSecurityAgent  # noqa: E402

CASES_PATH = os.path.join(os.path.dirname(__file__), "security_test_cases.json")


def load_cases() -> list[dict]:
    with open(CASES_PATH, encoding="utf-8") as f:
        return json.load(f)["cases"]


def check(case: dict, result) -> tuple[bool, str]:
    """So kết quả thực tế với kỳ vọng. Trả (đạt?, mô tả lệch)."""
    exp_safe = case["expected_is_safe"]
    if result.is_safe != exp_safe:
        return False, f"is_safe={result.is_safe} (kỳ vọng {exp_safe})"
    # Nếu phải bị cảnh báo, kiểm thêm mức rủi ro nằm trong khoảng chấp nhận.
    if not exp_safe:
        ok_levels = case.get("risk_chap_nhan", ["low", "medium", "high"])
        if result.risk_level not in ok_levels:
            return False, f"risk_level={result.risk_level} (chấp nhận {ok_levels})"
    return True, ""


async def run_all() -> int:
    agent = EmailSecurityAgent()
    cases = load_cases()

    results = []
    for c in cases:
        out = await agent.analyze(
            email_subject=c["subject"],
            email_body=c["body"],
            sender=c["sender"],
        )
        ok, detail = check(c, out)
        results.append((c, out, ok, detail))

    # ---- In chi tiết ----
    print("\n" + "=" * 78)
    print("KẾT QUẢ KIỂM THỬ SECURITY AGENT (recall-first)")
    print("=" * 78)
    for c, out, ok, detail in results:
        tag = "PASS" if ok else "FAIL"
        line = f"[{tag}] {c['id']:4} ({c['nhom']:10}) -> is_safe={out.is_safe}, risk={out.risk_level}"
        if not ok:
            line += f"   ❌ {detail}"
        print(line)

    # ---- Tổng hợp theo loại lỗi (quan trọng cho recall-first) ----
    missed_fraud = [c for c, o, ok, _ in results if c["nhom"] in ("fraud", "borderline") and not ok]
    false_alarm = [c for c, o, ok, _ in results if c["nhom"] == "benign" and not ok]
    n_fraud = sum(1 for c in cases if c["nhom"] in ("fraud", "borderline"))
    n_benign = sum(1 for c in cases if c["nhom"] == "benign")
    passed = sum(1 for *_, ok, _ in results if ok)

    print("-" * 78)
    print(f"Tổng: {passed}/{len(cases)} ca đạt.")
    print(f"  • BỎ SÓT lừa đảo (nghiêm trọng nhất): {len(missed_fraud)}/{n_fraud}"
          + ("  -> " + ", ".join(c["id"] for c in missed_fraud) if missed_fraud else "  ✅ không bỏ sót"))
    print(f"  • BÁO NHẦM email hợp lệ (sàn precision): {len(false_alarm)}/{n_benign}"
          + ("  -> " + ", ".join(c["id"] for c in false_alarm) if false_alarm else "  ✅ không báo nhầm"))
    recall = (n_fraud - len(missed_fraud)) / n_fraud if n_fraud else 1.0
    precision_floor = (n_benign - len(false_alarm)) / n_benign if n_benign else 1.0
    print(f"  • Recall (bắt được lừa đảo): {recall:.0%}")
    print(f"  • Giữ đúng email hợp lệ:     {precision_floor:.0%}")
    print("=" * 78 + "\n")

    # Recall-first: ưu tiên KHÔNG bỏ sót. Báo lỗi nếu sót lừa đảo HOẶC có ca fail.
    return 0 if passed == len(cases) else 1


# ----- Hỗ trợ pytest (mỗi ca là một test) -----
def _load_for_pytest():
    return load_cases()

try:
    import pytest

    @pytest.mark.asyncio
    @pytest.mark.parametrize("case", _load_for_pytest(), ids=lambda c: c["id"])
    async def test_case(case):
        agent = EmailSecurityAgent()
        out = await agent.analyze(
            email_subject=case["subject"],
            email_body=case["body"],
            sender=case["sender"],
        )
        ok, detail = check(case, out)
        assert ok, f"{case['id']} ({case['nhom']}): {detail} | note: {case['note']}"
except ImportError:
    pass


if __name__ == "__main__":
    sys.exit(asyncio.run(run_all()))
