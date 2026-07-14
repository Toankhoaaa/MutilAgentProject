#!/usr/bin/env python3
"""
augment_labeling_source.py — Add pre-labeled rows to labeling_source.csv
from spam_ham_dataset.csv and emails.csv so each of the 5 classifier
labels has ≥ TARGET_PER_CLASS rows with true_label filled.

Label mapping:
  spam_ham "spam"  + newsletter keywords  → newsletter
  spam_ham "spam"  (no newsletter kw)     → spam
  spam_ham "ham"   + urgent keywords      → urgent
  spam_ham "ham"   + need_reply keywords  → need_reply
  spam_ham "ham"   + newsletter keywords  → newsletter
  spam_ham "ham"   (default)              → important

  emails.csv (all ham-like, RFC 2822)     → same ham heuristics

All added rows carry true_label + note "auto-labeled from X — verify",
so you can review and correct before running eval.
"""

from __future__ import annotations

import csv
import email as email_mod
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

csv.field_size_limit(10_000_000)   # Enron emails can be large

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

TARGET_PER_CLASS = 30
CLASSES = ["urgent", "need_reply", "important", "newsletter", "spam"]

HERE = Path(__file__).resolve().parent
LABELING_CSV = HERE / "labeling_source.csv"
SPAM_HAM_CSV = HERE / "spam_ham_dataset.csv"
EMAILS_CSV   = HERE / "emails.csv"

# How many rows of emails.csv to scan (it's ~33M lines / very large)
EMAILS_CSV_MAX_ROWS = 8_000

OUTPUT_COLUMNS = [
    "id", "gmail_message_id", "source", "sender", "subject",
    "body", "classifier_hint", "true_label", "note",
]

# ---------------------------------------------------------------------------
# Keyword tables for heuristic classification
# ---------------------------------------------------------------------------

# Priority order matters: urgent > newsletter > need_reply > important (default)
KEYWORDS: dict[str, list[str]] = {
    "urgent": [
        "urgent", "action required", "asap", "as soon as possible",
        "immediately", "time sensitive", "time-sensitive", "deadline",
        "by eod", "end of day", "critical", "must respond",
    ],
    "newsletter": [
        "unsubscribe", "to unsubscribe", "list-unsubscribe",
        "mailing list", "newsletter", "weekly digest", "daily digest",
        "monthly digest", "subscription", "subscribed", "opt out",
        "you are receiving", "view in browser", "manage preferences",
        "email digest", "company news", "industry news", "bulletin",
    ],
    "need_reply": [
        "please let me know", "let me know", "please advise",
        "please confirm", "could you please", "can you please",
        "your thoughts", "please review", "please respond",
        "your response", "get back to me", "please reply",
        "waiting for your", "need your input", "need your approval",
        "need your feedback", "pending your",
    ],
}


def _classify_text(subject: str, body: str, is_spam_source: bool) -> str:
    """
    Apply keyword heuristics to classify an email text into one of 5 labels.

    For spam-source emails: can only be "spam" or "newsletter".
    For ham-source emails: urgent only fires when a keyword is in the subject
    line — body-only signals like "asap" or "immediately" inside work emails
    are too noisy to reliably indicate urgency.
    """
    subject_lower = subject.lower()
    full_lower = f"{subject_lower} {body.lower()}"

    if is_spam_source:
        for kw in KEYWORDS["newsletter"]:
            if kw in full_lower:
                return "newsletter"
        return "spam"
    else:
        # Ham source: newsletter > urgent (subject only) > need_reply > important
        for kw in KEYWORDS["newsletter"]:
            if kw in full_lower:
                return "newsletter"
        for kw in KEYWORDS["urgent"]:
            if kw in subject_lower:
                return "urgent"
        for kw in KEYWORDS["need_reply"]:
            if kw in full_lower:
                return "need_reply"
        return "important"


# ---------------------------------------------------------------------------
# Text utilities
# ---------------------------------------------------------------------------

def _clean(text: str, max_chars: int = 5_000) -> str:
    return " ".join(text.split())[:max_chars]


def _split_subject_body(text: str) -> tuple[str, str]:
    """
    For spam_ham_dataset rows: text starts with 'Subject: ...\n<body>'.
    Returns (subject, body).
    """
    lines = text.split("\n", 1)
    first = lines[0].strip()
    if first.lower().startswith("subject:"):
        subject = first[8:].strip()
        body = lines[1].strip() if len(lines) > 1 else ""
    else:
        subject = ""
        body = text.strip()
    return subject, body


