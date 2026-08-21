import atexit
import hashlib
import hmac
import os
import queue
import re
import secrets
import subprocess
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from flask import Flask, jsonify, render_template, request, session
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from game_stats import GameStats, GameStatsError
from opening_book import OpeningBook, OpeningBookError, USI_MOVE_RE


BASE_DIR = Path(__file__).resolve().parent
CONFIGURED_ENGINE_PATH = Path(
    os.environ.get(
        "YANEURAOU_PATH",
        BASE_DIR / "engine" / "YaneuraOu",
    )
)


def cpu_flags():
    try:
        cpuinfo = Path("/proc/cpuinfo").read_text(encoding="utf-8", errors="ignore").lower()
    except OSError:
        return set()
    match = re.search(r"^(?:flags|features)\s*:\s*(.+)$", cpuinfo, re.MULTILINE)
    return set(match.group(1).split()) if match else set()


AVX2_ENGINE_PATH = Path(
    os.environ.get(
        "YANEURAOU_AVX2_PATH",
        CONFIGURED_ENGINE_PATH.with_name(f"{CONFIGURED_ENGINE_PATH.name}-avx2"),
    )
)
CPU_FLAGS = cpu_flags()
USE_AVX2_ENGINE = AVX2_ENGINE_PATH.is_file() and {"avx2", "bmi2"}.issubset(CPU_FLAGS)
ENGINE_PATH = AVX2_ENGINE_PATH if USE_AVX2_ENGINE else CONFIGURED_ENGINE_PATH
ENGINE_TARGET = "AVX2" if USE_AVX2_ENGINE else "SSE42"
OPENING_ADMIN_PASSWORD = os.environ.get("OPENING_ADMIN_PASSWORD")
# The pawn-only experiment is ON when the variable is absent. With the attack
# experiment disabled, setting this to false restores the material baseline.
VARIANT_PAWN_EVAL_ENABLED = os.environ.get("VARIANT_PAWN_EVAL", "true").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
    "experimental",
}
# 攻撃型v2は、既存サービスで環境変数が未設定でも有効にする。
# falseにすれば昨日の歩評価だけの状態へ即座に戻せる。
VARIANT_ATTACK_EVAL_ENABLED = os.environ.get("VARIANT_ATTACK_EVAL", "true").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
    "experimental",
}
# 居玉・左右歩攻めv3はv2に加算する独立項。falseでv2へ即時復帰できる。
VARIANT_HOME_ATTACK_EVAL_ENABLED = os.environ.get(
    "VARIANT_HOME_ATTACK_EVAL", "true"
).strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
    "experimental",
}

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY", secrets.token_hex(32)),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=bool(os.environ.get("RENDER")),
    PERMANENT_SESSION_LIFETIME=60 * 60 * 12,
    MAX_CONTENT_LENGTH=16 * 1024,
)


class EngineError(RuntimeError):
    pass


class SearchSuperseded(EngineError):
    pass


