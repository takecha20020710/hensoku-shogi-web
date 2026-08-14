"use strict";

const PIECE_NAMES = {
  p: "歩", l: "香", n: "桂", s: "銀", g: "金", b: "角", r: "飛", k: "玉",
  P: "と", L: "杏", N: "圭", S: "全", B: "馬", R: "龍",
};

const PROMOTE = { p: "P", l: "L", n: "N", s: "S", b: "B", r: "R" };
const UNPROMOTE = { P: "p", L: "l", N: "n", S: "s", B: "b", R: "r" };
const HAND_ORDER = ["r", "b", "g", "s", "n", "l", "p"];
const RANK_NAMES = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const FILE_NAMES = { 1: "１", 2: "２", 3: "３", 4: "４", 5: "５", 6: "６", 7: "７", 8: "８", 9: "９" };

const elements = {
  modeScreen: document.querySelector("#mode-screen"),
  gameScreen: document.querySelector("#game-screen"),
  matchModeButton: document.querySelector("#match-mode-button"),
  analysisModeButton: document.querySelector("#analysis-mode-button"),
  backToModes: document.querySelector("#back-to-modes"),
  resetGame: document.querySelector("#reset-game"),
  modeName: document.querySelector("#mode-name"),
  turnStatus: document.querySelector("#turn-status"),
  board: document.querySelector("#board"),
  blackHand: document.querySelector("#black-hand-pieces"),
  whiteHand: document.querySelector("#white-hand-pieces"),
  blackHandCount: document.querySelector("#black-hand-count"),
  whiteHandCount: document.querySelector("#white-hand-count"),
  gameMessage: document.querySelector("#game-message"),
  analysisPanel: document.querySelector("#analysis-panel"),
  moveNumber: document.querySelector("#move-number"),
  analysisToggle: document.querySelector("#analysis-toggle"),
  historyBack: document.querySelector("#history-back"),
  historyForward: document.querySelector("#history-forward"),
  analysisElapsed: document.querySelector("#analysis-elapsed"),
  analysisNodes: document.querySelector("#analysis-nodes"),
  analysisNps: document.querySelector("#analysis-nps"),
  candidates: [1, 2, 3].map((rank) => document.querySelector(`#candidate-${rank}`)),
  passwordDialog: document.querySelector("#password-dialog"),
  passwordForm: document.querySelector("#password-form"),
  passwordInput: document.querySelector("#analysis-password"),
  passwordError: document.querySelector("#password-error"),
  closePassword: document.querySelector("#close-password"),
};

let mode = null;
let board = [];
let hands = [];
let turn = 0;
let selected = null;
let selectedHand = null;
let legalTargets = [];
let lastMove = null;
let moveNumber = 0;
let gameOver = false;
let gameMessage = "";
let aiThinking = false;
let analysisRunning = false;
let history = [];
let historyIndex = -1;
let requestSerial = 0;
let analysisTimer = null;
let analysisMetricTimer = null;
let analysisStartedAt = null;
let analysisElapsedMs = 0;
let analysisNodes = 0;
let latestAnalysisNps = 0;
let hasAnalysisResult = false;


function emptyHands() {
  return [
    { p: 0, l: 0, n: 0, s: 0, g: 0, b: 0, r: 0 },
    { p: 0, l: 0, n: 0, s: 0, g: 0, b: 0, r: 0 },
  ];
}


function initialBoard() {
  const empty = () => Array(9).fill(null);
  return [
    [[1, "l"], [1, "n"], [1, "s"], [1, "g"], [1, "k"], [1, "g"], [1, "s"], [1, "n"], [1, "l"]],
    [null, [1, "r"], null, null, null, null, null, [1, "b"], null],
    Array.from({ length: 9 }, () => [1, "p"]),
    empty(),
    empty(),
    empty(),
    Array.from({ length: 9 }, () => [0, "p"]),
    [null, [0, "b"], null, null, null, null, null, [0, "r"], null],
    [[0, "l"], [0, "n"], [0, "s"], [0, "g"], [0, "k"], [0, "g"], [0, "s"], [0, "n"], [0, "l"]],
  ];
}


