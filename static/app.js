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
const KIF_RANKS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const KIF_PIECES = {
  歩: "p", 香: "l", 桂: "n", 銀: "s", 金: "g", 角: "b", 飛: "r", 玉: "k", 王: "k",
  と: "P", 杏: "L", 成香: "L", 圭: "N", 成桂: "N", 全: "S", 成銀: "S", 馬: "B", 龍: "R", 竜: "R",
};
const CSA_PIECES = {
  FU: "p", KY: "l", KE: "n", GI: "s", KI: "g", KA: "b", HI: "r", OU: "k",
  TO: "P", NY: "L", NK: "N", NG: "S", UM: "B", RY: "R",
};
const SVG_NS = "http://www.w3.org/2000/svg";

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
  arrowLines: document.querySelector("#arrow-lines"),
  blackHand: document.querySelector("#black-hand-pieces"),
  whiteHand: document.querySelector("#white-hand-pieces"),
  blackHandCount: document.querySelector("#black-hand-count"),
  whiteHandCount: document.querySelector("#white-hand-count"),
  gameMessage: document.querySelector("#game-message"),
  analysisPanel: document.querySelector("#analysis-panel"),
  moveNumber: document.querySelector("#move-number"),
  analysisToggle: document.querySelector("#analysis-toggle"),
  historyStart: document.querySelector("#history-start"),
  historyBack: document.querySelector("#history-back"),
  historyForward: document.querySelector("#history-forward"),
  historyEnd: document.querySelector("#history-end"),
  analysisElapsed: document.querySelector("#analysis-elapsed"),
  analysisNodes: document.querySelector("#analysis-nodes"),
  analysisNps: document.querySelector("#analysis-nps"),
  evaluationBar: document.querySelector("#evaluation-bar"),
  sentePercentage: document.querySelector("#sente-percentage"),
  gotePercentage: document.querySelector("#gote-percentage"),
  candidates: [1, 2, 3].map((rank) => ({
    row: document.querySelector(`#candidate-row-${rank}`),
    score: document.querySelector(`#candidate-score-${rank}`),
    move: document.querySelector(`#candidate-move-${rank}`),
    pv: document.querySelector(`#candidate-pv-${rank}`),
  })),
  copyKifu: document.querySelector("#copy-kifu"),
  pasteKifu: document.querySelector("#paste-kifu"),
  openingManager: document.querySelector("#opening-manager"),
  kifuDialog: document.querySelector("#kifu-dialog"),
  closeKifu: document.querySelector("#close-kifu"),
  kifuText: document.querySelector("#kifu-text"),
  kifuStatus: document.querySelector("#kifu-status"),
  loadKifu: document.querySelector("#load-kifu"),
  copyKifuText: document.querySelector("#copy-kifu-text"),
  sideDialog: document.querySelector("#side-dialog"),
  chooseSente: document.querySelector("#choose-sente"),
  chooseGote: document.querySelector("#choose-gote"),
  closeSide: document.querySelector("#close-side"),
  openingAdminLoginDialog: document.querySelector("#opening-admin-login-dialog"),
  openingAdminLoginForm: document.querySelector("#opening-admin-login-form"),
  openingAdminPassword: document.querySelector("#opening-admin-password"),
  openingAdminLoginError: document.querySelector("#opening-admin-login-error"),
  closeOpeningAdminLogin: document.querySelector("#close-opening-admin-login"),
  openingManagerDialog: document.querySelector("#opening-manager-dialog"),
  closeOpeningManager: document.querySelector("#close-opening-manager"),
  openingName: document.querySelector("#opening-name"),
  openingAiSide: document.querySelector("#opening-ai-side"),
  openingCurrentLine: document.querySelector("#opening-current-line"),
  registerOpeningLine: document.querySelector("#register-opening-line"),
  openingManagerStatus: document.querySelector("#opening-manager-status"),
  openingStorageStatus: document.querySelector("#opening-storage-status"),
  openingLineList: document.querySelector("#opening-line-list"),
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
let humanSide = 0;
let analysisRunning = false;
let history = [];
let historyIndex = -1;
let requestSerial = 0;
let analysisTimer = null;
let analysisMetricTimer = null;
let analysisAbortController = null;
let analysisStartedAt = null;
let analysisElapsedMs = 0;
let analysisNodes = 0;
let latestAnalysisNps = 0;
let hasAnalysisResult = false;
let latestCandidates = [];
let moveList = [];
let managedOpeningLines = [];
let openingPersistenceReady = false;


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
    moveList: [...moveList],
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
  cancelAnalysisRequest();
  requestSerial += 1;
  const saved = history[index];
  board = cloneBoard(saved.board);
  hands = cloneHands(saved.hands);
  turn = saved.turn;
  lastMove = saved.lastMove ? [...saved.lastMove] : null;
  moveNumber = saved.moveNumber;
  moveList = [...(saved.moveList || [])];
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
  const atStart = historyIndex <= 0;
  const atEnd = historyIndex >= history.length - 1;
  elements.historyStart.disabled = atStart;
  elements.historyBack.disabled = atStart;
  elements.historyForward.disabled = atEnd;
  elements.historyEnd.disabled = atEnd;
}


