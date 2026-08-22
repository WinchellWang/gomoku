const SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
// Rapfi searches for 4.5s in the worker. Leave enough delivery headroom on
// slower mobile devices before deciding that the engine is actually stuck.
const AI_MOVE_HARD_TIMEOUT_MS = 9000;

const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioContext = null;

function unlockAudio() {
  if (!AudioContextClass) return;
  audioContext ||= new AudioContextClass();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
}

function playStoneSound() {
  if (!AudioContextClass) return;
  unlockAudio();
  if (!audioContext || audioContext.state !== "running") return;

  const now = audioContext.currentTime;
  const master = audioContext.createGain();
  master.gain.setValueAtTime(0.72, now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
  master.connect(audioContext.destination);

  const noiseLength = Math.floor(audioContext.sampleRate * 0.035);
  const noiseBuffer = audioContext.createBuffer(1, noiseLength, audioContext.sampleRate);
  const noise = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseLength; i++) {
    const envelope = Math.pow(1 - i / noiseLength, 3);
    noise[i] = (Math.random() * 2 - 1) * envelope;
  }
  const noiseSource = audioContext.createBufferSource();
  const noiseFilter = audioContext.createBiquadFilter();
  noiseSource.buffer = noiseBuffer;
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.setValueAtTime(1850, now);
  noiseFilter.Q.setValueAtTime(0.9, now);
  noiseSource.connect(noiseFilter).connect(master);
  noiseSource.start(now);

  for (const [frequency, volume, duration] of [[235, 0.42, 0.12], [510, 0.18, 0.07]]) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.82, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }
}


const landing = document.querySelector("#landing");
const gameView = document.querySelector("#gameView");
const boardEl = document.querySelector("#board");
const statusText = document.querySelector("#statusText");
const undoBtn = document.querySelector("#undoBtn");
const engineLoading = document.querySelector("#engineLoading");
const loadingLabel = document.querySelector("#loadingLabel");
const loadingBar = document.querySelector("#loadingBar");

const aboutContent = document.querySelector("#aboutContent");

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function renderMarkdown(markdown) {
  const html = [];
  let listOpen = false;
  const closeList = () => { if (listOpen) { html.push("</ul>"); listOpen = false; } };
  for (const sourceLine of markdown.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line) { closeList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 1, 4);
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const item = line.match(/^[-*]\s+(.+)$/);
    if (item) {
      if (!listOpen) { html.push("<ul>"); listOpen = true; }
      html.push(`<li>${renderInlineMarkdown(item[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }
  closeList();
  return html.join("");
}

async function loadAboutContent() {
  try {
    const response = await fetch("./about.md", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Unable to load about.md (${response.status})`);
    aboutContent.innerHTML = renderMarkdown(await response.text());
  } catch (error) {
    console.error(error);
    aboutContent.innerHTML = '<p class="about-error">About information is currently unavailable.</p>';
  }
}


let board = new Int8Array(SIZE * SIZE);
let moves = [];
let current = BLACK;
let mode = "pvp";
let winner = EMPTY;
let winningCells = [];
let thinking = false;
let worker = null;
let aiLoadTimer = null;
let aiReady = false;
let aiMoveTimer = null;
let aiRequestId = 0;

function createBoard() {
  const fragment = document.createDocumentFragment();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("grid-lines");
  svg.setAttribute("viewBox", "0 0 14 14");
  svg.setAttribute("aria-hidden", "true");
  for (let i = 0; i < SIZE; i++) {
    const vertical = document.createElementNS("http://www.w3.org/2000/svg", "line");
    vertical.setAttribute("x1", i);
    vertical.setAttribute("y1", 0);
    vertical.setAttribute("x2", i);
    vertical.setAttribute("y2", 14);
    const horizontal = document.createElementNS("http://www.w3.org/2000/svg", "line");
    horizontal.setAttribute("x1", 0);
    horizontal.setAttribute("y1", i);
    horizontal.setAttribute("x2", 14);
    horizontal.setAttribute("y2", i);
    svg.append(vertical, horizontal);
  }
  fragment.append(svg);

  for (let i = 0; i < SIZE * SIZE; i++) {
    const cell = document.createElement("button");
    cell.className = "intersection";
    cell.type = "button";
    cell.dataset.index = i;
    cell.style.setProperty("--row", Math.floor(i / SIZE));
    cell.style.setProperty("--col", i % SIZE);
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-label", `Row ${Math.floor(i / SIZE) + 1}, column ${i % SIZE + 1}`);
    cell.addEventListener("click", () => playHuman(i));
    fragment.append(cell);
  }
  boardEl.replaceChildren(fragment);
}