function cloneBoard(source) {
  return source.map((row) => row.map((piece) => (piece ? [...piece] : null)));
}


function cloneHands(source) {
  return source.map((hand) => ({ ...hand }));
}


function inBounds(row, col) {
  return row >= 0 && row < 9 && col >= 0 && col < 9;
}


function oriented(owner, directions) {
  if (owner === 0) return directions;
  return directions.map(([dr, dc]) => [-dr, -dc]);
}


function addStepTargets(targets, sourceBoard, row, col, owner, directions) {
  for (const [dr, dc] of oriented(owner, directions)) {
    const nextRow = row + dr;
    const nextCol = col + dc;
    if (!inBounds(nextRow, nextCol)) continue;
    const target = sourceBoard[nextRow][nextCol];
    if (!target || target[0] !== owner) targets.push([nextRow, nextCol]);
  }
}


function addSlideTargets(targets, sourceBoard, row, col, owner, directions) {
  for (const [dr, dc] of oriented(owner, directions)) {
    let nextRow = row + dr;
    let nextCol = col + dc;
    while (inBounds(nextRow, nextCol)) {
      const target = sourceBoard[nextRow][nextCol];
      if (!target) {
        targets.push([nextRow, nextCol]);
      } else {
        if (target[0] !== owner) targets.push([nextRow, nextCol]);
        break;
      }
      nextRow += dr;
      nextCol += dc;
    }
  }
}


function pseudoTargets(sourceBoard, row, col) {
  const piece = sourceBoard[row]?.[col];
  if (!piece) return [];
  const [owner, type] = piece;
  const targets = [];
  const gold = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0]];

  if (type === "p") addStepTargets(targets, sourceBoard, row, col, owner, [[-1, 0]]);
  else if (type === "l") addSlideTargets(targets, sourceBoard, row, col, owner, [[-1, 0]]);
  else if (type === "n") addStepTargets(targets, sourceBoard, row, col, owner, [[-2, -1], [-2, 1]]);
  else if (type === "s") addStepTargets(targets, sourceBoard, row, col, owner, [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 1]]);
  else if (["g", "P", "L", "N", "S"].includes(type)) addStepTargets(targets, sourceBoard, row, col, owner, gold);
  else if (type === "b") addSlideTargets(targets, sourceBoard, row, col, owner, [[-1, -1], [-1, 1], [1, -1], [1, 1]]);
  else if (type === "r") addSlideTargets(targets, sourceBoard, row, col, owner, [[-1, 0], [1, 0], [0, -1], [0, 1]]);
  else if (type === "k") addStepTargets(targets, sourceBoard, row, col, owner, [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]);
  else if (type === "B") {
    addSlideTargets(targets, sourceBoard, row, col, owner, [[-1, -1], [-1, 1], [1, -1], [1, 1]]);
    addStepTargets(targets, sourceBoard, row, col, owner, [[-1, 0], [1, 0], [0, -1], [0, 1]]);
  } else if (type === "R") {
    addSlideTargets(targets, sourceBoard, row, col, owner, [[-1, 0], [1, 0], [0, -1], [0, 1]]);
    addStepTargets(targets, sourceBoard, row, col, owner, [[-1, -1], [-1, 1], [1, -1], [1, 1]]);
  }
  return targets;
}


function findKing(sourceBoard, owner) {
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = sourceBoard[row][col];
      if (piece && piece[0] === owner && piece[1] === "k") return [row, col];
    }
  }
  return null;
}


function isInCheck(sourceBoard, owner) {
  const king = findKing(sourceBoard, owner);
  if (!king) return true;
  const opponent = 1 - owner;
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = sourceBoard[row][col];
      if (!piece || piece[0] !== opponent) continue;
      if (pseudoTargets(sourceBoard, row, col).some(([r, c]) => r === king[0] && c === king[1])) return true;
    }
  }
  return false;
}


