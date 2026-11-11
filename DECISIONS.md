# Decisions

One line per decision, with the reason. Where the repository records no reason, the line says so instead of inventing one. The first sections come from section 8.1 of [docs/architecture.md](docs/architecture.md) (44 decisions, grouped by topic here); later sections record what was decided during and after the build, from the build ledger and the architecture's sections 10.1 and 10.2. Where a later decision replaces an earlier one, the earlier line says so.

## Product rules

- **Combos and garbage cancelling are in scope, added to the original spec.** The owner wanted matches to get tense through speed and stacked combos, and cancelling makes comebacks possible.
- **T-spin and back-to-back bonuses stay out.** The design proposed leaving them out as a default and the owner did not object; they are listed as future work.
- **The combo bonus is `min(4, floor(combo / 2))`, so a chain of singles sends 0, 1, 1, 2, 2, 3, 3, 4, 4.** It makes single-line clears matter inside a chain. The numbers are the builder's call, recorded in the design for the owner to check.
- **Pending garbage is inserted only on a lock that clears nothing.** Garbage then queues behind a live combo and lands when the chain breaks, which is the tension the owner described.
- **An attack cancels your own pending garbage first, oldest first, and only the leftover is sent.** A partly cancelled entry keeps its hole column and remaining rows.
- **Every room plays a best-of-3 series, first to 2 round wins.** The owner added the series as a signature feature; it replaces the single rematch.
- **A drawn round is replayed, keeps its round number (with `replay` set) and counts for nobody.** A series therefore always ends when someone reaches 2 wins.
- **Leaving, or running out the disconnect grace, forfeits the whole series.** The design words it so; a forfeit sets the winner without adding a round win, so the score stays truthful and the reason line explains it.
- **Each player gets 3 pauses per series.** The cap stops a player pausing the opponent forever; it was per match in the source spec and moved to per series with the best-of-3 format.
- **The 200-dropped-input limit counts across the whole series.** The owner chose this over per round, to match the per-series pause cap.
- **A disconnect between rounds holds the seat for 2 minutes with no pause and no grace, then the series goes to the opponent.** The owner's answer to an open question; it stops a series hanging forever when no round is running.
- **A room holds 2 players and at most 8 spectators.** The owner set the cap; without one, spectators are a bandwidth amplifier because each gets its own copy of every 30 Hz snapshot. A ninth viewer gets `ROOM_FULL`.
- **A third joiner becomes a spectator, and `?watch=1` joins as a spectator even when a seat is free.** The source spec's nice-to-have N4.
- **The cleared-row flash shows on your own board only.** The owner chose it over adding a `clear` event, because the opponent's cleared rows are not part of what the opponent view carries.
- **No name filter.** Names are seen only by people who joined with the private room code; the owner accepted this and listed filtering as future work.
- **Nothing about players persists after a room ends.** The design treats keeping children's data as a failure, so there are no accounts and no database.
- **Logs carry room codes and seats, never names, IP addresses or tokens.** Same reason: no player data in logs.
- **Touch-only devices get a keyboard warning and an offer to watch.** Touch controls are out of scope, and a warning is better than a broken board; any physical key press counts as proof of a keyboard.

## Engine

- **The board is a `readonly string[]` of 20 strings of 10 characters.** It is immutable for free, a copy is 20 references, and it is the same as the test fixture and the wire form.
- **Rotation is numeric, 0 to 3.** It indexes the kick tables directly and is compact on the wire.
- **`PlayerState.tick` lives inside the state.** `bestMoment.tick` and `simulate` need it, and the source spec's `tick(state, level)` API is kept.
- **The bag lives inside `PlayerState` and is nullable.** Server refill stays pure, and the client predicts from the 5-piece preview.
- **An empty queue gives `active: null` and a `starved` event, not a top-out.** Prediction then stops cleanly when the preview runs dry.
- **Garbage is inserted sequentially, so the newest attack ends lowest.** This is the literal reading of "in arrival order, existing rows shift up".
- **On garbage overflow the engine inserts, truncates and tops out.** The board shown at game over is then the one that ended the round.
- **Lock delay counts the landing tick and resets on any downward move.** The engine and the test harness share one unambiguous rule.
- **Each tick runs inputs (A, then B), then gravity (A, B), then attack routing.** It is deterministic and `simulate` mirrors it.
- **`simulate` caps actions per tick with the server's `MAX_ACTIONS_PER_TICK`.** Prediction then matches the server even under bursts.
- **`OwnView` carries the piece timers.** Exact re-simulation (REQ-082) is impossible without them, and they reveal nothing hidden.
- **The speed level comes from the absolute tick, and tests use a `startTick` option.** Top-speed tests need no special hook.
- **The engine has no hidden rows above the board, and any cell outside 0 to 9 by 0 to 19 is a collision.** This is the source spec's rule; no further reason is recorded.

