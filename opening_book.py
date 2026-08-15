import base64
import json
import os
import re
import secrets
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


USI_MOVE_RE = re.compile(r"^(?:[1-9][a-i][1-9][a-i]\+?|[PLNSGBR]\*[1-9][a-i])$")


# 対局モードの組み込み定跡。pattern は直前までのUSI指し手、None は任意の1手。
# 具体的な分岐を先に、一般的な分岐を後ろに置く。
DEFAULT_OPENING_RULES = [
    {"ai_side": 0, "pattern": [], "move": "5g5f"},
    {"ai_side": 0, "pattern": ["5g5f", None], "move": "2h5h"},

    {"ai_side": 1, "pattern": [None], "move": "5c5d"},
    {"ai_side": 1, "pattern": ["7g7f", "5c5d", "8h3c"], "move": "2b3c"},
    {"ai_side": 1, "pattern": ["7g7f", "5c5d", "8h3c+"], "move": "2b3c"},
    {"ai_side": 1, "pattern": ["5g5f", "5c5d", "5f5e"], "move": "5d5e"},

    # ▲2六歩から始まる追加定跡。
    {
        "ai_side": 1,
        "pattern": ["2g2f", "5c5d", "2f2e", "8b5b", "2e2d"],
        "move": "5d5e",
    },
    {
        "ai_side": 1,
        "pattern": ["2g2f", "5c5d", "2f2e", "8b5b", "2e2d", "5d5e", "2d2c+"],
        "move": "5e5f",
    },
    {
        "ai_side": 1,
        "pattern": [
            "2g2f", "5c5d", "2f2e", "8b5b", "2e2d", "5d5e", "2d2c+", "5e5f", "5g5f",
        ],
        "move": "3a3b",
    },

    # 11手目 ▲2四歩打 の分岐。
    {
        "ai_side": 1,
        "pattern": [
            "2g2f", "5c5d", "2f2e", "8b5b", "2e2d", "5d5e", "2d2c+", "5e5f", "5g5f", "3a3b",
            "P*2d",
        ],
        "move": "3b2c",
    },
    {
        "ai_side": 1,
        "pattern": [
            "2g2f", "5c5d", "2f2e", "8b5b", "2e2d", "5d5e", "2d2c+", "5e5f", "5g5f", "3a3b",
            "P*2d", "3b2c", "2d2c+",
        ],
        "move": "P*5h",
    },
    {
        "ai_side": 1,
        "pattern": [
            "2g2f", "5c5d", "2f2e", "8b5b", "2e2d", "5d5e", "2d2c+", "5e5f", "5g5f", "3a3b",
            "P*2d", "3b2c", "2d2c+", "P*5h", "5i6h",
        ],
        "move": "5h5i+",
    },
    {
        "ai_side": 1,
        "pattern": [
            "2g2f", "5c5d", "2f2e", "8b5b", "2e2d", "5d5e", "2d2c+", "5e5f", "5g5f", "3a3b",
            "P*2d", "3b2c", "2d2c+", "P*5h", "5i4h",
        ],
        "move": "5h5i+",
    },

    # 11手目 ▲2四と の分岐。
    {
        "ai_side": 1,
        "pattern": [
            "2g2f", "5c5d", "2f2e", "8b5b", "2e2d", "5d5e", "2d2c+", "5e5f", "5g5f", "3a3b",
            "2c2d",
        ],
        "move": "5b5f",
    },
    # 注記の「13手目▲5七歩打なら18手目△5八歩打」は手番が合わないため、
    # 次のAI手である14手目△5八歩打として登録している。
    {
        "ai_side": 1,
        "pattern": [
            "2g2f", "5c5d", "2f2e", "8b5b", "2e2d", "5d5e", "2d2c+", "5e5f", "5g5f", "3a3b",
            "2c2d", "5b5f", "P*5g",
        ],
        "move": "P*5h",
    },
    {
        "ai_side": 1,
        "pattern": [
            "2g2f", "5c5d", "2f2e", "8b5b", "2e2d", "5d5e", "2d2c+", "5e5f", "5g5f", "3a3b",
            "2c2d", "5b5f", "P*5h",
        ],
        "move": "P*5g",
    },
    {
        "ai_side": 1,
        "pattern": [
            "2g2f", "5c5d", "2f2e", "8b5b", "2e2d", "5d5e", "2d2c+", "5e5f", "5g5f", "3a3b",
            "2c2d", "5b5f", "P*5h", "P*5g", "5h5g",
        ],
        "move": "5f2f",
    },
    {
        "ai_side": 1,
        "pattern": [
            "2g2f", "5c5d", "2f2e", "8b5b", "2e2d", "5d5e", "2d2c+", "5e5f", "5g5f", "3a3b",
            "2c2d", "5b5f", "P*5h", "P*5g", "5h5g", "5f2f", "P*2g",
        ],
        "move": "2f2d",
    },

    {"ai_side": 1, "pattern": [None, "5c5d", None], "move": "8b5b"},
]