function legalPieceTargets(sourceBoard, row, col) {
  const piece = sourceBoard[row]?.[col];
  if (!piece) return [];
  const owner = piece[0];
  return pseudoTargets(sourceBoard, row, col).filter(([toRow, toCol]) => {
    const target = sourceBoard[toRow][toCol];
    if (target?.[1] === "k") return false;
    const testBoard = cloneBoard(sourceBoard);
    testBoard[toRow][toCol] = testBoard[row][col];
    testBoard[row][col] = null;
    return !isInCheck(testBoard, owner);
  });
}


function hasUnpromotedPawn(sourceBoard, owner, col) {
  return sourceBoard.some((row) => row[col]?.[0] === owner && row[col]?.[1] === "p");
}


function deadDrop(type, owner, row) {
  if (type === "p" || type === "l") return owner === 0 ? row === 0 : row === 8;
  if (type === "n") return owner === 0 ? row <= 1 : row >= 7;
  return false;
}


function hasAnyLegalMove(sourceBoard, sourceHands, owner, checkPawnMate = true) {
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = sourceBoard[row][col];
      if (piece && piece[0] === owner && legalPieceTargets(sourceBoard, row, col).length) return true;
    }
  }
  for (const type of HAND_ORDER) {
    if (sourceHands[owner][type] > 0 && dropTargets(sourceBoard, sourceHands, owner, type, checkPawnMate).length) return true;
  }
  return false;
}


function dropTargets(sourceBoard, sourceHands, owner, type, checkPawnMate = true) {
  const targets = [];
  if (!sourceHands[owner] || sourceHands[owner][type] <= 0) return targets;

  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      if (sourceBoard[row][col] || deadDrop(type, owner, row)) continue;
      if (type === "p" && hasUnpromotedPawn(sourceBoard, owner, col)) continue;

      const testBoard = cloneBoard(sourceBoard);
      testBoard[row][col] = [owner, type];
      if (isInCheck(testBoard, owner)) continue;

      if (type === "p" && checkPawnMate && isInCheck(testBoard, 1 - owner)) {
        const testHands = cloneHands(sourceHands);
        testHands[owner][type] -= 1;
        if (!hasAnyLegalMove(testBoard, testHands, 1 - owner, false)) continue;
      }
      targets.push([row, col]);
    }
  }
  return targets;
}


function promotionZone(owner, row) {
  return owner === 0 ? row <= 2 : row >= 6;
}


function canPromote(type, owner, fromRow, toRow) {
  return Boolean(PROMOTE[type]) && (promotionZone(owner, fromRow) || promotionZone(owner, toRow));
}


function mustPromote(type, owner, toRow) {
  if (type === "p" || type === "l") return owner === 0 ? toRow === 0 : toRow === 8;
  if (type === "n") return owner === 0 ? toRow <= 1 : toRow >= 7;
  return false;
}


function sameSquare(a, b) {
  return Boolean(a && b && a[0] === b[0] && a[1] === b[1]);
}


function targetIncludes(targets, row, col) {
  return targets.some(([targetRow, targetCol]) => targetRow === row && targetCol === col);
}


function snapshot() {
  return {
    board: cloneBoard(board),
    hands: cloneHands(hands),
    turn,
    lastMove: lastMove ? [...lastMove] : null,
    moveNumber,
    gameOver,
    gameMessage,
  };
}


function saveHistory() {
  if (historyIndex < history.length - 1) history = history.slice(0, historyIndex + 1);
  history.push(snapshot());
  historyIndex = history.length - 1;
  updateHistoryButtons();
}


function restoreHistory(index) {
  if (index < 0 || index >= history.length) return;
  const resumeAnalysis = analysisRunning;
  window.clearTimeout(analysisTimer);
  analysisTimer = null;
  requestSerial += 1;
  const saved = history[index];
  board = cloneBoard(saved.board);
  hands = cloneHands(saved.hands);
  turn = saved.turn;
  lastMove = saved.lastMove ? [...saved.lastMove] : null;
  moveNumber = saved.moveNumber;
  gameOver = saved.gameOver;
  gameMessage = saved.gameMessage;
  selected = null;
  selectedHand = null;
  legalTargets = [];
  aiThinking = false;
  historyIndex = index;
  resetAnalysisProgress(resumeAnalysis);
  renderAll();
  if (resumeAnalysis) requestAnalysis();
}