class YaneuraOu:
    def __init__(self, executable: Path):
        self.executable = executable
        self.process = None
        self.output_queue = queue.Queue()
        self.reader_thread = None
        self.search_lock = threading.Lock()
        self.send_lock = threading.Lock()
        self.search_state_lock = threading.Lock()
        self.next_search_ticket = 0
        self.latest_ticket_by_owner = {}
        self.active_search_owner = None
        self.active_search_ticket = None
        self.current_multipv = None

    def _send(self, command: str):
        with self.send_lock:
            if self.process is None or self.process.poll() is not None:
                raise EngineError("AIエンジンが停止しています。")
            self.process.stdin.write(command + "\n")
            self.process.stdin.flush()

    def _reader(self):
        try:
            for line in self.process.stdout:
                self.output_queue.put(line.rstrip("\r\n"))
        finally:
            self.output_queue.put(None)

    def _read_until(self, predicate, timeout: float):
        deadline = time.monotonic() + timeout
        collected = []
        while time.monotonic() < deadline:
            remaining = max(0.01, deadline - time.monotonic())
            try:
                line = self.output_queue.get(timeout=remaining)
            except queue.Empty as exc:
                raise EngineError("AIエンジンの応答がタイムアウトしました。") from exc
            if line is None:
                raise EngineError("AIエンジンが予期せず終了しました。")
            collected.append(line)
            if predicate(line):
                return line, collected
        raise EngineError("AIエンジンの応答がタイムアウトしました。")

    def _drain_output(self):
        while True:
            try:
                self.output_queue.get_nowait()
            except queue.Empty:
                return

    def start(self):
        if self.process is not None and self.process.poll() is None:
            return
        if not self.executable.is_file():
            raise EngineError("Linux版YaneuraOuが見つかりません。")

        self.output_queue = queue.Queue()
        self.process = subprocess.Popen(
            [str(self.executable)],
            cwd=str(self.executable.parent),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        self.reader_thread = threading.Thread(target=self._reader, daemon=True)
        self.reader_thread.start()

        self._send("usi")
        self._read_until(lambda line: line == "usiok", 20)
        self._send("setoption name Threads value 1")
        # A larger transposition table improves repeated analysis while staying
        # comfortably inside Render Free's 512 MB memory limit.
        self._send("setoption name USI_Hash value 128")
        # Windows配布版を直接使っても同じv3になるようエンジン既定値もtrue。
        # Web側は環境変数を明示し、v3・v2・v1・従来評価へ個別に戻せる。
        self._send(
            "setoption name VariantPawnEval value "
            + ("true" if VARIANT_PAWN_EVAL_ENABLED else "false")
        )
        self._send(
            "setoption name VariantAttackEval value "
            + ("true" if VARIANT_ATTACK_EVAL_ENABLED else "false")
        )
        self._send(
            "setoption name VariantHomeAttackEval value "
            + ("true" if VARIANT_HOME_ATTACK_EVAL_ENABLED else "false")
        )
        self._send("isready")
        self._read_until(lambda line: line == "readyok", 30)
        self.current_multipv = 1

    def stop(self):
        process = self.process
        self.process = None
        if process is None or process.poll() is not None:
            return
        try:
            process.stdin.write("quit\n")
            process.stdin.flush()
            process.wait(timeout=3)
        except Exception:
            process.kill()

    def _prepare_search(self, owner_id: str):
        with self.search_state_lock:
            self.next_search_ticket += 1
            ticket = self.next_search_ticket
            self.latest_ticket_by_owner[owner_id] = ticket
            if self.active_search_owner == owner_id:
                try:
                    self._send("stop")
                except EngineError:
                    pass
            return ticket

    @staticmethod
    def _parse_info(line: str):
        parts = line.split()
        if not parts or parts[0] != "info" or "pv" not in parts:
            return None

        result = {
            "multipv": 1,
            "depth": None,
            "seldepth": None,
            "nodes": None,
            "nps": None,
            "score_type": None,
            "score": None,
            "pv": [],
        }
        index = 1
        while index < len(parts):
            token = parts[index]
            if token in ("depth", "seldepth", "multipv", "nodes", "nps") and index + 1 < len(parts):
                try:
                    result[token] = int(parts[index + 1])
                except ValueError:
                    pass
                index += 2
                continue
            if token == "score" and index + 2 < len(parts):
                result["score_type"] = parts[index + 1]
                try:
                    result["score"] = int(parts[index + 2])
                except ValueError:
                    result["score"] = None
                index += 3
                continue
            if token == "pv":
                result["pv"] = parts[index + 1 :]
                break
            index += 1

        if not result["pv"]:
            return None
        return result

    def search(self, sfen: str, movetime: int, multipv: int, owner_id: str):
        ticket = self._prepare_search(owner_id)
        with self.search_lock:
            self.start()
            self._drain_output()
            with self.search_state_lock:
                if self.latest_ticket_by_owner.get(owner_id) != ticket:
                    raise SearchSuperseded("新しい局面の解析を優先しました。")
                self.active_search_owner = owner_id
                self.active_search_ticket = ticket
            try:
                if self.current_multipv != multipv:
                    self._send(f"setoption name MultiPV value {multipv}")
                    self._send("isready")
                    self._read_until(lambda line: line == "readyok", 10)
                    self.current_multipv = multipv
                self._send(f"position sfen {sfen}")
                with self.search_state_lock:
                    if self.latest_ticket_by_owner.get(owner_id) != ticket:
                        raise SearchSuperseded("新しい局面の解析を優先しました。")
                    # 状態ロック中にgoを送ることで、後続のstopが必ずgoの後に届く。
                    self._send(f"go movetime {movetime}")

                bestmove = None
                candidates = {}
                deadline = time.monotonic() + (movetime / 1000) + 20

                while time.monotonic() < deadline:
                    remaining = max(0.01, deadline - time.monotonic())
                    try:
                        line = self.output_queue.get(timeout=remaining)
                    except queue.Empty as exc:
                        raise EngineError("AIの思考がタイムアウトしました。") from exc
                    if line is None:
                        raise EngineError("AIエンジンが予期せず終了しました。")
                    if line.startswith("bestmove"):
                        parts = line.split()
                        bestmove = parts[1] if len(parts) > 1 else "resign"
                        break
                    parsed = self._parse_info(line)
                    if parsed is not None:
                        candidates[parsed["multipv"]] = parsed

                if bestmove is None:
                    try:
                        self._send("stop")
                    except EngineError:
                        pass
                    raise EngineError("AIから指し手を取得できませんでした。")

                ordered = [candidates[key] for key in sorted(candidates) if key <= multipv]
                nodes = max((candidate.get("nodes") or 0 for candidate in ordered), default=0)
                nps = max((candidate.get("nps") or 0 for candidate in ordered), default=0)
                return {"bestmove": bestmove, "candidates": ordered, "nodes": nodes, "nps": nps}
            finally:
                with self.search_state_lock:
                    if self.active_search_ticket == ticket:
                        self.active_search_owner = None
                        self.active_search_ticket = None


engine = YaneuraOu(ENGINE_PATH)
opening_book = OpeningBook()
game_stats = GameStats()
atexit.register(engine.stop)


SFEN_BOARD_RE = re.compile(r"^(?:[1-9PLNSGBRKplnsgbrk+]+/){8}[1-9PLNSGBRKplnsgbrk+]+$")
SFEN_HAND_RE = re.compile(r"^(?:-|(?:(?:[1-9][0-9]*)?[RBGSNLPKrbgsnlpk])+)$")


def valid_sfen(value):
    if not isinstance(value, str) or len(value) > 300:
        return False
    parts = value.split()
    if len(parts) != 4:
        return False
    board, side, hands, move_number = parts
    if not SFEN_BOARD_RE.fullmatch(board):
        return False
    if side not in ("b", "w") or not SFEN_HAND_RE.fullmatch(hands):
        return False
    if not move_number.isdigit() or int(move_number) < 1:
        return False
    for rank in board.split("/"):
        squares = 0
        promoted = False
        for char in rank:
            if char == "+":
                if promoted:
                    return False
                promoted = True
                continue
            if char.isdigit():
                if promoted:
                    return False
                squares += int(char)
            else:
                if promoted and char.upper() not in "PLNSBR":
                    return False
                squares += 1
            promoted = False
        if promoted or squares != 9:
            return False
    return True


def json_body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def client_ip():
    forwarded = request.headers.get("X-Forwarded-For", "")
    return forwarded.split(",", 1)[0].strip() or request.remote_addr or "unknown"


failed_logins = defaultdict(deque)
failed_logins_lock = threading.Lock()


def login_blocked(ip):
    now = time.monotonic()
    with failed_logins_lock:
        attempts = failed_logins[ip]
        while attempts and now - attempts[0] > 15 * 60:
            attempts.popleft()
        return len(attempts) >= 5


def record_failed_login(ip):
    with failed_logins_lock:
        failed_logins[ip].append(time.monotonic())


def ensure_search_client_id():
    owner_id = session.get("search_client_id")
    if not owner_id:
        owner_id = secrets.token_urlsafe(18)
        session["search_client_id"] = owner_id
    return owner_id


def opening_admin_session_tag():
    """管理パスワード変更時に、過去の認証セッションを自動で無効化する。"""
    if not OPENING_ADMIN_PASSWORD:
        return None
    secret_key = app.config["SECRET_KEY"]
    if isinstance(secret_key, str):
        secret_key = secret_key.encode("utf-8")
    return hmac.new(
        secret_key,
        f"opening-admin:v1:{OPENING_ADMIN_PASSWORD}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def opening_admin_authorized():
    expected = opening_admin_session_tag()
    actual = session.get("opening_admin_auth_tag")
    return bool(
        expected
        and isinstance(actual, str)
        and hmac.compare_digest(actual, expected)
    )


def game_token_serializer():
    return URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="hensoku-game-result-v1")


@app.after_request
def security_headers(response):
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; "
        "style-src 'self'; script-src 'self'; connect-src 'self'; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if (
        request.path.startswith("/api/opening-admin")
        or request.path in {"/api/auth-status", "/api/game-stats", "/api/game/result"}
    ):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/")
