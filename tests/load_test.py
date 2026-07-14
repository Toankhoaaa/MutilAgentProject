#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
load_test.py
============
Đo throughput và xác định giới hạn hệ thống bằng cách gửi batch email
đồng thời tới backend FastAPI.

YÊU CẦU
--------
  pip install aiohttp asyncio

CÁCH DÙNG
---------
  # Đảm bảo backend đang chạy: uvicorn main:app --host 0.0.0.0 --port 8000
  # Đảm bảo đã có JWT token hợp lệ (login trước, copy Bearer Token)

  python load_test.py \
      --url http://localhost:8000 \
      --token "YOUR_JWT_TOKEN" \
      --batches 1 5 10 20 50 \
      --out load_test_results.csv

KẾT QUẢ
--------
  Bảng throughput và tỉ lệ lỗi theo từng mức batch size — dán vào Bảng 3.7.

LƯU Ý KHI ĐO
------------
  - Mỗi mức batch chạy 3 lần, lấy trung bình (tránh outlier do cold start).
  - Gemini API có rate limit (quota/phút). Nếu thấy nhiều lỗi 429,
    giảm batch size hoặc tăng delay giữa các lần chạy.
  - Load test này đo giới hạn HỆ THỐNG CỤC BỘ (CPU, SQLite write lock,
    RAM), không phải giới hạn của Gemini API.
  - Kết quả thực tế phụ thuộc vào: máy chủ chạy backend, băng thông mạng,
    quota Gemini hiện tại.