function updateHistoryButtons() {
  elements.historyBack.disabled = historyIndex <= 0;
  elements.historyForward.disabled = historyIndex >= history.length - 1;
}


function handTotal(owner) {
  return Object.values(hands[owner]).reduce((total, count) => total + count, 0);
}


function checkGameEnd() {
  if (handTotal(0) >= 3) {
    gameOver = true;
    gameMessage = mode === "match" ? "持ち駒が3枚になりました。あなたの負けです。" : "先手の持ち駒が3枚になりました。先手の負けです。";
    return true;
  }
  if (handTotal(1) >= 3) {
    gameOver = true;
    gameMessage = mode === "match" ? "相手の持ち駒が3枚になりました。あなたの勝ちです！" : "後手の持ち駒が3枚になりました。後手の負けです。";
    return true;
  }
  if (isInCheck(board, turn) && !hasAnyLegalMove(board, hands, turn)) {
    gameOver = true;
    if (mode === "match") gameMessage = turn === 1 ? "相手の王を詰ませました。あなたの勝ちです！" : "あなたの王が詰みました。あなたの負けです。";
    else gameMessage = `${turn === 0 ? "先手" : "後手"}の王が詰みました。`;
    return true;
  }
  return false;
}


function resetPosition() {
  stopAnalysis(false);
  requestSerial += 1;
  board = initialBoard();
  hands = emptyHands();
  turn = 0;
  selected = null;
  selectedHand = null;
  legalTargets = [];
  lastMove = null;
  moveNumber = 0;
  gameOver = false;
  gameMessage = "";
  aiThinking = false;
  history = [];
  historyIndex = -1;
  resetAnalysisProgress(false);
  saveHistory();
  renderAll();
}


function startMode(nextMode) {
  mode = nextMode;
  elements.modeScreen.classList.add("is-hidden");
  elements.gameScreen.classList.remove("is-hidden");
  elements.gameScreen.classList.toggle("match-mode", mode === "match");
  elements.gameScreen.classList.toggle("analysis-mode", mode === "analysis");
  elements.analysisPanel.classList.toggle("is-hidden", mode !== "analysis");
  elements.modeName.textContent = mode === "match" ? "対局モード" : "検討モード";
  resetPosition();
}


function returnToModes() {
  stopAnalysis(false);
  requestSerial += 1;
  aiThinking = false;
  mode = null;
  elements.gameScreen.classList.add("is-hidden");
  elements.modeScreen.classList.remove("is-hidden");
}


function renderBoard() {
  elements.board.replaceChildren();
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const square = document.createElement("button");
      square.type = "button";
      square.className = "square";
      square.dataset.row = String(row);
      square.dataset.col = String(col);
      square.setAttribute("role", "gridcell");

      const piece = board[row][col];
      const file = 9 - col;
      const pieceText = piece ? `${piece[0] === 0 ? "先手" : "後手"}${PIECE_NAMES[piece[1]]}` : "空きマス";
      square.setAttribute("aria-label", `${file}筋${row + 1}段 ${pieceText}`);
      if (sameSquare(lastMove, [row, col])) square.classList.add("last-move");
      if (sameSquare(selected, [row, col])) square.classList.add("selected");
      if (targetIncludes(legalTargets, row, col)) square.classList.add(piece ? "legal-capture" : "legal-move");

      if (piece) {
        const pieceElement = document.createElement("span");
        pieceElement.className = `piece ${piece[0] === 1 ? "white" : "black"} ${UNPROMOTE[piece[1]] ? "promoted" : ""}`;
        pieceElement.textContent = PIECE_NAMES[piece[1]];
        square.append(pieceElement);
      }
      square.addEventListener("click", () => onSquareClick(row, col));
      elements.board.append(square);
    }
  }
}


function renderHand(owner, container) {
  container.replaceChildren();
  for (const type of HAND_ORDER) {
    const count = hands[owner][type];
    if (!count) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hand-piece";
    button.textContent = `${PIECE_NAMES[type]} ×${count}`;
    button.disabled = gameOver || aiThinking || owner !== turn || (mode === "match" && owner === 1);
    if (selectedHand === type && owner === turn) button.classList.add("selected");
    button.addEventListener("click", () => selectHand(owner, type));
    container.append(button);
  }
}


