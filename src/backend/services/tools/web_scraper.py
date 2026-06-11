"""Web scraper tool — extracts main text content from a URL.

Intended for the Chatbot Agent to read job descriptions and similar
public web pages. The LLM calls ``scrape_url`` directly as a tool.
"""

from __future__ import annotations

import logging

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 10
_REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    )
}
# HTML tags that never contain readable body text
_NOISE_TAGS = ["script", "style", "nav", "header", "footer", "aside", "noscript"]


def scrape_url(url: str) -> str:
    """Fetch a public webpage and return its main readable text.

    Strips scripts, styles, and navigation chrome so the returned string
    contains only prose — suitable for extracting job descriptions or
    company profiles.

    Args:
        url: Fully-qualified URL of the page to fetch, e.g.
            ``"https://example.com/jobs/123"``.

    Returns:
        Plain text extracted from the page body (newline-separated).
        On failure, returns a string that starts with ``"Error:"``
        describing what went wrong — callers should check for this
        prefix rather than raising.

    Examples:
        >>> text = scrape_url("https://example.com/jobs/software-engineer")
        >>> print(text[:200])
    """
    try:
        response = requests.get(url, headers=_REQUEST_HEADERS, timeout=_TIMEOUT_SECONDS)
    except requests.exceptions.Timeout:
        logger.warning("Timeout fetching %s", url)
        return f"Error: request timed out for {url}."
    except requests.exceptions.ConnectionError as exc:
        logger.warning("Connection error fetching %s: %s", url, exc)
        return f"Error: could not connect to {url} — {exc}"
    except requests.RequestException as exc:
        logger.warning("Request failed for %s: %s", url, exc)
        return f"Error: request failed for {url} — {exc}"

    if response.status_code == 403:
        return f"Error: access denied (403) — {url} is blocking automated requests."
    if response.status_code == 404:
        return f"Error: page not found (404) for {url}."
    if not response.ok:
        return f"Error: HTTP {response.status_code} received for {url}."

    soup = BeautifulSoup(response.text, "html.parser")
    for tag in soup(_NOISE_TAGS):
        tag.decompose()

    raw_text = soup.get_text(separator="\n")
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    return "\n".join(lines)
