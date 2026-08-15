import os
from unittest.mock import ANY, patch

os.environ.setdefault("OPENING_ADMIN_PASSWORD", "test-password")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("VARIANT_PAWN_EVAL", "true")

import app as webapp
from opening_book import OpeningBook, OpeningBookError


START_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1"


def test_valid_sfen():
    assert webapp.valid_sfen(START_SFEN)
    assert not webapp.valid_sfen("not-sfen")
    assert not webapp.valid_sfen("9/9/9/9/9/9/9/9/8 b - 1")


def test_parse_engine_info_includes_nodes():
    parsed = webapp.YaneuraOu._parse_info(
        "info depth 18 seldepth 27 multipv 2 score cp 134 nodes 10000000 nps 420000 pv 7g7f 3c3d"
    )
    assert parsed["depth"] == 18
    assert parsed["multipv"] == 2
    assert parsed["nodes"] == 10_000_000
    assert parsed["nps"] == 420_000
    assert parsed["pv"] == ["7g7f", "3c3d"]


def test_index_and_health():
    client = webapp.app.test_client()
    page = client.get("/")
    assert page.status_code == 200
    assert b'analysis-elapsed' in page.data
    assert b'analysis-nodes' in page.data
    assert b'analysis-nps' in page.data
    assert b'history-start' in page.data
    assert b'history-end' in page.data
    assert b'flip-board' in page.data
    assert b'evaluation-bar' in page.data
    assert b'evaluation-graph' in page.data
    assert b'candidate-score-1' in page.data
    assert b'move-arrows' in page.data
    assert b'copy-kifu' in page.data
    assert b'paste-kifu' in page.data
    assert b'kifu-dialog' in page.data
    assert b'opening-manager' in page.data
    assert b'opening-admin-login-dialog' in page.data
    assert b'choose-sente' in page.data
    assert b'choose-gote' in page.data
    assert b'post-game-analysis-dialog' in page.data
    assert "思考エンジン" not in page.get_data(as_text=True)
    health = client.get("/api/health").get_json()
    assert health["ok"] is True
    assert health["threads"] == 1
    assert health["hash_mb"] == 128
    assert health["engine_target"] in ("SSE42", "AVX2")
    assert health["variant_pawn_eval"] is True
    assert health["variant_pawn_eval_version"] == 1


def test_analysis_is_public_and_admin_is_separate():
    client = webapp.app.test_client()
    assert client.get("/api/auth-status").get_json() == {"authorized": True, "opening_admin": False}
    result = {"bestmove": "7g7f", "candidates": []}
    with patch.object(webapp.engine, "search", return_value=result):
        response = client.post("/api/analyze", json={"sfen": START_SFEN, "movetime": 800})
    assert response.status_code == 200


def test_think_uses_engine():
    client = webapp.app.test_client()
    result = {"bestmove": "7g7f", "candidates": []}
    with patch.object(webapp.engine, "search", return_value=result) as search:
        response = client.post("/api/think", json={"sfen": START_SFEN, "movetime": 800})
    assert response.status_code == 200
    assert response.get_json()["bestmove"] == "7g7f"
    search.assert_called_once_with(START_SFEN, 800, 1, ANY)


def test_evaluate_uses_single_pv_engine_search():
    client = webapp.app.test_client()
    result = {"bestmove": "7g7f", "candidates": [{"score_type": "cp", "score": 25, "pv": ["7g7f"]}]}
    with patch.object(webapp.engine, "search", return_value=result) as search:
        response = client.post("/api/evaluate", json={"sfen": START_SFEN, "movetime": 350})
    assert response.status_code == 200
    search.assert_called_once_with(START_SFEN, 350, 1, ANY)


def test_opening_move_routes_and_deviation():
    client = webapp.app.test_client()
    webapp.opening_book.loaded = True
    webapp.opening_book.lines = []

    base = ["2g2f", "5c5d", "2f2e", "8b5b", "2e2d"]
    assert client.post("/api/opening-move", json={"ai_side": 1, "history": base}).get_json()["move"] == "5d5e"
    assert client.post(
        "/api/opening-move",
        json={"ai_side": 1, "history": base + ["5d5e", "2d2c+"]},
    ).get_json()["move"] == "5e5f"

    through_ten = base + ["5d5e", "2d2c+", "5e5f", "5g5f", "3a3b"]
    assert client.post(
        "/api/opening-move",
        json={"ai_side": 1, "history": through_ten + ["P*2d"]},
    ).get_json()["move"] == "3b2c"
    assert client.post(
        "/api/opening-move",
        json={"ai_side": 1, "history": through_ten + ["2c2d"]},
    ).get_json()["move"] == "5b5f"
    assert client.post(
        "/api/opening-move",
        json={"ai_side": 1, "history": through_ten + ["2c2d", "5b5f", "P*5g"]},
    ).get_json()["move"] == "P*5h"
    assert client.post(
        "/api/opening-move",
        json={"ai_side": 1, "history": through_ten + ["P*4d"]},
    ).get_json()["move"] is None


def test_opening_admin_requires_login_and_lists_lines():
    client = webapp.app.test_client()
    assert client.get("/api/opening-admin/lines").status_code == 403
    with client.session_transaction() as session:
        session["opening_admin_authorized"] = True
    assert client.get("/api/opening-admin/lines").status_code == 403
    assert client.post("/api/opening-admin/login", json={"password": "test-password"}).status_code == 200
    webapp.opening_book.loaded = True
    webapp.opening_book.lines = []
    response = client.get("/api/opening-admin/lines")
    assert response.status_code == 200
    lines = response.get_json()["lines"]
    assert len(lines) == 9
    assert all(line["built_in"] is True for line in lines)
    with patch.object(webapp, "OPENING_ADMIN_PASSWORD", "changed-password"):
        assert client.get("/api/opening-admin/lines").status_code == 403


def test_opening_book_rejects_conflicting_ai_move():
    book = OpeningBook()
    book.loaded = True
    book.lines = []
    with patch.object(book, "_persist"):
        try:
            book.add_line("競合する定跡", 1, ["2g2f", "5c5e"])
        except OpeningBookError as exc:
            assert "2手目" in str(exc)
            assert "5c5d" in str(exc)
            assert "5c5e" in str(exc)
        else:
            raise AssertionError("AI手が競合する定跡を登録できてしまいました。")


def test_opening_book_allows_new_player_branch_with_same_ai_moves():
    book = OpeningBook()
    book.loaded = True
    book.lines = []
    moves = ["2g2f", "5c5d", "2f2e", "8b5b"]
    with patch.object(book, "_persist"):
        added = book.add_line("既存AI手と一致", 1, moves)
    assert added["moves"] == moves