## Protocol and netcode

- **Smart prediction: run-ahead with tick-stamped inputs and no server rewind.** The builder check showed that at level 12 plain prediction lands moves 3 to 5 rows low at 40 to 60 ms of round-trip time; the owner chose this fix.
- **The client snaps to the re-simulated result on each snapshot, with no smoothing.** The design calls snapping honest.
- **Hard drop is predicted through the lock on your own board.** It was added to the design after the builder check; no separate reason is recorded.
- **Stamps are monotonic and clamped to `serverTick + 30`.** Round-trip jitter then can never cause `BAD_TICK` on an honest client.
- **`BAD_TICK` does not count toward the 20-bad-message disconnect.** Clock drift on an honest client must not disconnect it.
- **The tick estimate is the minimum over 120 snapshot samples plus rtt/2.** It recovers after server stalls and leans safely ahead.
- **`lastAckSeq` is the buffer head minus 1, or the last seen seq when the buffer is empty.** Dropped and rejected inputs get acknowledged too, so phantom moves do not stay predicted.
- **The seq space resets on each seat binding and each round.** Refresh-rejoin and new rounds work without the client persisting counters.
- **The input bucket is charged once, after the seat and status gates and before the seq, tick and cap checks.** Mashing keys before the start cannot drain it, and the drain never charges again.
- **Frames over 1 KB get `BAD_MESSAGE` from the app, and `ws` closes frames over 16 KiB.** Over-limit frames get an answer, and huge frames are never buffered.
- **Close codes are 4000 to 4004 and the reason string is the key name.** Clients can branch on the code without parsing text.
- **Error codes split per-IP limits into `TOO_MANY_CREATES` and `TOO_MANY_JOINS`.** DESIGN.md has different copy for each.
- **Snapshot events are only `attack` and `cancel`, with no hole columns.** That is enough for the projectile effect and shows nothing beyond the public view.
- **`heightSamples` are taken at round-relative ticks 0, 30, 60 and so on, capped at 7,200.** It matches the report design and bounds memory.
- **`actions` counts inputs drained and applied.** This is the literal reading of "accepted and applied".
- **`gameOver` carries `tick`.** "Topped out at 04:51" is then computed from ticks, never from wall clocks.
- **The initial snapshot is sent when the countdown starts.** Boards show under the standoff and prediction has a base before DUEL!.
- **A spectator who joins, or a player who rejoins, during a countdown also gets the `countdown` or `resumed` message.** The client needs a clock anchor (gap ruling G4).
- **A forfeit between rounds appends no round summary.** No round is in progress, so there is nothing to summarise (gap ruling G1).
- **A name's length is counted in code points, and the UI validates names only through `NameSchema`.** zod counts code points, so a character outside the Basic Multilingual Plane counts once; checking `.length` would disagree (gap ruling G5).
- **The room statuses `roundOver` and `seriesOver` replace `finished`.** The table needs to tell "Next round" from "New series".

## Server