def index():
    ensure_search_client_id()
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify(
        {
            "ok": True,
            "engine_target": ENGINE_TARGET,
            "threads": 1,
            "hash_mb": 128,
            "engine_build": "pgo",
            "opening_admin_auth_version": 2,
            "evaluation_graph_version": 1,
            "candidate_arrow_version": 2,
            "game_stats_version": 1,
            "variant_pawn_eval": VARIANT_PAWN_EVAL_ENABLED,
            "variant_pawn_eval_version": 1,
            "variant_pawn_search_version": 5,
            "variant_attack_eval": VARIANT_ATTACK_EVAL_ENABLED,
            "variant_attack_eval_version": 2,
            "variant_home_attack_eval": VARIANT_HOME_ATTACK_EVAL_ENABLED,
            "variant_home_attack_eval_version": 3,
        }
    )


@app.get("/api/game-stats")
def game_stats_snapshot():
    try:
        return jsonify(game_stats.snapshot())
    except GameStatsError:
        app.logger.exception("game stats read failed")
        return jsonify({"error": "AI戦績を読み込めませんでした。"}), 503


@app.post("/api/game/start")
def start_tracked_game():
    data = json_body()
    try:
        ai_side = int(data.get("ai_side"))
    except (TypeError, ValueError):
        return jsonify({"error": "AI側が不正です。"}), 400
    if ai_side not in (0, 1):
        return jsonify({"error": "AI側が不正です。"}), 400
    payload = {"game_id": secrets.token_urlsafe(18), "ai_side": ai_side}
    return jsonify({"game_token": game_token_serializer().dumps(payload)})