function handTotal(owner) {
  return Object.values(hands[owner]).reduce((total, count) => total + count, 0);
}


function aiSide() {
  return 1 - humanSide;
}


function isAiTurn() {
  return mode === "match" && turn === aiSide();
}


async function fixedAiOpeningMove() {
  try {
    const result = await postJson("/api/opening-move", { ai_side: aiSide(), history: moveList });
    return typeof result.move === "string" ? result.move : null;
  } catch (_) {
    // 定跡照合だけが失敗した場合は、対局を止めず通常エンジンへ切り替える。
    return null;
  }
}


function matchResult(loser, humanLossMessage, aiLossMessage) {
  return loser === humanSide ? humanLossMessage : aiLossMessage;
}


function checkGameEnd() {
  if (handTotal(0) >= 3) {
    gameOver = true;
    gameMessage = mode === "match"
      ? matchResult(0, "持ち駒が3枚になりました。あなたの負けです。", "AIの持ち駒が3枚になりました。あなたの勝ちです！")
      : "先手の持ち駒が3枚になりました。先手の負けです。";
    return true;
  }
  if (handTotal(1) >= 3) {
    gameOver = true;
    gameMessage = mode === "match"
      ? matchResult(1, "持ち駒が3枚になりました。あなたの負けです。", "AIの持ち駒が3枚になりました。あなたの勝ちです！")
      : "後手の持ち駒が3枚になりました。後手の負けです。";
    return true;
  }
  if (isInCheck(board, turn) && !hasAnyLegalMove(board, hands, turn)) {
    gameOver = true;
    if (mode === "match") {
      gameMessage = matchResult(turn, "あなたの王が詰みました。あなたの負けです。", "AIの王を詰ませました。あなたの勝ちです！");
    }
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
  moveList = [];
  gameOver = false;
  gameMessage = "";
  aiThinking = false;
  history = [];
  historyIndex = -1;
  resetAnalysisProgress(false);
  saveHistory();
  renderAll();
  if (isAiTurn()) window.setTimeout(requestAiMove, 120);
}


function startMode(nextMode) {
  mode = nextMode;
  elements.modeScreen.classList.add("is-hidden");
  elements.gameScreen.classList.remove("is-hidden");
  elements.gameScreen.classList.toggle("match-mode", mode === "match");
  elements.gameScreen.classList.toggle("analysis-mode", mode === "analysis");
  elements.gameScreen.classList.toggle("gote-player", mode === "match" && humanSide === 1);
  elements.analysisPanel.classList.toggle("is-hidden", mode !== "analysis");
  elements.modeName.textContent = mode === "match" ? `対局モード（${humanSide === 0 ? "先手" : "後手"}）` : "検討モード";
  resetPosition();
}


function startMatch(side) {
  humanSide = side;
  elements.sideDialog.close();
  startMode("match");
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
  const flipped = mode === "match" && humanSide === 1;
  elements.board.classList.toggle("flipped", flipped);
  for (let displayRow = 0; displayRow < 9; displayRow += 1) {
    const row = flipped ? 8 - displayRow : displayRow;
    for (let displayCol = 0; displayCol < 9; displayCol += 1) {
      const col = flipped ? 8 - displayCol : displayCol;
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
  renderCandidateArrows();
}


function displaySquare(row, col) {
  const flipped = mode === "match" && humanSide === 1;
  return flipped ? [8 - row, 8 - col] : [row, col];
}


function renderCandidateArrows() {
  elements.arrowLines.replaceChildren();
  if (mode !== "analysis") return;

  for (let index = 0; index < Math.min(2, latestCandidates.length); index += 1) {
    const move = latestCandidates[index]?.pv?.[0];
    if (!move || move === "resign" || move === "win") continue;
    const styleName = index === 0 ? "best" : "second";

    if (move.includes("*")) {
      const [, squareText] = move.split("*");
      const [row, col] = displaySquare(...parseUsiSquare(squareText));
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", String(col + 0.5));
      circle.setAttribute("cy", String(row + 0.5));
      circle.setAttribute("r", index === 0 ? "0.34" : "0.25");
      circle.setAttribute("class", `candidate-drop ${styleName}`);
      elements.arrowLines.append(circle);
      continue;
    }

    const [sourceRow, sourceCol] = displaySquare(...parseUsiSquare(move.slice(0, 2)));
    const [targetRow, targetCol] = displaySquare(...parseUsiSquare(move.slice(2, 4)));
    const dx = targetCol - sourceCol;
    const dy = targetRow - sourceRow;
    const distance = Math.hypot(dx, dy) || 1;
    const shortenStart = 0.16;
    const shortenEnd = 0.28;
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(sourceCol + 0.5 + (dx / distance) * shortenStart));
    line.setAttribute("y1", String(sourceRow + 0.5 + (dy / distance) * shortenStart));
    line.setAttribute("x2", String(targetCol + 0.5 - (dx / distance) * shortenEnd));
    line.setAttribute("y2", String(targetRow + 0.5 - (dy / distance) * shortenEnd));
    line.setAttribute("class", `candidate-arrow ${styleName}`);
    elements.arrowLines.append(line);
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
    button.disabled = gameOver || aiThinking || owner !== turn || (mode === "match" && owner !== humanSide);
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
  return !(mode === "match" && turn !== humanSide);
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


function completeMove(usiMove = null) {
  selected = null;
  selectedHand = null;
  legalTargets = [];
  if (usiMove) moveList.push(usiMove);
  moveNumber += 1;
  turn = 1 - turn;
  checkGameEnd();
  saveHistory();
  if (mode === "analysis") resetAnalysisProgress(analysisRunning);
  renderAll();

  if (!gameOver && isAiTurn()) window.setTimeout(requestAiMove, 120);
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
  const promotion = type !== originalType ? "+" : "";
  completeMove(`${toUsiSquare(fromRow, fromCol)}${toUsiSquare(toRow, toCol)}${promotion}`);
}


function performDrop(type, row, col) {
  if (hands[turn][type] <= 0 || !targetIncludes(dropTargets(board, hands, turn, type), row, col)) return;
  board[row][col] = [turn, type];
  hands[turn][type] -= 1;
  lastMove = [row, col];
  completeMove(`${type.toUpperCase()}*${toUsiSquare(row, col)}`);
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


function toUsiSquare(row, col) {
  return `${9 - col}${String.fromCharCode("a".charCodeAt(0) + row)}`;
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
    completeMove(move);
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
  completeMove(move);
}


async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "通信に失敗しました。");
    error.status = response.status;
    throw error;
  }
  return data;
}


function getJson(url) {
  return requestJson(url);
}


function postJson(url, body, signal = null) {
  return requestJson(url, { method: "POST", body: JSON.stringify(body), signal });
}


function deleteJson(url) {
  return requestJson(url, { method: "DELETE" });
}


async function requestAiMove() {
  if (gameOver || mode !== "match" || turn !== aiSide() || aiThinking) return;
  const serial = ++requestSerial;
  aiThinking = true;
  gameMessage = "";
  renderAll();
  try {
    const openingMove = await fixedAiOpeningMove();
    if (serial !== requestSerial || mode !== "match") return;
    if (openingMove) {
      if (!isLegalStateMove(board, hands, turn, openingMove)) throw new Error(`固定序盤の指し手が不正です：${openingMove}`);
      aiThinking = false;
      applyUsiMove(openingMove);
      return;
    }
    const result = await postJson("/api/think", { sfen: makeSfen(), movetime: 5000 });
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
  if (candidate.score_type === "mate") {
    const mateMoves = Number(candidate.score);
    if (!Number.isFinite(mateMoves)) return "詰み";
    const winner = mateMoves > 0 ? turn : 1 - turn;
    return `${winner === 0 ? "先手" : "後手"}勝ち（${Math.abs(mateMoves)}手）`;
  }
  if (candidate.score_type === "cp" && candidate.score != null) {
    const engineScore = Number(candidate.score);
    if (!Number.isFinite(engineScore)) return "--";
    const senteScore = turn === 0 ? engineScore : -engineScore;
    return `${senteScore >= 0 ? "+" : ""}${Math.round(senteScore)}`;
  }
  return "--";
}


function evaluationPercentage(candidate) {
  if (!candidate) return 50;
  if (candidate.score_type === "mate") {
    const mateMoves = Number(candidate.score);
    if (!Number.isFinite(mateMoves)) return 50;
    const winner = mateMoves > 0 ? turn : 1 - turn;
    return winner === 0 ? 100 : 0;
  }
  if (candidate.score_type !== "cp") return 50;
  const engineScore = Number(candidate.score);
  if (!Number.isFinite(engineScore)) return 50;
  const senteScore = turn === 0 ? engineScore : -engineScore;
  // +76がおよそ52%になる、一般的な将棋ソフトに近い緩やかな換算。
  return Math.max(1, Math.min(99, 100 / (1 + Math.exp(-senteScore / 900))));
}


function updateEvaluationBar(candidate = null) {
  const sente = evaluationPercentage(candidate);
  const roundedSente = Math.round(sente);
  const roundedGote = 100 - roundedSente;
  elements.evaluationBar.value = sente;
  elements.evaluationBar.textContent = `${roundedSente}%`;
  elements.sentePercentage.textContent = `▲ ${roundedSente}%`;
  elements.gotePercentage.textContent = `△ ${roundedGote}%`;
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
    result.push(`${virtualTurn === 0 ? "▲" : "△"}${japaneseMove(move, virtualBoard, previousDestination)}`);
    previousDestination = applyVirtualMove(virtualBoard, virtualHands, virtualTurn, move);
    if (!previousDestination) break;
    virtualTurn = 1 - virtualTurn;
  }
  return result;
}


function renderCandidates(candidates) {
  latestCandidates = candidates.filter((candidate) => Array.isArray(candidate?.pv) && candidate.pv.length);
  for (let index = 0; index < 3; index += 1) {
    const candidate = candidates[index];
    const cells = elements.candidates[index];
    if (!candidate) {
      cells.score.textContent = "--";
      cells.move.textContent = "候補なし";
      cells.pv.textContent = "";
      cells.row.removeAttribute("title");
      continue;
    }
    const line = pvToJapanese(candidate.pv || []);
    cells.score.textContent = scoreText(candidate);
    cells.move.textContent = line[0] || "候補なし";
    cells.pv.textContent = line.slice(1).join(" ") || "—";
    const depth = candidate.depth == null ? "--" : candidate.depth;
    cells.row.title = `深さ ${depth}`;
  }
  updateEvaluationBar(candidates[0]);
  renderCandidateArrows();
}


function clearCandidates(text) {
  latestCandidates = [];
  for (const candidate of elements.candidates) {
    candidate.score.textContent = "--";
    candidate.move.textContent = text;
    candidate.pv.textContent = "";
    candidate.row.removeAttribute("title");
  }
  updateEvaluationBar();
  renderCandidateArrows();
}


function moveDestination(move) {
  const squareText = move.includes("*") ? move.split("*")[1] : move.slice(2, 4);
  return parseUsiSquare(squareText);
}


function isLegalStateMove(sourceBoard, sourceHands, owner, move) {
  if (typeof move !== "string") return false;
  if (move.includes("*")) {
    const match = move.match(/^([PLNSGBR])\*([1-9][a-i])$/i);
    if (!match) return false;
    const type = match[1].toLowerCase();
    const [row, col] = parseUsiSquare(match[2]);
    return dropTargets(sourceBoard, sourceHands, owner, type).some(([r, c]) => r === row && c === col);
  }

  const match = move.match(/^([1-9][a-i])([1-9][a-i])(\+?)$/);
  if (!match) return false;
  const [fromRow, fromCol] = parseUsiSquare(match[1]);
  const [toRow, toCol] = parseUsiSquare(match[2]);
  const piece = sourceBoard[fromRow]?.[fromCol];
  if (!piece || piece[0] !== owner) return false;
  if (!legalPieceTargets(sourceBoard, fromRow, fromCol).some(([r, c]) => r === toRow && c === toCol)) return false;
  if (match[3] && !canPromote(piece[1], owner, fromRow, toRow)) return false;
  if (!match[3] && mustPromote(piece[1], owner, toRow)) return false;
  return true;
}


function normalizeKifuText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
}


function filterDirectionalSources(sources, notation, owner, toRow) {
  let filtered = [...sources];
  if (notation.includes("直")) filtered = filtered.filter(({ row, col, toCol }) => col === toCol);
  if (notation.includes("寄")) filtered = filtered.filter(({ row }) => row === toRow);
  if (notation.includes("上")) filtered = filtered.filter(({ row }) => (owner === 0 ? row > toRow : row < toRow));
  if (notation.includes("引")) filtered = filtered.filter(({ row }) => (owner === 0 ? row < toRow : row > toRow));

  if (filtered.length > 1 && (notation.includes("右") || notation.includes("左"))) {
    const columns = filtered.map(({ col }) => col);
    const rightColumn = owner === 0 ? Math.max(...columns) : Math.min(...columns);
    const leftColumn = owner === 0 ? Math.min(...columns) : Math.max(...columns);
    const chosenColumn = notation.includes("右") ? rightColumn : leftColumn;
    filtered = filtered.filter(({ col }) => col === chosenColumn);
  }
  return filtered;
}


function parseJapaneseMove(rawNotation, sourceBoard, sourceHands, owner, previousDestination) {
  let notation = normalizeKifuText(rawNotation)
    .replace(/^[▲△☗☖]/, "")
    .replace(/\s+/g, "")
    .replace(/まで.*$/, "");
  const originMatch = notation.match(/\(([0-9])([0-9])\)/);
  notation = notation.replace(/\(\s*\d+:\d+[\s\S]*$/, "");
  notation = notation.replace(/\([0-9][0-9]\)/, "");

  let toRow;
  let toCol;
  if (notation.startsWith("同")) {
    if (!previousDestination) throw new Error("「同」の移動先を特定できません。");
    [toRow, toCol] = previousDestination;
    notation = notation.slice(1);
  } else {
    const destination = notation.match(/^([1-9])([1-9一二三四五六七八九])/);
    if (!destination) throw new Error(`移動先を読み取れません：${rawNotation}`);
    const file = Number(destination[1]);
    const rank = Number(destination[2]) || KIF_RANKS[destination[2]];
    toRow = rank - 1;
    toCol = 9 - file;
    notation = notation.slice(destination[0].length);
  }

  const pieceName = Object.keys(KIF_PIECES)
    .sort((a, b) => b.length - a.length)
    .find((name) => notation.startsWith(name));
  if (!pieceName) throw new Error(`駒名を読み取れません：${rawNotation}`);
  const writtenType = KIF_PIECES[pieceName];
  notation = notation.slice(pieceName.length);
  const promotes = notation.includes("成") && !notation.includes("不成") && !UNPROMOTE[writtenType];
  const sourceType = promotes ? writtenType : writtenType;
  const isDrop = notation.includes("打") || (originMatch && originMatch[1] === "0" && originMatch[2] === "0");

  if (isDrop) {
    const type = (UNPROMOTE[sourceType] || sourceType).toLowerCase();
    const move = `${type.toUpperCase()}*${toUsiSquare(toRow, toCol)}`;
    if (!isLegalStateMove(sourceBoard, sourceHands, owner, move)) throw new Error(`打ち場所が不正です：${rawNotation}`);
    return move;
  }

  let fromRow;
  let fromCol;
  if (originMatch) {
    const fromFile = Number(originMatch[1]);
    const fromRank = Number(originMatch[2]);
    fromRow = fromRank - 1;
    fromCol = 9 - fromFile;
  } else {
    const candidates = [];
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        const piece = sourceBoard[row][col];
        if (!piece || piece[0] !== owner || piece[1] !== sourceType) continue;
        if (legalPieceTargets(sourceBoard, row, col).some(([r, c]) => r === toRow && c === toCol)) {
          candidates.push({ row, col, toCol });
        }
      }
    }
    const filtered = filterDirectionalSources(candidates, notation, owner, toRow);
    if (filtered.length !== 1) throw new Error(`移動元を特定できません：${rawNotation}`);
    [{ row: fromRow, col: fromCol }] = filtered;
  }

  const piece = sourceBoard[fromRow]?.[fromCol];
  if (!piece || piece[0] !== owner || piece[1] !== sourceType) throw new Error(`移動元の駒が一致しません：${rawNotation}`);
  const move = `${toUsiSquare(fromRow, fromCol)}${toUsiSquare(toRow, toCol)}${promotes ? "+" : ""}`;
  if (!isLegalStateMove(sourceBoard, sourceHands, owner, move)) throw new Error(`指し手が不正です：${rawNotation}`);
  return move;
}