function renderAll() {
  renderBoard();
  renderHand(0, elements.blackHand);
  renderHand(1, elements.whiteHand);
  elements.blackHandCount.textContent = `${handTotal(0)} / 3`;
  elements.whiteHandCount.textContent = `${handTotal(1)} / 3`;
  elements.moveNumber.textContent = `現在：第${moveNumber}手目`;
  elements.gameMessage.textContent = gameMessage;

  if (gameOver) elements.turnStatus.textContent = "対局終了";
  else if (aiThinking) elements.turnStatus.textContent = "AI思考中...";
  else elements.turnStatus.textContent = turn === 0 ? "先手の番" : "後手の番";

  updateHistoryButtons();
}


function canInteract() {
  if (gameOver || aiThinking || !mode) return false;
  return !(mode === "match" && turn === 1);
}


function selectHand(owner, type) {
  if (!canInteract() || owner !== turn || hands[owner][type] <= 0) return;
  selected = null;
  if (selectedHand === type) {
    selectedHand = null;
    legalTargets = [];
  } else {
    selectedHand = type;
    legalTargets = dropTargets(board, hands, owner, type);
  }
  renderAll();
}


function onSquareClick(row, col) {
  if (!canInteract()) return;

  if (selectedHand) {
    if (targetIncludes(legalTargets, row, col)) performDrop(selectedHand, row, col);
    else {
      selectedHand = null;
      legalTargets = [];
      renderAll();
    }
    return;
  }

  if (!selected) {
    const piece = board[row][col];
    if (!piece || piece[0] !== turn) return;
    selected = [row, col];
    legalTargets = legalPieceTargets(board, row, col);
    renderAll();
    return;
  }

  if (sameSquare(selected, [row, col])) {
    selected = null;
    legalTargets = [];
    renderAll();
    return;
  }

  if (targetIncludes(legalTargets, row, col)) {
    const [fromRow, fromCol] = selected;
    performMove(fromRow, fromCol, row, col);
    return;
  }

  const piece = board[row][col];
  if (piece && piece[0] === turn) {
    selected = [row, col];
    legalTargets = legalPieceTargets(board, row, col);
  } else {
    selected = null;
    legalTargets = [];
  }
  renderAll();
}


function completeMove() {
  selected = null;
  selectedHand = null;
  legalTargets = [];
  moveNumber += 1;
  turn = 1 - turn;
  checkGameEnd();
  saveHistory();
  if (mode === "analysis") resetAnalysisProgress(analysisRunning);
  renderAll();

  if (!gameOver && mode === "match" && turn === 1) window.setTimeout(requestAiMove, 120);
  if (!gameOver && mode === "analysis" && analysisRunning) requestAnalysis();
}


function performMove(fromRow, fromCol, toRow, toCol) {
  const piece = board[fromRow][fromCol];
  if (!piece) return;
  const [owner, originalType] = piece;
  const captured = board[toRow][toCol];
  if (captured) {
    const capturedType = UNPROMOTE[captured[1]] || captured[1];
    if (capturedType !== "k") hands[owner][capturedType] += 1;
  }

  let type = originalType;
  if (mustPromote(originalType, owner, toRow)) type = PROMOTE[originalType];
  else if (canPromote(originalType, owner, fromRow, toRow) && window.confirm("成りますか？")) type = PROMOTE[originalType];

  board[toRow][toCol] = [owner, type];
  board[fromRow][fromCol] = null;
  lastMove = [toRow, toCol];
  completeMove();
}


function performDrop(type, row, col) {
  if (hands[turn][type] <= 0 || !targetIncludes(dropTargets(board, hands, turn, type), row, col)) return;
  board[row][col] = [turn, type];
  hands[turn][type] -= 1;
  lastMove = [row, col];
  completeMove();
}