@app.post("/api/game/result")
def record_game_result():
    data = json_body()
    token = data.get("game_token")
    try:
        winner = int(data.get("winner"))
    except (TypeError, ValueError):
        winner = -1
    if not isinstance(token, str) or winner not in (0, 1):
        return jsonify({"error": "対局結果が不正です。"}), 400
    try:
        payload = game_token_serializer().loads(token, max_age=24 * 60 * 60)
    except SignatureExpired:
        return jsonify({"error": "対局結果の有効期限が切れています。"}), 400
    except BadSignature:
        return jsonify({"error": "対局結果を確認できません。"}), 400
    if (
        not isinstance(payload, dict)
        or payload.get("ai_side") not in (0, 1)
        or not isinstance(payload.get("game_id"), str)
    ):
        return jsonify({"error": "対局情報が不正です。"}), 400
    try:
        stats = game_stats.record(
            payload["game_id"], payload["ai_side"], winner == payload["ai_side"]
        )
        return jsonify({"ok": True, "stats": stats})
    except GameStatsError:
        app.logger.exception("game stats update failed")
        return jsonify({"error": "AI戦績を保存できませんでした。"}), 503


@app.get("/api/auth-status")
def auth_status():
    return jsonify(
        {
            # 検討モードは全員が利用可能。旧版JSとの互換性のためauthorizedも返す。
            "authorized": True,
            "opening_admin": opening_admin_authorized(),
        }
    )


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


def valid_opening_history(value):
    return (
        isinstance(value, list)
        and len(value) <= 200
        and all(isinstance(move, str) and USI_MOVE_RE.fullmatch(move) for move in value)
    )


