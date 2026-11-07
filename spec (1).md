# SPEC: Head-to-Head Online Falling-Block Game

**Audience:** Claude Code (implementer). **Goal:** a polished, demo-ready, cheat-resistant two-player online Tetris-style game with a deterministic, fully tested rules engine.

Read this whole document before writing code. Build in the milestone order in §12. Where this spec is silent, choose the simplest correct option and record it in `DECISIONS.md` (one line per decision, with the reason). Do not add features outside this spec until every must-have passes its acceptance checks.

---

## 1. Requirements

### Game rules, per player board
| ID | Rule |
|----|------|
| R1 | Board is **10 columns wide, 20 rows tall**. |
| R2 | The 7 standard tetrominoes: **I, O, T, S, Z, J, L**. |
| R3 | Player can **move left/right, rotate, soft drop (faster), hard drop (instant)**. |
| R4 | A completed row disappears and **everything above moves down**. |
| R5 | A player **loses when a new piece cannot enter the board**. |

### Must-haves
| ID | Requirement |
|----|-------------|
| M1 | One player creates a game and gets a **shareable link and code**; a second player joins with either. |
| M2 | Each player sees **their own board and the opponent's board, live**. |
| M3 | **Both players get the same piece sequence.** |
| M4 | Clearing 2+ rows at once sends garbage: **2→1, 3→2, 4→4** (1→0). Each garbage row has **exactly one empty cell**. |
| M5 | Last player standing wins; **both screens show the result**. |
| M6 | Handle a player **leaving or disconnecting mid-game**. |
| M7 | **Assume players will cheat.** |
| M8 | **Automated tests** for rules: line clears, rotation, wall/piece collisions, garbage. |

### Nice-to-haves (only after M1–M8 pass)
N1 Rematch button · N2 Next-piece preview · N3 Ghost piece · N4 Spectators

### Explicitly out of scope
Accounts, matchmaking, persistence/database, hold piece, T-spin/combo/back-to-back bonuses, garbage cancelling, mobile touch controls, horizontal scaling. List these in the README as "future work".

---

## 2. Architecture

**Core principle: the server is the only source of truth.** Clients send *intents* (e.g. "rotate clockwise"), never state. The server runs the real simulation for both boards using a shared, pure, deterministic engine. Clients run the same engine only to *predict* their own inputs so controls feel instant; server snapshots always win.

```
┌──────────── Browser (Player A) ────────────┐        ┌──────────── Node server ─────────────┐
│ Keyboard → InputController (DAS/ARR)       │ intents│ Room (code ABC234)                    │
│   → predict with @game/engine (own board)  │───────▶│   validate (zod, rate limit, seat)    │
│   → render boards on <canvas>              │◀───────│   Match: 60 Hz fixed-step loop        │
│                                            │snapshot│   PlayerSim A ◀─garbage─▶ PlayerSim B │
└────────────────────────────────────────────┘        │   piece queue from server-only RNG    │
                 (Player B identical)                  │   broadcast snapshots to A, B, specs  │
                                                       └───────────────────────────────────────┘
```

### Tech stack (use exactly this)
- **TypeScript (strict)** everywhere, **pnpm workspaces**, Node 20+.
- `packages/engine`: pure rules engine. **No I/O, no `Date`, no `Math.random`, no floats in game state.** Same code runs on server and client.
- `packages/protocol`: message types and **zod** schemas, shared by client and server.
- `apps/server`: Node + **Fastify** + **@fastify/websocket**. Serves the built client in production.
- `apps/client`: **Vite + React** for the UI shell (lobby, overlays) and **HTML `<canvas>`** for boards.
- Tests: **Vitest** (engine + server integration), **fast-check** (property tests), **Playwright** (one end-to-end smoke test).
- Lint/format: ESLint + Prettier. CI: GitHub Actions running `typecheck`, `lint`, `test`.

### Repository layout
```
/packages/engine/src/{types,pieces,srs,board,rng,bag,player,garbage,config}.ts
/packages/engine/test/*.test.ts
/packages/protocol/src/{messages,schemas}.ts
/apps/server/src/{index,rooms,match,connection,rateLimit,codes}.ts
/apps/server/test/*.test.ts
/apps/client/src/{main.tsx,App.tsx,net/,game/,render/,ui/}
/e2e/smoke.spec.ts
README.md  DECISIONS.md  Dockerfile  .github/workflows/ci.yml
```

