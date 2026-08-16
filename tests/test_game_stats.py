from game_stats import GameStats


def test_normalize_ignores_invalid_counts_and_limits_processed_games():
    normalized = GameStats._normalize(
        {
            "sente": {"wins": 12, "losses": -4},
            "gote": {"wins": "9", "losses": 3},
            "processed_games": [None, *[f"game-{index}" for index in range(5100)]],
        }
    )
    assert normalized["sente"] == {"wins": 12, "losses": 0}
    assert normalized["gote"] == {"wins": 0, "losses": 3}
    assert len(normalized["processed_games"]) == 5000
    assert normalized["processed_games"][0] == "game-100"


def test_memory_record_is_idempotent(monkeypatch):
    monkeypatch.delenv("GAME_STATS_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("OPENING_BOOK_GITHUB_TOKEN", raising=False)
    stats = GameStats()
    stats.record("one-game", 1, True)
    snapshot = stats.record("one-game", 1, True)
    assert snapshot["gote"] == {"wins": 1, "losses": 0}
    assert snapshot["persistence_ready"] is False
