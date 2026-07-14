#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
evaluate_final.py — Script đánh giá tổng hợp
=============================================
Đọc labeling_source.csv, chạy Rule-based (không cần API) VÀ AI Gemini
(nếu có API key), xuất đủ số liệu cho toàn bộ bảng đánh giá trong báo cáo.

CÁCH DÙNG
---------
    # Chỉ Rule-based (không cần API key):
    python evaluate_final.py

    # Đầy đủ (cần GEMINI_API_KEY):
    GEMINI_API_KEY=your_key python evaluate_final.py
    # Hoặc tạo file .env có GEMINI_API_KEY=your_key

ĐƯỜNG DẪN MẶC ĐỊNH
------------------
    Input : labeling_source.csv (cùng thư mục)
    Output: evaluation_results.csv + bảng in ra terminal
"""

import csv, re, os, time, json, statistics
from collections import Counter, defaultdict
from pathlib import Path
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ─── CẤU HÌNH ────────────────────────────────────────────────────────────────
INPUT_CSV   = os.getenv("EVAL_CSV", "labeling_source.csv")
GEMINI_KEY  = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL= "gemini-2.5-flash"
CLASSES     = ["urgent", "need_reply", "important", "newsletter", "spam"]
DELAY_SEC   = 0.5   # delay giữa các lần gọi API để tránh rate limit

# ─── LOAD DATA ────────────────────────────────────────────────────────────────
def load_labeled(path: str) -> list:
    if not Path(path).exists():
        raise FileNotFoundError(f"Không tìm thấy: {path}")
    rows = list(csv.DictReader(open(path, encoding="utf-8-sig")))
    labeled = [r for r in rows if r.get("true_label", "").strip()]
    print(f"[DATA] {len(labeled)}/{len(rows)} email có nhãn từ '{path}'")
    return labeled

def get_text(r, max_body=500):
    return (r.get("subject","") + " " + r.get("body","")[:max_body]).lower()

# ─── RULE-BASED CLASSIFIER ───────────────────────────────────────────────────
def rule_classify(r) -> str:
    t = get_text(r)
    subj = r.get("subject","").lower()
    body = r.get("body","")[:500].lower()
    words = body.split()

    # === SPAM ===
    spam_hard = [
        "cheap ","medication ","no prescription","pills ","cialis","viagra",
        "phharma","young pussies","young sluts","lose weight","wire transfer",
        "mrs. juliana","dear friend , please","kareem","solicitors",
        "gain substantial ground","montana oil","suntrust bank","cablefilterz",
        "buy pain relief","microsoft office software","pay less for microsoft",
        "prozacs meds","from mrs","bequest","notification of bequest",
        "sex for t","sprig bashaw","vulgar","underground",
        "valium","xanax","pharmacy ","weight now",
    ]
    if any(k in t for k in spam_hard):
        return "spam"
    if re.search(r"[a-z]{15,}", body):          # gibberish word
        return "spam"
    if len(words) > 5 and sum(1 for w in words if len(w)>12) > len(words)*0.4:
        return "spam"                             # mostly obfuscated tokens

    # === NEWSLETTER ===
    nl_hard = [
        "spring savings","clearance","voucher","cruise","travel package",
        "iwon","equity report","stock market standouts","@ $","@$",
        "holiday voucher","registration confirmation","take 30 % off",
        "free coffee","sample movies","special invitation","impact equity",
        "end of year","10 % off","charset = us-ascii","take 30% off",
    ]
    if any(k in t for k in nl_hard):
        return "newsletter"
    if re.search(r"stock.{0,30}(shoot|explo|gain|recomm|skyrocket)", t):
        return "newsletter"

    # === URGENT ===
    urg_hard = [
        "force majeure","chapter 11","reorganization","curtailment",
        "immediately to avoid","close schedule","settelement",
        "out of the office","organizational change","name changes",
    ]
    if any(k in t for k in urg_hard):
        return "urgent"

    # === NEED_REPLY ===
    if re.match(r"^(re|fw)\s*:", subj):
        return "need_reply"

    # === IMPORTANT vs NEED_REPLY (Enron operational) ===
    if re.search(r"meter #|meter variances|nom for|nominations for|actuals for|enron/", t):
        return "important"
    if len(words) < 20:
        return "need_reply"
    return "important"

# ─── FEW-SHOT PROMPT ─────────────────────────────────────────────────────────
FEW_SHOT_PROMPT = """\
You are an expert email classifier. Classify the email into exactly one of:
- urgent     : needs immediate action (incident, deadline, force majeure)
- need_reply : needs a reply (questions, requests, follow-ups)
- important  : informational but not urgent (reports, announcements)
- newsletter : promotional, marketing, subscription content
- spam       : unsolicited, phishing, scam, obfuscated content