function makeSfen() {
  const rows = [];
  for (let row = 0; row < 9; row += 1) {
    let text = "";
    let emptyCount = 0;
    for (let col = 0; col < 9; col += 1) {
      const piece = board[row][col];
      if (!piece) {
        emptyCount += 1;
        continue;
      }
      if (emptyCount) {
        text += String(emptyCount);
        emptyCount = 0;
      }
      const [owner, type] = piece;
      const base = UNPROMOTE[type] || type;
      const letter = owner === 0 ? base.toUpperCase() : base.toLowerCase();
      text += UNPROMOTE[type] ? `+${letter}` : letter;
    }
    if (emptyCount) text += String(emptyCount);
    rows.push(text);
  }

  let handText = "";
  for (const owner of [0, 1]) {
    for (const type of HAND_ORDER) {
      const count = hands[owner][type];
      if (!count) continue;
      const letter = owner === 0 ? type.toUpperCase() : type.toLowerCase();
      handText += `${count > 1 ? count : ""}${letter}`;
    }
  }
  return `${rows.join("/")} ${turn === 0 ? "b" : "w"} ${handText || "-"} ${Math.max(1, moveNumber + 1)}`;
}


function parseUsiSquare(text) {
  return [text.charCodeAt(1) - "a".charCodeAt(0), 9 - Number(text[0])];
}


function applyUsiMove(move) {
  if (!move || move === "resign") {
    gameOver = true;
    gameMessage = mode === "match" ? "AIが投了しました。あなたの勝ちです！" : "投了";
    saveHistory();
    renderAll();
    return;
  }
  if (move === "win") {
    gameOver = true;
    gameMessage = "AIの入玉宣言勝ちです。";
    saveHistory();
    renderAll();
    return;
  }

  if (move.includes("*")) {
    const [pieceLetter, squareText] = move.split("*");
    const [row, col] = parseUsiSquare(squareText);
    const type = pieceLetter.toLowerCase();
    if (!inBounds(row, col) || board[row][col] || hands[turn][type] <= 0) throw new Error("AIから不正な指し手が返されました。");
    board[row][col] = [turn, type];
    hands[turn][type] -= 1;
    lastMove = [row, col];
    completeMove();
    return;
  }

  const [fromRow, fromCol] = parseUsiSquare(move.slice(0, 2));
  const [toRow, toCol] = parseUsiSquare(move.slice(2, 4));
  const piece = board[fromRow]?.[fromCol];
  if (!piece || piece[0] !== turn) throw new Error("AIから不正な指し手が返されました。");
  const [owner, originalType] = piece;
  const captured = board[toRow][toCol];
  if (captured) {
    const capturedType = UNPROMOTE[captured[1]] || captured[1];
    if (capturedType !== "k") hands[owner][capturedType] += 1;
  }
  const type = move.endsWith("+") ? PROMOTE[originalType] || originalType : originalType;
  board[toRow][toCol] = [owner, type];
  board[fromRow][fromCol] = null;
  lastMove = [toRow, toCol];
  completeMove();
}


async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "通信に失敗しました。");
  return data;
}


async function requestAiMove() {
  if (gameOver || mode !== "match" || turn !== 1 || aiThinking) return;
  const serial = ++requestSerial;
  aiThinking = true;
  gameMessage = "";
  renderAll();
  try {
    const result = await postJson("/api/think", { sfen: makeSfen(), movetime: 1800 });
    if (serial !== requestSerial || mode !== "match") return;
    aiThinking = false;
    applyUsiMove(result.bestmove);
  } catch (error) {
    if (serial !== requestSerial) return;
    aiThinking = false;
    gameMessage = error.message;
    renderAll();
  }
}


function scoreText(candidate) {
  if (candidate.score_type === "mate") return candidate.score == null ? "詰み" : `詰み ${candidate.score}`;
  if (candidate.score_type === "cp" && candidate.score != null) return `評価 ${(candidate.score / 100).toFixed(2).replace(/^(-?)/, "$1+").replace("-+", "-")}`;
  return "評価 --";
}