### Root scripts
`pnpm dev` (server + client with hot reload), `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm start` (production, single port, env `PORT`, default 3000), `pnpm e2e`.

---

## 3. Engine specification (`packages/engine`)

### 3.1 Coordinates and board
- Grid: `x` = column 0..9 (left→right), `y` = row 0..19 (**top→bottom**; y grows downward).
- `Board` = 20 rows × 10 cells. Cell value: `null` (empty) or a `CellKind` = `'I'|'O'|'T'|'S'|'Z'|'J'|'L'|'G'` (`G` = garbage).
- There are **no hidden rows** above the board. Any cell with `y < 0`, `y > 19`, `x < 0` or `x > 9` counts as a collision.
- Serialized form (used in the protocol and in test fixtures): an array of 20 strings of length 10, `.` for empty, a letter for filled. Provide `parseBoard(rows: string[])` and `serializeBoard(board)`; tests must use them for readable fixtures.

### 3.2 Pieces and spawn orientation
Each piece is defined by its cells inside a bounding box in its spawn orientation (state `0`). Rotation states are `0, R, 2, L`. Rotating clockwise maps a cell `(x, y)` in an `n×n` box to `(n-1-y, x)`; counter-clockwise is the inverse. This reproduces SRS rotation exactly.

| Piece | Box | Spawn cells (x,y) in box | Box origin on board (left, top) |
|------|-----|--------------------------|---------------------------------|
| I | 4×4 | (0,1)(1,1)(2,1)(3,1) | (3, −1) → occupies row 0, cols 3–6 |
| O | 2×2 | (0,0)(1,0)(0,1)(1,1) | (4, 0) → cols 4–5, rows 0–1; never rotates |
| T | 3×3 | (1,0)(0,1)(1,1)(2,1) | (3, 0) |
| S | 3×3 | (1,0)(2,0)(0,1)(1,1) | (3, 0) |
| Z | 3×3 | (0,0)(1,0)(1,1)(2,1) | (3, 0) |
| J | 3×3 | (0,0)(0,1)(1,1)(2,1) | (3, 0) |
| L | 3×3 | (2,0)(0,1)(1,1)(2,1) | (3, 0) |

### 3.3 Rotation with SRS wall kicks
On rotate, try each kick offset in order; the first position with no collision is used. If all fail, the rotation is rejected and **state is unchanged**. The O piece never rotates or kicks (rotate is a no-op with no state change).

Offsets below use the standard SRS convention where **+y is UP**. Because our grid's y grows downward, **apply each offset as `(dx, -dy)`**.

**J, L, S, T, Z**
| Transition | Tests |
|---|---|
| 0→R | (0,0) (−1,0) (−1,+1) (0,−2) (−1,−2) |
| R→0 | (0,0) (+1,0) (+1,−1) (0,+2) (+1,+2) |
| R→2 | (0,0) (+1,0) (+1,−1) (0,+2) (+1,+2) |
| 2→R | (0,0) (−1,0) (−1,+1) (0,−2) (−1,−2) |
| 2→L | (0,0) (+1,0) (+1,+1) (0,−2) (+1,−2) |
| L→2 | (0,0) (−1,0) (−1,−1) (0,+2) (−1,+2) |
| L→0 | (0,0) (−1,0) (−1,−1) (0,+2) (−1,+2) |
| 0→L | (0,0) (+1,0) (+1,+1) (0,−2) (+1,−2) |

**I**
| Transition | Tests |
|---|---|
| 0→R | (0,0) (−2,0) (+1,0) (−2,−1) (+1,+2) |
| R→0 | (0,0) (+2,0) (−1,0) (+2,+1) (−1,−2) |
| R→2 | (0,0) (−1,0) (+2,0) (−1,+2) (+2,−1) |
| 2→R | (0,0) (+1,0) (−2,0) (+1,−2) (−2,+1) |
| 2→L | (0,0) (+2,0) (−1,0) (+2,+1) (−1,−2) |
| L→2 | (0,0) (−2,0) (+1,0) (−2,−1) (+1,+2) |
| L→0 | (0,0) (+1,0) (−2,0) (+1,−2) (−2,+1) |
| 0→L | (0,0) (−1,0) (+2,0) (−1,+2) (+2,−1) |