def _parse_rfc822(raw: str) -> tuple[str, str, str]:
    """Parse a full RFC 2822 message. Returns (sender, subject, body)."""
    try:
        msg = email_mod.message_from_string(raw)
        sender  = msg.get("From", "") or ""
        subject = msg.get("Subject", "") or ""
        parts: list[str] = []
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    try:
                        payload = part.get_payload(decode=True)
                        if payload:
                            parts.append(payload.decode("utf-8", errors="replace"))
                    except Exception:
                        pass
        else:
            try:
                payload = msg.get_payload(decode=True)
                if payload:
                    parts.append(payload.decode("utf-8", errors="replace"))
                else:
                    raw_payload = msg.get_payload()
                    if isinstance(raw_payload, str):
                        parts.append(raw_payload)
            except Exception:
                raw_payload = msg.get_payload()
                if isinstance(raw_payload, str):
                    parts.append(raw_payload)
        body = "\n".join(parts).strip()
        return sender, subject, body
    except Exception:
        return "", "", ""


# ---------------------------------------------------------------------------
# Current state
# ---------------------------------------------------------------------------

def load_current() -> tuple[list[dict], Counter]:
    rows: list[dict] = []
    with LABELING_CSV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    counts: Counter = Counter(
        r.get("true_label", "").strip()
        for r in rows
        if r.get("true_label", "").strip()
    )
    return rows, counts


# ---------------------------------------------------------------------------
# SOURCE 1 — spam_ham_dataset.csv
# ---------------------------------------------------------------------------

def _new_row(source: str, sender: str, subject: str, body: str,
             true_label: str) -> dict:
    return {
        "gmail_message_id": "",
        "source":           source,
        "sender":           _clean(sender, 200),
        "subject":          _clean(subject, 300),
        "body":             _clean(body, 5_000),
        "classifier_hint":  "",
        "true_label":       true_label,
        "note":             f"auto-labeled from {source} — verify",
    }