function startGame(selectedMode) {
  mode = selectedMode;
  landing.classList.add("is-hidden");
  gameView.classList.remove("is-hidden");
  document.body.classList.add("game-active");
  resetGame();
  if (mode === "pve") initializeAi();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function stopWorker() {
  clearTimeout(aiLoadTimer);
  clearTimeout(aiMoveTimer);
  aiLoadTimer = null;
  aiMoveTimer = null;
  worker?.terminate();
  worker = null;
  aiReady = false;
  engineLoading.classList.add("is-hidden");
  thinking = false;
}

function resetGame({ preserveAi = true } = {}) {
  clearTimeout(aiMoveTimer);
  aiMoveTimer = null;
  aiRequestId++;
  thinking = false;
  if (!preserveAi) stopWorker();
  board = new Int8Array(SIZE * SIZE);
  moves = [];
  current = BLACK;
  winner = EMPTY;
  winningCells = [];
  render();
}

function playHuman(index) {
  if (thinking || winner || board[index] !== EMPTY || (mode === "pve" && current === WHITE)) return;
  makeMove(index, current);
  if (!winner && mode === "pve") requestAiMove();
}

function getUndoCount() {
  return mode === "pve" ? 2 : 1;
}

function canUndo() {
  const isHumanTurn = mode === "pvp" || current === BLACK;
  return !thinking && !winner && isHumanTurn && moves.length >= getUndoCount();
}

function makeMove(index, player) {
  board[index] = player;
  moves.push(index);
  playStoneSound();
  winningCells = getWinningLine(index, player);
  if (winningCells.length) winner = player;
  else if (moves.length === SIZE * SIZE) winner = -1;
  else current = player === BLACK ? WHITE : BLACK;
  render();
}

function getWinningLine(index, player) {
  const row = Math.floor(index / SIZE);
  const col = index % SIZE;
  for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    const line = [index];
    for (const sign of [-1, 1]) {
      for (let step = 1; step < SIZE; step++) {
        const r = row + dr * step * sign;
        const c = col + dc * step * sign;
        if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || board[r * SIZE + c] !== player) break;
        sign < 0 ? line.unshift(r * SIZE + c) : line.push(r * SIZE + c);
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}

function armAiMoveTimeout() {
  clearTimeout(aiMoveTimer);
  aiMoveTimer = setTimeout(() => {
    if (thinking && mode === "pve" && current === WHITE && !winner) {
      console.warn("Rapfi move timed out; playing a fallback move.");
      const fallback = findFallbackMove();
      stopWorker();
      if (fallback !== undefined) makeMove(fallback, WHITE);
    }
  }, AI_MOVE_HARD_TIMEOUT_MS);
}

function findFallbackMove() {
  const empty = Array.from(board.keys()).filter((index) => board[index] === EMPTY);
  // A rare engine failure should still take a direct win or block one.
  for (const player of [WHITE, BLACK]) {
    for (const index of empty) {
      board[index] = player;
      const wins = getWinningLine(index, player).length > 0;
      board[index] = EMPTY;
      if (wins) return index;
    }
  }
  const distance = (index) => Math.abs(index % SIZE - 7) + Math.abs(Math.floor(index / SIZE) - 7);
  return empty.sort((a, b) => distance(a) - distance(b))[0];
}

function updateLoadingProgress(percent) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  loadingLabel.textContent = "Loading · " + value + "%";
  loadingBar.style.width = value + "%";
}

function initializeAi() {
  // Reuse an already-loaded or currently-loading 40MB engine.
  if (worker) return;
  aiReady = false;
  thinking = true;
  engineLoading.classList.remove("is-hidden");
  updateLoadingProgress(0);
  render();
  const fail = (error) => {
    console.error("AI failed to load.", error);
    stopWorker();
    statusText.textContent = "AI unavailable — restart to retry";
    render();
  };
  clearTimeout(aiLoadTimer);
  try {
    worker = new Worker("./rapfi-worker.js?v=20260822-2");
  } catch (error) {
    fail(error);
    return;
  }
  worker.onmessage = ({ data }) => {
    if (data.type === "loading-progress" && data.total > 0) {
      updateLoadingProgress(data.loaded / data.total * 100);
      return;
    }
    if (data.type === "ready") {
      clearTimeout(aiLoadTimer);
      aiLoadTimer = null;
      aiReady = true;
      updateLoadingProgress(100);
      window.setTimeout(() => engineLoading.classList.add("is-hidden"), 180);
      if (mode === "pve" && current === WHITE && !winner) {
        thinking = true;
        statusText.textContent = "AI is thinking...";
        const requestId = ++aiRequestId;
        worker.postMessage({ type: "think", moves: moves.slice(), requestId });
        armAiMoveTimeout();
      } else {
        thinking = false;
        render();
      }
      return;
    }
    if (data.type === "engine-error") {
      fail(data.message);
      return;
    }
    if (!thinking || data.type !== "move" || data.requestId !== aiRequestId) return;
    clearTimeout(aiMoveTimer);
    aiMoveTimer = null;
    thinking = false;
    if (board[data.index] === EMPTY) makeMove(data.index, WHITE);
  };
  worker.onerror = (event) => fail(event.message || event);
  aiLoadTimer = setTimeout(() => {
    if (!aiReady) fail("Rapfi loading timed out");
  }, 30000);
}

function requestAiMove() {
  thinking = true;
  statusText.textContent = "AI is thinking...";
  undoBtn.disabled = true;
  if (!worker || !aiReady) { initializeAi(); return; }
  const requestId = ++aiRequestId;
  worker.postMessage({ type: "think", moves: moves.slice(), requestId });
  armAiMoveTimeout();
}

function restartGame() {
  // Rapfi cannot switch boards in the middle of a search. Keeping restart
  // disabled for this short interval avoids destroying and reloading it.
  if (thinking && aiReady) return;
  resetGame();
  if (mode === "pve" && !worker) initializeAi();
}

function undo() {
  if (!canUndo()) return;

  const undoCount = getUndoCount();
  for (let step = 0; step < undoCount; step++) {
    board[moves.pop()] = EMPTY;
  }
  winner = EMPTY;
  winningCells = [];
  current = moves.length % 2 === 0 ? BLACK : WHITE;
  render();
}

function render() {
  boardEl.querySelectorAll(".intersection").forEach((cell, index) => {
    const value = board[index];
    cell.replaceChildren();
    cell.classList.toggle("last", index === moves.at(-1));
    cell.classList.toggle("winner", winningCells.includes(index));
    cell.disabled = Boolean(value) || Boolean(winner) || thinking;
    if (value) {
      const stone = document.createElement("span");
      stone.className = `stone ${value === BLACK ? "black" : "white"}`;
      cell.append(stone);
    }
  });
  if (winner === BLACK) statusText.textContent = "Black wins";
  else if (winner === WHITE) statusText.textContent = "White wins";
  else if (winner === -1) statusText.textContent = "Draw";
  else if (!thinking) statusText.textContent = `${current === BLACK ? "Black" : "White"} to move`;
  undoBtn.disabled = !canUndo();
  document.querySelector("#resetBtn").disabled = thinking && aiReady;
}

document.querySelector("#startHumanBtn").addEventListener("click", () => startGame("pvp"));
document.querySelector("#startAiBtn").addEventListener("click", () => startGame("pve"));
document.querySelector("#resetBtn").addEventListener("click", restartGame);
undoBtn.addEventListener("click", undo);
document.querySelector("#backBtn").addEventListener("click", () => { stopWorker(); gameView.classList.add("is-hidden"); landing.classList.remove("is-hidden"); document.body.classList.remove("game-active"); });
document.querySelector("#copyrightYear").textContent = new Date().getFullYear();
document.addEventListener("pointerdown", unlockAudio, { once: true });
createBoard();
loadAboutContent();
render();
