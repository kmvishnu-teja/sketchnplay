/*
 * Sketch Sprint — real-time multiplayer Pictionary-style party game
 * Run:  node server.js   (then open http://localhost:3000)
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const WORDS = require('./words');

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ ok: true }));
// Create an empty room over HTTP; the first socket to joinRoom becomes host.
// (Creating via HTTP avoids losing the room across the index -> game page navigation.)
app.post('/api/rooms', (_req, res) => {
  const code = makeCode();
  rooms.set(code, {
    code, players: new Map(), order: [],
    state: 'lobby', round: 0, drawerId: null,
    word: null, wordDifficulty: null, wordChoices: null,
    roundEndsAt: null, strokes: [], guessed: new Set(),
    usedWords: new Set(),
    roundTimer: null, chooseTimer: null, intermissionTimer: null,
  });
  res.json({ code });
});
const server = http.createServer(app);
const io = new Server(server);

// ---- Config ----
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const MAX_NAME_LEN = 16;
const ROUND_TIME_MS = Number(process.env.ROUND_TIME_MS) || 60000; // per-round drawing time
const CHOOSE_TIME_MS = 15000;  // time the drawer has to pick a word
const INTERMISSION_MS = 6000;  // scoreboard shown between rounds
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no ambiguous chars
const DIFF_MULT = { easy: 1, medium: 1.25, hard: 1.5 };
const DRAWER_POINTS_PER_GUESS = 250;

const rooms = new Map(); // code -> room

// ---- Helpers ----
function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(raw) {
  return String(raw || '').trim().slice(0, MAX_NAME_LEN);
}

function publicPlayers(room) {
  return room.order
    .map(id => room.players.get(id))
    .filter(Boolean)
    .map(p => ({
      id: p.id, name: p.name, score: p.score,
      isHost: p.isHost, connected: p.connected,
      isDrawer: p.id === room.drawerId,
      hasGuessed: room.guessed.has(p.id),
    }));
}

function broadcastPlayers(room) {
  io.to(room.code).emit('players', publicPlayers(room));
}

function maskedWord(word) {
  return word.split('').map(ch => (ch === ' ' ? '  ' : '_ ')).join('').trim();
}

function pickWordChoices(room, n = 3) {
  const pool = WORDS.filter(e => !room.usedWords.has(e.w));
  const source = pool.length >= n ? pool : WORDS; // recycle if exhausted
  const choices = [];
  const picked = new Set();
  while (choices.length < n && picked.size < source.length) {
    const entry = source[Math.floor(Math.random() * source.length)];
    if (!picked.has(entry.w)) { picked.add(entry.w); choices.push(entry); }
  }
  return choices;
}

function clearTimers(room) {
  if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
  if (room.chooseTimer) { clearTimeout(room.chooseTimer); room.chooseTimer = null; }
  if (room.intermissionTimer) { clearTimeout(room.intermissionTimer); room.intermissionTimer = null; }
}

function connectedPlayers(room) {
  return room.order.map(id => room.players.get(id)).filter(p => p && p.connected);
}

// ---- Round flow ----
function startGame(room) {
  const players = connectedPlayers(room);
  if (players.length < MIN_PLAYERS) return false;
  for (const p of players) { p.score = 0; p.hasDrawn = false; }
  room.usedWords = new Set();
  room.round = 0;
  room.state = 'drawing';
  io.to(room.code).emit('gameStarted', { totalRounds: players.length });
  broadcastPlayers(room);
  startRound(room);
  return true;
}

function startRound(room) {
  clearTimers(room);
  const drawer = room.order
    .map(id => room.players.get(id))
    .find(p => p && p.connected && !p.hasDrawn);
  if (!drawer) { endGame(room); return; }

  room.round += 1;
  room.drawerId = drawer.id;
  room.word = null;
  room.wordChoices = pickWordChoices(room);
  room.strokes = [];
  room.guessed = new Set();
  room.state = 'choosing';

  // Drawer picks a word; everyone else waits.
  io.to(drawer.id).emit('wordChoices', {
    round: room.round,
    totalRounds: connectedPlayers(room).length,
    choices: room.wordChoices.map(c => ({ word: c.w, difficulty: c.d })),
  });
  io.to(room.code).emit('roundStarting', {
    round: room.round,
    totalRounds: connectedPlayers(room).length,
    drawerId: drawer.id,
    drawerName: drawer.name,
  });
  broadcastPlayers(room);

  room.chooseTimer = setTimeout(() => {
    if (room.state === 'choosing') beginDrawing(room, room.wordChoices[0]);
  }, CHOOSE_TIME_MS);
}

function beginDrawing(room, choice) {
  if (room.chooseTimer) { clearTimeout(room.chooseTimer); room.chooseTimer = null; }
  room.word = choice.w;
  room.wordDifficulty = choice.d;
  room.usedWords.add(choice.w);
  room.state = 'drawing';
  room.roundEndsAt = Date.now() + ROUND_TIME_MS;

  const drawer = room.players.get(room.drawerId);
  io.to(room.code).emit('roundStarted', {
    round: room.round,
    totalRounds: connectedPlayers(room).length,
    drawerId: room.drawerId,
    drawerName: drawer ? drawer.name : '',
    maskedWord: maskedWord(room.word),
    endsAt: room.roundEndsAt,
    roundTimeMs: ROUND_TIME_MS,
  });
  if (drawer) io.to(drawer.id).emit('yourWord', { word: room.word, difficulty: choice.d });

  room.roundTimer = setTimeout(() => endRound(room, 'time'), ROUND_TIME_MS);
}

function guesserPoints(room) {
  const timeLeft = Math.max(0, room.roundEndsAt - Date.now());
  const base = 500 + 500 * (timeLeft / ROUND_TIME_MS);
  return Math.round(base * (DIFF_MULT[room.wordDifficulty] || 1));
}

function endRound(room, reason) {
  if (room.state !== 'drawing' && room.state !== 'choosing') return;
  clearTimers(room);
  room.state = 'roundEnd';
  const drawer = room.players.get(room.drawerId);
  if (drawer) drawer.hasDrawn = true;

  io.to(room.code).emit('roundEnded', {
    reason, // 'time' | 'allGuessed' | 'drawerLeft'
    word: room.word,
    difficulty: room.wordDifficulty,
    drawerId: room.drawerId,
    drawerName: drawer ? drawer.name : '',
    scores: publicPlayers(room),
  });
  broadcastPlayers(room);

  room.intermissionTimer = setTimeout(() => startRound(room), INTERMISSION_MS);
}

function endGame(room) {
  clearTimers(room);
  room.state = 'gameOver';
  const standings = publicPlayers(room).sort((a, b) => b.score - a.score);
  io.to(room.code).emit('gameOver', { standings });
  broadcastPlayers(room);
}

function checkAllGuessed(room) {
  const need = connectedPlayers(room).filter(p => p.id !== room.drawerId);
  if (need.length > 0 && need.every(p => room.guessed.has(p.id))) {
    endRound(room, 'allGuessed');
  }
}

function removePlayer(room, socketId) {
  const player = room.players.get(socketId);
  if (!player) return;
  const wasDrawer = room.drawerId === socketId;
  const wasHost = player.isHost;
  room.players.delete(socketId);
  room.order = room.order.filter(id => id !== socketId);
  room.guessed.delete(socketId);

  if (wasHost) {
    const next = room.order.map(id => room.players.get(id)).find(p => p && p.connected);
    if (next) { next.isHost = true; io.to(room.code).emit('hostChanged', { name: next.name }); }
  }
  if (room.order.length === 0) { clearTimers(room); rooms.delete(room.code); return; }

  if (wasDrawer && (room.state === 'drawing' || room.state === 'choosing')) {
    endRound(room, 'drawerLeft');
  } else if (room.state === 'drawing') {
    checkAllGuessed(room);
  }
  broadcastPlayers(room);
}

// ---- Socket handlers ----
io.on('connection', (socket) => {
  let room = null;

  socket.on('createRoom', ({ name }) => {
    const clean = cleanName(name);
    if (!clean) return socket.emit('errorMsg', 'Please enter a nickname.');
    const code = makeCode();
    room = {
      code, players: new Map(), order: [],
      state: 'lobby', round: 0, drawerId: null,
      word: null, wordDifficulty: null, wordChoices: null,
      roundEndsAt: null, strokes: [], guessed: new Set(),
      usedWords: new Set(),
      roundTimer: null, chooseTimer: null, intermissionTimer: null,
    };
    rooms.set(code, room);
    const player = { id: socket.id, name: clean, score: 0, isHost: true, connected: true, hasDrawn: false };
    room.players.set(socket.id, player);
    room.order.push(socket.id);
    socket.join(code);
    socket.emit('roomJoined', { code, playerId: socket.id, isHost: true });
    broadcastPlayers(room);
  });

  socket.on('joinRoom', ({ code, name }) => {
    const clean = cleanName(name);
    const c = String(code || '').toUpperCase().trim();
    if (!clean) return socket.emit('errorMsg', 'Please enter a nickname.');
    room = rooms.get(c);
    if (!room) return socket.emit('errorMsg', 'Room not found. Check the code.');
    if (room.players.size >= MAX_PLAYERS) return socket.emit('errorMsg', 'Room is full (8 players max).');
    const nameTaken = [...room.players.values()].some(p => p.name.toLowerCase() === clean.toLowerCase());
    if (nameTaken) return socket.emit('errorMsg', 'That nickname is taken in this room.');
    const isHost = room.players.size === 0;
    const player = { id: socket.id, name: clean, score: 0, isHost, connected: true, hasDrawn: room.state !== 'lobby' };
    room.players.set(socket.id, player);
    room.order.push(socket.id);
    socket.join(c);
    socket.emit('roomJoined', { code: c, playerId: socket.id, isHost });
    // Catch a mid-game joiner up on the current round
    if (room.state === 'drawing' && room.word) {
      socket.emit('roundStarted', {
        round: room.round,
        totalRounds: connectedPlayers(room).length,
        drawerId: room.drawerId,
        drawerName: (room.players.get(room.drawerId) || {}).name || '',
        maskedWord: maskedWord(room.word),
        endsAt: room.roundEndsAt,
        roundTimeMs: ROUND_TIME_MS,
        strokes: room.strokes,
      });
    }
    broadcastPlayers(room);
  });

  socket.on('startGame', () => {
    if (!room) return;
    const me = room.players.get(socket.id);
    if (!me || !me.isHost) return socket.emit('errorMsg', 'Only the host can start the game.');
    if (room.state !== 'lobby' && room.state !== 'gameOver') return;
    if (connectedPlayers(room).length < MIN_PLAYERS) {
      return socket.emit('errorMsg', `Need at least ${MIN_PLAYERS} players to start.`);
    }
    startGame(room);
  });

  socket.on('playAgain', () => {
    if (!room) return;
    const me = room.players.get(socket.id);
    if (!me || !me.isHost || room.state !== 'gameOver') return;
    clearTimers(room);
    room.state = 'lobby';
    room.round = 0; room.drawerId = null; room.word = null; room.strokes = [];
    for (const p of room.players.values()) { p.score = 0; p.hasDrawn = false; }
    io.to(room.code).emit('backToLobby');
    broadcastPlayers(room);
  });

  socket.on('chooseWord', ({ word }) => {
    if (!room || room.state !== 'choosing' || socket.id !== room.drawerId) return;
    const choice = (room.wordChoices || []).find(c => c.w === word);
    if (!choice) return;
    beginDrawing(room, choice);
  });

  socket.on('strokeStart', ({ color, width }) => {
    if (!room || room.state !== 'drawing' || socket.id !== room.drawerId) return;
    const stroke = { color, width, points: [] };
    room.strokes.push(stroke);
    socket.to(room.code).emit('strokeStart', { color, width });
  });

  socket.on('strokePoint', ({ x, y }) => {
    if (!room || room.state !== 'drawing' || socket.id !== room.drawerId) return;
    const s = room.strokes[room.strokes.length - 1];
    if (s) s.points.push({ x, y });
    socket.to(room.code).emit('strokePoint', { x, y });
  });

  socket.on('clearCanvas', () => {
    if (!room || room.state !== 'drawing' || socket.id !== room.drawerId) return;
    room.strokes = [];
    io.to(room.code).emit('canvasCleared');
  });

  socket.on('guess', ({ text }) => {
    if (!room || room.state !== 'drawing' || !room.word) return;
    const me = room.players.get(socket.id);
    if (!me || socket.id === room.drawerId || room.guessed.has(socket.id)) return;
    const guess = String(text || '').trim().toLowerCase();
    if (!guess) return;
    if (guess === room.word.toLowerCase()) {
      room.guessed.add(socket.id);
      const points = guesserPoints(room);
      me.score += points;
      const drawer = room.players.get(room.drawerId);
      if (drawer) drawer.score += DRAWER_POINTS_PER_GUESS;
      io.to(room.code).emit('correctGuess', {
        playerId: me.id, name: me.name, points,
        drawerPoints: DRAWER_POINTS_PER_GUESS,
        totalGuessed: room.guessed.size,
      });
      broadcastPlayers(room);
      checkAllGuessed(room);
    } else {
      io.to(room.code).emit('chatGuess', { name: me.name, text: String(text).trim().slice(0, 60) });
    }
  });

  socket.on('leaveRoom', () => {
    if (room) { removePlayer(room, socket.id); socket.leave(room.code); room = null; }
  });

  socket.on('disconnect', () => {
    if (room) { removePlayer(room, socket.id); room = null; }
  });
});

server.listen(PORT, () => console.log(`Sketch Sprint running on http://localhost:${PORT}`));