def collect_spam_ham(needed: dict[str, int]) -> list[dict]:
    """Read spam_ham_dataset.csv and return rows for under-represented classes."""
    buckets: dict[str, list[dict]] = defaultdict(list)
    seen: set[str] = set()

    with SPAM_HAM_CSV.open(encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            label = row.get("label", "").strip()
            text  = row.get("text",  "").strip()
            if not text or label not in ("spam", "ham"):
                continue

            subject, body = _split_subject_body(text)

            # Skip very short emails
            if len(body.split()) < 5:
                continue

            # Dedup by subject prefix
            dedup = (subject or body[:60]).lower()[:60]
            if dedup in seen:
                continue
            seen.add(dedup)

            cls = _classify_text(subject, body, is_spam_source=(label == "spam"))

            if len(buckets[cls]) < needed.get(cls, 0):
                buckets[cls].append(_new_row(
                    "spam_ham_dataset", "", subject, body, cls
                ))

            if all(len(buckets[c]) >= needed.get(c, 0) for c in CLASSES):
                break

    result: list[dict] = []
    for cls in CLASSES:
        result.extend(buckets[cls][: needed.get(cls, 0)])
    return result


# ---------------------------------------------------------------------------
# SOURCE 2 — emails.csv  (RFC 2822, all legitimate/ham-like)
# ---------------------------------------------------------------------------

def collect_emails_csv(needed: dict[str, int]) -> list[dict]:
    """Sample from emails.csv (huge file). All emails treated as ham-source."""
    if not EMAILS_CSV.exists():
        print(f"  emails.csv not found at {EMAILS_CSV} — skipping")
        return []

    buckets: dict[str, list[dict]] = defaultdict(list)
    seen: set[str] = set()
    scanned = 0

    with EMAILS_CSV.open(encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            if scanned >= EMAILS_CSV_MAX_ROWS:
                break
            scanned += 1

            raw = row.get("message", "").strip()
            if not raw:
                continue

            sender, subject, body = _parse_rfc822(raw)
            if len(body.split()) < 5:
                continue

            dedup = (subject or body[:60]).lower()[:60]
            if dedup in seen:
                continue
            seen.add(dedup)

            cls = _classify_text(subject, body, is_spam_source=False)

            if len(buckets[cls]) < needed.get(cls, 0):
                buckets[cls].append(_new_row(
                    "emails_csv", sender, subject, body, cls
                ))

            if all(len(buckets[c]) >= needed.get(c, 0) for c in CLASSES):
                break

    print(f"  Scanned {scanned} rows from emails.csv")
    result: list[dict] = []
    for cls in CLASSES:
        result.extend(buckets[cls][: needed.get(cls, 0)])
    return result


# ---------------------------------------------------------------------------
# Write CSV
# ---------------------------------------------------------------------------

def write_csv(rows: list[dict], path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for i, row in enumerate(rows, 1):
            row["id"] = i
            writer.writerow(row)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if not LABELING_CSV.exists():
        sys.exit(f"ERROR: {LABELING_CSV} not found.")
    if not SPAM_HAM_CSV.exists():
        sys.exit(f"ERROR: {SPAM_HAM_CSV} not found.")

    # ── Current state ────────────────────────────────────────────────────
    current_rows, current_counts = load_current()
    print(f"Current labeling_source.csv: {len(current_rows)} rows")
    print("  true_label distribution:")
    for cls in CLASSES:
        print(f"    {cls:15s}: {current_counts.get(cls, 0)}")
    print(f"    {'(empty)':15s}: {sum(1 for r in current_rows if not r.get('true_label','').strip())}")

    # ── What we still need ───────────────────────────────────────────────
    needed: dict[str, int] = {
        cls: max(0, TARGET_PER_CLASS - current_counts.get(cls, 0))
        for cls in CLASSES
    }
    total_needed = sum(needed.values())
    print(f"\nNeeded to reach {TARGET_PER_CLASS} per class:")
    for cls, n in needed.items():
        status = "✓ already satisfied" if n == 0 else f"need {n} more"
        print(f"  {cls:15s}: {status}")

    if total_needed == 0:
        print("\nAll classes already have ≥30 labeled samples. Nothing to add.")
        return

    # ── Source 1: spam_ham ───────────────────────────────────────────────
    print(f"\n=== Source 1: spam_ham_dataset.csv ===")
    new_rows = collect_spam_ham(needed)
    added_by_class = Counter(r["true_label"] for r in new_rows)
    print(f"  Added {len(new_rows)} rows:")
    for cls in CLASSES:
        if added_by_class.get(cls, 0):
            print(f"    {cls:15s}: +{added_by_class[cls]}")

    # ── Source 2: emails.csv  (only if still needed) ─────────────────────
    still_needed: dict[str, int] = {
        cls: max(0, needed[cls] - added_by_class.get(cls, 0))
        for cls in CLASSES
    }
    if sum(still_needed.values()) > 0:
        print(f"\n=== Source 2: emails.csv (first {EMAILS_CSV_MAX_ROWS} rows) ===")
        extra_rows = collect_emails_csv(still_needed)
        extra_by_class = Counter(r["true_label"] for r in extra_rows)
        print(f"  Added {len(extra_rows)} rows:")
        for cls in CLASSES:
            if extra_by_class.get(cls, 0):
                print(f"    {cls:15s}: +{extra_by_class[cls]}")
        new_rows.extend(extra_rows)

    # ── Merge & write ────────────────────────────────────────────────────
    all_rows = current_rows + new_rows
    write_csv(all_rows, LABELING_CSV)

    # ── Final summary ────────────────────────────────────────────────────
    final_counts: Counter = Counter(
        r.get("true_label", "").strip() or "(empty)"
        for r in all_rows
    )
    print(f"\n{'='*50}")
    print("FINAL labeling_source.csv")
    print(f"{'='*50}")
    print(f"Total rows: {len(all_rows)}")
    for cls in CLASSES:
        count = final_counts.get(cls, 0)
        ok = "✓" if count >= TARGET_PER_CLASS else "✗ STILL SHORT"
        print(f"  {ok}  {cls:15s}: {count:3d}  (need {TARGET_PER_CLASS})")
    print(f"       {'(empty)':15s}: {final_counts.get('(empty)', 0)}  ← manual labeling pool")
    print(f"\nOutput: {LABELING_CSV}")
    print("\nIMPORTANT: Rows with source=spam_ham_dataset or source=emails_csv")
    print("have true_label pre-filled by keyword heuristics — review before eval.")


if __name__ == "__main__":
    main()
