from __future__ import annotations

import json
import os
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

from collect import collect_recent_history
from render import write_site
from tracker import apply_history

ROOT = Path(__file__).resolve().parents[1]
STATE_PATH = ROOT / "data" / "state.json"
USERNAME = os.environ.get("MAL_USERNAME", "TiMEZ4I3eth").strip()
TOKI_BASE_URL = os.environ.get("TOKI_BASE_URL", "http://127.0.0.1:3000").strip()


def main() -> None:
    state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    if state.get("username") != USERNAME:
        raise SystemExit(
            f"Configured username {USERNAME!r} does not match state.json username "
            f"{state.get('username')!r}. Update data/state.json deliberately before switching accounts."
        )

    history = collect_recent_history(USERNAME, TOKI_BASE_URL)
    state, summary = apply_history(state, history, datetime.now(ZoneInfo("Asia/Bangkok")))
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    repository = os.environ.get("GITHUB_REPOSITORY", "").strip()
    image_url = None
    if "/" in repository:
        owner, repo_name = repository.split("/", 1)
        if repo_name.lower() == f"{owner}.github.io".lower():
            image_url = f"https://{owner}.github.io/heatmap.png"
        else:
            image_url = f"https://{owner}.github.io/{repo_name}/heatmap.png"
    write_site(state, USERNAME, ROOT / "site", image_url=image_url)

    print(f"MAL account: {USERNAME}")
    print(f"Recent history rows returned: anime={len(history['anime'])}, manga={len(history['manga'])}")
    print(f"Previously unseen history events imported: {summary['events_added']}")
    print(f"Anime episodes added: {summary['anime_added']}")
    print(f"Manga chapters added: {summary['manga_added']}")
    print(f"Contribution dates changed: {', '.join(summary['days_changed']) or 'none'}")
    if summary["first_import"]:
        print("First import complete: all history currently exposed by MAL was backfilled.")
    print("Only aggregate daily totals and hashed event fingerprints are stored in the repository.")


if __name__ == "__main__":
    main()
