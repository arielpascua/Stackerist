# Requirement conformance (gate 9e)

Generated 2026-11-11 from the real runs on the final tree: `vitest --reporter=json` (90 files, 1,164 tests) and `playwright --reporter=json` (67 tests: 66 passed, 1 skipped). A requirement is **MET** only when at least one test whose title names it passed and none that names it failed. Requirements that rest on tooling or on a deploy are classified by hand, with the evidence stated. The source list is the 92 requirements in `docs/superpowers/specs/2026-11-07-stackerist-design.md`.

| Id | Status | Evidence | Requirement |
| --- | --- | --- | --- |
| REQ-001 | MET | 6 named tests pass (unit). | The system must use a board 10 columns wide and 20 rows tall with no hidden rows, where any cell with x < 0, x > 9, y < 0 or y > 19 counts as a... |
| REQ-002 | MET | 18 named tests pass (unit). | The system must provide the seven pieces I, O, T, S, Z, J and L with the spawn cells and spawn positions exactly as listed in source spec §3.2. |
| REQ-003 | MET | 5 named tests pass (unit). | The system must let a player move left and right one column, rotate clockwise and counter-clockwise, soft drop and hard drop, and a blocked move... |
| REQ-004 | MET | 23 named tests pass (unit). | The system must rotate pieces using the SRS kick tables in source spec §3.3, applying each offset as (dx, −dy), using the first non-colliding... |
| REQ-005 | MET | 1 named test passes (unit). | The system must treat rotating the O piece as a no-op that leaves the state unchanged. |
| REQ-006 | MET | 9 named tests pass (unit). | The system must remove every completed row on lock, whether or not the rows are adjacent, and shift everything above them down. |
| REQ-007 | MET | 11 named tests pass (unit). | The system must top a player out when a new piece's spawn cells collide, and a topped-out state must ignore all further actions and ticks. |
| REQ-008 | MET | 13 named tests pass (unit). | The system must generate pieces with a 7-bag randomizer driven by a deterministic 32-bit integer PRNG (mulberry32 or xoshiro128**), so the same... |
| REQ-009 | MET | 3 named tests pass (unit). | The system must run all timing in integer ticks at 60 ticks per second using the exported constants from source spec §3.5. |
| REQ-010 | MET | 12 named tests pass (unit). | The system must apply gravity, soft drop, lock delay and lock resets exactly as in source spec §3.7 items 2–4, and a hard drop must lock immediately. |
| REQ-011 | MET | 5 named tests pass (unit). | The system must keep the engine pure, with no I/O, no Date, no Math.random and no floats in game state, and applyAction and tick must never mutate... |
| REQ-012 | MET | 7 named tests pass (unit). | The system must provide parseBoard and serializeBoard for boards written as 20 strings of 10 characters, with '.' for empty and a letter for a... |
| REQ-013 | MET | 1 named test passes (unit). | The system must count a combo that increases by one on every lock that clears at least one line and resets to zero on a lock that clears no lines. |
| REQ-014 | MET | 8 named tests pass (unit). | The system must compute the attack of a clearing lock as the line attack (1→0, 2→1, 3→2, 4→4) plus a combo bonus of min(4, floor(combo / 2)). |
| REQ-015 | MET | 6 named tests pass (unit). | The system must spend outgoing attack first on cancelling the player's own pending garbage, oldest first, and send only the leftover rows to the... |
| REQ-016 | MET | 4 named tests pass (unit). | The system must insert pending garbage only on a lock that clears no lines, after line clears and before the next spawn, at the bottom of the... |
| REQ-017 | MET | 15 named tests pass (unit). | The system must make every garbage row nine garbage cells and exactly one empty cell, with all rows of one attack sharing one hole column chosen... |
| REQ-018 | MET | 3 named tests pass (unit). | The system must top a player out when inserted garbage pushes any filled cell above row 0. |
| REQ-019 | MET | 6 named tests pass (unit). | The system must record each player's best moment as the clearing lock with the highest combo, ties broken by higher attack and then by the earlier... |
| REQ-020 | MET | 16 named tests pass (unit). | The system must let one player create a game and receive a 6-character room code drawn with crypto.randomInt from ABCDEFGHJKMNPQRSTUVWXYZ23456789,... |
| REQ-021 | MET | 61 named tests pass (unit). | The system must issue a 128-bit random base64url seat token on create and join, keep it in sessionStorage under ‹redacted:secret-assignment›, and... |
| REQ-022 | MET | 1 named test passes (e2e). | The system must show each player their own board and the opponent's board live. |
| REQ-023 | MET | 5 named tests pass (unit). | The system must give both players the identical piece sequence from a single server-only seed, using a separate bag instance per player. |
| REQ-024 | MET | 6 named tests pass (unit). | The system must run each match as a server-authoritative 60 Hz fixed-step loop using an accumulator over performance.now(), catching up at most 5... |
| REQ-025 | MET | 2 named tests pass (unit). | The system must start a 3-second countdown when both seats are connected in a waiting room, sending startsAt and serverNow so clients can correct... |
| REQ-026 | MET | 2 named tests pass (unit). | The system must declare the last player standing the winner, declare a draw when both players top out in the same tick, and show the result on... |
| REQ-027 | MET | 3 named tests pass (unit). | The system must send snapshots at most every 2 ticks and immediately after any lock. |
| REQ-028 | MET | 15 named tests pass (unit). | The system must send a board's owner the board, active piece, next 5 pieces, pending garbage, lastAckSeq, stats and tick, and send opponents and... |
| REQ-029 | MET | 7 named tests pass (unit). | The system must delete a room that has had no connected players for 2 minutes and a waiting room older than 15 minutes. |
| REQ-030 | MET | 4 named tests pass (e2e,unit). | The system must treat an explicit leave as an immediate forfeit in which the opponent wins with reason OPPONENT_LEFT. |
| REQ-031 | MET | 15 named tests pass; 1 more (the `E2E_SLOW` grace-expiry test, about 40 s) is skipped in the default run and passed when run on its own earlier. | The system must pause the match for both players on an unexpected disconnect (socket closed, or no pong for 10 s with pings every 3 s), show the... |
| REQ-032 | MET | 5 named tests pass (unit). | The system must allow each player at most 3 pauses per series, and a 4th disconnect or an expired grace period must forfeit with reason... |
| REQ-033 | MET | 2 named tests pass (unit). | The system must keep the match paused when both players disconnect, forfeit whichever player's grace expires first, and end the room as abandoned... |
| REQ-034 | MET | 4 named tests pass (unit). | The system must return the room to waiting when a player disconnects during waiting or countdown, and hold that seat for its token for 2 minutes,... |
| REQ-035 | MET | 3 named tests pass (unit). | The system must let a reconnect with a valid seat token replace any older socket for that seat, closing the old socket with reason REPLACED. |
| REQ-036 | MET | 6 named tests pass (unit). | The system must have no client message that carries game state, and the server must compute every board, line clear and attack itself. |
| REQ-037 | MET | 50 named tests pass (unit). | The system must run gravity and lock delay on the server clock, and a client's tick stamp may only schedule its own input for the current or a... |
| REQ-038 | MET | 10 named tests pass (unit). | The system must rate-limit each player's inputs with a token bucket of 30 actions per second sustained and a burst of 20, charged once when the... |
| REQ-039 | MET | 11 named tests pass (unit). | The system must reject frames larger than 1 KB and zod-validate every message, replying error BAD_MESSAGE to any invalid or unknown message and... |
| REQ-040 | MET | 4 named tests pass (unit). | The system must bind a seat to its socket only after a seat-token check that uses crypto.timingSafeEqual, and apply that socket's actions only to... |
| REQ-041 | MET | 2 named tests pass (unit). | The system must reject any input whose seq is not strictly greater than the last accepted seq for that seat. |
| REQ-042 | MET | 1 named test passes (unit). | The system must ignore inputs from spectators and reply error NOT_A_PLAYER. |
| REQ-043 | MET | 1 named test passes (unit). | The system must reject inputs sent before the match starts, after game over, or while paused, replying error NOT_PLAYING. |
| REQ-044 | MET, caveat | Named tests pass. Caveat F11 (code review, deferred): names also appear in a few aria-labels and live-region texts outside the bidi isolate; they are never inserted as HTML. | The system must trim player names, require 1 to 16 characters, normalize names with NFKC, require at least one letter or digit, refuse any name... |
| REQ-045 | MET | 39 named tests pass (unit). | The system must define every message in source spec §5, plus the input tick stamp, the ping rtt, the countdown and resumed start tick, the combo... |
| REQ-046 | MET | 3 named tests pass (unit). | The system must include, for each seat, lines cleared, garbage sent, garbage cancelled, pieces placed, best combo and best moment in the gameOver... |
| REQ-047 | MET | 15 named tests pass (unit). | The system must provide a home screen with a name field, a Create game button, and a join code field with a Join button, and opening /g/:code must... |
| REQ-048 | MET | 8 named tests pass (unit). | The system must provide a lobby showing the large room code, a Copy link button that shows "Copied!", the text "Waiting for opponent…" and the... |
| REQ-049 | MET | 24 named tests pass (unit). | The system must provide a game screen with the player's own board large, the opponent's board at about 60% size beside it, names above each board,... |
| REQ-050 | MET | 26 named tests pass (unit). | The system must show overlays for the countdown, the opponent-disconnected state with a live seconds timer, and each round's result ("You win",... |
| REQ-051 | MET | 10 named tests pass (unit). | The system must show each player their own best moment on the result screen, drawn from the server-recorded data with the cleared rows highlighted... |
| REQ-052 | MET | 17 named tests pass (unit). | The system must show a combo callout on a player's board whenever that player's combo reaches 2 or more. |
| REQ-053 | MET | 25 named tests pass (unit). | The system must implement the keyboard controls in source spec §6.2 with client-side DAS of 170 ms and ARR of 50 ms, ignore operating-system key... |
| REQ-054 | MET | 46 named tests pass (unit). | The system must predict the player's own board by simulating forward from the latest own snapshot to the estimated arrival tick with the engine's... |
| REQ-055 | MET | 30 named tests pass (unit). | The system must draw boards on a device-pixel-ratio-aware canvas with requestAnimationFrame, flash cleared rows for 150 ms without ever delaying... |
| REQ-056 | MET | 3 named tests pass (unit). | The system must fit the whole game screen inside a 1280×600 CSS-pixel viewport without scrolling and scale down below that without breaking or... |
| REQ-057 | MET | 3 named tests pass (unit). | The system must use the Prime Time design recorded in DESIGN.md (palette, fonts, piece colors, combo banner, result card and the generated logo,... |
| REQ-058 | MET | 4 named tests pass (unit). | The system must warn a touch-only device before it takes a seat and offer to watch instead, treat any physical key press as proof of a keyboard,... |
| REQ-059 | MET | 13 named tests pass (unit). | The system must offer Next round after a round and New series after a series, each starting only when both players accept, generating new seeds... |
| REQ-060 | MET | 6 named tests pass (unit). | The system must show the next 5 pieces beside the player's own board and the next 1 piece beside the opponent's board. |
| REQ-061 | MET | 10 named tests pass (e2e,unit). | The system must draw a translucent ghost piece at ghostPosition on the player's own board. |
| REQ-062 | MET | 10 named tests pass (e2e,unit). | The system must let a third joiner, or anyone opening /g/CODE?watch=1, watch both boards read-only with names, allow at most 8 spectators per room... |
| REQ-063 | MET | 99 named tests pass (unit). | The system must have engine unit tests for every case listed in source spec §8.1 using parseBoard fixtures, with case 24 changed to "pending... |
| REQ-064 | MET | 18 named tests pass (unit). | The system must have engine unit tests for combo counting and reset, every step of the combo bonus table, full and partial garbage cancelling,... |
| REQ-065 | MET | 19 named tests pass (unit). | The system must have server integration tests for every case in source spec §8.2, run with real WebSocket clients against a server on a random... |
| REQ-066 | MET | 2 named tests pass (e2e). | The system must have one Playwright end-to-end smoke test in which two browser contexts create and join through the share link, both hard-drop... |
| REQ-067 | MET | Engine coverage measured 2026-11-11: lines 314 of 314 (100 %), branches 208 of 211, functions 77 of 77, statements 362 of 363. Threshold is 90 % lines. | The system must reach at least 90% line coverage on the engine package. |
| REQ-068 | PARTIAL | Server cost is about 1 to 4 % of one core when the machine is quiet (best windows 1.09 %, 3.27 %, earlier 3.91 %), but across 11 runs on this busy development machine the test failed 3 (best windows 5.79 %, 6.08 % and 7.18 %) and passed 8, because it measures a process that includes both simulated clients. Not yet measured on the host: re-measure on Railway. | The system must keep one running match well under 5% of one CPU core. |
| REQ-069 | MET, caveat | Named tests pass (effect within two ticks at 0, 50 and 150 ms round trip). Caveat F6 (deferred): own input can show up to one tick (16 ms) late. | The system must make the player's own inputs appear instantly through prediction and, at up to a 150 ms round trip and every speed level, must... |
| REQ-070 | MET (tooling) | `pnpm typecheck` and `pnpm lint` both exit 0 on the final tree (recorded as trusted verify events by cdt-verify); lint sets `@typescript-eslint/no-explicit-any` to error. | The system must pass pnpm typecheck (tsc -b over the project references) and pnpm lint with zero errors, with no use of any in the engine or... |
| REQ-071 | MET | 6 named tests pass (unit). | The system must write structured pino log lines for room created, joined, started and ended, for every disconnect, and for every anti-cheat... |
| REQ-072 | MET | 8 named tests pass (unit). | The system must keep any single failing request or message from crashing the server process by wrapping every WebSocket and HTTP handler and... |
| REQ-073 | MET | 11 named tests pass (unit). | The system must build and run with pnpm install, pnpm build and pnpm start on a single port taken from PORT (default 3000), serving the client,... |
| REQ-074 | MET | 3 named tests pass (unit). | The system must provide the root scripts dev, test, typecheck, lint, build, start and e2e. |
| REQ-075 | MET, caveat | Dockerfile and `railway.json` parsed and checked by tests. The Docker image has never been built (no Docker on this machine); the first Railway build is the first real build. | The system must ship a multi-stage Dockerfile on a Node 24 Alpine image and a railway.json that builds from it with a /healthz health check and... |
| REQ-076 | NOT MET | Needs the deployed URL: a full match between two people on different networks. Not possible until the owner approves the deploy. | The system must be playable for a full match by two people on different networks from the deployed Railway URL in the Southeast Asia (Singapore)... |
| REQ-077 | MET | Workflow parsed and checked by tests; GitHub CI run on the final commit is green. | The system must include a GitHub Actions workflow that runs typecheck, lint and test in the private GitHub repository. |
| REQ-078 | MET | 22 named tests pass (unit). | The system must include a README with a one-paragraph pitch, how to run, how to play, the architecture diagram, a "How we prevent cheating"... |
| REQ-079 | MET | 13 named tests pass (unit). | The system must stamp every input with the client's target tick, apply each buffered input at the first server tick at or after its stamp without... |
| REQ-080 | MET | 19 named tests pass (unit). | The system must measure each player's round-trip time from ping and pong, send it to that player in the ping message, and include the match start... |
| REQ-081 | MET | 14 named tests pass (unit). | The system must allow at most one live room per connection, at most 10 room creations and 20 failed joins per minute per client IP resolved... |
| REQ-082 | MET | 10 named tests pass (unit). | The system must have a server integration test with 150 ms of injected round-trip latency at the top speed level proving that tick-stamped moves... |
| REQ-083 | MET | 10 named tests pass (e2e,unit). | The system must play every room as a best-of-3 series in which the first player to win 2 rounds wins the series, a drawn round is replayed without... |
| REQ-084 | MET | 11 named tests pass (unit). | The system must award the whole series to the opponent when a player leaves or runs out their disconnect grace period, and must show a... |
| REQ-085 | MET | 4 named tests pass (unit). | The system must show the current round number and the series score on the game screen, in the lobby, on the result card and to spectators. |
| REQ-086 | MET | 21 named tests pass (e2e,unit). | The system must run a standoff countdown in which the two name plates face off, the count runs 3, 2, 1 and ends on "DUEL!" at the exact moment... |
| REQ-087 | MET | 25 named tests pass (e2e,unit). | The system must animate every sent attack as a projectile flying from the sender's board to the receiver's garbage meter, sized by its row count,... |
| REQ-088 | MET | 16 named tests pass (e2e,unit). | The system must pulse a board's frame red while that board's stack height plus its pending garbage is 16 rows or more, on both the own board and... |
| REQ-089 | MET | 55 named tests pass (e2e,unit). | The system must play an original soundtrack synthesized in the browser with no audio files, whose tempo rises with each speed level, starting at... |
| REQ-090 | MET | 5 named tests pass (e2e,unit). | The system must record on the server, for each player in each round, pieces placed, accepted actions, garbage sent, received and cancelled,... |
| REQ-091 | MET | 19 named tests pass (e2e,unit). | The system must show a post-match report with pieces per second, actions per minute, garbage sent, received and cancelled, and a line chart of... |
| REQ-092 | MET | 10 named tests pass (unit). | The system must have tests for series scoring (two wins end the series, a draw is replayed, a forfeit ends the series), for the report statistics,... |

**90 of 92 MET** (including the ones with a stated caveat); **2 not fully met**: REQ-068, REQ-076.