### 3.4 Randomizer: 7-bag
- `createRng(seed: number)` returns a deterministic PRNG (implement **mulberry32** or **xoshiro128\*\***; 32-bit integer math only).
- `createBag(rng)` yields pieces in bags: each bag is a Fisher–Yates shuffle of all 7 pieces. Every bag-aligned group of 7 contains each piece exactly once.
- Same seed ⇒ identical infinite sequence.

### 3.5 Timing (fixed step, 60 ticks per second)
All timing is in integer **ticks**. Constants live in `config.ts` and are exported:

| Constant | Value | Meaning |
|---|---|---|
| `TICK_RATE` | 60 | ticks per second |
| `GRAVITY_TABLE` | `[60,48,37,28,21,16,11,8,6,4,3,2,1]` | ticks per row of fall, indexed by speed level |
| `LEVEL_UP_TICKS` | 1800 | speed level rises every 30 s of match time (capped at the last entry) |
| `SOFT_DROP_TICKS_PER_ROW` | 2 | fall interval while soft drop is held (or gravity, if faster) |
| `LOCK_DELAY_TICKS` | 30 | 0.5 s grounded before locking |
| `MAX_LOCK_RESETS` | 15 | successful moves/rotates while grounded that reset lock delay |
| `PREVIEW_COUNT` | 5 | upcoming pieces sent to the board's owner |

### 3.6 Player state and API
```ts
type Action =
  | { type: 'moveLeft' } | { type: 'moveRight' }
  | { type: 'rotateCW' } | { type: 'rotateCCW' }
  | { type: 'softDropStart' } | { type: 'softDropStop' }
  | { type: 'hardDrop' };

interface PlayerState {
  board: Board;
  active: ActivePiece | null;      // kind, rotation, x, y
  queue: PieceKind[];              // upcoming pieces (refilled from a PieceSource)
  pendingGarbage: GarbageAttack[]; // { rows: number; holeColumn: number }[]
  softDrop: boolean;
  gravityCounter: number; lockCounter: number; lockResets: number; lowestY: number;
  linesCleared: number; garbageSent: number; piecesPlaced: number;
  toppedOut: boolean;
}

applyAction(state, action): { state; events: EngineEvent[] }   // pure
tick(state, level): { state; events: EngineEvent[] }            // pure, advances one tick
receiveGarbage(state, attack): PlayerState                      // queues into pendingGarbage
ghostPosition(state): ActivePiece | null                         // used by N3
```
Events: `moved`, `rotated(kickIndex)`, `locked`, `linesCleared(count, rows)`, `attack(rows)`, `garbageInserted(rows)`, `spawned(kind)`, `toppedOut(reason)`.

All functions are **pure**: they return new state and never mutate inputs. This is what makes prediction, replay and testing simple.

### 3.7 Rule details (precise)
1. **Move left/right:** shift one column if no collision; otherwise no-op.
2. **Gravity:** each tick `gravityCounter++`; when it reaches the current fall interval, reset it and try to move down one row. If the piece cannot move down, it is *grounded*.
3. **Soft drop:** while held, fall interval = `min(gravity, SOFT_DROP_TICKS_PER_ROW)`. Soft drop does not bypass lock delay.
4. **Lock delay:** while grounded, `lockCounter++` each tick; lock when it reaches `LOCK_DELAY_TICKS`. A successful move or rotate while grounded resets `lockCounter` to 0 if `lockResets < MAX_LOCK_RESETS`, and increments `lockResets`. `lockResets` resets to 0 only when the piece reaches a new lowest row (`lowestY`).
5. **Hard drop:** move down until collision, then **lock immediately**.
6. **On lock, in this exact order:**
   1. Write the piece's cells to the board.
   2. Find all full rows (any rows, not necessarily adjacent); remove them; rows above shift down; empty rows are added at the top. (R4)
   3. Compute attack from cleared count: `{0:0, 1:0, 2:1, 3:2, 4:4}`. If > 0, emit `attack(n)` (the server routes it to the opponent). (M4)
   4. Insert **all** `pendingGarbage` at the bottom of the board, in arrival order: each garbage row is 9 `G` cells and 1 empty cell at the attack's `holeColumn`; existing rows shift up. If any filled cell would be pushed above row 0, the player **tops out** (overflow). Clear `pendingGarbage`.
   5. Spawn the next piece from the queue at its spawn position (§3.2). If any spawn cell collides, the player **tops out** (R5) and the piece is not placed.
