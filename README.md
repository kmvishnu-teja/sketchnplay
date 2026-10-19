# Sketch Sprint

A real-time multiplayer **draw & guess** party game for 2–8 players. One player draws a
secret word on a shared canvas while everyone else guesses from their own device — fastest
correct guess earns the most points.

Built with Node.js, Express and Socket.IO. No build step, no database.

## Run it

```bash
cd sketch-sprint
npm install
node server.js
```

Then open **http://localhost:3000** in your browser.

### Play with friends (not just your own machine)

Everyone needs to reach your server. Pick one:

- **Same Wi-Fi:** find your computer's local IP (e.g. `192.168.1.42`) and have friends
  open `http://192.168.1.42:3000` in their phone/laptop browser.
- **Over the internet:** deploy it — it's a plain Node app. E.g. on Render/Railway/Fly.io:
  set the start command to `node server.js` and it will use the provided `PORT`.

## How to play

1. One player clicks **Create room**, picks a nickname, and shares the 4-letter room code
   (or the invite link) with the others.
2. Everyone joins from their own device with a nickname. The room holds up to 8 players.
3. The host clicks **Start game**.
4. Each round, one player is the **drawer**:
   - The drawer picks 1 of 3 secret words (harder words are worth more to everyone).
   - They draw on the canvas — colors, brush sizes, clear button included.
   - Everyone else watches the drawing appear live and types guesses.
5. Rounds rotate so **every player draws once**. Highest total score wins — podium at the end.

## Rules & scoring

- **Guesser:** first correct guess earns the most. Points = `round((500 + 500 × timeLeft / roundTime) × difficultyMultiplier)`.
  - Difficulty multipliers: easy ×1, medium ×1.25, hard ×1.5.
  - A correct guess is hidden from the feed (shown as "✔ Name guessed it!") so late
    guessers can't just copy it.
- **Drawer:** +250 points for every player who guesses correctly — draw well!
- **Round ends** when everyone has guessed, when the 60-second timer runs out, or if the
  drawer leaves. The word is revealed, then the next round starts automatically.
- **Game ends** after every player has drawn once. Standings are sorted, top 3 get medals.
- The host can hit **Play again** to return everyone to the lobby.

Names are case-insensitive for guesses; the drawer can't guess their own word.

## Configuration

| Env var         | Default | What it does                          |
|-----------------|---------|---------------------------------------|
| `PORT`          | `3000`  | HTTP/WebSocket port                   |
| `ROUND_TIME_MS` | `60000` | Drawing time per round (milliseconds) |

## Tests

```bash
# start the server with short rounds, then in another terminal:
npm test              # 19 socket-level integration tests
npm run test:e2e      # full UI test in headless Chromium (needs server on :3001)
```

Integration tests cover: room creation/joining, host rules, word picking, live stroke
sync, guess handling, scoring math, drawer disconnects, timer expiry, game-over
standings, play-again, and room capacity. The E2E test drives two real browser
windows through the whole game: lobby → drawing → guessing → round-over → game-over.

## Project layout

```
server.js          game server: rooms, rounds, timers, scoring
words.js           160-word bank (easy / medium / hard)
public/
  index.html       home: create / join a room
  game.html        lobby + game board + overlays
  game.js          client: canvas, guesses, timer, scoreboard
  style.css        theme
test/
  integration.js   socket-level tests
  e2e.js           headless-browser UI tests
```