function parseCsaMoves(text) {
  const moves = [];
  const virtualBoard = initialBoard();
  const virtualHands = emptyHands();
  let virtualTurn = 0;
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^([+-])([0-9]{2})([0-9]{2})([A-Z]{2})/);
    if (!match) continue;
    const owner = match[1] === "+" ? 0 : 1;
    if (owner !== virtualTurn) throw new Error("CSA棋譜の手番が一致しません。");
    const resultingType = CSA_PIECES[match[4]];
    if (!resultingType) throw new Error(`未対応のCSA駒です：${match[4]}`);
    const toFile = Number(match[3][0]);
    const toRank = Number(match[3][1]);
    let move;
    if (match[2] === "00") {
      const type = (UNPROMOTE[resultingType] || resultingType).toUpperCase();
      move = `${type}*${toUsiSquare(toRank - 1, 9 - toFile)}`;
    } else {
      const fromFile = Number(match[2][0]);
      const fromRank = Number(match[2][1]);
      const fromSquare = toUsiSquare(fromRank - 1, 9 - fromFile);
      const toSquare = toUsiSquare(toRank - 1, 9 - toFile);
      const piece = virtualBoard[fromRank - 1]?.[9 - fromFile];
      const promotion = piece && !UNPROMOTE[piece[1]] && UNPROMOTE[resultingType] ? "+" : "";
      move = `${fromSquare}${toSquare}${promotion}`;
    }
    if (!isLegalStateMove(virtualBoard, virtualHands, virtualTurn, move)) throw new Error(`CSAの指し手が不正です：${line}`);
    applyVirtualMove(virtualBoard, virtualHands, virtualTurn, move);
    moves.push(move);
    virtualTurn = 1 - virtualTurn;
  }
  return moves;
}


