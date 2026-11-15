import unittest
from unittest.mock import Mock

from scripts.collect import HistorySourceError, fetch_user_history


class CollectHistoryTests(unittest.TestCase):
    def test_fetches_documented_toki_history_array(self):
        response = Mock()
        response.status_code = 200
        response.ok = True
        response.json.return_value = [
            {
                "mal_url": {"mal_id": 1535, "url": "https://myanimelist.net/anime/1535"},
                "increment": 2,
                "date": "2026-11-14T10:00:00+00:00",
            }
        ]
        session = Mock()
        session.get.return_value = response

        rows = fetch_user_history("TiMEZ4I3eth", "anime", session=session)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["increment"], 2)
        self.assertEqual(session.get.call_args.kwargs["params"], {"type": "anime"})

    def test_accepts_wrapped_data_array(self):
        response = Mock()
        response.status_code = 200
        response.ok = True
        response.json.return_value = {"data": []}
        session = Mock()
        session.get.return_value = response
        self.assertEqual(fetch_user_history("TiMEZ4I3eth", "manga", session=session), [])

    def test_rejects_unexpected_response_shape(self):
        response = Mock()
        response.status_code = 200
        response.ok = True
        response.json.return_value = {"unexpected": True}
        session = Mock()
        session.get.return_value = response
        with self.assertRaises(HistorySourceError):
            fetch_user_history("TiMEZ4I3eth", "anime", session=session)

    def test_exposes_forbidden_response_as_actionable_error(self):
        response = Mock()
        response.status_code = 403
        response.ok = False
        response.text = "Forbidden"
        session = Mock()
        session.get.return_value = response
        with self.assertRaisesRegex(HistorySourceError, "HTTP 403"):
            fetch_user_history("TiMEZ4I3eth", "anime", session=session)


if __name__ == "__main__":
    unittest.main()