function japaneseMove(move, sourceBoard, previousDestination = null) {
  if (move.includes("*")) {
    const [pieceLetter, squareText] = move.split("*");
    const [row] = parseUsiSquare(squareText);
    const file = Number(squareText[0]);
    return `${FILE_NAMES[file]}${RANK_NAMES[row]}${PIECE_NAMES[pieceLetter.toLowerCase()]}打`;
  }
  const [fromRow, fromCol] = parseUsiSquare(move.slice(0, 2));
  const [toRow, toCol] = parseUsiSquare(move.slice(2, 4));
  const piece = sourceBoard[fromRow]?.[fromCol];
  if (!piece) return move;
  const destination = sameSquare(previousDestination, [toRow, toCol]) ? "同" : `${FILE_NAMES[9 - toCol]}${RANK_NAMES[toRow]}`;
  return `${destination}${PIECE_NAMES[piece[1]]}${move.endsWith("+") ? "成" : ""}`;
}


function applyVirtualMove(sourceBoard, sourceHands, virtualTurn, move) {
  if (move.includes("*")) {
    const [pieceLetter, squareText] = move.split("*");
    const [row, col] = parseUsiSquare(squareText);
    const type = pieceLetter.toLowerCase();
    if (sourceHands[virtualTurn][type] > 0) sourceHands[virtualTurn][type] -= 1;
    sourceBoard[row][col] = [virtualTurn, type];
    return [row, col];
  }
  const [fromRow, fromCol] = parseUsiSquare(move.slice(0, 2));
  const [toRow, toCol] = parseUsiSquare(move.slice(2, 4));
  const piece = sourceBoard[fromRow]?.[fromCol];
  if (!piece) return null;
  const captured = sourceBoard[toRow][toCol];
  if (captured) {
    const capturedType = UNPROMOTE[captured[1]] || captured[1];
    if (capturedType !== "k") sourceHands[virtualTurn][capturedType] += 1;
  }
  const type = move.endsWith("+") ? PROMOTE[piece[1]] || piece[1] : piece[1];
  sourceBoard[toRow][toCol] = [virtualTurn, type];
  sourceBoard[fromRow][fromCol] = null;
  return [toRow, toCol];
}


function pvToJapanese(pv) {
  const virtualBoard = cloneBoard(board);
  const virtualHands = cloneHands(hands);
  let virtualTurn = turn;
  let previousDestination = null;
  const result = [];
  for (const move of pv) {
    result.push(japaneseMove(move, virtualBoard, previousDestination));
    previousDestination = applyVirtualMove(virtualBoard, virtualHands, virtualTurn, move);
    if (!previousDestination) break;
    virtualTurn = 1 - virtualTurn;
  }
  return result.join(" ");
}


function renderCandidates(candidates) {
  for (let index = 0; index < 3; index += 1) {
    const candidate = candidates[index];
    if (!candidate) {
      elements.candidates[index].textContent = "候補なし";
      continue;
    }
    const firstMove = japaneseMove(candidate.pv[0], board);
    const depth = candidate.depth == null ? "--" : candidate.depth;
    elements.candidates[index].textContent = `${firstMove} ${scoreText(candidate)} 深さ ${depth}\n→ ${pvToJapanese(candidate.pv)}`;
  }
}


function clearCandidates(text) {
  for (const candidate of elements.candidates) candidate.textContent = text;
}


function formatNodeCount(value) {
  const nodes = Math.max(0, Math.floor(Number(value) || 0));
  if (nodes >= 100_000_000) return `${(nodes / 100_000_000).toFixed(nodes >= 1_000_000_000 ? 1 : 2)}億局面`;
  if (nodes >= 10_000) return `${(nodes / 10_000).toFixed(nodes >= 10_000_000 ? 0 : 1)}万局面`;
  return `${nodes.toLocaleString("ja-JP")}局面`;
}


function formatNodeSpeed(value) {
  return `${formatNodeCount(value).replace("局面", "")}局面/秒`;
}


function updateAnalysisMetrics() {
  let elapsed = analysisElapsedMs;
  if (analysisRunning && analysisStartedAt != null) elapsed += performance.now() - analysisStartedAt;
  elements.analysisElapsed.textContent = `${(elapsed / 1000).toFixed(1)}秒`;
  elements.analysisNodes.textContent = formatNodeCount(analysisNodes);
  elements.analysisNps.textContent = formatNodeSpeed(latestAnalysisNps);
}