7. Garbage is only ever inserted between lock and spawn, so it can never overlap the active piece.
8. A topped-out state ignores all further actions and ticks (returns unchanged state).

### 3.8 Garbage hole columns
The engine does not choose hole columns. The server chooses them with its own server-only RNG and passes them in through `receiveGarbage`. All rows from **one attack** share the same hole column, so a clean well can be dug; separate attacks get independent random columns.

---

## 4. Server specification (`apps/server`)

### 4.1 Rooms and codes
- Everything runs over one WebSocket at `/ws`. HTTP serves the client and `GET /healthz`.
- **Room code:** 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I/L), generated with `crypto.randomInt`, unique among live rooms, case-insensitive on input. Share link: `https://<host>/g/<CODE>`.
- Room lifecycle: `waiting` → `countdown` (3 s) → `playing` → `finished` (→ `countdown` again on rematch).
- A room with no connected players for 2 minutes, or a `waiting` room older than 15 minutes, is deleted.
- Seats: `A` (creator) and `B` (joiner). A third connection to a full room becomes a **spectator** (N4); before N4 exists it receives `error: ROOM_FULL`.
- On create/join, the server issues a **seat token** (128-bit random, base64url). The token is the only way to act as that seat or to reconnect. The client stores it in `sessionStorage` under `token:<CODE>`, so a page refresh rejoins automatically.

### 4.2 Match loop
- When both seats are connected in `waiting`, start a 3-second countdown (send `startsAt` and `serverNow` so the client can correct for clock skew).
- At start the server generates a piece seed with `crypto.randomInt(2**31)` and a separate seed for garbage holes. **Neither seed is ever sent to clients.** Each player gets their own bag instance created from the same piece seed, so sequences are identical (M3) without exposing future pieces.
- Fixed-step loop at 60 Hz using an accumulator over `performance.now()` (catch up at most 5 ticks per wake to avoid a death spiral). Each tick:
  1. Drain each player's input queue (max 10 actions per player per tick; the rest stay queued, queue capped at 60) and `applyAction` them in order.
  2. `tick` each player's state.
  3. Route `attack` events: `receiveGarbage(opponent, { rows, holeColumn: holeRng() })`.
  4. Check top-outs. Exactly one topped out → the other wins. Both in the same tick → **draw**.
  5. Mark changed players dirty; send snapshots at most every 2 ticks (30 Hz), and immediately after any lock.
- Speed level is shared by both players and derived from match ticks elapsed (§3.5).

### 4.3 What clients receive (information hiding)
- To the **owner** of a board: board, active piece, next `PREVIEW_COUNT` pieces, pending garbage, `lastAckSeq`, stats, tick.
- To the **opponent and spectators**: board, active piece, **next 1 piece only**, pending garbage total, stats. Never the seed or further queue.

### 4.4 Disconnects and leaving (M6)
- **Explicit leave** (Leave button sends `leave`): immediate forfeit; opponent wins with reason `OPPONENT_LEFT`.
- **Unexpected disconnect** (socket closed, or no pong for 10 s; server pings every 3 s): the match **pauses for both players**. The opponent sees "Opponent disconnected, waiting 20 s". If the player reconnects with their seat token within **20 s**, both see a 3 s countdown and play resumes from the exact paused state.
- Anti-abuse: each player may cause at most **3 pauses per match**. A 4th disconnect, or grace expiry, is an immediate forfeit with reason `OPPONENT_DISCONNECTED`.
- If both players disconnect, the match stays paused; whoever's grace expires first forfeits; if both expire together, the room ends as abandoned.
- Disconnect during `waiting`/`countdown`: return the room to `waiting` and hold the seat for that token for 2 minutes.
- A reconnect with a valid token **replaces** any older socket for that seat (the old one is closed with reason `REPLACED`).

