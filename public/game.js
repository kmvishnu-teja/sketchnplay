/* Sketch Sprint client */
const params = new URLSearchParams(location.search);
const CODE = (params.get('code') || '').toUpperCase();
const MY_NAME = sessionStorage.getItem('sketchName') || '';
if (!CODE || !MY_NAME) location.href = 'index.html';

const $ = id => document.getElementById(id);
const socket = io();

let myId = null, isHost = false, isDrawer = false;
let endsAt = 0, roundTimeMs = 60000, timerRAF = null;

document.getElementById('roomCode').textContent = CODE;
document.getElementById('copyBtn').onclick = () => {
  const link = location.origin + '/index.html?code=' + CODE;
  navigator.clipboard.writeText(link).then(
    () => { const b = $('copyBtn'); b.textContent = 'Copied!'; setTimeout(() => b.textContent = 'Copy invite link', 1500); },
    () => alert('Copy this link: ' + link));
};

/* ---------- sound ---------- */
const sfxBtn = $('soundBtn');
const paintSfx = () => { sfxBtn.textContent = Sfx.enabled ? '🔊' : '🔇'; };
sfxBtn.onclick = () => { const on = Sfx.toggle(); paintSfx(); if (on) Sfx.play('click'); };
paintSfx();

/* ---------- lobby / players ---------- */
socket.on('connect', () => socket.emit('joinRoom', { code: CODE, name: MY_NAME }));

socket.on('roomJoined', ({ playerId, isHost: h }) => {
  myId = playerId; isHost = h;
  $('startBtn').style.display = h ? '' : 'none';
  $('againBtn').classList.toggle('hidden', !h);
  $('againHint').style.display = h ? 'none' : '';
});

socket.on('errorMsg', (m) => {
  if (!$('lobby').classList.contains('hidden')) {
    $('lobbyErr').textContent = m;
    if (/not found|full/i.test(m)) setTimeout(() => location.href = 'index.html', 1800);
  } else feedSys(m);
});

socket.on('players', (players) => {
  $('lobbyCount').textContent = players.length + '/8';
  $('lobbyList').innerHTML = players.map(p =>
    `<li><span>${esc(p.name)}${p.isHost ? ' 👑' : ''}${p.id === myId ? ' (you)' : ''}</span><span>${p.score} pts</span></li>`).join('');
  $('playerList').innerHTML = players.map(p =>
    `<li><span class="${p.id === myId ? 'me' : ''}">${esc(p.name)}${p.isHost ? ' 👑' : ''}${p.isDrawer ? '<span class="drawerTag">drawing</span>' : ''}${p.hasGuessed ? '<span class="guessedTag">✓</span>' : ''}</span><span>${p.score}</span></li>`).join('');
});

socket.on('hostChanged', ({ name }) => feedSys(`👑 ${esc(name)} is now the host.`));

$('startBtn').onclick = () => { $('lobbyErr').textContent = ''; Sfx.play('click'); socket.emit('startGame'); };
$('againBtn').onclick = () => { Sfx.play('click'); socket.emit('playAgain'); };
socket.on('backToLobby', () => {
  $('overOv').classList.add('hidden'); $('roundOv').classList.add('hidden');
  $('game').classList.add('hidden'); $('lobby').classList.remove('hidden');
  $('feed').innerHTML = '';
});

/* ---------- game flow ---------- */
socket.on('gameStarted', ({ totalRounds }) => {
  $('lobby').classList.add('hidden'); $('game').classList.remove('hidden');
  feedSys(`Game on! ${totalRounds} rounds — everyone draws once.`);
  Sfx.play('gameStart');
});

socket.on('roundStarting', ({ round, totalRounds, drawerName }) => {
  $('roundInfo').textContent = `Round ${round}/${totalRounds}`;
  $('roundOv').classList.add('hidden'); // dismiss previous round's scoreboard
  feedSys(`🎨 ${esc(drawerName)} is picking a word…`);
  Sfx.play('roundStart');
});

