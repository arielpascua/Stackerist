# Stackerist — Design

**Date:** 2026-11-07 · **Status:** draft for approval · **Owner:** Ariel (first player and judge)
**Supersedes as source of truth:** `spec (1).md` (the "source spec"). Where this document and the
source spec disagree, this document wins. Where this document says "as in source spec §x", the
source spec's detail (tables, shapes, constants) is adopted unchanged.

---

## 1. Intent — what this is and why

Stackerist is a head-to-head online falling-block game. Two players each have their own board,
race to clear lines, and attack each other with garbage rows. Last one standing wins.

It is being built for a real household first. Ariel plays on a desktop, Ariel's daughter on her
laptop. Today they share one Wi-Fi network, but the game has to work from different homes so she can
play her friends too. Ariel is the first tester and the judge of whether it is good.

**The bar is "very competitive and fun".** In Ariel's words, a match gets tense when *the pieces
fall faster and combos are stacked*. So the game has two engines of tension:

1. **Speed.** Both players share one speed level that rises every 30 seconds, from one row per
   second to near-instant falling (max speed after ~6 minutes). Long matches are forced to end.
2. **Combos you can fight back with.** Clearing lines on consecutive pieces builds a combo that
   hits harder each step, and your attacks first cancel garbage that is headed your way. Comebacks
   are possible, and garbage piles up behind a chain until it breaks.

Ending a match feels like a broadcast "final score": both players see the result, both
players' stats, and **their own best combo moment** as a frozen picture of the board.

### Anti-goals (failure even if it "works")
- **Unplayable:** any input bug, desync, stuck state, or crash during a match.
- **Laggy:** inputs that feel delayed on your own board, or a stuttering opponent board.
- **Not-so-good UI:** anything that looks unfinished, generic, or cramped on a laptop.
- **A look-alike of a famous game:** no classic falling-block color set, no borrowed name or
  trade dress. Mechanics are genre-standard; the look is our own.
- **Keeping kids' data:** no accounts, no database, nothing about players persists after a room ends.

## 2. Goals, non-goals

**Goals:** a deployed, cheat-resistant two-player match playable from two different networks; a
pure, deterministic, fully tested rules engine; the Prime Time visual identity; combos with
cancelling; a best-moment highlight on the result screen; rematch, preview, ghost and spectators.

**Non-goals (future work, list in README):** accounts, matchmaking, persistence/database, hold
piece, T-spin bonuses, back-to-back bonuses, mobile touch controls, horizontal scaling, handicaps,
"save best moment as image", sound effects beyond the music (Q5).

> Changed from the source spec: **combo bonuses and garbage cancelling are now IN scope** (Ariel,
> 2026-11-07). T-spin and back-to-back stay out (default proposed, not objected to).

## 3. Decided in conversation (Ariel's calls)

| Decision | Detail |
|---|---|
| Combos in | Consecutive clearing locks build a combo with a bonus table (§5.2). |
| Garbage cancelling in | Your attack pays down your own incoming garbage first; the remainder goes to the opponent (§5.3). |
| Players & devices | Desktop + laptop, keyboard only. Same Wi-Fi now; has to work across homes. |
| Hosting | **Railway** (CLI already installed and logged in on this machine). |
| Look | **Prime Time** — sports-broadcast scoreboard direction (§7). Approved "good for the UI for now". |
| Generated art | Logo, arena backdrop and win-screen art from `gpt-image-bridge`, approved. Kept in `design/concept-art/`. |
| Best moment | On the result screen **both** players see their own best combo moment (§5.4). |
| Signature features | **Duel identity** (standoff countdown ending on DUEL!, garbage projectiles, danger pulse, music that speeds up), a **post-match report** with a stack-height chart, and **best-of-3 series** (rounds 1 to 3). Name stays **Stackerist**. (§5.6, §6.2; Ariel, 2026-11-07) |
| Netcode at top speed | **Smart prediction** (§6.1): the client runs its own board slightly ahead and stamps each input with the tick it was made for, so moves land where the player saw them at every speed level. Chosen after the builder check showed level 12 would otherwise land moves 3–5 rows low. |

## 4. My calls (builder defaults — check these)

- **Laptop fit:** the whole game screen fits a 1280×600 CSS-pixel viewport (a typical laptop at
  125–150% scaling, minus browser toolbars) with no scrolling, and scales down below that.