### 4.5 Anti-cheat (M7): implement every row and add a server test for each
| Threat | Defense |
|---|---|
| Client sends a fake board, fake line clears or fake garbage | The protocol has **no message that carries game state**. The server computes everything. |
| Choosing or peeking future pieces | Seed is server-only; owner sees 5 upcoming pieces, opponent 1. |
| Speed hack / slowing gravity | Gravity and lock delay run on the server clock; client timing is ignored. |
| Input flooding / inhuman macros | Token bucket per player: 30 actions/s sustained, burst 20. Over-limit actions are dropped and counted; 200 drops in a match → disconnect with `RATE_LIMITED`. |
| Malformed or oversized messages | Max frame 1 KB; zod-validate every message; invalid or unknown → `error: BAD_MESSAGE`; 20 bad messages → disconnect. |
| Acting as the other player / seat hijacking | The seat is bound to the socket after the token check; actions apply only to that seat. Tokens compared with `crypto.timingSafeEqual`. |
| Replaying or reordering inputs | Each `input` carries a strictly increasing integer `seq`; non-increasing `seq` is rejected. |
| Spectator sends inputs | Ignored; reply `error: NOT_A_PLAYER`. |
| Inputs before start, after game over or while paused | Rejected with `error: NOT_PLAYING`. |
| Disconnect abuse to pause the opponent | Pause cap and grace limit (§4.4). |
| XSS via player names | Names trimmed, 1–16 chars, rendered as text only (never `innerHTML`). |

Known limitation for the README: screen-reading bots and assistive overlays cannot be fully prevented in a browser game. Joining your own room from two tabs is allowed (useful for local testing) and gives no advantage, since each seat still plays by the server's rules.

---

## 5. Protocol (`packages/protocol`)

JSON over WebSocket. Every message has a `type`. Define TypeScript types and zod schemas for all of them.

**Client → Server**
```ts
{ type: 'create', name: string }
{ type: 'join', code: string, name: string, asSpectator?: boolean }
{ type: 'rejoin', code: string, token: string }
{ type: 'input', seq: number, action: Action }
{ type: 'leave' }
{ type: 'rematch' }                                    // N1
{ type: 'pong', t: number }
```

**Server → Client**
```ts
{ type: 'created', code, token, seat: 'A' }
{ type: 'joined', code, token?, seat: 'A' | 'B' | 'spectator' }
{ type: 'room', status, players: { A?: PlayerInfo, B?: PlayerInfo }, spectators: number }
{ type: 'countdown', startsAt: number, serverNow: number }
{ type: 'snapshot', tick, level, you?: OwnView, players: { A?: PublicView, B?: PublicView } }
{ type: 'paused', seat, graceEndsAt, serverNow, pausesLeft }
{ type: 'resumed', startsAt, serverNow }
{ type: 'gameOver', winner: 'A' | 'B' | null,
  reason: 'TOP_OUT' | 'OPPONENT_LEFT' | 'OPPONENT_DISCONNECTED' | 'DRAW', stats }
{ type: 'rematchStatus', A: boolean, B: boolean }      // N1
{ type: 'error', code: string, message: string }
{ type: 'ping', t: number }
```
`PlayerInfo = { name, connected }`. Boards are serialized as 20 strings (§3.1).

---

## 6. Client specification (`apps/client`)

### 6.1 Screens
1. **Home:** name field, **Create game** button, **Join** code field and button. Opening `/g/:code` pre-fills the code and focuses the name field.
2. **Lobby (waiting):** large room code, **Copy link** button (shows "Copied!"), "Waiting for opponent…", list of players.
3. **Game:** own board large, opponent board about 60% size beside it, names above each, a pending-garbage meter (red bar beside each board, height = pending rows), stats (lines, garbage sent, pieces), speed level, connection dot with ping in ms, Leave button with confirm.
4. **Overlays:** 3-2-1 countdown; "Opponent disconnected, 17 s" with a live timer; result overlay **"You win" / "You lose" / "Draw"** with reason and stats, plus Rematch (N1) and Back to home. Both players must see their result (M5).

### 6.2 Controls
| Key | Action |
|---|---|
| ← / → | Move (DAS 170 ms, ARR 50 ms, implemented client-side; each repeat sends one move action) |
| ↑ or X | Rotate clockwise |
| Z or Ctrl | Rotate counter-clockwise |
| ↓ | Soft drop (`softDropStart` on keydown; `softDropStop` on keyup and on window blur) |
| Space | Hard drop |

Show a small controls legend. Prevent page scrolling on these keys. Ignore OS key-repeat events (DAS/ARR is ours).