function resetAnalysisProgress(running = analysisRunning) {
  analysisElapsedMs = 0;
  analysisNodes = 0;
  latestAnalysisNps = 0;
  hasAnalysisResult = false;
  analysisStartedAt = running ? performance.now() : null;
  clearCandidates(running ? "解析中..." : "解析待機中");
  updateAnalysisMetrics();
}


function startMetricTimer() {
  window.clearInterval(analysisMetricTimer);
  analysisMetricTimer = window.setInterval(updateAnalysisMetrics, 100);
  updateAnalysisMetrics();
}


async function requestAnalysis() {
  if (!analysisRunning || gameOver || mode !== "analysis") return;
  window.clearTimeout(analysisTimer);
  const serial = ++requestSerial;
  if (!hasAnalysisResult) clearCandidates("解析中...");
  try {
    const result = await postJson("/api/analyze", { sfen: makeSfen(), movetime: 1500 });
    if (serial !== requestSerial || !analysisRunning || mode !== "analysis") return;
    analysisNodes += Math.max(0, Number(result.nodes) || 0);
    latestAnalysisNps = Math.max(0, Number(result.nps) || 0);
    hasAnalysisResult = true;
    renderCandidates(result.candidates || []);
    updateAnalysisMetrics();
    // Start the next search immediately. The old 450 ms pause wasted almost
    // one quarter of Render Free's already limited CPU time.
    analysisTimer = window.setTimeout(requestAnalysis, 0);
  } catch (error) {
    if (serial !== requestSerial) return;
    clearCandidates(error.message);
    stopAnalysis(false);
  }
}


function startAnalysis() {
  if (gameOver || mode !== "analysis" || analysisRunning) return;
  analysisRunning = true;
  resetAnalysisProgress(true);
  startMetricTimer();
  elements.analysisToggle.textContent = "■";
  elements.analysisToggle.setAttribute("aria-label", "検討停止");
  requestAnalysis();
}


function stopAnalysis(showWaiting = true) {
  if (analysisRunning && analysisStartedAt != null) {
    analysisElapsedMs += performance.now() - analysisStartedAt;
  }
  analysisRunning = false;
  analysisStartedAt = null;
  window.clearTimeout(analysisTimer);
  analysisTimer = null;
  window.clearInterval(analysisMetricTimer);
  analysisMetricTimer = null;
  requestSerial += 1;
  elements.analysisToggle.textContent = "▶";
  elements.analysisToggle.setAttribute("aria-label", "検討開始");
  updateAnalysisMetrics();
  if (showWaiting && mode === "analysis" && !hasAnalysisResult) clearCandidates("解析停止中");
}


async function openAnalysisMode() {
  try {
    const response = await fetch("/api/auth-status");
    const data = await response.json();
    if (data.authorized) {
      startMode("analysis");
      return;
    }
  } catch (_) {
    // パスワード入力へ進む
  }
  elements.passwordError.textContent = "";
  elements.passwordInput.value = "";
  elements.passwordDialog.showModal();
  window.setTimeout(() => elements.passwordInput.focus(), 0);
}


elements.matchModeButton.addEventListener("click", () => startMode("match"));
elements.analysisModeButton.addEventListener("click", openAnalysisMode);
elements.backToModes.addEventListener("click", returnToModes);
elements.resetGame.addEventListener("click", resetPosition);
elements.historyBack.addEventListener("click", () => restoreHistory(historyIndex - 1));
elements.historyForward.addEventListener("click", () => restoreHistory(historyIndex + 1));
elements.analysisToggle.addEventListener("click", () => (analysisRunning ? stopAnalysis() : startAnalysis()));
elements.closePassword.addEventListener("click", () => elements.passwordDialog.close());
elements.passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.passwordError.textContent = "";
  try {
    await postJson("/api/login", { password: elements.passwordInput.value });
    elements.passwordDialog.close();
    startMode("analysis");
  } catch (error) {
    elements.passwordError.textContent = error.message;
    elements.passwordInput.select();
  }
});

elements.passwordDialog.addEventListener("cancel", () => {
  elements.passwordError.textContent = "";
});

updateHistoryButtons();