- **Combo bonus numbers** (§5.2) and the "garbage waits while you chain" rule (§5.3).
- **Best-moment tie-breaks** (§5.4); spectators see both players' best moments.
- **Phones:** home and lobby work at 390px wide without horizontal scroll; on a touch-only device
  the game shows "Stackerist needs a keyboard" instead of a broken board. (Touch controls stay out.)
- **Fonts self-hosted** (`@fontsource`), not loaded from Google at runtime.
- **Art shipped optimized:** generated PNGs (1.2–1.6 MB each) converted to WebP/AVIF at display
  sizes; the logo gets a transparent-background version (its flat background keyed out, or
  regenerated with a transparent background if keying leaves fringes).
- **Lose / draw screens** reuse the arena backdrop, dimmed, with no confetti. No new art needed.
- **Different-networks proof:** one player on a phone hotspot against the deployed URL.
- *(Added from the builder check)* **Hard drop** is predicted fully through the lock on the own
  board; "locking only from snapshots" applies to lock-delay locks and to garbage.
- **Ping in ms:** the server measures round-trip time from ping/pong and sends it back in `ping`.
- **Match clock and top-out time** on screen are derived from ticks, never from wall clocks.
- **Phones and tablets:** a touch-only device gets a warning before taking a seat and an offer to
  watch instead; any physical key press counts as proof of a keyboard (iPads with keyboards work).
- **Logs** carry room codes and seats, never player names or IP addresses.
- **Failed joins** are rate-limited per IP, because Q4's "private code" reasoning depends on codes
  not being guessable by brute force.
- **macOS:** Ctrl+arrow is taken by the OS there, so the legend shows Z as the rotate-back key.
- **Deploys** go out with `railway up` from this machine; `railway.json` watch patterns only
  matter if Railway is later connected to GitHub, and are kept for that case.

## 5. Rules engine (`packages/engine`)

Everything in source spec §3 applies (board, coordinates, pieces and spawn table §3.2, SRS kicks
§3.3, 7-bag §3.4, timing constants §3.5, state/API §3.6, rule details §3.7, hole columns §3.8),
**except the lock sequence, which this section replaces.**

### 5.1 Lock sequence (replaces source spec §3.7 item 6)
On lock, in this exact order:
1. Write the piece's cells to the board.
2. Find all full rows (adjacent or not). **Capture the best-moment candidate here** (board with
   the piece written, before removal). Remove the full rows; rows above shift down; empty rows
   are added at the top.
3. **If at least one row cleared:** `combo += 1`; `attack = LINE_ATTACK[cleared] + COMBO_BONUS(combo)`;
   cancel against own pending garbage (§5.3); emit `attack(leftover)` if leftover > 0.
   Pending garbage is **not** inserted on a clearing lock.