socket.on('wordChoices', ({ choices }) => {
  const box = $('wordBtns'); box.innerHTML = '';
  choices.forEach(c => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.innerHTML = `${esc(c.word)}<span class="diff">${c.difficulty} · ×${{ easy: 1, medium: 1.25, hard: 1.5 }[c.difficulty] || 1} pts</span>`;
    b.onclick = () => { socket.emit('chooseWord', { word: c.word }); $('pickerOv').classList.add('hidden'); };
    box.appendChild(b);
  });
  $('pickerOv').classList.remove('hidden');
  Sfx.play('yourTurn');
});

socket.on('yourWord', ({ word, difficulty }) => {
  $('yourWord').textContent = `Draw: ${word} (${difficulty})`;
});

socket.on('roundStarted', (d) => {
  $('pickerOv').classList.add('hidden'); $('roundOv').classList.add('hidden');
  isDrawer = d.drawerId === myId;
  endsAt = d.endsAt; roundTimeMs = d.roundTimeMs || 60000;
  $('roundInfo').textContent = `Round ${d.round}/${d.totalRounds} · ${d.drawerName} drawing`;
  $('wordHint').textContent = isDrawer ? '' : d.maskedWord;
  $('yourWord').classList.toggle('hidden', !isDrawer);
  $('toolbar').classList.toggle('hidden', !isDrawer);
  $('guessRow').style.display = isDrawer ? 'none' : '';
  clearLocalCanvas();
  if (d.strokes) d.strokes.forEach(replayStroke);
  board.classList.toggle('locked', !isDrawer);
  startTimer();
  if (!isDrawer) feedSys(`✏️ ${esc(d.drawerName)} is drawing…`);
});

socket.on('roundEnded', ({ word, scores, reason, drawerName }) => {
  stopTimer();
  const why = reason === 'allGuessed' ? 'Everyone guessed it!' :
              reason === 'drawerLeft' ? `${esc(drawerName)} left — round skipped.` : 'Time\'s up!';
  $('roundTitle').textContent = why;
  $('roundWord').textContent = word || '—';
  $('roundScores').innerHTML = scores.map((p, i) =>
    `<li class="${i === 0 ? 'first' : ''}"><span>${i + 1}. ${esc(p.name)}</span><span>${p.score} pts</span></li>`).join('');
  $('roundOv').classList.remove('hidden');
  $('guessInput').value = '';
  Sfx.play(reason === 'timeUp' ? 'timeUp' : 'roundEnd');
});

socket.on('gameOver', ({ standings }) => {
  stopTimer();
  $('roundOv').classList.add('hidden');
  const medals = ['🥇', '🥈', '🥉'];
  $('finalScores').innerHTML = standings.map((p, i) =>
    `<li class="${i === 0 ? 'first' : ''}"><span>${medals[i] || (i + 1) + '.'} ${esc(p.name)}${p.id === myId ? ' (you)' : ''}</span><span>${p.score} pts</span></li>`).join('');
  $('overOv').classList.remove('hidden');
  Sfx.play('fanfare');
});