- **The server is the only source of truth, and the protocol has no message that carries game state.** It is the core of the anti-cheat design (source spec section 2).
- **A server-side series, report and snapshot events land with the first server pass, not later.** They are part of the one room state machine and protocol, and retrofitting them is rework.
- **The waiting-room TTL counts from creation and only if no round has started.** Rooms mid-series follow the empty-room rule instead.
- **Fastify request logging is off; only domain events are logged; anti-cheat lines are coalesced per second.** No IPs leak and log volume stays bounded. Later hardening makes repeated malformed-frame lines warnings rather than error-level stack traces.
- **`uncaughtException` logs and exits; `unhandledRejection` logs and continues.** Continuing after an unknown synchronous throw is unsafe, and Railway restarts the service on failure.
- **Every WebSocket handler, timer and room step is wrapped, and a room-level throw aborts only that room.** One bad request must not crash every live match.
- **There is no Fastify `trustProxy`; a custom resolver reads `X-Real-IP` in production.** Fastify 5.12's types and docs drop numeric hop trust, and Railway documents `X-Real-IP`.
- **Per-IP limits: 10 room creates a minute, 20 failed joins a minute, 6 live rooms and 40 open sockets; process-wide 500 rooms and 2,000 sockets.** The site is public. Failed joins are limited because the "private code" reasoning needs room codes to be unguessable by brute force. The rooms-per-IP and socket limits came from the security review (an IP could fill the room cap).
- **The per-IP room cap counts only rooms with a connected player, and abandoned rooms die at the 2-minute empty TTL.** The ledger records the rule but not why.
- **IPv6 clients are keyed by their `/64`.** One home or phone gets a whole `/64` and could otherwise mint billions of "different" clients (security finding F3).
- **A rejoin with the correct token is not blocked by the failed-join window.** An honest player must be able to get back into their seat even if a neighbour on the same address has been guessing codes (F3).
- **Room lifetimes: waiting 15 minutes, empty 2 minutes, finished and idle 10 minutes, any room 3 hours at most.** The idle and age limits came from the security review so one address cannot hold rooms open forever.
- **A socket over the per-IP or process cap is told `SERVER_BUSY` and closed with 1013.** 1013 is the standard "try again later" close code.
- **The WebSocket upgrade must have an `Origin` host equal to the `Host` header, or no `Origin` at all.** This replaces the earlier decision to have no Origin check (tokens live in `sessionStorage`, so a cross-site socket gains nothing); the review confirmed a foreign `Origin` was still accepted (finding F4). It stops other websites, not scripted clients, which can omit the header.
- **Every response carries a Content-Security-Policy, `nosniff` and `no-referrer`.** The review found none. The policy is same-origin only, with `frame-ancestors 'none'`.
- **`style-src` allows `'unsafe-inline'` only when `NODE_ENV` is not `production`.** The built client does not need it, but dev servers and the e2e probes inject `<style>` tags; the Dockerfile sets `NODE_ENV=production`.
- **A socket with more than 512 KB buffered is closed `SLOW_CONSUMER` (4005) and may rejoin; a pong counts as liveness only if it answers an outstanding ping.** A reviewer grew a slow reader's buffer without limit, and any `pong` had kept it alive.
- **Messages other than inputs have their own per-connection bucket: burst 20, refill 5 a second.** Join, leave and rematch spam was ungated (security finding F9).
- **Names refuse control, format and bidirectional-override characters, and the UI renders them inside `<bdi>`.** The review flagged names that accepted these characters (finding F7), and `<bdi>` isolates a name's text direction from the text around it. A side effect is that joined emoji sequences are refused too; see the accepted limitations.
- **The input drain is capped at 10 actions per seat per tick, the queue at 60, and the loop catches up at most 5 ticks per wake.** These are source spec numbers: the 5-tick catch-up avoids a death spiral after a stall, and the other two bound how much work one seat can queue.

## Client