4. **If no rows cleared:** `combo = 0`; insert **all** pending garbage at the bottom in arrival
   order (9 `G` + 1 hole at the attack's `holeColumn`, existing rows shift up); if any filled
   cell would be pushed above row 0 the player tops out; clear `pendingGarbage`.
5. Spawn the next piece at its spawn position; if any spawn cell collides, top out (R5).

### 5.2 Combo
- `combo` counts consecutive locks that each cleared ≥ 1 line. The first clearing lock is combo 1.
- `LINE_ATTACK = {0:0, 1:0, 2:1, 3:2, 4:4}` (unchanged, M4).
- `COMBO_BONUS(c) = min(4, floor(c / 2))` → c1:0, c2:1, c3:1, c4:2, c5:2, c6:3, c7:3, c8+:4.
  Export `COMBO_BONUS_CAP = 4` from `config.ts`.
- A chain of singles therefore attacks 0,1,1,2,2,3,3,4,4… — singles matter in a combo.
- Events: add `combo(count)` (emitted on every clearing lock) and `garbageCancelled(rows)`.

### 5.3 Garbage cancelling
- On a clearing lock, `attack` first cancels the player's own `pendingGarbage`, **oldest first**.
  A partially cancelled entry keeps its `holeColumn` and its remaining rows.
- Only the leftover is emitted as `attack(n)` and routed by the server to the opponent.
- Stats: `garbageSent` counts rows actually sent; `garbageCancelled` counts rows cancelled.
- Because garbage enters only on a non-clearing lock, garbage queues up behind a live combo and
  lands the moment the chain breaks. That is intended: it is the tension Ariel described.

### 5.4 Best moment
- Per player, track `bestMoment`: the clearing lock with the **highest combo**, ties broken by
  **higher total attack** (before cancelling), then **earlier** (first one kept).
- Record: `board` (20 serialized strings, piece written, before removal), `clearedRows`,
  `pieceCells` (the finishing piece's 4 cells), `combo`, `linesCleared`, `attack`, `sent`,
  `cancelled`, `tick`.
- A single line clear is combo 1, so a player with no combos still gets their biggest clear.
  A player who never cleared a line has `bestMoment: null` and the panel is hidden.

### 5.5 State additions
`PlayerState` adds `combo: number`, `bestCombo: number`, `garbageCancelled: number`,
`bestMoment: BestMoment | null`. All still pure, integer-only, never mutated.

### 5.6 Best-of-3 series (server-side, outside the engine)
- Every room plays a **series**: rounds 1, 2 and 3 if needed; the first player to **2 round wins**
  takes the series.
- A **drawn round** (both top out in the same tick) is replayed and counts for nobody; its round
  number is reused ("Round 2 · replay"), so a series still ends when someone reaches 2 wins.
- Between rounds both players press **Next round**; the next round gets new seeds and starts with
  the standoff countdown. After the series, **New series** (both accept) resets the score to 0–0.
  This replaces the single rematch (N1).
- **Leaving** or running out the disconnect grace forfeits the **whole series** to the opponent.
- The **3-pause limit** applies per player per **series**.
- Each round's result carries that round's stats, report (§6.2) and best moment.

### 5.7 Round report data (recorded by the server)
Per player per round: `piecesPlaced`, `actions` (inputs accepted and applied), `garbageSent`,
`garbageReceived` (rows the opponent routed to this player, whether later cancelled, inserted or
still pending), `garbageCancelled`, `durationTicks` (playing ticks only, pauses excluded), and
`heightSamples` — the stack height (rows from the floor to the highest filled cell, 0–20) sampled
every **30 ticks**. Derived on the client: **PPS** = `piecesPlaced / (durationTicks / 60)`;
**APM** = `actions × 60 / (durationTicks / 60)`.

## 6. Server, protocol, client

- **Server:** source spec §4 in full (rooms/codes/tokens §4.1, match loop §4.2, information hiding
  §4.3, disconnects §4.4, anti-cheat table §4.5), with the input buffer from §6.1. The rate-limit
  bucket is charged **once, at message receipt, before the action is queued** — never again at drain.
  The anti-cheat row "speed hack / slowing gravity" now reads: gravity and lock delay run on the
  server clock; a client's tick stamp can only *delay* its own input, never move it into the past.
- **Protocol:** source spec §5 in full, plus: `input` carries `tick` (§6.1); `ping` carries `rtt`
  (the server's last measured round trip in ms); `countdown` and `resumed` carry `tick` (the match
  tick play starts or resumes at); `PublicView` and `OwnView` carry `combo`;
  `gameOver.stats` is `{ A?: PlayerStats, B?: PlayerStats }` with
  `PlayerStats = { linesCleared, garbageSent, garbageCancelled, piecesPlaced, bestCombo, bestMoment }`.
- **Client:** source spec §6 in full (screens §6.1, controls §6.2, rendering §6.4), with the look
  from §7 below instead of the source spec's "standard piece colors". Prediction is §6.1 below,
  which replaces source spec §6.3.

### 6.1 Netcode — run-ahead prediction with tick-stamped inputs (replaces source spec §6.3)

- **Clock sync.** From `countdown`/`resumed` (`startsAt`, `serverNow`, `tick`) and each `ping.rtt`,
  the client keeps an estimate of the server's current match tick.
- **Target tick.** The client shows its own board at `targetTick = estimatedServerTick +
  ceil((rtt / 2) / (1000 / 60)) + 1`: the tick at which an input sent now reaches the server.
- **Display state.** `displayState = simulate(lastOwnSnapshot, from snapshot.tick to targetTick)`,
  running the engine's `tick` (with the speed level derived from the tick) and applying each
  unacknowledged input at its stamped tick. Incoming garbage comes only from snapshots; garbage
  that arrives inside the run-ahead window shows up one snapshot later as a correction.
- **Sending.** On a key, the client stamps `{ seq, tick: targetTick, action }`, sends it, adds it to
  `pendingInputs`, and recomputes `displayState`.
- **Server buffer.** Each seat's inputs wait in a buffer ordered by `(tick, seq)`. On server tick
  N, inputs with `tick ≤ N` are applied (at most 10 per seat per tick), then gravity runs. An input
  stamped in the past is applied on arrival — the server **never rewinds**. An input stamped more
  than `MAX_INPUT_LEAD_TICKS = 30` ahead, or earlier than that seat's previous stamp, is rejected
  with `error: BAD_TICK`.
- **Reconciliation.** On each own snapshot: drop inputs with `seq ≤ lastAckSeq`, re-simulate from
  the snapshot to `targetTick`, and snap to the result (no smoothing — snapping is honest).
- **Pause/resume.** While paused the client stops advancing; `resumed.tick` resynchronizes it.
- **Opponent board:** drawn straight from snapshots, no prediction (unchanged).

### 6.2 Duel identity and the post-match report (client)
The broadcast is covering a duel: Prime Time stays the look, the duel is the event.
- **Standoff countdown:** boards dim, the two name plates face off, `3 · 2 · 1` then **DUEL!**
  slams in. Total length stays 3 s; input goes live at the instant DUEL! appears.
- **Garbage projectile:** each sent attack (the leftover after cancelling) flies as an amber
  projectile from the sender's board to the receiver's garbage meter (~350 ms), sized by rows.
  Cancelled rows burst out of the defender's meter. Driven by attack/cancel events the server adds
  to snapshots — visual only, it reveals nothing the opponent view doesn't already show.
- **Danger pulse:** a board's frame pulses red while stack height + pending garbage ≥ 16 rows
  (within 4 of the top). Shown on both boards. Reduced motion → steady red frame.
- **Music:** an original soundtrack synthesized in the browser (Web Audio, no audio files, no
  licensing), tempo stepping up with each speed level; starts at DUEL!; mute button + `M` key,
  remembered per browser (on by default).
- **Post-match report** on each round's result: PPS, APM, garbage sent / received / cancelled,
  lines, best combo, and a small line chart of both players' stack height over match time (chart
  spec from the `dataviz` skill, colors from the design tokens). Round number and series score are
  visible on the game screen, lobby, result card and to spectators.
- **Robustness:** every WebSocket message handler and HTTP route is wrapped so one bad request
  cannot crash the process (and with it every live match); a process-level `unhandledRejection`
  logger is installed. A malformed path such as `/g/%` returns an error page, not a crash.

## 7. Look — Prime Time

Approved mockups: `design/concept-art/prime-time-art.html` (home, game, win) and
`design/concept-art/best-moment.html` (result card with best moment). Wave 0 turns this into
`DESIGN.md` + tokens; these values are the contract.

| Token | Value |
|---|---|
| Background | `#16130F` warm graphite (arena backdrop art behind, darkened) |
| Panel / line | `#2A231B` / `#3D3329` |
| Text / muted text | `#F2EADF` / `#BCA98F` (muted is tinted, never gray) |
| Accent (stadium amber) | `#F5B700` |
| Alert (garbage meter) | `#FF5A36` |
| Board well / grid lines | `#0E0B08` / `#251F18` |
| Pieces | I `#F5B700` · O `#E9E4D8` · T `#2FBF71` · S `#FF6A3D` · Z `#3D7BFF` · J `#C89BFF` · L `#12978A` · G `#776A5D` hatched with `#6A5E52` (L and G adjusted in Wave 0 for colour-vision separation and hole contrast; `DESIGN.md` is authoritative for exact values) |
| Block style | flat fill, 2px inset top highlight, 2px inset bottom shade |
| Ghost | 2px inset outline in the piece color at ~55% opacity |
| Display type | Big Shoulders Display 700/800/900 (names, numbers, banners) |
| Body type | Archivo 400/600 |
| Combo callout | slanted amber on-air banner `COMBO ×N` with `+sent · cancelled` sub-line |
| Result card | "FINAL" label, italic headline `YOU WIN` / `YOU LOSE` / `DRAW`, stats table, best moment, REMATCH (amber) + Back to home |

Art: `design/concept-art/pt-logo.png`, `pt-backdrop.png`, `pt-win.png`.

## 8. Hosting — Railway

- One Railway service built from the repo's multi-stage **Dockerfile** (builder `DOCKERFILE` in
  `railway.json`), health check on `/healthz`, Railway's `PORT` read by `pnpm start`.
