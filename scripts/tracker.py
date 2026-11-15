"""Deduplicate MAL recent-history events and aggregate daily contributions."""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

BANGKOK = ZoneInfo("Asia/Bangkok")


def parse_mal_datetime(value: str | None) -> datetime | None:
    """Parse an ISO timestamp and convert it to Bangkok time."""
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            # Toki documents date-time values. Treat a missing offset as UTC
            # rather than silently using the Actions runner's timezone.
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(BANGKOK)
    except (TypeError, ValueError):
        return None


def _entry_identity(row: dict[str, Any]) -> str:
    """Get a stable identifier for a title without storing its name in state."""
    entry = row.get("mal_url") or row.get("entry") or {}
    if isinstance(entry, dict):
        value = entry.get("url") or entry.get("mal_id") or entry.get("id")
        if value is not None:
            return str(value).strip()
        # Fallback for a future Toki schema change. The canonical JSON is
        # hashed immediately and is never written to the public state file.
        return json.dumps(entry, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    if entry is not None:
        return str(entry).strip()
    return "unknown-entry"


def normalize_history(
    history_by_kind: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """Normalize history rows and assign repeatable fingerprints.

    A duplicate ordinal preserves two genuinely separate but otherwise
    identical history rows, while keeping fingerprints stable across polls.
    """
    provisional: list[dict[str, Any]] = []
    for kind in ("anime", "manga"):
        for row in history_by_kind.get(kind, []):
            if not isinstance(row, dict):
                continue
            try:
                increment = max(0, int(row.get("increment", 0) or 0))
            except (TypeError, ValueError):
                continue
            stamp = parse_mal_datetime(row.get("date"))
            if increment <= 0 or stamp is None:
                continue
            entry_id = _entry_identity(row)
            # Canonical UTC timestamp protects against equivalent timestamps
            # expressed with different offsets.
            utc_stamp = stamp.astimezone(timezone.utc).isoformat(timespec="seconds")
            identity = f"{kind}|{entry_id}|{utc_stamp}|{increment}"
            provisional.append({
                "kind": kind,
                "date": stamp.date().isoformat(),
                "increment": increment,
                "identity": identity,
            })

    provisional.sort(key=lambda item: (item["identity"], item["date"]))
    occurrences: dict[str, int] = defaultdict(int)
    normalized: list[dict[str, Any]] = []
    for item in provisional:
        identity = item.pop("identity")
        duplicate_number = occurrences[identity]
        occurrences[identity] += 1
        digest = hashlib.sha256(
            f"{identity}|duplicate:{duplicate_number}".encode("utf-8")
        ).hexdigest()
        item["fingerprint"] = digest
        normalized.append(item)
    return normalized


def apply_history(
    state: dict[str, Any],
    history_by_kind: dict[str, list[dict[str, Any]]],
    now: datetime | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Import currently visible history and add only previously unseen events.

    This imports recent history on the first run (backfill), then deduplicates
    overlapping history windows on each later run. Events are assigned to the
    date supplied by MAL/Toki, converted to Asia/Bangkok.
    """
    now = now or datetime.now(BANGKOK)
    if now.tzinfo is None:
        now = now.replace(tzinfo=BANGKOK)
    now = now.astimezone(BANGKOK)

    daily = state.setdefault("daily", {})
    seen = state.setdefault("seen_events", {})
    normalized = normalize_history(history_by_kind)
    added = {"anime": 0, "manga": 0}
    imported_events = 0
    changed_days: set[str] = set()

    for event in normalized:
        fingerprint = event["fingerprint"]
        if fingerprint in seen:
            continue
        kind = event["kind"]
        day = event["date"]
        increment = event["increment"]
        record = daily.setdefault(day, {"anime": 0, "manga": 0, "total": 0})
        record[kind] = int(record.get(kind, 0)) + increment
        record["total"] = int(record.get("anime", 0)) + int(record.get("manga", 0))
        seen[fingerprint] = day
        added[kind] += increment
        imported_events += 1
        changed_days.add(day)

    first_import = state.get("first_import_at") is None
    if first_import:
        state["first_import_at"] = now.isoformat(timespec="seconds")
    state["last_sync_at"] = now.isoformat(timespec="seconds")
    state["history_source"] = "Toki public MAL history"

    summary = {
        "first_import": first_import,
        "events_seen": len(normalized),
        "events_added": imported_events,
        "anime_added": added["anime"],
        "manga_added": added["manga"],
        "days_changed": sorted(changed_days),
    }
    return state, summary
