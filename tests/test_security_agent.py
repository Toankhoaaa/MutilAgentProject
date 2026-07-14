#!/usr/bin/env python3
"""
Bước 2 của quy trình đánh giá Security Agent (phát hiện phishing).

Mục đích: đọc file dataset darkknight25/phishing_benign_email_dataset đã TẢI VỀ MÁY
(môi trường này không tải Hugging Face trực tiếp được), KIỂM TRA cấu trúc thật,
lấy mẫu CÂN BẰNG phishing/safe, rồi chuẩn hóa ra CSV với đúng các cột:

    id, true_label, subject, body, sender, source_dataset, difficulty, note

Script này KHÔNG dịch (bước 3 riêng) và KHÔNG chạy agent (harness riêng).
Nó chỉ chuẩn bị tập test sạch, nhãn GỐC giữ nguyên (khách quan, không do AI/bạn bịa).

CÁCH DÙNG:
  1. Tải file dataset từ Hugging Face về máy (xem hướng dẫn cuối file).
  2. Chạy KIỂM TRA trước để xem cấu trúc thật:
       python3 prepare_phishing_testset.py --inspect duong_dan_file.jsonl
  3. Nếu tên cột khớp mặc định -> chạy luôn:
       python3 prepare_phishing_testset.py --input duong_dan_file.jsonl --out testset_phishing_en.csv
  4. Nếu tên cột LỆCH -> chỉ định map:
       python3 prepare_phishing_testset.py --input file.jsonl --out out.csv \
           --col-label label --col-subject subject --col-body body --col-sender spoofed_sender
"""

import argparse
import csv
import json
import os
import random
import sys
from collections import Counter

# ---- Giá trị nhãn: dataset có thể dùng nhiều cách viết, ta chuẩn hóa về phishing/safe ----
PHISHING_TOKENS = {"phishing", "phish", "1", "spam", "malicious", "fraud"}
SAFE_TOKENS = {"safe", "benign", "legitimate", "ham", "0", "legit"}


def normalize_label(raw):
    """Đưa nhãn gốc bất kỳ về 'phishing' / 'safe' / None (không nhận ra)."""
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if s in PHISHING_TOKENS:
        return "phishing"
    if s in SAFE_TOKENS:
        return "safe"
    return None