- Public `*.up.railway.app` HTTPS domain; WebSockets on the same origin (`wss://<host>/ws`).
- `railway.json` watch patterns include root config files (`package.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `Dockerfile`, `railway.json`, `.node-version`), so a change to only those
  still triggers a deploy.
- Deploy success is confirmed from Railway's deployment status, **never** from the CLI's exit
  code (it has reported success on failed deploys on this machine before).
- Node runtime: **pending Q1** (source spec says 20; Node 20 is end-of-life since April 2026).

## 9. Requirements

Each requirement has an id. **Every test that proves a requirement names its id** (e.g.
`it('REQ-014 combo bonus table …')`), so the conformance check can map evidence to requirements.

### Engine rules
- REQ-001: The system must use a board 10 columns wide and 20 rows tall with no hidden rows, where any cell with x < 0, x > 9, y < 0 or y > 19 counts as a collision.
- REQ-002: The system must provide the seven pieces I, O, T, S, Z, J and L with the spawn cells and spawn positions exactly as listed in source spec §3.2.
- REQ-003: The system must let a player move left and right one column, rotate clockwise and counter-clockwise, soft drop and hard drop, and a blocked move must leave the state unchanged.
- REQ-004: The system must rotate pieces using the SRS kick tables in source spec §3.3, applying each offset as (dx, −dy), using the first non-colliding kick, and leaving the state unchanged when all five kicks fail.
- REQ-005: The system must treat rotating the O piece as a no-op that leaves the state unchanged.
- REQ-006: The system must remove every completed row on lock, whether or not the rows are adjacent, and shift everything above them down.
- REQ-007: The system must top a player out when a new piece's spawn cells collide, and a topped-out state must ignore all further actions and ticks.
- REQ-008: The system must generate pieces with a 7-bag randomizer driven by a deterministic 32-bit integer PRNG (mulberry32 or xoshiro128**), so the same seed always yields the same sequence.
- REQ-009: The system must run all timing in integer ticks at 60 ticks per second using the exported constants from source spec §3.5.
- REQ-010: The system must apply gravity, soft drop, lock delay and lock resets exactly as in source spec §3.7 items 2–4, and a hard drop must lock immediately.
- REQ-011: The system must keep the engine pure, with no I/O, no Date, no Math.random and no floats in game state, and applyAction and tick must never mutate their inputs.
- REQ-012: The system must provide parseBoard and serializeBoard for boards written as 20 strings of 10 characters, with '.' for empty and a letter for a filled cell.

### Combos, garbage and best moment
- REQ-013: The system must count a combo that increases by one on every lock that clears at least one line and resets to zero on a lock that clears no lines.
- REQ-014: The system must compute the attack of a clearing lock as the line attack (1→0, 2→1, 3→2, 4→4) plus a combo bonus of min(4, floor(combo / 2)).
- REQ-015: The system must spend outgoing attack first on cancelling the player's own pending garbage, oldest first, and send only the leftover rows to the opponent.
- REQ-016: The system must insert pending garbage only on a lock that clears no lines, after line clears and before the next spawn, at the bottom of the board in arrival order.
- REQ-017: The system must make every garbage row nine garbage cells and exactly one empty cell, with all rows of one attack sharing one hole column chosen by the server's own RNG.
- REQ-018: The system must top a player out when inserted garbage pushes any filled cell above row 0.
- REQ-019: The system must record each player's best moment as the clearing lock with the highest combo, ties broken by higher attack and then by the earlier lock, storing the board before removal, the cleared rows, the finishing piece's cells, the combo, lines cleared, attack, sent, cancelled and tick.

### Multiplayer and match
- REQ-020: The system must let one player create a game and receive a 6-character room code drawn with crypto.randomInt from ABCDEFGHJKMNPQRSTUVWXYZ23456789, unique among live rooms and case-insensitive on input, plus a share link /g/<CODE>, and a second player must be able to join with either.
- REQ-021: The system must issue a 128-bit random base64url seat token on create and join, keep it in sessionStorage under token:<CODE>, and rejoin automatically after a page refresh.
- REQ-022: The system must show each player their own board and the opponent's board live.
- REQ-023: The system must give both players the identical piece sequence from a single server-only seed, using a separate bag instance per player.
- REQ-024: The system must run each match as a server-authoritative 60 Hz fixed-step loop using an accumulator over performance.now(), catching up at most 5 ticks per wake, applying at most 10 actions per player per tick and capping each input queue at 60.
- REQ-025: The system must start a 3-second countdown when both seats are connected in a waiting room, sending startsAt and serverNow so clients can correct for clock skew.
- REQ-026: The system must declare the last player standing the winner, declare a draw when both players top out in the same tick, and show the result on both players' screens.
- REQ-027: The system must send snapshots at most every 2 ticks and immediately after any lock.
- REQ-028: The system must send a board's owner the board, active piece, next 5 pieces, pending garbage, lastAckSeq, stats and tick, and send opponents and spectators only the board, active piece, next 1 piece, pending garbage total and stats, and no message may ever contain a seed.
- REQ-029: The system must delete a room that has had no connected players for 2 minutes and a waiting room older than 15 minutes.

### Leaving and disconnects
- REQ-030: The system must treat an explicit leave as an immediate forfeit in which the opponent wins with reason OPPONENT_LEFT.
- REQ-031: The system must pause the match for both players on an unexpected disconnect (socket closed, or no pong for 10 s with pings every 3 s), show the opponent a live 20-second countdown, and resume from the exact paused state after a 3-second countdown when the player rejoins with their seat token within 20 s.
- REQ-032: The system must allow each player at most 3 pauses per series, and a 4th disconnect or an expired grace period must forfeit with reason OPPONENT_DISCONNECTED.
- REQ-033: The system must keep the match paused when both players disconnect, forfeit whichever player's grace expires first, and end the room as abandoned when both expire together.
- REQ-034: The system must return the room to waiting when a player disconnects during waiting or countdown, and hold that seat for its token for 2 minutes, and when a player disconnects between rounds of a series it must hold the seat for 2 minutes without using a pause and then award the series to the opponent.
- REQ-035: The system must let a reconnect with a valid seat token replace any older socket for that seat, closing the old socket with reason REPLACED.

### Anti-cheat
- REQ-036: The system must have no client message that carries game state, and the server must compute every board, line clear and attack itself.
- REQ-037: The system must run gravity and lock delay on the server clock, and a client's tick stamp may only schedule its own input for the current or a later server tick, never an earlier one.
- REQ-038: The system must rate-limit each player's inputs with a token bucket of 30 actions per second sustained and a burst of 20, charged once when the message is received and before it is queued, dropping and counting over-limit actions, and disconnecting the player with RATE_LIMITED after 200 drops counted across the whole series.
- REQ-039: The system must reject frames larger than 1 KB and zod-validate every message, replying error BAD_MESSAGE to any invalid or unknown message and disconnecting a client after 20 bad messages.
- REQ-040: The system must bind a seat to its socket only after a seat-token check that uses crypto.timingSafeEqual, and apply that socket's actions only to its own seat.
- REQ-041: The system must reject any input whose seq is not strictly greater than the last accepted seq for that seat.
- REQ-042: The system must ignore inputs from spectators and reply error NOT_A_PLAYER.
- REQ-043: The system must reject inputs sent before the match starts, after game over, or while paused, replying error NOT_PLAYING.
- REQ-044: The system must trim player names, require 1 to 16 characters, and render names only as text, never through innerHTML.

### Protocol
- REQ-045: The system must define every message in source spec §5, plus the input tick stamp, the ping rtt, the countdown and resumed start tick, the combo field, the snapshot attack and cancel events, the round and series fields, the round report and the gameOver stats in this document, as TypeScript types and zod schemas in packages/protocol shared by client and server, with no use of any.
- REQ-046: The system must include, for each seat, lines cleared, garbage sent, garbage cancelled, pieces placed, best combo and best moment in the gameOver message.

### Client
- REQ-047: The system must provide a home screen with a name field, a Create game button, and a join code field with a Join button, and opening /g/:code must pre-fill the code and focus the name field.
- REQ-048: The system must provide a lobby showing the large room code, a Copy link button that shows "Copied!", the text "Waiting for opponent…" and the list of players.
- REQ-049: The system must provide a game screen with the player's own board large, the opponent's board at about 60% size beside it, names above each board, a pending-garbage meter beside each board, stats, the speed level, a connection dot with ping in milliseconds, and a Leave button with a confirm step.
- REQ-050: The system must show overlays for the countdown, the opponent-disconnected state with a live seconds timer, and each round's result ("You win", "You lose" or "Draw") with the reason, the series score, both players' stats, a Next round or New series button and a Back to home button.
- REQ-051: The system must show each player their own best moment on the result screen, drawn from the server-recorded data with the cleared rows highlighted and the finishing piece outlined, and must hide that panel when the player cleared no lines.
- REQ-052: The system must show a combo callout on a player's board whenever that player's combo reaches 2 or more.
- REQ-053: The system must implement the keyboard controls in source spec §6.2 with client-side DAS of 170 ms and ARR of 50 ms, ignore operating-system key repeat, send softDropStop on key release and on window blur, prevent page scrolling on game keys, and show a controls legend.
- REQ-054: The system must predict the player's own board by simulating forward from the latest own snapshot to the estimated arrival tick with the engine's tick and the player's unacknowledged inputs at their stamped ticks, take incoming garbage only from snapshots, snap to each new snapshot's re-simulated result, and draw the opponent's board directly from snapshots without prediction.
- REQ-055: The system must draw boards on a device-pixel-ratio-aware canvas with requestAnimationFrame, flash cleared rows for 150 ms without ever delaying input, and nudge the board upward when garbage arrives.
- REQ-056: The system must fit the whole game screen inside a 1280×600 CSS-pixel viewport without scrolling and scale down below that without breaking or scrolling horizontally.
- REQ-057: The system must use the Prime Time design recorded in DESIGN.md (palette, fonts, piece colors, combo banner, result card and the generated logo, backdrop and win art) and must not use the classic falling-block piece-color set.
- REQ-058: The system must warn a touch-only device before it takes a seat and offer to watch instead, treat any physical key press as proof of a keyboard, and keep home and lobby usable at 390 px wide without horizontal scrolling.

### Nice-to-haves (build only after REQ-001–REQ-058 pass)
- REQ-059: The system must offer Next round after a round and New series after a series, each starting only when both players accept, generating new seeds while keeping seats, room and code, running the countdown, showing "Waiting for opponent to accept…" meanwhile, and showing "Opponent left" with a disabled button if the opponent has gone.
- REQ-060: The system must show the next 5 pieces beside the player's own board and the next 1 piece beside the opponent's board.
- REQ-061: The system must draw a translucent ghost piece at ghostPosition on the player's own board.
- REQ-062: The system must let a third joiner, or anyone opening /g/CODE?watch=1, watch both boards read-only with names, allow at most 8 spectators per room and answer any further spectator with ROOM_FULL, and show the players a spectator count.

### Tests
- REQ-063: The system must have engine unit tests for every case listed in source spec §8.1 using parseBoard fixtures, with case 24 changed to "pending garbage is inserted only on a non-clearing lock, after line clears and before spawn", plus the fast-check property test from source spec §8.1.
- REQ-064: The system must have engine unit tests for combo counting and reset, every step of the combo bonus table, full and partial garbage cancelling, garbage held back during a combo and landing when it breaks, and best-moment selection including both tie-breaks and the null case.
- REQ-065: The system must have server integration tests for every case in source spec §8.2, run with real WebSocket clients against a server on a random port with injectable seedProvider, holeRng and clock and a manual-tick mode, plus a test that only the leftover attack after cancelling reaches the opponent.
- REQ-066: The system must have one Playwright end-to-end smoke test in which two browser contexts create and join through the share link, both hard-drop until someone tops out, and both pages show opposite results or both show Draw.
- REQ-067: The system must reach at least 90% line coverage on the engine package.

### Non-functional
- REQ-068: The system must keep one running match well under 5% of one CPU core.
- REQ-069: The system must make the player's own inputs appear instantly through prediction and, at up to a 150 ms round trip and every speed level, must land each move in the cells the player was shown, except when garbage arrives inside the prediction window.
- REQ-070: The system must pass pnpm typecheck (tsc -b over the project references) and pnpm lint with zero errors, with no use of any in the engine or protocol packages.
- REQ-071: The system must write structured pino log lines for room created, joined, started and ended, for every disconnect, and for every anti-cheat trigger, without logging player names or IP addresses.
- REQ-072: The system must keep any single failing request or message from crashing the server process by wrapping every WebSocket and HTTP handler and logging unhandled promise rejections.

### Delivery
- REQ-073: The system must build and run with pnpm install, pnpm build and pnpm start on a single port taken from PORT (default 3000), serving the client, the /ws WebSocket and GET /healthz.
- REQ-074: The system must provide the root scripts dev, test, typecheck, lint, build, start and e2e.
- REQ-075: The system must ship a multi-stage Dockerfile on a Node 24 Alpine image and a railway.json that builds from it with a /healthz health check and watch patterns that include the root config files.
- REQ-076: The system must be playable for a full match by two people on different networks from the deployed Railway URL in the Southeast Asia (Singapore) region.
- REQ-077: The system must include a GitHub Actions workflow that runs typecheck, lint and test in the private GitHub repository.
- REQ-078: The system must include a README with a one-paragraph pitch, how to run, how to play, the architecture diagram, a "How we prevent cheating" section, a "How the rules are tested" section, design decisions, known limitations and future work, and a DECISIONS.md with one line and one reason per decision.

### Netcode and limits (added after the builder check, 2026-11-07)
- REQ-079: The system must stamp every input with the client's target tick, apply each buffered input at the first server tick at or after its stamp without ever rewinding, and reject with BAD_TICK any input stamped more than 30 ticks ahead of the server or earlier than that seat's previous stamp.
- REQ-080: The system must measure each player's round-trip time from ping and pong, send it to that player in the ping message, and include the match start tick in the countdown and resumed messages.
- REQ-081: The system must allow at most one live room per connection, at most 10 room creations and 20 failed joins per minute per client IP resolved through Railway's proxy hops, and at most 500 live rooms, replying with an error message whenever a limit is hit.
- REQ-082: The system must have a server integration test with 150 ms of injected round-trip latency at the top speed level proving that tick-stamped moves from a predicting client lock in exactly the cells that client displayed.

### Signature features (Ariel, 2026-11-07; build after REQ-001–REQ-058 pass, with the nice-to-haves)
- REQ-083: The system must play every room as a best-of-3 series in which the first player to win 2 rounds wins the series, a drawn round is replayed without counting, and both players must press Next round before the next round's countdown starts with new seeds.
- REQ-084: The system must award the whole series to the opponent when a player leaves or runs out their disconnect grace period, and must show a series-winner screen with the final score, each round's result and a New series button that restarts at 0–0 once both players accept.
- REQ-085: The system must show the current round number and the series score on the game screen, in the lobby, on the result card and to spectators.
- REQ-086: The system must run a standoff countdown in which the two name plates face off, the count runs 3, 2, 1 and ends on "DUEL!" at the exact moment play starts, without delaying the first input.
- REQ-087: The system must animate every sent attack as a projectile flying from the sender's board to the receiver's garbage meter, sized by its row count, and show cancelled rows bursting out of the defender's meter, driven only by attack and cancel events from server snapshots.
- REQ-088: The system must pulse a board's frame red while that board's stack height plus its pending garbage is 16 rows or more, on both the own board and the opponent's board, and show a steady red frame instead of a pulse under reduced motion.
- REQ-089: The system must play an original soundtrack synthesized in the browser with no audio files, whose tempo rises with each speed level, starting at "DUEL!", with a mute button and an M-key toggle that each browser remembers.
- REQ-090: The system must record on the server, for each player in each round, pieces placed, accepted actions, garbage sent, received and cancelled, playing ticks, and the stack height every 30 ticks, and send them with the round result.
- REQ-091: The system must show a post-match report with pieces per second, actions per minute, garbage sent, received and cancelled, and a line chart of both players' stack height over match time.
- REQ-092: The system must have tests for series scoring (two wins end the series, a draw is replayed, a forfeit ends the series), for the report statistics, and for the stack-height sampling.

## 10. Left to the builder

Internal module structure beyond the source spec's layout; exact canvas animation curves within the
§7 motion feel (one authored moment per event, no bouncy easing); lobby copy beyond the strings
named here; how the transparent logo is produced; CI caching; test helper design.

## 11. Resolved questions (Ariel, 2026-11-07)

| # | Question | Answer |
|---|---|---|
| Q1 | Node version? Source spec says Node 20, which is end-of-life since April 2026. | **Node 24 LTS** in Docker, `engines` and `.node-version` (this machine already runs 24.13). |
| Q2 | Which Railway region? Lag depends on the distance to the server. | **Southeast Asia (Singapore).** |
| Q3 | Room-creation flooding (the source spec is silent; the site is public). | One live room per connection; at most 10 creates per minute per IP (counting Railway's proxy hops correctly); a 500-live-room cap answering `error: SERVER_BUSY`. |
| Q4 | Name filtering for kids' names? | None: names are only seen by people who joined with the private code. Future work. |
| Q5 | Sound effects? | **Music is in** (REQ-089, Ariel 2026-11-07). Other sound effects stay future work. |
| Q6 | GitHub repo for CI? There is no remote yet. | **Yes: a private GitHub repo**, pushed so the workflow runs there. Railway deploys from this machine. |
| Q7 | REFERENCE product to beat (design gate). | `tetr.io` — scoped to in-match HUD clarity: reading incoming garbage, combo/attack feedback and the opponent's board at a glance. |
| Q8 | Build budget. | **Full workflow, every gate.** Stop at each gate result and before shipping. |
