import atexit
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


BASE_DIR = Path(__file__).resolve().parent
ENGINE_PATH = Path(
    os.environ.get(
        "YANEURAOU_PATH",
        BASE_DIR / "engine" / "YaneuraOu",
    )
)
ANALYSIS_PASSWORD = os.environ.get("ANALYSIS_PASSWORD")

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


class YaneuraOu:
    def __init__(self, executable: Path):
        self.executable = executable
        self.process = None
        self.output_queue = queue.Queue()
        self.reader_thread = None
        self.search_lock = threading.Lock()

    def _send(self, command: str):
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
        self._send("setoption name USI_Hash value 16")
        self._send("isready")
        self._read_until(lambda line: line == "readyok", 30)

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

    @staticmethod
    def _parse_info(line: str):
        parts = line.split()
        if not parts or parts[0] != "info" or "pv" not in parts:
            return None

        result = {
            "multipv": 1,
            "depth": None,
            "score_type": None,
            "score": None,
            "pv": [],
        }
        index = 1
        while index < len(parts):
            token = parts[index]
            if token in ("depth", "multipv") and index + 1 < len(parts):
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

    def search(self, sfen: str, movetime: int, multipv: int):
        with self.search_lock:
            self.start()
            self._drain_output()
            self._send(f"setoption name MultiPV value {multipv}")
            self._send("isready")
            self._read_until(lambda line: line == "readyok", 10)
            self._send(f"position sfen {sfen}")
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
            return {"bestmove": bestmove, "candidates": ordered}


engine = YaneuraOu(ENGINE_PATH)
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
    return response


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify({"ok": True})


@app.get("/api/auth-status")
def auth_status():
    return jsonify({"authorized": bool(session.get("analysis_authorized"))})


@app.post("/api/login")
def analysis_login():
    if not ANALYSIS_PASSWORD:
        return jsonify({"error": "検討パスワードが未設定です。"}), 503
    ip = client_ip()
    if login_blocked(ip):
        return jsonify({"error": "入力回数が多すぎます。15分後に再試行してください。"}), 429

    password = json_body().get("password", "")
    if not isinstance(password, str) or not hmac.compare_digest(password, ANALYSIS_PASSWORD):
        record_failed_login(ip)
        return jsonify({"error": "パスワードが違います。"}), 401

    with failed_logins_lock:
        failed_logins.pop(ip, None)
    session.clear()
    session.permanent = True
    session["analysis_authorized"] = True
    return jsonify({"ok": True})


@app.post("/api/logout")
def analysis_logout():
    session.clear()
    return jsonify({"ok": True})


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
        return jsonify(engine.search(sfen, movetime, multipv))
    except EngineError as exc:
        return jsonify({"error": str(exc)}), 503
    except Exception:
        app.logger.exception("engine search failed")
        return jsonify({"error": "AIとの通信に失敗しました。"}), 500


@app.post("/api/think")
def think():
    return search_request(1)


@app.post("/api/analyze")
def analyze():
    if not session.get("analysis_authorized"):
        return jsonify({"error": "検討モードの認証が必要です。"}), 403
    return search_request(3)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
