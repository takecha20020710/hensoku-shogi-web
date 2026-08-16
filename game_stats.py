import base64
import json
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


class GameStatsError(RuntimeError):
    pass


def _empty_stats():
    now = datetime.now(timezone.utc).isoformat()
    return {
        "version": 1,
        "started_at": now,
        "updated_at": now,
        "sente": {"wins": 0, "losses": 0},
        "gote": {"wins": 0, "losses": 0},
        "processed_games": [],
    }


class GameStats:
    """全利用者のAI戦績をGitHub上の小さなJSONへ永続保存する。"""

    def __init__(self):
        self.repository = os.environ.get(
            "GAME_STATS_REPOSITORY",
            os.environ.get("OPENING_BOOK_REPOSITORY", "takecha20020710/hensoku-shogi-web"),
        )
        self.branch = os.environ.get(
            "GAME_STATS_BRANCH", os.environ.get("OPENING_BOOK_BRANCH", "opening-book-data")
        )
        self.path = os.environ.get("GAME_STATS_PATH", "game_stats.json")
        self.token = os.environ.get(
            "GAME_STATS_GITHUB_TOKEN", os.environ.get("OPENING_BOOK_GITHUB_TOKEN", "")
        ).strip()
        self.lock = threading.RLock()
        self.memory_stats = _empty_stats()

    @property
    def persistence_ready(self):
        return bool(self.token)

    def _request(self, url, method="GET", payload=None, allow_missing=False):
        data = None
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "hensoku-shogi-game-stats",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        api_request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(api_request, timeout=12) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if allow_missing and exc.code == 404:
                return None
            detail = exc.read().decode("utf-8", errors="replace")
            raise GameStatsError(f"戦績保存に失敗しました（HTTP {exc.code}）。{detail[:160]}") from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise GameStatsError("戦績データへ接続できませんでした。") from exc

    @staticmethod
    def _normalize(document):
        if not isinstance(document, dict):
            return _empty_stats()
        normalized = _empty_stats()
        for side in ("sente", "gote"):
            values = document.get(side, {})
            for result in ("wins", "losses"):
                value = values.get(result, 0) if isinstance(values, dict) else 0
                normalized[side][result] = value if isinstance(value, int) and value >= 0 else 0
        for field in ("started_at", "updated_at"):
            value = document.get(field)
            if isinstance(value, str) and value:
                normalized[field] = value
        processed = document.get("processed_games", [])
        if isinstance(processed, list):
            normalized["processed_games"] = [
                game_id
                for game_id in processed[-5000:]
                if isinstance(game_id, str) and 1 <= len(game_id) <= 100
            ]
        return normalized

    def _content_url(self):
        quoted_path = urllib.parse.quote(self.path, safe="/")
        return f"https://api.github.com/repos/{self.repository}/contents/{quoted_path}"

    def _read_remote(self):
        current = self._request(
            f"{self._content_url()}?ref={urllib.parse.quote(self.branch, safe='')}",
            allow_missing=True,
        )
        if current is None:
            return _empty_stats(), None
        try:
            content = base64.b64decode(current.get("content", "")).decode("utf-8")
            return self._normalize(json.loads(content)), current.get("sha")
        except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
            raise GameStatsError("保存済みの戦績データが壊れています。") from exc

    @staticmethod
    def _public(document, persistence_ready):
        return {
            "started_at": document["started_at"],
            "updated_at": document["updated_at"],
            "sente": dict(document["sente"]),
            "gote": dict(document["gote"]),
            "persistence_ready": persistence_ready,
        }

    def snapshot(self):
        with self.lock:
            if not self.persistence_ready:
                return self._public(self.memory_stats, False)
            document, _ = self._read_remote()
            self.memory_stats = document
            return self._public(document, True)

    def record(self, game_id, ai_side, ai_won):
        if not isinstance(game_id, str) or not game_id or len(game_id) > 100:
            raise GameStatsError("対局IDが不正です。")
        if ai_side not in (0, 1) or not isinstance(ai_won, bool):
            raise GameStatsError("対局結果が不正です。")

        with self.lock:
            if not self.persistence_ready:
                document = self.memory_stats
                if game_id not in document["processed_games"]:
                    self._apply_result(document, game_id, ai_side, ai_won)
                return self._public(document, False)

            # 同時終局時のSHA競合を考慮し、最新値を読み直して最大3回更新する。
            for attempt in range(3):
                document, sha = self._read_remote()
                if game_id in document["processed_games"]:
                    self.memory_stats = document
                    return self._public(document, True)
                self._apply_result(document, game_id, ai_side, ai_won)
                payload = {
                    "message": "Record hensoku shogi AI result",
                    "content": base64.b64encode(
                        (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
                    ).decode("ascii"),
                    "branch": self.branch,
                }
                if sha:
                    payload["sha"] = sha
                try:
                    self._request(self._content_url(), method="PUT", payload=payload)
                    self.memory_stats = document
                    return self._public(document, True)
                except GameStatsError as exc:
                    if attempt == 2 or not any(
                        status in str(exc) for status in ("HTTP 409", "HTTP 422")
                    ):
                        raise
            raise GameStatsError("戦績を更新できませんでした。")

    @staticmethod
    def _apply_result(document, game_id, ai_side, ai_won):
        side = "sente" if ai_side == 0 else "gote"
        result = "wins" if ai_won else "losses"
        document[side][result] += 1
        document["updated_at"] = datetime.now(timezone.utc).isoformat()
        document["processed_games"] = [*document["processed_games"], game_id][-5000:]
