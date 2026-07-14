#!/usr/bin/env python3
"""
build_labeling_source.py — Assemble 150–200 email labeling candidates for Classifier eval.

Two sources:
  db    — gmail_message_ids from classifications table (has classifier_hint)
  gmail — fresh fetch across promotions / updates / social / inbox / spam

Output: labeling_source.csv  (true_label column is EMPTY — fill in manually)

Usage:
  cd /path/to/Project1
  python build_labeling_source.py

Requirements (already in project venv):
  google-auth google-auth-httplib2 google-api-python-client
"""

from __future__ import annotations

import base64
import csv
import json
import sqlite3
import sys
import time
import uuid
from collections import Counter
from email.utils import parseaddr
from pathlib import Path

try:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except ImportError:
    sys.exit(
        "ERROR: google client libs missing.\n"
        "  pip install google-auth google-auth-httplib2 google-api-python-client"
    )

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _find_db() -> Path:
    """Locate email_orchestrator.db by walking upward from the script and from cwd."""
    roots = [Path(__file__).resolve().parent, Path.cwd()]
    for root in roots:
        p = root
        for _ in range(6):
            for sub in ("src/email_orchestrator.db", "email_orchestrator.db"):
                c = p / sub
                if c.exists():
                    return c
            p = p.parent
    raise FileNotFoundError(
        "Cannot find email_orchestrator.db. Run from the project root."
    )

DB_PATH    = _find_db()
OUTPUT_CSV = Path(__file__).resolve().parent / "labeling_source.csv"

# Cap per class for DB source so newsletter/important don't swamp the pool.
# urgent=23, need_reply=27, spam=15 are minority — take all of them.
DB_CAP_PER_CLASS = 45

# Gmail API queries and per-query fetch limits
GMAIL_FETCH_PLAN: list[tuple[str, int]] = [
    ("category:promotions", 60),   # newsletter/promotional diversity
    ("category:updates",    30),   # update emails
    ("category:social",     30),   # social
    ("in:inbox",            40),   # urgent/need_reply/important
    ("in:spam",             30),   # spam candidates
]

BODY_TRUNCATE = 5_000  # characters; keeps CSV manageable

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def load_credentials(db_path: Path) -> Credentials:
    """Read the first Google OAuth token from the DB and return Credentials."""
    conn = sqlite3.connect(str(db_path))
    try:
        row = conn.execute(
            "SELECT google_oauth_token FROM users "
            "WHERE google_oauth_token IS NOT NULL LIMIT 1"
        ).fetchone()
    finally:
        conn.close()

    if not row:
        sys.exit("ERROR: No user with google_oauth_token in DB. Complete OAuth flow first.")

    info = json.loads(row[0])

    # google.oauth2.credentials.Credentials.from_authorized_user_info expects
    # client_id / client_secret / refresh_token / token_uri.
    try:
        creds = Credentials.from_authorized_user_info(info)
    except Exception:
        # Fallback: construct manually from to_json() field names
        creds = Credentials(
            token=info.get("token"),
            refresh_token=info.get("refresh_token"),
            token_uri=info.get("token_uri", "https://oauth2.googleapis.com/token"),
            client_id=info.get("client_id"),
            client_secret=info.get("client_secret"),
            scopes=info.get("scopes"),
        )

    if creds.expired and creds.refresh_token:
        print("  Refreshing OAuth token...")
        creds.refresh(Request())

    return creds


def gmail_service(creds: Credentials):
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


# ---------------------------------------------------------------------------
# Gmail message parsing (mirrors GmailService._parse_message)
# ---------------------------------------------------------------------------

def _decode_b64(data: str) -> str:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding).decode("utf-8", errors="replace")