function parseJapaneseMoves(notations) {
  const moves = [];
  const virtualBoard = initialBoard();
  const virtualHands = emptyHands();
  let virtualTurn = 0;
  let previousDestination = null;
  for (const notation of notations) {
    if (/^(投了|中断|千日手|持将棋|切れ負け|反則)/.test(notation.trim())) break;
    const move = parseJapaneseMove(notation, virtualBoard, virtualHands, virtualTurn, previousDestination);
    previousDestination = applyVirtualMove(virtualBoard, virtualHands, virtualTurn, move);
    moves.push(move);
    virtualTurn = 1 - virtualTurn;
  }
  return moves;
}


function validateUsiMoves(moves) {
  const virtualBoard = initialBoard();
  const virtualHands = emptyHands();
  let virtualTurn = 0;
  moves.forEach((move, index) => {
    if (!isLegalStateMove(virtualBoard, virtualHands, virtualTurn, move)) {
      throw new Error(`${index + 1}手目が不正です：${move}`);
    }
    applyVirtualMove(virtualBoard, virtualHands, virtualTurn, move);
    virtualTurn = 1 - virtualTurn;
  });
}


function parseKifuText(text) {
  const normalized = normalizeKifuText(text);
  const csaMoves = parseCsaMoves(normalized);
  if (csaMoves.length) return csaMoves;

  const numberedMoves = [];
  for (const line of normalized.split("\n")) {
    const match = line.match(/^\s*\d+\s+(.+?)\s*$/);
    if (match) numberedMoves.push(match[1]);
  }
  if (numberedMoves.length) return parseJapaneseMoves(numberedMoves);

  const markedMoves = [];
  for (const match of normalized.matchAll(/[▲△☗☖]([^▲△☗☖\n]+)/g)) markedMoves.push(`${match[0][0]}${match[1]}`);
  if (markedMoves.length) return parseJapaneseMoves(markedMoves);

  const movesSection = normalized.includes(" moves ") ? normalized.split(/\smoves\s/).pop() : normalized;
  const usiMoves = movesSection.match(/(?:[PLNSGBR]\*[1-9][a-i]|[1-9][a-i][1-9][a-i]\+?)/gi) || [];
  const normalizedMoves = usiMoves.map((move) => (
    move.includes("*") ? `${move[0].toUpperCase()}*${move.slice(2).toLowerCase()}` : move.toLowerCase()
  ));
  if (normalizedMoves.length) {
    validateUsiMoves(normalizedMoves);
    return normalizedMoves;
  }
  throw new Error("指し手を読み取れませんでした。KIF・KI2・CSA・USI形式を貼り付けてください。");
}