/* ---------- guesses / feed ---------- */
socket.on('chatGuess', ({ name, text }) => {
  const li = document.createElement('li');
  li.innerHTML = `<span class="who">${esc(name)}:</span> ${esc(text)}`;
  pushFeed(li);
});
socket.on('correctGuess', ({ name, points }) => {
  const li = document.createElement('li');
  li.className = 'sys'; li.textContent = `✔ ${name} guessed it! +${points}`;
  pushFeed(li);
  Sfx.play(name === MY_NAME ? 'correctSelf' : 'correct');
});
function feedSys(html) {
  const li = document.createElement('li');
  li.className = 'sys'; li.innerHTML = html;
  pushFeed(li);
}
function pushFeed(li) {
  const f = $('feed'); f.appendChild(li); f.scrollTop = f.scrollHeight;
}
function sendGuess() {
  const v = $('guessInput').value.trim();
  if (!v) return;
  socket.emit('guess', { text: v });
  $('guessInput').value = '';
}
$('guessBtn').onclick = sendGuess;
$('guessInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendGuess(); });
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------- canvas ---------- */
const board = $('board');
const ctx = board.getContext('2d');
const COLORS = ['#111111', '#e5484d', '#f5a524', '#3ddc84', '#2f7df6', '#7c6cf0', '#ff7ab8', '#ffffff'];
let curColor = COLORS[0], curWidth = 8;
let drawing = false, lastPt = null, remoteStroke = null;

const sw = $('swatches');
COLORS.forEach((c, i) => {
  const d = document.createElement('div');
  d.className = 'swatch' + (i === 0 ? ' on' : '');
  d.style.background = c;
  d.onclick = () => { curColor = c; [...sw.children].forEach(x => x.classList.remove('on')); d.classList.add('on'); };
  sw.appendChild(d);
});
$('brushSize').onchange = e => curWidth = Number(e.target.value);
$('clearBtn').onclick = () => { socket.emit('clearCanvas'); clearLocalCanvas(); };

function norm(e) {
  const r = board.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
}
function drawSeg(a, b, color, widthPx) {
  ctx.strokeStyle = color; ctx.lineWidth = widthPx; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(a.x * board.width, a.y * board.height);
  ctx.lineTo(b.x * board.width, b.y * board.height); ctx.stroke();
}
board.addEventListener('pointerdown', e => {
  if (!isDrawer) return;
  drawing = true; board.setPointerCapture(e.pointerId);
  const p = norm(e); lastPt = p;
  socket.emit('strokeStart', { color: curColor, width: curWidth / board.width });
  drawDot(p, curColor, curWidth);
});
board.addEventListener('pointermove', e => {
  if (!drawing || !isDrawer) return;
  const p = norm(e);
  drawSeg(lastPt, p, curColor, curWidth);
  socket.emit('strokePoint', p);
  lastPt = p;
});
const stopDraw = () => { drawing = false; lastPt = null; };
board.addEventListener('pointerup', stopDraw);
board.addEventListener('pointercancel', stopDraw);
function drawDot(p, color, w) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(p.x * board.width, p.y * board.height, w / 2, 0, 7); ctx.fill();
}
function clearLocalCanvas() { ctx.clearRect(0, 0, board.width, board.height); }

socket.on('strokeStart', ({ color, width }) => {
  remoteStroke = { color, width: width * board.width, pts: [] };
});
socket.on('strokePoint', (p) => {
  if (!remoteStroke) return;
  const pts = remoteStroke.pts;
  if (pts.length === 0) drawDot(p, remoteStroke.color, remoteStroke.width);
  else drawSeg(pts[pts.length - 1], p, remoteStroke.color, remoteStroke.width);
  pts.push(p);
});
socket.on('canvasCleared', clearLocalCanvas);
function replayStroke(s) {
  const w = s.width * board.width;
  s.points.forEach((p, i) => {
    if (i === 0) drawDot(p, s.color, w);
    else drawSeg(s.points[i - 1], p, s.color, w);
  });
}

/* ---------- timer ---------- */
let lastTickSec = -1;
function startTimer() {
  stopTimer();
  lastTickSec = -1;
  const tick = () => {
    const left = Math.max(0, endsAt - Date.now());
    $('timerFill').style.width = (100 * left / roundTimeMs) + '%';
    const s = Math.ceil(left / 1000);
    if (left > 0 && s <= 10 && s !== lastTickSec) { lastTickSec = s; Sfx.play('tick'); }
    if (left > 0) timerRAF = requestAnimationFrame(tick);
  };
  tick();
}
function stopTimer() { if (timerRAF) cancelAnimationFrame(timerRAF); timerRAF = null; }