- **No router and no state library.** Three routes and one store do not justify a dependency.
- **The standoff and combo banner are DOM, painted from a frame callback inside the canvas animation loop.** DUEL! and input-live share one frame, and the text keeps the design's typography.
- **Client unit tests are DOM-free (Vitest `environment: 'node'`), and UI behaviour is proven by Playwright.** There is no jsdom dependency, and the evidence comes from a real browser.
- **End-to-end tests locate elements by `data-testid` and assert copy imported from `ui/copy.ts`.** CSS `text-transform` cannot break a locator, and each string has one source.
- **Music is synthesized in the browser with Web Audio: A minor, tempo `100 + 6 x level` bpm, remembered under `stackerist:music`.** It meets the owner's music request with no audio files, no licensing and no dependency. DESIGN.md names no key, so A minor (Am F C G, Am F G E) is the author's choice, flagged for review.
- **The danger pulse starts when stack height plus pending garbage is 16 rows or more.** The design says "within 4 of the top"; reduced motion gets a steady red frame.
- **The post-match chart is hand-rolled SVG with a title, description and a hidden data table.** The dependency set stays closed. No chart library was added.
- **Fonts are self-hosted with `@fontsource`.** The design says not to load them from Google at runtime; no further reason is recorded.
- **The game backdrop is a flat 0.84 dark overlay, and the display font gets a synthetic -12 degree slant.** The floodlight backdrop gave HUD labels a 1.09:1 contrast ratio, and the display font has no italic.
- **Garbage cells use fill `#776A5D` with stripe `#6A5E52`.** The first garbage colour had 1.94:1 contrast against the board well; these reach 3.74:1 and 3.12:1.
- **The L piece colour is `#12978A`, changed from `#00B3A4`.** The original collided with the T piece for people with tritan colour vision; the minimum colour distance for tritan became 10.38.
- **The look avoids the classic falling-block colour set, name and trade dress.** The owner listed a look-alike of a famous game as a failure.
- **The whole game screen fits a 1280 by 600 viewport with no scrolling.** It is a typical laptop at 125 to 150 % scaling minus browser toolbars.

## Build, test and tooling

- **Node 24 instead of the spec's Node 20.** Node 20 reached end-of-life in April 2026; the owner accepted Node 24 LTS, which was already installed on the development machine.
- **Packages resolve through a `@stackerist/source` export condition in dev and test, and through `dist` in production.** There is no prebuild step, and the production build stays real. A side effect: on a fresh clone the client tests need `pnpm typecheck` to have emitted `dist` first.
- **`@stackerist/protocol` depends on `@stackerist/engine`.** The views, type checks and the one `Predictor` need engine types, and the latency test has to exercise the real algorithm.
- **Every requirement-proving test names its id in the title (`REQ-014 ...`).** The conformance check can then map evidence to requirements mechanically.
- **The CPU test passes if any of up to three 10-second windows is under 5 %.** A busy machine only adds CPU time to the process, so a server that really burns 5 % fails all three; the cost is that 3.91 % is not "well under" 5 %, so it needs re-measuring on the host.
- **The latency harness runs on a virtual clock with a fixed 7,919 ms client clock skew.** The skew proves the clock-skew correction works.
- **The latency harness disables the per-connection non-input bucket.** The harness sends `rematch` as a synchronisation barrier every few simulated ticks, and the bucket correctly dropped it; the bucket keeps its own tests.
- **Server tests have a 15-second timeout instead of retries.** Random 5-second timeouts appeared when 50 or more processes were running; the same files pass alone in about 0.25 seconds each.
- **The real-stalled-reader slow-consumer test is skipped on Linux.** Linux autotunes socket buffers to about 10 MB, so a paused reader legitimately outlasts the test; the forged-`bufferedAmount` cases in the same file prove the logic on every operating system. CI on Linux found this.
- **The end-to-end suite runs with one worker.** Two workers were declined because the standoff timing check (within 200 ms) would flake, and CI does not run the suite.
- **The geometry gate has a `[data-overlay]` exclusion, and overlay content is still measured for overflow.** They are intentional overlays (effects canvas, standoff, combo banner, result scrims), which the overlap rule is not meant for.
- **Semgrep ran with four explicit public rulesets and metrics off.** `--config=auto` refuses to run with metrics off, and enabling telemetry was not chosen.
- **CI runs with `contents: read` permission only.** The workflow notes least privilege.

## Hosting and deploy