def _extract_body(payload: dict) -> str:
    plain: list[str] = []

    def walk(part: dict) -> None:
        mime = part.get("mimeType", "")
        data = part.get("body", {}).get("data")
        if data:
            text = _decode_b64(data)
            if mime == "text/plain":
                plain.append(text)
            elif mime.startswith("text/") and not plain:
                plain.append(text)
        for child in part.get("parts") or []:
            walk(child)

    walk(payload)
    return "\n".join(plain).strip()


def _parse_message(msg: dict) -> dict:
    payload = msg.get("payload", {})
    headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}

    sender_raw = headers.get("from", "")
    sender = parseaddr(sender_raw)[1] or sender_raw
    subject = headers.get("subject", "")
    body = _extract_body(payload) or msg.get("snippet", "")

    return {
        "gmail_message_id": msg.get("id", ""),
        "sender":  sender,
        "subject": subject,
        "body":    body,
    }


def _fetch_one(svc, msg_id: str) -> dict | None:
    """Fetch and parse one message. Returns None on error."""
    for attempt in range(3):
        try:
            msg = svc.users().messages().get(
                userId="me", id=msg_id, format="full"
            ).execute()
            return _parse_message(msg)
        except HttpError as exc:
            status = getattr(exc.resp, "status", None)
            if status == 404:
                return None  # deleted / not in this mailbox
            if status in (429, 500, 503) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            print(f"  WARN: failed to fetch {msg_id} ({status}): {exc}", file=sys.stderr)
            return None
    return None


# ---------------------------------------------------------------------------
# SOURCE 1 — DB
# ---------------------------------------------------------------------------

def load_db_source(db_path: Path, svc) -> list[dict]:
    """
    Pull gmail_message_id + category from DB, fetch email content from Gmail API.
    Caps per class so majority classes don't dominate.
    """
    conn = sqlite3.connect(str(db_path))
    try:
        rows = conn.execute(
            """
            SELECT gmail_message_id, category
            FROM   classifications
            WHERE  gmail_message_id IS NOT NULL
            ORDER  BY created_at DESC
            """
        ).fetchall()
    finally:
        conn.close()

    by_class: dict[str, list[str]] = {}
    for gid, cat in rows:
        by_class.setdefault(cat or "unknown", []).append(gid)

    dist_str = ", ".join(f"{k}={len(v)}" for k, v in sorted(by_class.items()))
    print(f"  Full DB distribution: {dist_str}")

    selected: list[tuple[str, str]] = []
    for cat, ids in by_class.items():
        take = min(DB_CAP_PER_CLASS, len(ids))
        selected.extend((gid, cat) for gid in ids[:take])

    print(f"  After per-class cap ({DB_CAP_PER_CLASS}): {len(selected)} emails to fetch")

    results = []
    for i, (gid, cat) in enumerate(selected, 1):
        parsed = _fetch_one(svc, gid)
        if parsed:
            results.append({**parsed, "source": "db", "classifier_hint": cat})
        if i % 25 == 0:
            print(f"    ... {i}/{len(selected)}")
        time.sleep(0.05)

    print(f"  → {len(results)} DB emails fetched successfully")
    return results


# ---------------------------------------------------------------------------
# SOURCE 2 — Gmail API (fresh, diverse)
# ---------------------------------------------------------------------------

def load_gmail_source(svc) -> list[dict]:
    print("\n=== SOURCE 2: Gmail API (fresh) ===")
    results = []

    for query, limit in GMAIL_FETCH_PLAN:
        print(f"  query={query!r}  limit={limit}")
        try:
            list_resp = svc.users().messages().list(
                userId="me", q=query, maxResults=limit
            ).execute()
        except HttpError as exc:
            print(f"  WARN: list failed: {exc}", file=sys.stderr)
            continue

        refs = list_resp.get("messages", [])
        batch: list[dict] = []
        for ref in refs:
            parsed = _fetch_one(svc, ref["id"])
            if parsed:
                batch.append({**parsed, "source": "gmail", "classifier_hint": ""})
            time.sleep(0.05)

        print(f"    → {len(batch)} fetched")
        results.extend(batch)

    return results