@app.post("/api/opening-move")
def opening_move():
    data = json_body()
    try:
        ai_side = int(data.get("ai_side"))
    except (TypeError, ValueError):
        return jsonify({"error": "AI側が不正です。"}), 400
    history = data.get("history")
    if ai_side not in (0, 1) or not valid_opening_history(history):
        return jsonify({"error": "定跡照合データが不正です。"}), 400
    return jsonify({"move": opening_book.match(ai_side, history)})


@app.get("/api/opening-admin/status")
def opening_admin_status():
    return jsonify(
        {
            "authorized": opening_admin_authorized(),
            "persistence_ready": opening_book.persistence_ready,
        }
    )


@app.post("/api/opening-admin/login")
def opening_admin_login():
    if not OPENING_ADMIN_PASSWORD:
        return jsonify({"error": "定跡管理パスワードが未設定です。"}), 503
    ip = client_ip()
    if login_blocked(ip):
        return jsonify({"error": "入力回数が多すぎます。15分後に再試行してください。"}), 429
    password = json_body().get("password", "")
    if not isinstance(password, str) or not hmac.compare_digest(password, OPENING_ADMIN_PASSWORD):
        record_failed_login(ip)
        return jsonify({"error": "パスワードが違います。"}), 401
    with failed_logins_lock:
        failed_logins.pop(ip, None)
    session.permanent = True
    session.pop("opening_admin_authorized", None)
    session["opening_admin_auth_tag"] = opening_admin_session_tag()
    ensure_search_client_id()
    return jsonify({"ok": True})


def require_opening_admin():
    if not opening_admin_authorized():
        return jsonify({"error": "定跡管理者の認証が必要です。"}), 403
    return None


@app.get("/api/opening-admin/lines")
def opening_admin_lines():
    denied = require_opening_admin()
    if denied:
        return denied
    return jsonify(
        {
            "lines": opening_book.list_lines(),
            "persistence_ready": opening_book.persistence_ready,
        }
    )


@app.post("/api/opening-admin/lines")
def opening_admin_add_line():
    denied = require_opening_admin()
    if denied:
        return denied
    data = json_body()
    try:
        line = opening_book.add_line(data.get("name"), data.get("ai_side"), data.get("moves"))
        return jsonify({"ok": True, "line": line, "lines": opening_book.list_lines()})
    except OpeningBookError as exc:
        return jsonify({"error": str(exc)}), 503 if not opening_book.persistence_ready else 400


@app.delete("/api/opening-admin/lines/<line_id>")
def opening_admin_delete_line(line_id):
    denied = require_opening_admin()
    if denied:
        return denied
    if not re.fullmatch(r"[0-9a-f]{16}", line_id):
        return jsonify({"error": "定跡IDが不正です。"}), 400
    try:
        opening_book.delete_line(line_id)
        return jsonify({"ok": True, "lines": opening_book.list_lines()})
    except OpeningBookError as exc:
        return jsonify({"error": str(exc)}), 503 if not opening_book.persistence_ready else 400


def search_request(multipv):
    data = json_body()
    sfen = data.get("sfen")
    if not valid_sfen(sfen):
        return jsonify({"error": "局面データが不正です。"}), 400
    try:
        movetime = int(data.get("movetime", 1200))
    except (TypeError, ValueError):
        movetime = 1200
    movetime = max(300, min(movetime, 5000))

    try:
        return jsonify(engine.search(sfen, movetime, multipv, ensure_search_client_id()))
    except SearchSuperseded as exc:
        return jsonify({"error": str(exc)}), 409
    except EngineError as exc:
        return jsonify({"error": str(exc)}), 503
    except Exception:
        app.logger.exception("engine search failed")
        return jsonify({"error": "AIとの通信に失敗しました。"}), 500


@app.post("/api/think")
def think():
    return search_request(1)


@app.post("/api/evaluate")
def evaluate():
    """Short single-PV search used to save the evaluation after an AI move."""
    return search_request(1)


@app.post("/api/analyze")
def analyze():
    return search_request(3)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