function loadKifuMoves(moves) {
  validateUsiMoves(moves);
  const resumeAnalysis = analysisRunning;
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
  moveList = [];
  gameOver = false;
  gameMessage = "";
  aiThinking = false;
  history = [];
  historyIndex = -1;
  saveHistory();

  moves.forEach((move, index) => {
    lastMove = applyVirtualMove(board, hands, turn, move);
    moveList.push(move);
    moveNumber += 1;
    turn = 1 - turn;
    gameOver = false;
    gameMessage = "";
    if (index === moves.length - 1) checkGameEnd();
    saveHistory();
  });
  resetAnalysisProgress(false);
  renderAll();
  if (resumeAnalysis && !gameOver) startAnalysis();
}


function exportKifu() {
  const virtualBoard = initialBoard();
  const virtualHands = emptyHands();
  let virtualTurn = 0;
  let previousDestination = null;
  const lines = ["# 変則将棋AI", "手合割：平手", "手数----指手---------"];
  moveList.forEach((move, index) => {
    let notation = japaneseMove(move, virtualBoard, previousDestination);
    if (!move.includes("*")) {
      const [fromRow, fromCol] = parseUsiSquare(move.slice(0, 2));
      notation += `(${9 - fromCol}${fromRow + 1})`;
    }
    lines.push(`${String(index + 1).padStart(4, " ")} ${notation}`);
    previousDestination = applyVirtualMove(virtualBoard, virtualHands, virtualTurn, move);
    virtualTurn = 1 - virtualTurn;
  });
  return lines.join("\n");
}