# ---------------------------------------------------------------------------
# MERGE + DEDUP
# ---------------------------------------------------------------------------

def merge_and_dedup(db_rows: list[dict], gmail_rows: list[dict]) -> list[dict]:
    """DB row wins on collision (it carries classifier_hint)."""
    seen: dict[str, dict] = {}

    for row in db_rows:         # DB first so it wins
        mid = row["gmail_message_id"]
        if mid and mid not in seen:
            seen[mid] = row

    for row in gmail_rows:      # Gmail second — only adds new message_ids
        mid = row["gmail_message_id"]
        if mid and mid not in seen:
            seen[mid] = row

    return list(seen.values())


# ---------------------------------------------------------------------------
# OUTPUT CSV
# ---------------------------------------------------------------------------

COLUMNS = [
    "id", "gmail_message_id", "source", "sender", "subject",
    "body", "classifier_hint", "true_label", "note",
]


def write_csv(rows: list[dict], path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for i, row in enumerate(rows, 1):
            body = (row.get("body") or "")[:BODY_TRUNCATE]
            writer.writerow({
                "id":               i,
                "gmail_message_id": row.get("gmail_message_id", ""),
                "source":           row.get("source", ""),
                "sender":           row.get("sender", ""),
                "subject":          row.get("subject", ""),
                "body":             body,
                "classifier_hint":  row.get("classifier_hint", ""),
                "true_label":       "",
                "note":             "",
            })

    print(f"\nWrote {len(rows)} rows  →  {path}")


# ---------------------------------------------------------------------------
# SUMMARY
# ---------------------------------------------------------------------------

def print_summary(rows: list[dict]) -> None:
    by_source = Counter(r["source"] for r in rows)
    by_hint   = Counter(r.get("classifier_hint") or "(none)" for r in rows)

    print("\n" + "=" * 50)
    print("SUMMARY")
    print("=" * 50)
    print(f"Total candidates : {len(rows)}")
    print(f"  source=db      : {by_source['db']}")
    print(f"  source=gmail   : {by_source['gmail']}")
    print()
    print("classifier_hint distribution (Classifier output — NOT ground truth):")
    for label, count in sorted(by_hint.items(), key=lambda x: -x[1]):
        bar = "█" * (count // 5)
        print(f"  {label:20s}  {count:4d}  {bar}")
    print()
    print("true_label: EMPTY — read each email and assign one of:")
    print("  urgent / need_reply / important / newsletter / spam")
    print()

    # Warn if any class looks starved
    CLASSES = {"urgent", "need_reply", "important", "newsletter", "spam"}
    low = [c for c in CLASSES if by_hint.get(c, 0) < 20]
    if low:
        print(f"⚠  Low candidates for: {', '.join(low)}")
        print("   Consider re-running with larger limits for those queries.")
    else:
        print("All 5 classes have ≥ 20 classifier_hint candidates. Good pool.")

    print(f"\nOutput file: {OUTPUT_CSV}")
    print("Do NOT commit this file (contains real email content).")


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main() -> None:
    if not DB_PATH.exists():
        sys.exit(f"ERROR: DB not found at {DB_PATH}")

    print(f"DB path : {DB_PATH}")
    print("Loading Google OAuth credentials from DB...")
    creds = load_credentials(DB_PATH)
    svc   = gmail_service(creds)
    print("Gmail service ready.\n")

    print("=== SOURCE 1: DB ===")
    db_rows = load_db_source(DB_PATH, svc)

    gmail_rows = load_gmail_source(svc)

    print("\n=== MERGE + DEDUP ===")
    merged = merge_and_dedup(db_rows, gmail_rows)
    print(f"Total after dedup: {len(merged)} rows")

    write_csv(merged, OUTPUT_CSV)
    print_summary(merged)


if __name__ == "__main__":
    main()
