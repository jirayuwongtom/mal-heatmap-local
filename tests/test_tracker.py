import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from scripts.tracker import apply_history, normalize_history

BKK = ZoneInfo("Asia/Bangkok")


class HistoryTrackerTests(unittest.TestCase):
    def test_first_run_backfills_visible_recent_history(self):
        state = {"schema_version": 2, "username": "TiMEZ4I3eth", "seen_events": {}, "daily": {}}
        history = {
            "anime": [
                {"mal_url": {"mal_id": 1535, "url": "https://myanimelist.net/anime/1535"},
                 "increment": 2, "date": "2026-11-14T10:00:00+00:00"}
            ],
            "manga": [
                {"mal_url": {"mal_id": 123, "url": "https://myanimelist.net/manga/123"},
                 "increment": 5, "date": "2026-11-14T10:30:00+00:00"}
            ],
        }
        state, summary = apply_history(state, history, datetime(2026, 11, 15, 20, 0, tzinfo=BKK))
        self.assertTrue(summary["first_import"])
        self.assertEqual(summary["events_added"], 2)
        self.assertEqual(state["daily"]["2026-11-14"], {"anime": 2, "manga": 5, "total": 7})
        self.assertTrue(state["first_import_at"])

    def test_repeated_poll_does_not_double_count_same_history(self):
        state = {"schema_version": 2, "username": "TiMEZ4I3eth", "seen_events": {}, "daily": {}}
        history = {
            "anime": [
                {"mal_url": {"url": "https://myanimelist.net/anime/1535"},
                 "increment": 3, "date": "2026-11-14T10:00:00+00:00"}
            ],
            "manga": [],
        }
        state, _ = apply_history(state, history, datetime(2026, 11, 15, 20, 0, tzinfo=BKK))
        state, summary = apply_history(state, history, datetime(2026, 11, 15, 21, 0, tzinfo=BKK))
        self.assertEqual(summary["events_added"], 0)
        self.assertEqual(state["daily"]["2026-11-14"]["total"], 3)

    def test_two_identical_rows_in_one_response_are_counted_twice(self):
        row = {"mal_url": {"url": "https://myanimelist.net/anime/1535"},
               "increment": 1, "date": "2026-11-14T10:00:00+00:00"}
        normalized = normalize_history({"anime": [row, row], "manga": []})
        self.assertEqual(len(normalized), 2)
        self.assertNotEqual(normalized[0]["fingerprint"], normalized[1]["fingerprint"])

    def test_missing_dates_and_zero_increment_are_ignored(self):
        history = {
            "anime": [
                {"mal_url": {"mal_id": 1}, "increment": 1, "date": None},
                {"mal_url": {"mal_id": 2}, "increment": 0, "date": "2026-11-14T10:00:00+00:00"},
            ],
            "manga": [],
        }
        self.assertEqual(normalize_history(history), [])

    def test_timestamp_is_converted_to_bangkok_date(self):
        history = {
            "anime": [
                {"mal_url": {"mal_id": 1}, "increment": 1, "date": "2026-11-14T18:00:00+00:00"}
            ],
            "manga": [],
        }
        events = normalize_history(history)
        self.assertEqual(events[0]["date"], "2026-11-15")


if __name__ == "__main__":
    unittest.main()