function setKifuStatus(message, success = false) {
  elements.kifuStatus.textContent = message;
  elements.kifuStatus.classList.toggle("success", success);
}


async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  elements.kifuText.focus();
  elements.kifuText.select();
  if (!document.execCommand("copy")) throw new Error("コピーできませんでした。");
}


async function showKifuCopyDialog() {
  elements.kifuText.value = exportKifu();
  setKifuStatus("");
  if (!elements.kifuDialog.open) elements.kifuDialog.showModal();
  try {
    await copyText(elements.kifuText.value);
    setKifuStatus("現在の棋譜をコピーしました。", true);
  } catch (_) {
    elements.kifuText.select();
    setKifuStatus("自動コピーできない場合は、棋譜欄を長押ししてコピーしてください。");
  }
}


async function showKifuPasteDialog() {
  elements.kifuText.value = "";
  setKifuStatus("棋譜を貼り付けて「棋譜を読み込む」を押してください。", true);
  if (!elements.kifuDialog.open) elements.kifuDialog.showModal();
  elements.kifuText.focus();
  try {
    const clipboardText = await navigator.clipboard?.readText?.();
    if (clipboardText) elements.kifuText.value = clipboardText;
  } catch (_) {
    // ブラウザが読み取りを許可しない場合も、手動貼り付けは利用できる。
  }
}