- **Railway, region Southeast Asia (Singapore), `asia-southeast1-eqsg3a`.** The owner chose Singapore because lag depends on distance to the server; the id was checked against Railway's deployment-regions documentation.
- **One replica, no horizontal scaling.** Rooms live in one process's memory; scaling is listed as future work.
- **The image is a multi-stage Dockerfile on Node 24 Alpine, running as the `node` user, started with `node` directly.** Starting without pnpm lets the platform's SIGTERM reach the server.
- **The Dockerfile uses no BuildKit cache mounts.** Railway requires service-scoped mount ids, so plain layers are used.
- **The Docker context and build stage keep `design/tokens` and `design/assets`, and nothing else from `design/`.** The client imports them, so the build fails without them; concept art stays out.
- **`railway.json` watch patterns include the root config files.** A commit that changes only `package.json`, the lockfile or the `Dockerfile` must still trigger a deploy.
- **Deploy success is read from Railway's deployment status, never from the CLI's exit code.** The CLI has reported success on failed deploys on the development machine.
- **The client IP defaults to `X-Real-IP` in production and to the socket address otherwise, and is verified by a spoof test after the first deploy.** Railway documents `X-Real-IP` but not whether a client-supplied value is overwritten.

## Accepted limitations

- **The 31-bit piece seed stays for now.** The owner: "stay on 31-bit random seed generator. we will fix this later." A scripted client can recover its seed in about a minute and see its own future pieces and garbage holes, but not the opponent's. The remedy (a 128-bit server seed or a crypto-backed bag) is future work.
- **Phones are not a supported player platform.** Keyboard-only is the design; the result card is scaled down on a phone and the HUD is cramped, and both were accepted as documented limitations rather than fixed.
- **Emoji are refused in names, for readability.** The owner's answer on 2026-11-10 to the open question about joined emoji, and broader than asked: all emoji, including joined, flag, skin-tone and keycap sequences. The refusal is built from stable emoji code-point ranges and the Unicode properties together, because the properties alone changed between Node 24.13 (this development machine) and Node 24.22 (CI) and made three tests fail on GitHub; text-style symbols (a star, a heart, the copyright sign) are therefore deliberately left unspecified.
- **The end-to-end suite does not run under the production Content-Security-Policy.** It needs inline styles for its probes; the strict policy was checked once by hand, and a production-policy run is future work.
- **The Docker image has not been built on the development machine.** Docker is not installed there, so the first Railway build is the first real build.
- **Names are normalized (NFKC) and must contain a letter or digit.** The security re-review showed blank-looking names (Hangul fillers, a Braille blank), unreadable stacks of combining marks and full-width or mathematical look-alike letters; normalizing and requiring a letter or digit keeps names readable, and runs of three combining marks are refused while the two a real script needs (Thai, Vietnamese) still pass. Homoglyph spoofing is out of scope: no cheap rule separates it from real names.
- **Every undeleted room counts against the IP that created it, and each IPv6 /48 has an aggregate cap.** The re-review created rooms, closed the creator's socket and rejoined them, holding 10 rooms against a cap of 6; counting empty rooms until they are deleted closes that, and the /48 cap stops one delegated prefix from multiplying the per-/64 budget.
- **The 3-hour room age limit never closes a match in progress.** It re-checks every 5 seconds and closes the room between rounds, because a family playing for three hours should not lose a live round.
- **Refused-socket warnings are coalesced under one key per second, and log coalescing is indexed per connection.** A flood of refused upgrades wrote about 7,000 log lines in 10 seconds and each close scanned every key; after the change it writes about 22 and the close cost no longer grows with the number of entries. Health-check latency under such a flood did not improve, because the cost is the upgrade handling itself; that remains a known residual.
- **Every regular expression on attacker-controlled input is linear and has a hostile-length timing test.** The Host-header filter added in the first security round lost its backslashes and backtracked exponentially, so one request with a long hostile `Host` could have frozen the server; it was caught before any deploy, repaired, bounded, and the built file's pattern is checked for its backslashes.
- **A merge is not done until its GitHub CI run is green.** Two separate pushes passed on the development machine and failed on Linux CI (kernel socket buffers, then Unicode data in a newer Node), so local green is not evidence about the deploy platform.