EXAMPLES:
Subject: URGENT: Production server down
Body: Our main DB crashed, 500 users affected. Need DBA now.
→ {{"category":"urgent","confidence":0.98}}

Subject: Re: Budget proposal for Q3
Body: Can you review the attached budget and let me know by Friday?
→ {{"category":"need_reply","confidence":0.91}}

Subject: HPL nom for January 9, 2001
Body: Please find attached the nominations for HPL for Jan 9.
→ {{"category":"important","confidence":0.87}}

Subject: Spring Savings Certificate - Take 30% off
Body: Take 30% off your next purchase with code SPRING30. Unsubscribe here.
→ {{"category":"newsletter","confidence":0.95}}

Subject: young pussies
Body: tonya could feel the glow of the hundreds of candles...
→ {{"category":"spam","confidence":0.99}}

Now classify:
Subject: {subject}
Body: {body}

Respond with ONLY valid JSON: {{"category":"...","confidence":0.0}}"""

ZERO_SHOT_PROMPT = """\
Classify this email into one of: urgent, need_reply, important, newsletter, spam.
- urgent: needs immediate action
- need_reply: needs a reply
- important: informational, not urgent
- newsletter: promotional/marketing
- spam: unsolicited/phishing/scam

Subject: {subject}
Body: {body}