function formatOpeningMoves(moves) {
  if (!Array.isArray(moves) || !moves.length) return "まだ指し手がありません。";
  const virtualBoard = initialBoard();
  const virtualHands = emptyHands();
  let virtualTurn = 0;
  let previousDestination = null;
  const result = [];
  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    if (move == null) {
      result.push(`${index + 1}. ${virtualTurn === 0 ? "▲" : "△"}（プレイヤー任意手）`);
      previousDestination = null;
      virtualTurn = 1 - virtualTurn;
      continue;
    }
    try {
      result.push(`${index + 1}. ${virtualTurn === 0 ? "▲" : "△"}${japaneseMove(move, virtualBoard, previousDestination)}`);
      previousDestination = applyVirtualMove(virtualBoard, virtualHands, virtualTurn, move);
    } catch (_) {
      result.push(`${index + 1}. ${move}`);
    }
    virtualTurn = 1 - virtualTurn;
  }
  return result.join(" → ");
}


function setOpeningManagerStatus(message, success = false) {
  elements.openingManagerStatus.textContent = message;
  elements.openingManagerStatus.classList.toggle("success", success);
}


function updateOpeningStorageStatus() {
  elements.openingStorageStatus.classList.toggle("ready", openingPersistenceReady);
  elements.openingStorageStatus.textContent = openingPersistenceReady
    ? "永続保存：準備済み（登録後、全対局へすぐ反映されます）"
    : "永続保存：未設定（RenderにOPENING_BOOK_GITHUB_TOKENを設定すると登録できます）";
  elements.registerOpeningLine.disabled = !openingPersistenceReady || moveList.length === 0;
}


function renderManagedOpeningLines() {
  elements.openingLineList.replaceChildren();
  if (!managedOpeningLines.length) {
    const empty = document.createElement("p");
    empty.className = "opening-empty";
    empty.textContent = "画面から登録した定跡はまだありません。組み込み定跡は対局で有効です。";
    elements.openingLineList.append(empty);
    return;
  }

  const customLines = managedOpeningLines.filter((line) => !line.built_in).reverse();
  const builtInLines = managedOpeningLines.filter((line) => line.built_in);
  for (const line of [...customLines, ...builtInLines]) {
    const item = document.createElement("article");
    item.className = "opening-line-item";

    const title = document.createElement("h4");
    title.className = "opening-line-title";
    title.textContent = `${line.built_in ? "【組み込み】" : "【画面登録】"}${line.name}（AI：${Number(line.ai_side) === 0 ? "先手" : "後手"}）`;

    const moves = document.createElement("p");
    moves.className = "opening-line-moves";
    moves.textContent = formatOpeningMoves(line.moves);

    item.append(title);
    if (!line.built_in) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "opening-delete-button";
      deleteButton.textContent = "削除";
      deleteButton.addEventListener("click", async () => {
        if (!window.confirm(`「${line.name}」を削除しますか？`)) return;
        deleteButton.disabled = true;
        setOpeningManagerStatus("削除中...");
        try {
          const result = await deleteJson(`/api/opening-admin/lines/${line.id}`);
          managedOpeningLines = result.lines || [];
          renderManagedOpeningLines();
          setOpeningManagerStatus("定跡を削除し、対局へ反映しました。", true);
        } catch (error) {
          deleteButton.disabled = false;
          setOpeningManagerStatus(error.message);
        }
      });
      item.append(deleteButton);
    }
    item.append(moves);
    if (line.note) {
      const note = document.createElement("p");
      note.className = "opening-line-note";
      note.textContent = `注：${line.note}`;
      item.append(note);
    }
    elements.openingLineList.append(item);
  }
}


async function refreshOpeningManager() {
  const result = await getJson("/api/opening-admin/lines");
  managedOpeningLines = result.lines || [];
  openingPersistenceReady = Boolean(result.persistence_ready);
  elements.openingCurrentLine.textContent = formatOpeningMoves(moveList);
  updateOpeningStorageStatus();
  renderManagedOpeningLines();
  setOpeningManagerStatus("");
}


async function showOpeningManager() {
  try {
    await refreshOpeningManager();
    if (!elements.openingManagerDialog.open) elements.openingManagerDialog.showModal();
  } catch (error) {
    if (error.status !== 403) {
      gameMessage = error.message;
      renderAll();
      return;
    }
    elements.openingAdminLoginError.textContent = "";
    elements.openingAdminPassword.value = "";
    elements.openingAdminLoginDialog.showModal();
    window.setTimeout(() => elements.openingAdminPassword.focus(), 0);
  }
}