### 6.3 Prediction and reconciliation (own board only)
- Keep `serverState` (latest own snapshot) and `pendingInputs` (sent but not yet acknowledged).
- On key: create `{seq, action}`, send it, append to `pendingInputs`, and set `displayState = replay(serverState, pendingInputs)` using the engine's `applyAction` (no local `tick`).
- On own snapshot: `serverState = snapshot.you`; drop inputs with `seq <= lastAckSeq`; recompute `displayState`.
- Gravity, locking and garbage are shown only from server snapshots. The opponent board is rendered directly from snapshots with no prediction.

### 6.4 Rendering and look
- Canvas with `requestAnimationFrame`, device-pixel-ratio aware. Cell size scales to fit the viewport (target ≥ 900 px wide; scale down below that without breaking).
- Standard piece colors (I cyan, O yellow, T purple, S green, Z red, J blue, L orange, G gray) with a subtle bevel so cells read as blocks; faint grid lines.
- Line clear: 150 ms flash on cleared rows (visual only; never delays input). Incoming garbage: quick upward nudge/shake.
- Dark theme, clean typography, deliberate spacing. This is a client demo; it should look finished.

---

## 7. Nice-to-haves (only after milestones 1–7 in §12 are green)
- **N1 Rematch:** after game over each player clicks Rematch; when both have, generate new seeds, keep seats/room/code, run the 3 s countdown. Show "Waiting for opponent to accept…". If the opponent left, show "Opponent left" and disable the button.
- **N2 Next preview:** own board shows the next 5 pieces (already in the snapshot); opponent board shows the next 1.
- **N3 Ghost:** translucent outline at `ghostPosition` on the own board.
- **N4 Spectators:** joining a full room, or `/g/CODE?watch=1`, shows both boards read-only with names; players see a spectator count.

---

## 8. Testing (M8)

### 8.1 Engine unit tests (Vitest), all required
Use `parseBoard` fixtures so tests read like pictures of the board.

**Movement and collision**
1. Piece moves left/right on an empty board.
2. Piece cannot move through the left wall, right wall or floor.
3. Piece cannot move into an occupied cell (left, right and down).
4. Gravity moves the piece down one row after the configured number of ticks.

**Rotation**
5. Each of the 7 pieces returns to its original cells after four CW rotations.
6. CW followed by CCW returns to the original state.
7. O piece rotation leaves the state unchanged.
8. T piece against the left wall rotates using a kick (assert kick index and final cells).
9. Vertical I piece against the right wall rotates to horizontal via the I kick table.
10. A rotation that fails all 5 kicks leaves the state unchanged.
11. A known kick into a slot (T-spin-style fixture) lands in the expected cells.
12. Rotation never places a cell above row 0.

**Drops and locking**
13. Hard drop lands at the ghost position and locks immediately.
14. Soft drop falls at `SOFT_DROP_TICKS_PER_ROW`.
15. A grounded piece locks after exactly `LOCK_DELAY_TICKS`.
16. Moving while grounded resets lock delay, at most `MAX_LOCK_RESETS` times.

**Line clears**
17. Single, double, triple and four-row clears remove the right rows and shift everything above down.
18. Non-adjacent full rows (e.g. rows 17 and 19) clear correctly; the row between is preserved and shifted.
19. A row with one empty cell is not cleared.
20. Lines cleared are tracked in stats.

**Garbage**
21. Attack table: 1→0, 2→1, 3→2, 4→4.
22. Garbage rows insert at the bottom with exactly 9 filled cells and the hole at the given column; the existing stack shifts up by the row count.
23. All rows of one attack share the hole column; two attacks may differ.
24. Pending garbage is inserted only at lock, after line clears, before spawn.
25. A garbage row is cleared by filling its hole.
26. Garbage that pushes a filled cell above row 0 tops the player out.

**Spawning, loss, randomizer, purity**
27. Each piece spawns at the position in §3.2.
28. Spawn blocked by the stack ⇒ `toppedOut`; further actions and ticks are no-ops.
29. 7-bag: every bag-aligned group of 7 contains all 7 pieces exactly once (check 100 bags).
30. Same seed ⇒ identical first 1,000 pieces; different seeds ⇒ different sequences.
31. `applyAction` and `tick` never mutate their inputs (deep-freeze inputs in tests).

**Property test (fast-check):** for random action/tick sequences, no cell is ever out of bounds, the active piece never overlaps filled cells, and no full row ever remains on the board after a lock.