def load_records(path):
    """Đọc cả .jsonl (mỗi dòng 1 JSON) lẫn .json (mảng) lẫn .csv."""
    ext = os.path.splitext(path)[1].lower()
    records = []
    if ext in (".jsonl", ".ndjson"):
        with open(path, "r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError as e:
                    print(f"  [bỏ qua] dòng {line_no} không phải JSON hợp lệ: {e}", file=sys.stderr)
    elif ext == ".json":
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        records = data if isinstance(data, list) else data.get("data", [])
    elif ext in (".csv", ".tsv"):
        delim = "\t" if ext == ".tsv" else ","
        with open(path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter=delim)
            records = list(reader)
    else:
        raise ValueError(f"Định dạng không hỗ trợ: {ext} (cần .jsonl/.json/.csv)")
    return records


def inspect(path):
    """In cấu trúc thật của file để xác nhận tên cột trước khi xử lý."""
    records = load_records(path)
    print(f"\n=== KIỂM TRA CẤU TRÚC: {path} ===")
    print(f"Tổng số bản ghi: {len(records)}")
    if not records:
        print("File rỗng hoặc không đọc được.")
        return
    # Gom tất cả khóa xuất hiện
    keys = Counter()
    for r in records:
        if isinstance(r, dict):
            keys.update(r.keys())
    print(f"\nCác cột (khóa) thấy trong file, kèm số lần xuất hiện:")
    for k, c in keys.most_common():
        print(f"  - {k!r}: {c}")
    # In 2 bản ghi mẫu
    print(f"\n2 bản ghi mẫu đầu tiên:")
    for i, r in enumerate(records[:2]):
        print(f"\n  [bản ghi {i}]")
        for k, v in r.items():
            vs = str(v)
            if len(vs) > 200:
                vs = vs[:200] + "...(cắt)"
            print(f"    {k}: {vs}")
    # Thử đoán cột nhãn + phân bố nhãn
    print(f"\nThử đoán phân bố nhãn (dò các cột tên giống 'label'):")
    for k in keys:
        if "label" in k.lower() or k.lower() in ("class", "category", "type"):
            dist = Counter(normalize_label(r.get(k)) for r in records if isinstance(r, dict))
            print(f"  cột {k!r} -> {dict(dist)}")
    print("\n=> Dùng tên cột trên để chạy bước chuẩn hóa (xem --help).")


def build_testset(path, out_path, n_per_class,
                  col_label, col_subject, col_body, col_sender,
                  source_name, seed):
    records = load_records(path)
    if not records:
        print("Không có bản ghi nào để xử lý.", file=sys.stderr)
        sys.exit(1)

    # Phân nhóm theo nhãn chuẩn hóa
    buckets = {"phishing": [], "safe": []}
    skipped = 0
    for r in records:
        if not isinstance(r, dict):
            skipped += 1
            continue
        lab = normalize_label(r.get(col_label))
        if lab in buckets:
            buckets[lab].append(r)
        else:
            skipped += 1

    print(f"Đọc {len(records)} bản ghi. "
          f"phishing={len(buckets['phishing'])}, safe={len(buckets['safe'])}, "
          f"bỏ qua (nhãn không nhận ra)={skipped}")

    # Kiểm đủ mẫu không
    for lab in ("phishing", "safe"):
        if len(buckets[lab]) < n_per_class:
            print(f"  [CẢNH BÁO] '{lab}' chỉ có {len(buckets[lab])} < {n_per_class} yêu cầu. "
                  f"Sẽ lấy hết {len(buckets[lab])} mẫu loại này.", file=sys.stderr)

    rng = random.Random(seed)  # seed cố định -> tái lập được (quan trọng cho báo cáo)
    chosen = []
    for lab in ("phishing", "safe"):
        pool = buckets[lab]
        rng.shuffle(pool)
        take = min(n_per_class, len(pool))
        chosen.extend((lab, r) for r in pool[:take])
    rng.shuffle(chosen)  # trộn để phishing/safe không xếp khối

    # Ghi ra CSV với đúng cột yêu cầu
    fieldnames = ["id", "true_label", "subject", "body", "sender",
                  "source_dataset", "difficulty", "note"]
    n_phish = n_safe = 0
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for idx, (lab, r) in enumerate(chosen, 1):
            if lab == "phishing":
                n_phish += 1
            else:
                n_safe += 1
            w.writerow({
                "id": f"ph_{idx:04d}",
                "true_label": lab,                          # nhãn GỐC giữ nguyên
                "subject": (r.get(col_subject) or "").strip(),
                "body": (r.get(col_body) or "").strip(),
                "sender": (r.get(col_sender) or "").strip() if col_sender else "",
                "source_dataset": source_name,
                "difficulty": "",   # để trống — bạn có thể tự đánh dấu easy/hard sau nếu muốn
                "note": "",         # để trống — ghi chú thủ công nếu cần
            })

    print(f"\n✅ Đã ghi {n_phish + n_safe} mẫu ra: {out_path}")
    print(f"   phishing={n_phish}, safe={n_safe}")
    print(f"   (seed={seed} -> tái lập được; nhãn gốc giữ nguyên, chưa dịch)")
    print(f"\nBước tiếp theo: dịch cột subject/body sang tiếng Việt (giữ true_label),")
    print(f"rồi chạy harness Security Agent trên file đã dịch.")


def main():
    ap = argparse.ArgumentParser(description="Chuẩn bị tập test phishing/safe cân bằng.")
    ap.add_argument("--inspect", metavar="FILE",
                    help="Chỉ kiểm tra cấu trúc file rồi thoát.")
    ap.add_argument("--input", help="File dataset đã tải (.jsonl/.json/.csv)")
    ap.add_argument("--out", default="testset_phishing_en.csv", help="File CSV đầu ra")
    ap.add_argument("--n-per-class", type=int, default=75,
                    help="Số mẫu mỗi lớp (mặc định 75 -> tổng 150)")
    ap.add_argument("--col-label", default="label", help="Tên cột nhãn trong file gốc")
    ap.add_argument("--col-subject", default="subject", help="Tên cột subject")
    ap.add_argument("--col-body", default="body", help="Tên cột body")
    ap.add_argument("--col-sender", default="", help="Tên cột sender/spoofed_sender (có thể bỏ trống)")
    ap.add_argument("--source-name", default="darkknight25/phishing_benign_email_dataset",
                    help="Tên nguồn để ghi vào cột source_dataset (cho trích dẫn báo cáo)")
    ap.add_argument("--seed", type=int, default=42, help="Seed ngẫu nhiên (tái lập)")
    args = ap.parse_args()

    if args.inspect:
        inspect(args.inspect)
        return
    if not args.input:
        ap.error("Cần --input (hoặc dùng --inspect để xem cấu trúc trước).")

    build_testset(
        path=args.input, out_path=args.out, n_per_class=args.n_per_class,
        col_label=args.col_label, col_subject=args.col_subject,
        col_body=args.col_body, col_sender=args.col_sender or None,
        source_name=args.source_name, seed=args.seed,
    )


if __name__ == "__main__":
    main()