# 管理画面に表示する組み込み定跡。None はプレイヤーの任意手を表す。
# 対局時の照合ロジックは上の DEFAULT_OPENING_RULES を使用し、ここは閲覧用に
# 会話で指定された分岐を1本ずつ分かりやすくまとめている。
DEFAULT_OPENING_LINES = [
    {
        "id": "builtin-sente-center-rook",
        "name": "AI先手：5六歩・5八飛",
        "ai_side": 0,
        "moves": ["5g5f", None, "2h5h"],
        "built_in": True,
    },
    {
        "id": "builtin-gote-center-rook",
        "name": "AI後手：5四歩・5二飛（基本形）",
        "ai_side": 1,
        "moves": [None, "5c5d", None, "8b5b"],
        "built_in": True,
    },
    {
        "id": "builtin-gote-bishop",
        "name": "AI後手例外：7六歩・3三角",
        "ai_side": 1,
        "moves": ["7g7f", "5c5d", "8h3c", "2b3c"],
        "built_in": True,
    },
    {
        "id": "builtin-gote-bishop-promote",
        "name": "AI後手例外：7六歩・3三角成",
        "ai_side": 1,
        "moves": ["7g7f", "5c5d", "8h3c+", "2b3c"],
        "built_in": True,
    },
    {
        "id": "builtin-gote-center-capture",
        "name": "AI後手例外：5六歩・5五歩",
        "ai_side": 1,
        "moves": ["5g5f", "5c5d", "5f5e", "5d5e"],
        "built_in": True,
    },
    {
        "id": "builtin-gote-pawn-drop-king-6h",
        "name": "AI後手：2四歩打分岐・6八玉",
        "ai_side": 1,
        "moves": [
            "2g2f", "5c5d", "2f2e", "8b5b", "2e2d", "5d5e", "2d2c+", "5e5f",
            "5g5f", "3a3b", "P*2d", "3b2c", "2d2c+", "P*5h", "5i6h", "5h5i+",
        ],
        "built_in": True,
    },
    {
        "id": "builtin-gote-pawn-drop-king-4h",
        "name": "AI後手：2四歩打分岐・4八玉",
        "ai_side": 1,
        "moves": [
            "2g2f", "5c5d", "2f2e", "8b5b", "2e2d", "5d5e", "2d2c+", "5e5f",
            "5g5f", "3a3b", "P*2d", "3b2c", "2d2c+", "P*5h", "5i4h", "5h5i+",
        ],
        "built_in": True,
    },
    {
        "id": "builtin-gote-tokin-main",
        "name": "AI後手：2四と分岐・本線",
        "ai_side": 1,
        "moves": [
            "2g2f", "5c5d", "2f2e", "8b5b", "2e2d", "5d5e", "2d2c+", "5e5f",
            "5g5f", "3a3b", "2c2d", "5b5f", "P*5h", "P*5g", "5h5g", "5f2f",
            "P*2g", "2f2d",
        ],
        "built_in": True,
    },
    {
        "id": "builtin-gote-tokin-5g-drop",
        "name": "AI後手：2四と分岐・13手目5七歩打",
        "ai_side": 1,
        "moves": [
            "2g2f", "5c5d", "2f2e", "8b5b", "2e2d", "5d5e", "2d2c+", "5e5f",
            "5g5f", "3a3b", "2c2d", "5b5f", "P*5g", "P*5h",
        ],
        "built_in": True,
        "note": "手番に合わせ、AIの次の手（14手目）を5八歩打として登録",
    },
]