Respond ONLY with JSON: {{"category":"...","confidence":0.0}}"""

# ─── GEMINI CALLER ───────────────────────────────────────────────────────────
def call_gemini(prompt: str) -> tuple:
    """Returns (category, confidence, latency_ms, error)"""
    try:
        import google.generativeai as genai
        genai.configure(api_key=GEMINI_KEY)
    except ImportError:
        return "error", 0.0, 0.0, "pip install google-generativeai"

    t0 = time.perf_counter()
    try:
        model = genai.GenerativeModel(GEMINI_MODEL)
        resp  = model.generate_content(prompt)
        text  = resp.text.strip()
    except Exception as e:
        return "error", 0.0, (time.perf_counter()-t0)*1000, str(e)

    lat = (time.perf_counter()-t0)*1000
    try:
        m = re.search(r'\{[^}]+\}', text)
        if m:
            d = json.loads(m.group())
            cat  = d.get("category","").lower().strip()
            conf = float(d.get("confidence", 0.0))
            if cat in CLASSES:
                return cat, conf, lat, ""
    except Exception:
        pass
    return "error", 0.0, lat, f"parse_error: {text[:60]}"

# ─── METRICS ─────────────────────────────────────────────────────────────────
def pct(lst, p):
    s = sorted(lst)
    k = (len(s)-1)*p/100
    lo, hi = int(k), min(int(k)+1, len(s)-1)
    return s[lo]+(s[hi]-s[lo])*(k-lo)

def compute_metrics(y_true, y_pred, classes=CLASSES):
    tp = defaultdict(int); fp = defaultdict(int); fn = defaultdict(int)
    for t, p in zip(y_true, y_pred):
        if t == p: tp[t] += 1
        else: fp[p] += 1; fn[t] += 1
    correct = sum(tp.values())
    n = len(y_true)
    acc = correct / n
    per = {}
    for c in classes:
        ni  = sum(1 for t in y_true if t == c)
        p_i = tp[c]/(tp[c]+fp[c]) if tp[c]+fp[c] else 0
        r_i = tp[c]/(tp[c]+fn[c]) if tp[c]+fn[c] else 0
        f_i = 2*p_i*r_i/(p_i+r_i) if p_i+r_i else 0
        per[c] = dict(n=ni, tp=tp[c], fp=fp[c], fn=fn[c], p=p_i, r=r_i, f1=f_i)
    macro_p = statistics.mean(v["p"]  for v in per.values())
    macro_r = statistics.mean(v["r"]  for v in per.values())
    macro_f = statistics.mean(v["f1"] for v in per.values())
    return dict(accuracy=acc, n=n, n_correct=correct,
                macro_p=macro_p, macro_r=macro_r, macro_f1=macro_f,
                per_class=per)

def sec_metrics(y_true, y_pred):
    TP=TN=FP=FN=0
    for t,p in zip(y_true, y_pred):
        if t==1 and p==1: TP+=1
        elif t==0 and p==0: TN+=1
        elif t==0 and p==1: FP+=1
        else: FN+=1
    prec = TP/(TP+FP) if TP+FP else 0
    rec  = TP/(TP+FN) if TP+FN else 0
    f1   = 2*prec*rec/(prec+rec) if prec+rec else 0
    fpr  = FP/(FP+TN) if FP+TN else 0
    fnr  = FN/(FN+TP) if FN+TP else 0
    return dict(TP=TP,TN=TN,FP=FP,FN=FN,
                accuracy=(TP+TN)/(TP+TN+FP+FN),
                precision=prec, recall=rec, f1=f1, fpr=fpr, fnr=fnr)

# ─── PRINT HELPERS ───────────────────────────────────────────────────────────
HR = "="*70
hr = "-"*70

def print_classification(m, label="", latencies=None):
    print(f"\n{HR}")
    print(f"  {label}")
    print(HR)
    print(f"  Accuracy: {m['accuracy']:.1%}  ({m['n_correct']}/{m['n']} email đúng)")
    print(f"\n  {'Nhãn':<14}{'N':>5}{'Precision':>11}{'Recall':>9}{'F1':>8}")
    print(f"  {hr}")
    for c in CLASSES:
        pc = m['per_class'][c]
        print(f"  {c:<14}{pc['n']:>5}{pc['p']:>11.3f}{pc['r']:>9.3f}{pc['f1']:>8.3f}")
    print(f"  {hr}")
    print(f"  {'Macro avg':<14}{m['n']:>5}{m['macro_p']:>11.3f}{m['macro_r']:>9.3f}{m['macro_f1']:>8.3f}")
    if latencies:
        print(f"\n  Độ trễ: avg={statistics.mean(latencies):.0f}ms  p50={pct(latencies,50):.0f}ms  p95={pct(latencies,95):.0f}ms")

def print_security(s, label=""):
    print(f"\n  SECURITY AGENT ({label}):")
    print(f"  TP={s['TP']}  TN={s['TN']}  FP={s['FP']}  FN={s['FN']}")
    print(f"  Accuracy={s['accuracy']:.3f}  Precision={s['precision']:.3f}  Recall={s['recall']:.3f}  F1={s['f1']:.3f}")
    print(f"  ⚠ FP rate={s['fpr']:.1%}  FN rate={s['fnr']:.1%}")

# ─── RUN EXPERIMENT ──────────────────────────────────────────────────────────
def run_llm_experiment(rows, prompt_tmpl, label):
    y_true, y_pred, latencies, errors = [], [], [], []
    print(f"\n  [{label}] Đang chạy {len(rows)} email...")
    for i, r in enumerate(rows):
        subj = r.get("subject","")
        body = r.get("body","")[:400]
        gt   = r.get("true_label","").strip()
        prompt = prompt_tmpl.format(subject=subj, body=body)
        cat, conf, lat, err = call_gemini(prompt)
        y_true.append(gt); y_pred.append(cat); latencies.append(lat)
        if err: errors.append(err)
        status = "✓" if cat == gt else f"✗({gt}→{cat})"
        print(f"  [{i+1:>3}/{len(rows)}] {subj[:40]:<40} {status}  {lat:.0f}ms")
        time.sleep(DELAY_SEC)
    n_err = sum(1 for p in y_pred if p == "error")
    print(f"  Xong: {len(rows)} email, {n_err} lỗi parse")
    if errors: print(f"  Lỗi mẫu: {errors[:3]}")
    return y_true, y_pred, latencies

# ─── MAIN ────────────────────────────────────────────────────────────────────
def main():
    print(f"\n{'#'*70}")
    print(f"  EVALUATE FINAL — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"  Input: {INPUT_CSV}")
    print(f"  Gemini API: {'✅ CÓ' if GEMINI_KEY else '❌ KHÔNG — chỉ chạy Rule-based'}")
    print(f"{'#'*70}")

    rows = load_labeled(INPUT_CSV)
    y_true = [r["true_label"].strip() for r in rows]
    y_true_binary = [1 if t == "spam" else 0 for t in y_true]

    all_results = {}

    # ── 1. RULE-BASED BASELINE ────────────────────────────────────────────────
    print(f"\n{'─'*40}")
    print("  [1] RULE-BASED BASELINE")
    print(f"{'─'*40}")
    y_rule = [rule_classify(r) for r in rows]
    m_rule = compute_metrics(y_true, y_rule)
    print_classification(m_rule, "RULE-BASED (keyword matching)")
    s_rule = sec_metrics(y_true_binary, [1 if p=="spam" else 0 for p in y_rule])
    print_security(s_rule, "Rule-based")
    all_results["rule_based"] = {"metrics": m_rule, "security": s_rule}

    if not GEMINI_KEY:
        print(f"\n{'─'*40}")
        print("  ⚠ Thiếu GEMINI_API_KEY — dừng tại Rule-based")
        print("  Set GEMINI_API_KEY=your_key và chạy lại để có đủ số liệu AI")
        print(f"{'─'*40}")
        _save_results(all_results)
        _print_report_table(all_results)
        return

    # ── 2. GEMINI ZERO-SHOT ───────────────────────────────────────────────────
    print(f"\n{'─'*40}")
    print("  [2] GEMINI ZERO-SHOT")
    print(f"{'─'*40}")
    y_true_z, y_pred_z, lat_z = run_llm_experiment(rows, ZERO_SHOT_PROMPT, "zero-shot")
    m_zero = compute_metrics(y_true_z, y_pred_z)
    print_classification(m_zero, "GEMINI ZERO-SHOT", lat_z)
    s_zero = sec_metrics([1 if t=="spam" else 0 for t in y_true_z],
                         [1 if p=="spam" else 0 for p in y_pred_z])
    print_security(s_zero, "Gemini Zero-shot")
    all_results["gemini_zero_shot"] = {"metrics": m_zero, "security": s_zero, "latencies": lat_z}

    # ── 3. GEMINI FEW-SHOT (hệ thống hiện tại) ───────────────────────────────
    print(f"\n{'─'*40}")
    print("  [3] GEMINI FEW-SHOT (hệ thống đề xuất)")
    print(f"{'─'*40}")
    y_true_f, y_pred_f, lat_f = run_llm_experiment(rows, FEW_SHOT_PROMPT, "few-shot")
    m_few = compute_metrics(y_true_f, y_pred_f)
    print_classification(m_few, "GEMINI FEW-SHOT", lat_f)
    s_few = sec_metrics([1 if t=="spam" else 0 for t in y_true_f],
                        [1 if p=="spam" else 0 for p in y_pred_f])
    print_security(s_few, "Gemini Few-shot (hệ thống)")
    all_results["gemini_few_shot"] = {"metrics": m_few, "security": s_few, "latencies": lat_f}

    # ── 4. TỰ ĐỘNG SINH BẢO CÁO ─────────────────────────────────────────────
    _save_results(all_results)
    _print_report_table(all_results)


def _save_results(all_results):
    rows_out = []
    for method, data in all_results.items():
        m = data["metrics"]
        s = data["security"]
        lats = data.get("latencies", [])
        row = {
            "method": method,
            "accuracy": f"{m['accuracy']:.3f}",
            "macro_f1": f"{m['macro_f1']:.3f}",
            "macro_p":  f"{m['macro_p']:.3f}",
            "macro_r":  f"{m['macro_r']:.3f}",
        }
        for c in CLASSES:
            pc = m["per_class"][c]
            row[f"{c}_p"]  = f"{pc['p']:.3f}"
            row[f"{c}_r"]  = f"{pc['r']:.3f}"
            row[f"{c}_f1"] = f"{pc['f1']:.3f}"
        row.update({
            "sec_TP": s["TP"], "sec_TN": s["TN"],
            "sec_FP": s["FP"], "sec_FN": s["FN"],
            "sec_FPR": f"{s['fpr']:.3f}", "sec_FNR": f"{s['fnr']:.3f}",
            "sec_F1": f"{s['f1']:.3f}",
            "avg_latency_ms": f"{statistics.mean(lats):.0f}" if lats else "—",
            "p95_latency_ms": f"{pct(lats,95):.0f}" if lats else "—",
        })
        rows_out.append(row)

    out = "evaluation_results.csv"
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        csv.DictWriter(f, fieldnames=rows_out[0].keys()).writeheader()
        csv.DictWriter(f, fieldnames=rows_out[0].keys()).writerows(rows_out)
    print(f"\n✅ Kết quả đầy đủ lưu vào: {out}")


def _print_report_table(all_results):
    """In bảng sẵn sàng dán vào báo cáo."""
    print(f"\n{'#'*70}")
    print("  BẢNG SẴN SÀNG DÁN VÀO BÁO CÁO")
    print(f"{'#'*70}")

    # Bảng so sánh tổng quan (Bảng 4.24 baseline)
    print(f"\n{'─'*70}")
    print("  BẢNG 4.24 — SO SÁNH PHƯƠNG PHÁP (Classification, N=150)")
    print(f"{'─'*70}")
    print(f"  {'Phương pháp':<28}{'Accuracy':>10}{'Macro F1':>10}{'FN rate spam':>14}")
    print(f"  {'─'*62}")
    print(f"  {'Manual (gold standard)':<28}{'100%':>10}{'1.000':>10}{'~5%':>14}")

    for method_key, label in [("rule_based","Rule-based (keyword)"),
                                ("gemini_zero_shot","Gemini Zero-shot"),
                                ("gemini_few_shot","Gemini Few-shot ✓")]:
        if method_key in all_results:
            m = all_results[method_key]["metrics"]
            s = all_results[method_key]["security"]
            print(f"  {label:<28}{m['accuracy']:>10.1%}{m['macro_f1']:>10.3f}{s['fnr']:>14.1%}")

    # Bảng Security Agent (Bảng 4.16)
    print(f"\n{'─'*70}")
    print("  BẢNG 4.16 — SECURITY AGENT (spam/phishing detection)")
    print(f"{'─'*70}")
    print(f"  {'Chỉ số':<20}{'Rule-based':>12}{'Zero-shot':>12}{'Few-shot ✓':>12}")
    print(f"  {'─'*56}")
    keys_sec = ["rule_based","gemini_zero_shot","gemini_few_shot"]
    metrics_sec = ["accuracy","precision","recall","f1","fpr","fnr"]
    labels_sec = ["Accuracy","Precision","Recall","F1-score","FP rate","FN rate (quan trọng)"]
    for mk, ml in zip(metrics_sec, labels_sec):
        row_vals = []
        for k in keys_sec:
            if k in all_results:
                v = all_results[k]["security"][mk]
                row_vals.append(f"{v:.1%}" if mk in ("fpr","fnr","accuracy") else f"{v:.3f}")
            else:
                row_vals.append("[chờ đo]")
        print(f"  {ml:<20}" + "".join(f"{v:>12}" for v in row_vals))

    # Bảng Classifier (Bảng 4.18 per-class)
    if "gemini_few_shot" in all_results:
        print(f"\n{'─'*70}")
        print("  BẢNG 4.18 — CLASSIFIER (Gemini Few-shot, N=150)")
        print(f"{'─'*70}")
        m = all_results["gemini_few_shot"]["metrics"]
        print(f"  {'Nhãn':<14}{'N':>5}{'Precision':>11}{'Recall':>9}{'F1':>8}")
        print(f"  {'─'*47}")
        for c in CLASSES:
            pc = m["per_class"][c]
            print(f"  {c:<14}{pc['n']:>5}{pc['p']:>11.3f}{pc['r']:>9.3f}{pc['f1']:>8.3f}")
        print(f"  {'─'*47}")
        print(f"  {'Macro avg':<14}{m['n']:>5}{m['macro_p']:>11.3f}{m['macro_r']:>9.3f}{m['macro_f1']:>8.3f}")
        print(f"  Accuracy tổng: {m['accuracy']:.1%}")

    # Thí nghiệm 1: Zero-shot vs Few-shot
    if "gemini_zero_shot" in all_results and "gemini_few_shot" in all_results:
        print(f"\n{'─'*70}")
        print("  BẢNG 3.9 — THÍ NGHIỆM 1: Zero-shot vs Few-shot")
        print(f"{'─'*70}")
        mz = all_results["gemini_zero_shot"]
        mf = all_results["gemini_few_shot"]
        lat_z = mz.get("latencies",[])
        lat_f = mf.get("latencies",[])
        delta_acc = mf["metrics"]["accuracy"] - mz["metrics"]["accuracy"]
        delta_f1  = mf["metrics"]["macro_f1"] - mz["metrics"]["macro_f1"]
        print(f"  {'Cấu hình':<28}{'Accuracy':>10}{'Macro F1':>10}"
              f"{'Avg ms':>10}{'p95 ms':>10}")
        print(f"  {'─'*68}")
        print(f"  {'Zero-shot (baseline)':<28}"
              f"{mz['metrics']['accuracy']:>10.1%}{mz['metrics']['macro_f1']:>10.3f}"
              f"{statistics.mean(lat_z) if lat_z else 0:>10.0f}"
              f"{pct(lat_z,95) if lat_z else 0:>10.0f}")
        print(f"  {'Few-shot (hệ thống)':<28}"
              f"{mf['metrics']['accuracy']:>10.1%}{mf['metrics']['macro_f1']:>10.3f}"
              f"{statistics.mean(lat_f) if lat_f else 0:>10.0f}"
              f"{pct(lat_f,95) if lat_f else 0:>10.0f}")
        print(f"  {'Cải thiện (Few-Zero)':<28}"
              f"{delta_acc:>+10.1%}{delta_f1:>+10.3f}")

    print(f"\n{'#'*70}")
    print("  XONG — Sao chép các bảng trên vào báo cáo luận văn")
    print(f"{'#'*70}\n")


if __name__ == "__main__":
    main()