"""

import asyncio, argparse, csv, time, json, statistics
from typing import Optional
try:
    import aiohttp
except ImportError:
    print("Thiếu thư viện: pip install aiohttp")
    import sys; sys.exit(1)

# ─── Cấu hình ────────────────────────────────────────────────────────────────
# Endpoint kích hoạt pipeline (điều chỉnh theo route thực tế của bạn)
PROCESS_ENDPOINT = "/api/v1/emails/process"   # POST → kích hoạt pipeline batch
STATUS_ENDPOINT  = "/api/v1/emails/status"    # GET  → kiểm tra đã xong chưa

# ─── Kết quả một lần test ────────────────────────────────────────────────────
class BatchResult:
    def __init__(self, batch_size: int, run_idx: int):
        self.batch_size = batch_size
        self.run_idx    = run_idx
        self.total_ms:  Optional[float] = None
        self.success:   int = 0
        self.errors:    int = 0
        self.http_errors: list[str] = []

    @property
    def throughput_per_min(self):
        if self.total_ms and self.total_ms > 0:
            return self.batch_size / (self.total_ms / 1000) * 60
        return 0

    @property
    def error_rate(self):
        total = self.success + self.errors
        return self.errors / total if total else 0

# ─── Gọi API ─────────────────────────────────────────────────────────────────
async def trigger_pipeline(session: "aiohttp.ClientSession",
                           base_url: str, headers: dict) -> tuple[bool, str]:
    """Kích hoạt pipeline xử lý email. Trả về (success, error_msg)."""
    url = base_url.rstrip("/") + PROCESS_ENDPOINT
    try:
        async with session.post(url, headers=headers, timeout=aiohttp.ClientTimeout(total=120)) as resp:
            if resp.status in (200, 201, 202):
                return True, ""
            body = await resp.text()
            return False, f"HTTP {resp.status}: {body[:100]}"
    except asyncio.TimeoutError:
        return False, "Timeout (>120s)"
    except Exception as e:
        return False, str(e)[:100]

async def run_batch(base_url: str, token: str,
                    batch_size: int, run_idx: int) -> BatchResult:
    """Gửi batch_size yêu cầu đồng thời."""
    headers = {"Authorization": f"Bearer {token}",
               "Content-Type": "application/json"}
    result = BatchResult(batch_size, run_idx)
    t0 = time.perf_counter()

    connector = aiohttp.TCPConnector(limit=batch_size + 5)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [trigger_pipeline(session, base_url, headers)
                 for _ in range(batch_size)]
        responses = await asyncio.gather(*tasks, return_exceptions=True)

    result.total_ms = (time.perf_counter() - t0) * 1000
    for ok, msg in responses:
        if isinstance(ok, Exception):
            result.errors += 1
            result.http_errors.append(str(ok)[:80])
        elif ok:
            result.success += 1
        else:
            result.errors += 1
            result.http_errors.append(msg)

    return result

# ─── Chạy toàn bộ test plan ──────────────────────────────────────────────────
async def run_load_test(base_url: str, token: str,
                        batches: list[int], runs_per_batch: int = 3,
                        delay_between_s: float = 5.0) -> list[BatchResult]:
    all_results = []
    for size in batches:
        print(f"\n[Batch size = {size}]  {runs_per_batch} lần chạy...")
        batch_results = []
        for i in range(1, runs_per_batch + 1):
            print(f"  Lần {i}/{runs_per_batch}... ", end="", flush=True)
            res = await run_batch(base_url, token, size, i)
            print(f"{res.total_ms:.0f} ms | "
                  f"OK={res.success} ERR={res.errors} | "
                  f"~{res.throughput_per_min:.1f} emails/phút")
            batch_results.append(res)
            all_results.append(res)
            if i < runs_per_batch:
                await asyncio.sleep(delay_between_s)

        # Tóm tắt mức batch này
        times  = [r.total_ms for r in batch_results if r.total_ms]
        tputs  = [r.throughput_per_min for r in batch_results]
        errs   = [r.error_rate for r in batch_results]
        print(f"  → TB: {statistics.mean(times):.0f} ms | "
              f"Throughput TB: {statistics.mean(tputs):.1f} emails/phút | "
              f"Lỗi TB: {statistics.mean(errs)*100:.1f}%")

        await asyncio.sleep(delay_between_s)

    return all_results

def summarize_load(all_results: list[BatchResult]) -> None:
    from itertools import groupby
    print("\n" + "=" * 74)
    print("KẾT QUẢ LOAD TEST")
    print("=" * 74)
    print(f"{'Batch size':>12}{'Tổng ms TB':>14}{'emails/phút TB':>16}{'Tỉ lệ lỗi TB':>14}")
    print("-" * 74)

    by_size = {}
    for r in all_results:
        by_size.setdefault(r.batch_size, []).append(r)

    for size in sorted(by_size):
        rs = by_size[size]
        times = [r.total_ms for r in rs if r.total_ms]
        tputs = [r.throughput_per_min for r in rs]
        errs  = [r.error_rate * 100 for r in rs]
        print(f"{size:>12}{statistics.mean(times):>14.0f}{statistics.mean(tputs):>16.1f}"
              f"{statistics.mean(errs):>13.1f}%")

    print("=" * 74)
    print("\nDán bảng trên vào Bảng 3.7 của báo cáo (điền số thực vào phần trống).")

def save_load_csv(all_results: list[BatchResult], path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["batch_size", "run_idx", "total_ms",
                         "success", "errors", "throughput_per_min", "error_rate"])
        for r in all_results:
            writer.writerow([r.batch_size, r.run_idx, r.total_ms,
                             r.success, r.errors,
                             f"{r.throughput_per_min:.1f}",
                             f"{r.error_rate:.3f}"])
    print(f"Chi tiết đã lưu vào: {path}")

# ─── Chế độ mock ─────────────────────────────────────────────────────────────
def mock_load_test(batches: list[int]) -> list[BatchResult]:
    """
    Tạo dữ liệu giả để kiểm tra cấu trúc script.
    XÓA khi chạy với backend thực.
    Mô phỏng: SQLite bắt đầu serialize writes khi batch > 10.
    """
    import random
    rng = random.Random(7)
    results = []
    for size in batches:
        for i in range(1, 4):
            r = BatchResult(size, i)
            # Giả lập: mỗi email mất ~3s, SQLite serialize khi nhiều concurrent
            base_time = size * 3000 if size <= 5 else size * 3000 * (1 + size/20)
            jitter = rng.uniform(0.9, 1.1)
            r.total_ms = base_time * jitter
            # Lỗi tăng khi batch lớn (rate limit simulation)
            error_prob = 0 if size <= 10 else (size - 10) * 0.02
            r.success = sum(1 for _ in range(size) if rng.random() > error_prob)
            r.errors  = size - r.success
            results.append(r)
    return results

# ─── Main ────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="Load test pipeline xử lý email")
    ap.add_argument("--url",     default="http://localhost:8000",
                    help="Base URL backend (mặc định: http://localhost:8000)")
    ap.add_argument("--token",   default="",
                    help="JWT Bearer Token (lấy sau khi login)")
    ap.add_argument("--batches", nargs="+", type=int,
                    default=[1, 5, 10, 20, 50],
                    help="Danh sách batch size cần test")
    ap.add_argument("--runs",    type=int, default=3,
                    help="Số lần chạy mỗi batch size (mặc định: 3)")
    ap.add_argument("--delay",   type=float, default=5.0,
                    help="Giây nghỉ giữa các batch (mặc định: 5s)")
    ap.add_argument("--out",     default="load_test_results.csv",
                    help="File CSV xuất kết quả")
    ap.add_argument("--mock",    action="store_true",
                    help="Dùng dữ liệu giả để kiểm tra cấu trúc")
    args = ap.parse_args()

    if args.mock:
        print(f"[MOCK MODE] Giả lập load test với batch sizes: {args.batches}")
        print("CẢNH BÁO: Đây là DỮ LIỆU GIẢ. Bỏ --mock khi test thực tế.\n")
        results = mock_load_test(args.batches)
    else:
        if not args.token:
            print("LỖI: Cần --token JWT. Login vào app, copy Bearer Token.")
            print("     Ví dụ: python load_test.py --token eyJhbGc...")
            import sys; sys.exit(1)
        results = asyncio.run(
            run_load_test(args.url, args.token, args.batches, args.runs, args.delay)
        )

    summarize_load(results)
    save_load_csv(results, args.out)

if __name__ == "__main__":
    main()