class OpeningBookError(RuntimeError):
    pass


class OpeningBook:
    def __init__(self):
        self.repository = os.environ.get("OPENING_BOOK_REPOSITORY", "takecha20020710/hensoku-shogi-web")
        self.branch = os.environ.get("OPENING_BOOK_BRANCH", "opening-book-data")
        self.path = os.environ.get("OPENING_BOOK_PATH", "opening_book.json")
        self.token = os.environ.get("OPENING_BOOK_GITHUB_TOKEN", "").strip()
        self.lock = threading.RLock()
        self.lines = []
        self.loaded = False

    @property
    def persistence_ready(self):
        return bool(self.token)

    def _request(self, url, method="GET", payload=None, authenticated=False):
        data = None
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "hensoku-shogi-opening-book",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if authenticated:
            if not self.token:
                raise OpeningBookError("定跡の永続保存がまだ設定されていません。")
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise OpeningBookError(f"GitHub保存に失敗しました（HTTP {exc.code}）。{detail[:160]}") from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise OpeningBookError("GitHubの定跡データへ接続できませんでした。") from exc

    def ensure_loaded(self):
        with self.lock:
            if self.loaded:
                return
            self.loaded = True
            quoted_path = urllib.parse.quote(self.path, safe="/")
            url = (
                f"https://api.github.com/repos/{self.repository}/contents/{quoted_path}"
                f"?ref={urllib.parse.quote(self.branch, safe='')}"
            )
            try:
                response = self._request(url, authenticated=bool(self.token))
                content = base64.b64decode(response.get("content", "")).decode("utf-8")
                self.lines = self._parse_document(content)
            except (OpeningBookError, UnicodeDecodeError, json.JSONDecodeError):
                self.lines = []

    @staticmethod
    def _parse_document(content):
        document = json.loads(content)
        lines = document.get("lines", []) if isinstance(document, dict) else []
        valid_lines = []
        for line in lines:
            if not isinstance(line, dict) or not re.fullmatch(r"[0-9a-f]{16}", str(line.get("id", ""))):
                continue
            try:
                OpeningBook.validate_line(line.get("name"), line.get("ai_side"), line.get("moves"))
            except OpeningBookError:
                continue
            valid_lines.append(line)
        return valid_lines

    @staticmethod
    def _pattern_matches(pattern, history):
        return len(pattern) == len(history) and all(
            expected is None or expected == actual for expected, actual in zip(pattern, history)
        )

    @staticmethod
    def _rules_from_line(line):
        ai_side = line["ai_side"]
        moves = line["moves"]
        return [
            {"ai_side": ai_side, "pattern": moves[:index], "move": move}
            for index, move in enumerate(moves)
            if index % 2 == ai_side
        ]

    def _matching_rule_locked(self, ai_side, history):
        """Return the currently effective rule for an exact game history."""
        dynamic_rules = []
        for line in reversed(self.lines):
            for rule in self._rules_from_line(line):
                dynamic_rules.append({**rule, "source": line.get("name", "画面登録定跡")})
        built_in_rules = [
            {**rule, "source": "組み込み定跡"}
            for rule in DEFAULT_OPENING_RULES
        ]
        for rule in dynamic_rules + built_in_rules:
            if rule["ai_side"] == ai_side and self._pattern_matches(rule["pattern"], history):
                return rule
        return None

    def match(self, ai_side, history):
        self.ensure_loaded()
        with self.lock:
            rule = self._matching_rule_locked(ai_side, history)
            if rule is not None:
                return rule["move"]
        return None

    def list_lines(self):
        self.ensure_loaded()
        with self.lock:
            custom_lines = [{**line, "built_in": False} for line in self.lines]
            return json.loads(
                json.dumps([*DEFAULT_OPENING_LINES, *custom_lines], ensure_ascii=False)
            )

    @staticmethod
    def validate_line(name, ai_side, moves):
        if not isinstance(name, str) or not (1 <= len(name.strip()) <= 40):
            raise OpeningBookError("定跡名は1〜40文字で入力してください。")
        if ai_side not in (0, 1):
            raise OpeningBookError("AI側を先手または後手から選択してください。")
        if not isinstance(moves, list) or not (1 <= len(moves) <= 200):
            raise OpeningBookError("1〜200手の棋譜を登録してください。")
        if any(not isinstance(move, str) or not USI_MOVE_RE.fullmatch(move) for move in moves):
            raise OpeningBookError("棋譜に不正な指し手が含まれています。")
        if not any(index % 2 == ai_side for index in range(len(moves))):
            raise OpeningBookError("選択したAI側の指し手が棋譜にありません。")

    def _persist(self, lines):
        if not self.token:
            raise OpeningBookError(
                "定跡の永続保存が未設定です。RenderにOPENING_BOOK_GITHUB_TOKENを設定してください。"
            )
        quoted_path = urllib.parse.quote(self.path, safe="/")
        url = f"https://api.github.com/repos/{self.repository}/contents/{quoted_path}"
        current = self._request(
            f"{url}?ref={urllib.parse.quote(self.branch, safe='')}", authenticated=True
        )
        document = json.dumps({"version": 1, "lines": lines}, ensure_ascii=False, indent=2) + "\n"
        payload = {
            "message": "Update opening book from admin editor",
            "content": base64.b64encode(document.encode("utf-8")).decode("ascii"),
            "branch": self.branch,
            "sha": current.get("sha"),
        }
        self._request(url, method="PUT", payload=payload, authenticated=True)

    def add_line(self, name, ai_side, moves):
        self.validate_line(name, ai_side, moves)
        self.ensure_loaded()
        with self.lock:
            # 同じ分岐（同じ直前棋譜）ではAIの指し手を1通りに限定する。
            # プレイヤー側の新しい分岐は追加できるが、既存の分岐を上書きする
            # AI手は登録できない。仮仕様なので、この検査を外せば従来動作へ戻せる。
            for index, move in enumerate(moves):
                if index % 2 != ai_side:
                    continue
                existing = self._matching_rule_locked(ai_side, moves[:index])
                if existing is not None and existing["move"] != move:
                    raise OpeningBookError(
                        f"{index + 1}手目のAIの指し手が既存の定跡"
                        f"（{existing['source']}）と異なります。"
                        f"（既存：{existing['move']}／新規：{move}）"
                        "同じ分岐でAIの指し手は1通りだけ登録できます。"
                    )
            line = {
                "id": secrets.token_hex(8),
                "name": name.strip(),
                "ai_side": ai_side,
                "moves": list(moves),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            updated = [*self.lines, line]
            self._persist(updated)
            self.lines = updated
            return json.loads(json.dumps(line, ensure_ascii=False))

    def delete_line(self, line_id):
        self.ensure_loaded()
        with self.lock:
            updated = [line for line in self.lines if line.get("id") != line_id]
            if len(updated) == len(self.lines):
                raise OpeningBookError("削除する定跡が見つかりません。")
            self._persist(updated)
            self.lines = updated