### 8.2 Server integration tests (Vitest, real WebSocket clients against a server on a random port)
The server must accept injectable dependencies (`seedProvider`, `holeRng`, `clock`) and a manual-tick mode so these tests are deterministic.
1. Create → receive code and token; join with code → both get `room` with both players; countdown starts.
2. Both players receive the same first 20 spawned pieces.
3. A scripted 2-line clear by A puts exactly 1 pending garbage row on B; 4 lines puts 4.
4. Top-out ⇒ both clients receive `gameOver` with the correct winner.
5. Simultaneous top-out ⇒ `DRAW`.
6. `leave` mid-game ⇒ opponent wins with `OPPONENT_LEFT`.
7. Socket drop ⇒ `paused`; rejoin with token within grace ⇒ `resumed` with state preserved; grace expiry ⇒ `OPPONENT_DISCONNECTED`.
8. 4th disconnect ⇒ immediate forfeit.
9. Rejoin with a wrong token is rejected.
10. Inputs with non-increasing `seq` are rejected.
11. Flooding beyond the rate limit drops actions; sustained flooding disconnects.
12. Malformed JSON, unknown type, or oversized frame ⇒ `BAD_MESSAGE`.
13. Third joiner becomes spectator (or `ROOM_FULL` before N4); spectator inputs ⇒ `NOT_A_PLAYER`.
14. The opponent view never includes more than 1 upcoming piece, and no message ever contains a seed.

### 8.3 End-to-end (Playwright)
One smoke test: two browser contexts; A creates, B opens the share link and joins; both see the countdown and two boards; both hard-drop repeatedly until someone tops out; both pages show the result overlay with opposite outcomes (or both "Draw").

---

## 9. Non-functional requirements
- One match uses well under 5% of a CPU core; snapshots are small (a board is 200 characters).
- Controls feel instant locally via prediction and play correctly at 150 ms round trip.
- No `any` in engine or protocol. `pnpm typecheck` and `pnpm lint` are clean.
- Engine line coverage ≥ 90% (`vitest --coverage`).
- Structured logs (pino via Fastify) for room created/joined/started/ended, disconnects, and every anti-cheat trigger.

---

## 10. Deliverables
- Working app: `pnpm install && pnpm build && pnpm start`, open `http://localhost:3000`, play across two browsers.
- Multi-stage `Dockerfile` (Node 20 alpine) and short deploy notes for any WebSocket-capable host (e.g. Fly.io, Render).
- `README.md` with: a one-paragraph pitch, how to run, how to play, the architecture diagram, a **"How we prevent cheating"** section (summarizing §4.5), a **"How the rules are tested"** section, design decisions, known limitations, future work.
- `DECISIONS.md` as described at the top.

---

## 11. Definition of done
- [ ] R1–R5 implemented exactly as in §3 and covered by §8.1 tests.
- [ ] M1–M8 each demonstrably work (manual check plus the listed tests).
- [ ] All tests pass in CI; typecheck and lint clean.
- [ ] Two people on different networks can play a full match from a deployed URL.
- [ ] README explains architecture, anti-cheat and testing well enough for a non-author to evaluate.
- [ ] N1–N4 implemented after the above, each with at least one test.

---

## 12. Build order (milestones)
Finish each milestone, run its checks, and commit before moving on.

1. **Scaffold:** pnpm workspace, TS strict, ESLint/Prettier, Vitest, CI workflow, empty packages. *Check:* `pnpm test` runs.
2. **Engine:** all of §3 plus all §8.1 tests. *Check:* tests green, coverage ≥ 90%.
3. **Protocol:** types, zod schemas, schema tests.
4. **Server lobby:** rooms, codes, tokens, create/join/rejoin, countdown. *Check:* §8.2 tests 1, 9, 13.
5. **Server match:** authoritative loop, shared sequence, garbage routing, game over, information hiding. *Check:* §8.2 tests 2–5, 14.
6. **Client:** home, lobby, canvas boards, DAS/ARR input, prediction and reconciliation, overlays. *Check:* manual two-browser game end to end.
7. **Disconnects and anti-cheat hardening:** §4.4 and §4.5. *Check:* §8.2 tests 6–8, 10–12.
8. **Nice-to-haves:** N2 preview → N3 ghost → N1 rematch → N4 spectators.
9. **Polish and ship:** visual polish, Playwright smoke test, README, Dockerfile, deploy.