async function registerCurrentOpening() {
  const name = elements.openingName.value.trim();
  if (!name) {
    setOpeningManagerStatus("定跡名を入力してください。");
    elements.openingName.focus();
    return;
  }
  if (!moveList.length) {
    setOpeningManagerStatus("検討盤で1手以上並べてから登録してください。");
    return;
  }
  elements.registerOpeningLine.disabled = true;
  setOpeningManagerStatus("定跡を保存中...");
  try {
    const result = await postJson("/api/opening-admin/lines", {
      name,
      ai_side: Number(elements.openingAiSide.value),
      moves: [...moveList],
    });
    managedOpeningLines = result.lines || [];
    elements.openingName.value = "";
    renderManagedOpeningLines();
    setOpeningManagerStatus("定跡を登録し、対局へすぐ反映しました。", true);
  } catch (error) {
    setOpeningManagerStatus(error.message);
  } finally {
    updateOpeningStorageStatus();
  }
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


function cancelAnalysisRequest() {
  if (!analysisAbortController) return;
  analysisAbortController.abort();
  analysisAbortController = null;
}


async function requestAnalysis() {
  if (!analysisRunning || gameOver || mode !== "analysis") return;
  window.clearTimeout(analysisTimer);
  cancelAnalysisRequest();
  const serial = ++requestSerial;
  const controller = new AbortController();
  analysisAbortController = controller;
  const movetime = hasAnalysisResult ? 1500 : 300;
  if (!hasAnalysisResult) clearCandidates("解析中...");
  try {
    const result = await postJson("/api/analyze", { sfen: makeSfen(), movetime }, controller.signal);
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
    if (error.name === "AbortError") return;
    if (serial !== requestSerial) return;
    clearCandidates(error.message);
    stopAnalysis(false);
  } finally {
    if (analysisAbortController === controller) analysisAbortController = null;
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
  cancelAnalysisRequest();
  window.clearInterval(analysisMetricTimer);
  analysisMetricTimer = null;
  requestSerial += 1;
  elements.analysisToggle.textContent = "▶";
  elements.analysisToggle.setAttribute("aria-label", "検討開始");
  updateAnalysisMetrics();
  if (showWaiting && mode === "analysis" && !hasAnalysisResult) clearCandidates("解析停止中");
}


function openAnalysisMode() {
  startMode("analysis");
}


elements.matchModeButton.addEventListener("click", () => elements.sideDialog.showModal());
elements.analysisModeButton.addEventListener("click", openAnalysisMode);
elements.chooseSente.addEventListener("click", () => startMatch(0));
elements.chooseGote.addEventListener("click", () => startMatch(1));
elements.closeSide.addEventListener("click", () => elements.sideDialog.close());
elements.backToModes.addEventListener("click", returnToModes);
elements.resetGame.addEventListener("click", resetPosition);
elements.historyStart.addEventListener("click", () => restoreHistory(0));
elements.historyBack.addEventListener("click", () => restoreHistory(historyIndex - 1));
elements.historyForward.addEventListener("click", () => restoreHistory(historyIndex + 1));
elements.historyEnd.addEventListener("click", () => restoreHistory(history.length - 1));
elements.analysisToggle.addEventListener("click", () => (analysisRunning ? stopAnalysis() : startAnalysis()));
elements.copyKifu.addEventListener("click", showKifuCopyDialog);
elements.pasteKifu.addEventListener("click", showKifuPasteDialog);
elements.openingManager.addEventListener("click", showOpeningManager);
elements.closeKifu.addEventListener("click", () => elements.kifuDialog.close());
elements.copyKifuText.addEventListener("click", showKifuCopyDialog);
elements.loadKifu.addEventListener("click", () => {
  setKifuStatus("");
  try {
    const moves = parseKifuText(elements.kifuText.value);
    loadKifuMoves(moves);
    setKifuStatus(`${moves.length}手の棋譜を読み込みました。`, true);
    window.setTimeout(() => elements.kifuDialog.close(), 450);
  } catch (error) {
    setKifuStatus(error.message || "棋譜を読み込めませんでした。");
  }
});
elements.closeOpeningAdminLogin.addEventListener("click", () => elements.openingAdminLoginDialog.close());
elements.closeOpeningManager.addEventListener("click", () => elements.openingManagerDialog.close());
elements.registerOpeningLine.addEventListener("click", registerCurrentOpening);
elements.openingAdminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.openingAdminLoginError.textContent = "";
  try {
    await postJson("/api/opening-admin/login", { password: elements.openingAdminPassword.value });
    elements.openingAdminLoginDialog.close();
    await refreshOpeningManager();
    elements.openingManagerDialog.showModal();
  } catch (error) {
    elements.openingAdminLoginError.textContent = error.message;
    elements.openingAdminPassword.select();
  }
});
elements.kifuDialog.addEventListener("cancel", () => setKifuStatus(""));
elements.openingAdminLoginDialog.addEventListener("cancel", () => {
  elements.openingAdminLoginError.textContent = "";
});
elements.openingManagerDialog.addEventListener("cancel", () => setOpeningManagerStatus(""));

updateHistoryButtons();
