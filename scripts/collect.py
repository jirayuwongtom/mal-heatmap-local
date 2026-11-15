"""Fetch public MyAnimeList recent-history events from a local Toki instance.

Toki is started temporarily by GitHub Actions for each run. It scrapes only
public MAL pages and exposes them as JSON; it is not the official MAL API.
"""
from __future__ import annotations

import time
from typing import Any
from urllib.parse import quote

import requests


class HistorySourceError(RuntimeError):
    """Raised when recent history cannot be fetched safely."""


def _decode_history_payload(payload: Any, kind: str) -> list[dict[str, Any]]:
    """Accept the documented Toki array response and a wrapped data response."""
    if isinstance(payload, dict):
        if payload.get("error"):
            raise HistorySourceError(f"Toki returned an error for {kind}: {payload['error']}")
        payload = payload.get("data")
    if not isinstance(payload, list):
        raise HistorySourceError(
            f"Unexpected Toki response for {kind}: expected a JSON array of history events."
        )

    rows: list[dict[str, Any]] = []
    for row in payload:
        if isinstance(row, dict):
            rows.append(row)
    return rows


def fetch_user_history(
    username: str,
    kind: str,
    toki_base_url: str = "http://127.0.0.1:3000",
    session: requests.Session | None = None,
) -> list[dict[str, Any]]:
    """Fetch all currently visible public history rows for one MAL content type.

    Toki's documented endpoint has no page parameter; it returns the recent
    history MAL currently exposes. MAL's public history window is about 21 days.
    """
    if kind not in {"anime", "manga"}:
        raise ValueError("kind must be 'anime' or 'manga'")

    url = f"{toki_base_url.rstrip('/')}/users/{quote(username, safe='')}/history"
    client = session or requests.Session()
    headers = {
        "Accept": "application/json",
        "User-Agent": "MAL-Contributions/2.0 (personal GitHub Actions project)",
    }

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            response = client.get(url, params={"type": kind}, headers=headers, timeout=45)
            if response.status_code in (429, 502, 503, 504):
                raise HistorySourceError(
                    f"Toki/MAL temporarily returned HTTP {response.status_code} for {kind}."
                )
            if response.status_code in (401, 403):
                raise HistorySourceError(
                    f"Toki/MAL returned HTTP {response.status_code} for {kind}. "
                    "Check that the MAL profile and history are public; MAL may also be throttling requests."
                )
            if response.status_code == 404:
                raise HistorySourceError(
                    f"Toki could not find public history for MAL user {username!r} ({kind})."
                )
            if not response.ok:
                raise HistorySourceError(
                    f"Toki returned HTTP {response.status_code} for {kind}: {response.text[:240]}"
                )
            try:
                payload = response.json()
            except ValueError as exc:
                raise HistorySourceError(f"Toki returned invalid JSON for {kind}.") from exc
            return _decode_history_payload(payload, kind)
        except (requests.RequestException, HistorySourceError) as exc:
            last_error = exc
            # Retry only transient upstream/network failures; don't retry auth/not-found/schema errors.
            message = str(exc)
            transient = isinstance(exc, requests.RequestException) or any(
                f"HTTP {code}" in message for code in (429, 502, 503, 504)
            )
            if not transient or attempt == 2:
                break
            time.sleep(2 ** attempt)

    raise HistorySourceError(str(last_error or "Could not fetch MAL history.")) from last_error


def collect_recent_history(
    username: str,
    toki_base_url: str = "http://127.0.0.1:3000",
) -> dict[str, list[dict[str, Any]]]:
    """Fetch anime and manga recent history. Fail the run if either type fails."""
    session = requests.Session()
    anime = fetch_user_history(username, "anime", toki_base_url, session=session)
    time.sleep(1.0)
    manga = fetch_user_history(username, "manga", toki_base_url, session=session)
    return {"anime": anime, "manga": manga}
