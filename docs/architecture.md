# Stackerist — Architecture (Wave 0)

**Status:** contract for Wave 1+ builders · **Date:** 2026-11-08 · **Author:** cdt:architect
**Authority:** `docs/superpowers/specs/2026-11-07-stackerist-design.md` @ `04314d9` (wins) → `spec (1).md`
(where the design adopts it) → `DESIGN.md` / `PRODUCT.md` / `design/tokens/*` (look and copy) → this file.
The requirement ids are the 92 rows in `.claude/specs/EXTRACTED_REQUIREMENTS.json` (REQ-001…REQ-092).
This file is written against the **merged scaffold** on `build/v1` (`43a8ced`, `498d193`).

**Binding rules for every builder**
1. The shapes, names, units and file boundaries here are contracts. To change one, message the orchestrator,
   which re-dispatches the owner. Never fix another agent's contract locally.
2. Every producer/consumer literal (message `type`s, fields, error and close codes, paths, storage keys,
   DOM hooks, test ids, UI copy) is defined **once** and imported. A retyped literal is a defect (§7.4).
3. **No new or bumped dependencies.** `pnpm-lock.yaml` stays untouched by Wave 1+ agents. The one exception
   is the workspace link in OQ-1, which the orchestrator or OPS applies before W1b.
4. Every test that proves a requirement names its id in the test title (`it('REQ-014 combo bonus …')`).
5. Everything a package exposes is re-exported from its `src/index.ts`, because the `@stackerist/source`
   condition points there.

**How the library APIs were grounded.** context7 is unavailable: it needs OAuth that this session can't
complete. I checked versions in the lockfile and on the npm registry, and APIs in the installed `.d.ts` files
(listed in the report's evidence block) plus the official docs over WebFetch. Anything not proven that way
is listed under §8.2 Risks.

---

## 1. Package graph & build (as scaffolded)

### 1.1 Graph

```
            ┌──────────────────────┐
            │ @stackerist/engine   │  pure rules · no deps · lib ES2023 · types: []
            └─────────┬────────────┘
                      │  workspace link  ◄── OQ-1: protocol → engine (not in the scaffold yet)
            ┌─────────▼────────────┐
            │ @stackerist/protocol │  zod schemas, wire types, views, clock + predictor kernel
            └───┬──────────────┬───┘
                │              │
   ┌────────────▼──────┐   ┌───▼──────────────────┐
   │ @stackerist/server│   │ @stackerist/client   │  Vite 8 + React 19 + canvas
   │ Node 24, Fastify 5│   │ (bundled by Vite)    │
   └───────────────────┘   └──────────────────────┘
 e2e/        root folder, not a workspace package (Playwright 1.63, e2e/playwright.config.ts)
 design/     tokens.css + tokens.ts + assets/*.webp (imported by the client; owned by ui-ux)
```

| Package | `exports["."]` (in this order) | Emits |
|---|---|---|
| `@stackerist/engine` | `@stackerist/source` → `./src/index.ts` · `types` → `./dist/index.d.ts` · `default` → `./dist/index.js` | `tsconfig.lib.json`: composite, `src`→`dist` |
| `@stackerist/protocol` | same shape | same |
| `@stackerist/server` | same shape (nobody imports it) | `tsconfig.lib.json` → `dist/index.js` |
| `@stackerist/client` | — | Vite → `apps/client/dist` |

### 1.2 TypeScript 6.0.3 — the real project layout
- `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`,
  `verbatimModuleSyntax`, `isolatedModules`, `module`/`moduleResolution: NodeNext`, `lib: ES2023`, `types: []`,
  declarations and source maps. `exactOptionalPropertyTypes` is **off**, and must stay off because zod-inferred
  optionals rely on it.
- `tsconfig.json` is the solution file. **`pnpm typecheck` = `tsc -b`** over `packages/engine`,
  `packages/protocol`, `apps/server`, `apps/client`, `e2e` and `tsconfig.tools.json`. Never run
  `tsc --noEmit` at the root: with `"files": []` it typechecks nothing.
- `tsconfig.build.json` lists only the emitting projects (engine lib, protocol lib, server lib). It is used by
  `pnpm build` and the Dockerfile.

| Project file | Resolution | lib · types | Emit | References |
|---|---|---|---|---|
| `packages/engine/tsconfig.lib.json` | NodeNext | ES2023 · `[]` (no DOM, no Node, so purity is enforced by types) | composite → `dist` | — |
| `packages/engine/tsconfig.test.json` | NodeNext | ES2023 · `node` | noEmit (`test/**`, `vitest.config.ts`) | engine lib |
| `packages/protocol/tsconfig.lib.json` | NodeNext | ES2023 · `[]` | composite → `dist` | **add `../engine/tsconfig.lib.json` (OQ-1)** |
| `packages/protocol/tsconfig.test.json` | NodeNext | ES2023 · `node` | noEmit | protocol lib (+ engine lib, OQ-1) |
| `apps/server/tsconfig.lib.json` | NodeNext | ES2023 · `node` | composite → `dist` | engine lib, protocol lib |
| `apps/server/tsconfig.test.json` | NodeNext | ES2023 · `node` | noEmit | server, engine, protocol libs |
| `apps/client/tsconfig.app.json` | Bundler, `jsx: react-jsx`, `allowImportingTsExtensions` | ES2023 + DOM · `vite/client` | noEmit; includes `src/**` **and** `test/**` | engine lib, protocol lib |
| `apps/client/tsconfig.node.json` | Bundler | `node` | noEmit (`vite.config.ts`, `vitest.config.ts`) | — |
| `e2e/tsconfig.json` | Bundler | ES2023 + DOM · `node` | noEmit (`e2e/**/*.ts`) | — |

**Import style.** Engine, protocol and server use relative imports with `.js` extensions (NodeNext); the
scaffold tests prove Vitest resolves `../src/index.js` to the `.ts` source. The client uses explicit
`.ts`/`.tsx` extensions, as the scaffold's `main.tsx` does. The client imports the design tokens by relative
path (`../../../design/tokens/tokens.ts`, `…/tokens.css`). TypeScript pulls imported files into the program
even when `include` doesn't list them, and Vite's default `server.fs.allow` covers the workspace root.

### 1.3 How the packages see each other
| Consumer | Resolves `@stackerist/engine` / `@stackerist/protocol` to | Mechanism (scaffold) |
|---|---|---|
| `tsc -b` | `types` → `dist/index.d.ts`, redirected to source by project references | references |
| Server at runtime (`pnpm start`, Docker) | `default` → `packages/*/dist/index.js` | Node ESM `exports` |
| Server dev | `src/index.ts` | `tsx watch --conditions=@stackerist/source src/index.ts` |
| Vite (client dev and build) | `src/index.ts` | `resolve.conditions: ['@stackerist/source', ...defaultClientConditions]` |
| Vitest: server | `src/index.ts` | `resolve.conditions` + `ssr.resolve.conditions` with `@stackerist/source` |
| Vitest: client | `src/index.ts` | `mergeConfig(viteConfig, …)` |
| Vitest: protocol | **must add** the same conditions block as the server config once it imports engine (OQ-1) | PRO edits `packages/protocol/vitest.config.ts` |

No test or dev workflow needs a prebuild. `dist/` is only produced by `tsc -b`.

### 1.4 Root scripts (REQ-074) — as scaffolded
| Script | Command |
|---|---|
| `dev` | `concurrently` → `pnpm --filter @stackerist/server dev` (tsx on :3000) + `pnpm --filter @stackerist/client dev` (Vite on :5173, proxying `/ws` with `ws: true` and `/healthz` to `STACKERIST_SERVER_ORIGIN ?? http://localhost:3000`) |
| `build` | `tsc -b tsconfig.build.json && pnpm --filter @stackerist/client build` |
| `start` | `node apps/server/dist/index.js` (one port: `PORT`, default 3000; `HOST`, default `0.0.0.0`) |
| `test` | `vitest run` (root `test.projects: ['packages/*', 'apps/*']`; project names `engine`, `protocol`, `server`, `client`) |
| `test:coverage` | `pnpm --filter @stackerist/engine test:coverage` (engine config: v8, `include: src/**/*.ts`, `thresholds.lines: 90`) |
| `typecheck` | `tsc -b` |
| `lint` | `eslint . --max-warnings=0 && prettier --check .` (builders must run `pnpm format` on their own paths) |
| `e2e` | `pnpm build && playwright test -c e2e/playwright.config.ts` |

### 1.5 Lint guards already in `eslint.config.js`
These are already in place:
- `no-explicit-any` everywhere.
- `strictTypeChecked` plus the `no-unsafe-*` rules for engine and protocol (REQ-070).
- `no-floating-promises` and `no-misused-promises` (REQ-072).
- Engine purity (REQ-011): `no-restricted-globals` for Date, performance, setTimeout, setInterval, process
  and crypto; `Math.random` banned; `node:*` imports banned.

Two gaps, each closed with a test and not a lint change (OPS is idle in W1–W2):
- **Protocol `node:*`.** Already blocked, because `tsconfig.lib.json` has `types: []`, so Node modules don't typecheck.
- **Client `innerHTML` (REQ-044).** UI owns `apps/client/test/ui/no-html.test.ts`, a source scan for
  `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `dangerouslySetInnerHTML`. OPS may add a
  `no-restricted-syntax` rule in W3.

### 1.6 Scaffold deltas this architecture needs (owner, when)
| # | Change | Owner · when |
|---|---|---|
| Δ1 | Add the protocol → engine link: `"@stackerist/engine": "workspace:*"` in `packages/protocol/package.json` dependencies; a reference to `../engine/tsconfig.lib.json` in protocol `tsconfig.lib.json` and `tsconfig.test.json`; then `pnpm install --offline`, which only adds a `link:` importer entry to the lockfile. **OQ-1, blocking W1b.** | orchestrator / OPS · before W1b |
| Δ2 | **Docker context excludes `design/`** (`.dockerignore` lists `design`, and the Dockerfile copies only `packages/` and `apps/`). The client imports `design/tokens/*` and `design/assets/*.webp`, so `pnpm build` in Docker fails. Re-include `design/tokens` and `design/assets` in `.dockerignore`, `COPY design/tokens design/assets` before `pnpm build`, and add `design/tokens/**` and `design/assets/**` to `railway.json` `watchPatterns`. | OPS · W3 (before the first deploy) |
| Δ3 | Repo-level conformance project `tools/` (`tools/vitest.config.ts` name `tools`, `tools/tsconfig.json`), added to root `test.projects` and to root `tsconfig.json` references. It holds REQ-074, 075 and 078 evidence. | OPS · W3 |

---

## 2. Engine (`packages/engine`)

### 2.1 Modules (all re-exported from `src/index.ts`)
| File | Contents |
|---|---|
| `types.ts` | every engine type (§2.2), verbatim |
| `config.ts` | constants, `levelForTick`, `fallInterval` (§2.3) |
| `pieces.ts` | piece table, spawn, cell maths |
| `srs.ts` | kick tables, `tryRotate` |
| `board.ts` | construction, `parseBoard` / `serializeBoard`, collision, rows, garbage insertion, `stackHeight` |
| `rng.ts` | mulberry32, pure and stateful forms |
| `bag.ts` | pure 7-bag |
| `garbage.ts` | attack maths, cancelling, `receiveGarbage` |
| `player.ts` | `createPlayerState`, `applyAction`, `tick`, `ghostPosition`, `isGrounded`, `playerStats` |
| `simulate.ts` | the prediction helper `simulate` (client and the REQ-082 harness) |
| `index.ts` | re-exports everything, and **keeps `ENGINE_VERSION`** until W2 removes the placeholder imports in server and client |

### 2.2 `src/types.ts` (complete; the W1a checkpoint commit copies it verbatim)

```ts
/** The seven tetrominoes. */
export type PieceKind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

/** A filled board cell: a piece letter, or 'G' for garbage. */
export type CellKind = PieceKind | 'G';

/**
 * Exactly BOARD_HEIGHT (20) strings of exactly BOARD_WIDTH (10) characters, each '.' (empty) or a CellKind.
 * board[0] is the top row (y = 0); board[y][x] is column x. Immutable by convention: never mutate;
 * every change returns a new array (strings are immutable, so a row edit rebuilds one string and a
 * copy is 20 references). This IS the serialized form: parseBoard/serializeBoard, fixtures and the wire.
 */
export type Board = readonly string[];

/** Rotation state: 0 = spawn, 1 = R (one CW turn), 2 = 180°, 3 = L (one CCW turn). */
export type Rotation = 0 | 1 | 2 | 3;

/** Board coordinates in cells: x = column 0..9 (left→right), y = row 0..19 (top→bottom). */
export interface Cell {
  readonly x: number;
  readonly y: number;
}

/** The falling piece. (x, y) = top-left of its n×n bounding box on the board; may be negative. */
export interface ActivePiece {
  readonly kind: PieceKind;
  readonly rotation: Rotation;
  readonly x: number;
  readonly y: number;
}

/** One incoming attack: `rows` (≥ 1) garbage rows, all with the empty cell at `holeColumn` (0..9). */
export interface GarbageAttack {
  readonly rows: number;
  readonly holeColumn: number;
}

/** Pure 7-bag state. Server-only: never serialized to any client. */
export interface BagState {
  /** mulberry32 state, uint32. */
  readonly rng: number;
  /** Pieces left in the current shuffled bag, next first (0..7 entries). */
  readonly remaining: readonly PieceKind[];
}

/** The clearing lock with the highest combo; ties → higher attack, then earlier (design §5.4). */
export interface BestMoment {
  /** 20 rows with the finishing piece written, BEFORE full rows were removed. */
  readonly board: Board;
  /** y indices of the cleared rows in `board`, ascending, 1..4 entries. */
  readonly clearedRows: readonly number[];
  /** The finishing piece's 4 cells, in `board` coordinates. */
  readonly pieceCells: readonly Cell[];
  /** Combo count after this lock (≥ 1). */
  readonly combo: number;
  /** Rows cleared by this lock (1..4). */
  readonly linesCleared: number;
  /** LINE_ATTACK[linesCleared] + comboBonus(combo), before cancelling. Rows. */
  readonly attack: number;
  /** Rows sent to the opponent after cancelling. */
  readonly sent: number;
  /** Rows of own pending garbage cancelled by this lock. */
  readonly cancelled: number;
  /** Match tick at which the lock happened (the tick being processed). */
  readonly tick: number;
}

/** Per-seat round stats carried by gameOver (design §6). */
export interface PlayerStats {
  readonly linesCleared: number;
  readonly garbageSent: number;
  readonly garbageCancelled: number;
  readonly piecesPlaced: number;
  readonly bestCombo: number;
  readonly bestMoment: BestMoment | null;
}

export interface PlayerState {
  /** Match tick this state is AT = the next tick `tick()` will process. Integer ≥ 0. */
  readonly tick: number;
  readonly board: Board;
  /** null when topped out, or (prediction only) when the queue ran dry ("starved"). */
  readonly active: ActivePiece | null;
  /** Upcoming pieces after `active`, next first. Server: exactly PREVIEW_COUNT after every spawn. */
  readonly queue: readonly PieceKind[];
  /** Refill source. Server: a bag. Client prediction: null (queue = the preview it was sent). */
  readonly bag: BagState | null;
  /** Incoming attacks, oldest first. */
  readonly pendingGarbage: readonly GarbageAttack[];
  readonly softDrop: boolean;
  /** Ticks counted toward the next gravity row (0 ≤ n < current fall interval). */
  readonly gravityCounter: number;
  /** Consecutive grounded ticks (0..LOCK_DELAY_TICKS). */
  readonly lockCounter: number;
  /** Lock-delay resets used since lowestY last increased (0..MAX_LOCK_RESETS). */
  readonly lockResets: number;
  /** Largest box-origin y the active piece has reached since it spawned. Rows. */
  readonly lowestY: number;
  /** Consecutive clearing locks; 0 after a non-clearing lock. */
  readonly combo: number;
  readonly bestCombo: number;
  readonly linesCleared: number;
  /** Rows sent after cancelling. */
  readonly garbageSent: number;
  /** Rows of own pending garbage cancelled by own attacks. */
  readonly garbageCancelled: number;
  /** Rows routed in through receiveGarbage, whether later cancelled, inserted or still pending (design §5.7). */
  readonly garbageReceived: number;
  /** Rows actually inserted into the board (drives the garbage nudge). */
  readonly garbageInserted: number;
  readonly piecesPlaced: number;
  readonly bestMoment: BestMoment | null;
  readonly toppedOut: boolean;
}

export type Action =
  | { readonly type: 'moveLeft' }
  | { readonly type: 'moveRight' }
  | { readonly type: 'rotateCW' }
  | { readonly type: 'rotateCCW' }
  | { readonly type: 'softDropStart' }
  | { readonly type: 'softDropStop' }
  | { readonly type: 'hardDrop' };

export type ActionType = Action['type'];

/** An input stamped with the match tick it was made for (design §6.1). */
export interface StampedInput {
  /** ≥ 1, strictly increasing per seat binding per round. */
  readonly seq: number;
  /** Match tick to apply it at: applied at the first processed tick ≥ this. */
  readonly tick: number;
  readonly action: Action;
}

export type TopOutReason = 'SPAWN_BLOCKED' | 'GARBAGE_OVERFLOW';

export type EngineEvent =
  | { readonly type: 'moved'; readonly dx: -1 | 1 }
  | { readonly type: 'rotated'; readonly rotation: Rotation; readonly kickIndex: number }
  | { readonly type: 'locked'; readonly kind: PieceKind; readonly cells: readonly Cell[] }
  | { readonly type: 'linesCleared'; readonly count: number; readonly rows: readonly number[] }
  | { readonly type: 'combo'; readonly count: number }
  | { readonly type: 'garbageCancelled'; readonly rows: number }
  | { readonly type: 'attack'; readonly rows: number }
  | { readonly type: 'garbageInserted'; readonly rows: number }
  | { readonly type: 'spawned'; readonly kind: PieceKind }
  | { readonly type: 'starved' }
  | { readonly type: 'toppedOut'; readonly reason: TopOutReason };

export interface StepResult {
  readonly state: PlayerState;
  readonly events: readonly EngineEvent[];
}

export interface TickedEvent {
  /** The match tick being processed when the event happened. */
  readonly tick: number;
  readonly event: EngineEvent;
}

export interface SimulateResult {
  /** State at `reachedTick`. */
  readonly state: PlayerState;
  /** = state.tick; equals the requested toTick unless stopped early. */
  readonly reachedTick: number;
  readonly stoppedBy: 'none' | 'starved' | 'toppedOut';
  readonly events: readonly TickedEvent[];
  /** seq of every input applied, in application order. */
  readonly appliedSeqs: readonly number[];
}
```

### 2.3 `src/config.ts`

```ts
export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;
export const TICK_RATE = 60;                                                  // ticks per second
export const GRAVITY_TABLE = [60, 48, 37, 28, 21, 16, 11, 8, 6, 4, 3, 2, 1] as const; // ticks per row, by level
export const MAX_LEVEL = 12;                                                  // GRAVITY_TABLE.length - 1
export const LEVEL_UP_TICKS = 1800;                                           // 30 s
export const SOFT_DROP_TICKS_PER_ROW = 2;
export const LOCK_DELAY_TICKS = 30;
export const MAX_LOCK_RESETS = 15;
export const PREVIEW_COUNT = 5;
export const LINE_ATTACK = [0, 0, 1, 2, 4] as const;                         // index = rows cleared
export const COMBO_BONUS_CAP = 4;
export const MAX_ACTIONS_PER_TICK = 10;                                       // server drain AND simulate()
/** min(MAX_LEVEL, floor(max(0, tick) / LEVEL_UP_TICKS)); `tick` is the absolute match tick. */
export function levelForTick(tick: number): number;
/** softDrop ? min(GRAVITY_TABLE[level], SOFT_DROP_TICKS_PER_ROW) : GRAVITY_TABLE[level]; level clamped 0..MAX_LEVEL. */
export function fallInterval(level: number, softDrop: boolean): number;
```
`TICK_MS` (1000/60, a float) lives in **protocol**, so the engine stays integer-only. The HUD shows
"Speed" as `level + 1` (1–13, per DESIGN.md); the wire and the engine carry the 0-based level.

### 2.4 Function signatures per module

```ts
// pieces.ts
export const PIECE_KINDS: readonly PieceKind[];        // ['I','O','T','S','Z','J','L'] — the bag's base order (determinism)
export interface PieceDef {
  readonly size: 2 | 3 | 4;                            // bounding box n
  readonly cells: readonly Cell[];                     // box coords, rotation 0 (source spec §3.2)
  readonly spawnX: number;                             // box origin on board: 3 (O: 4)
  readonly spawnY: number;                             // I: -1, others: 0
}
export const PIECES: Readonly<Record<PieceKind, PieceDef>>;
export function spawnPiece(kind: PieceKind): ActivePiece;                          // rotation 0 at the spawn origin
export function rotateBoxCells(cells: readonly Cell[], size: number, turnsCW: Rotation): Cell[]; // (x,y)→(n-1-y, x) per turn
export function pieceCells(piece: ActivePiece): Cell[];                            // 4 cells, board coordinates

// srs.ts
export type KickKey = '0>1' | '1>0' | '1>2' | '2>1' | '2>3' | '3>2' | '3>0' | '0>3';
export type KickTable = Readonly<Record<KickKey, readonly (readonly [dx: number, dy: number])[]>>; // SRS +y-UP, verbatim §3.3
export const JLSTZ_KICKS: KickTable;
export const I_KICKS: KickTable;
/** The 5 offsets converted to board space (dx, -dy). O → []. */
export function kickOffsets(kind: PieceKind, from: Rotation, to: Rotation): readonly Cell[];
/** First non-colliding kick, or null (state then unchanged). direction: 1 = CW, -1 = CCW. */
export function tryRotate(board: Board, piece: ActivePiece, direction: 1 | -1): { piece: ActivePiece; kickIndex: number } | null;

// board.ts
export const EMPTY_ROW: string;                                              // '..........'
export function emptyBoard(): Board;
/** Validates 20 rows × 10 chars of '.IOTSZJLG'; throws RangeError otherwise. Returns a frozen copy. */
export function parseBoard(rows: readonly string[]): Board;
/** A fresh mutable copy: the wire and fixture form. */
export function serializeBoard(board: Board): string[];
export function cellAt(board: Board, x: number, y: number): CellKind | null; // null = empty OR out of bounds
export function isBlocked(board: Board, x: number, y: number): boolean;      // filled or out of bounds (REQ-001)
export function collides(board: Board, cells: readonly Cell[]): boolean;
export function writeCells(board: Board, cells: readonly Cell[], kind: CellKind): Board;
export function fullRows(board: Board): number[];                            // ascending y
export function removeRows(board: Board, rows: readonly number[]): Board;    // shifts down; empty rows on top
/** Pushes the stack up by `rows` and adds rows of 9 'G' + '.' at holeColumn at the bottom. */
export function insertGarbage(board: Board, rows: number, holeColumn: number): { board: Board; overflow: boolean };
/** Rows from the floor to the highest filled cell, 0..20 (0 = empty). Locked cells only. Used by the
 *  report samples (REQ-090) and the danger pulse (REQ-088). */
export function stackHeight(board: Board): number;

// rng.ts — mulberry32, 32-bit integer maths only
export interface RngStep { readonly value: number; readonly state: number } // both uint32
export function seedRng(seed: number): number;                               // seed >>> 0
export function rngNext(state: number): RngStep;
/** Uniform integer in [0, n) by rejection sampling; 1 ≤ n ≤ 2^32. */
export function rngInt(state: number, n: number): RngStep;
/** Stateful convenience for the server's hole RNG: each call returns the next uint32. */
export function createRng(seed: number): () => number;

// bag.ts
export function createBag(seed: number): BagState;                           // `remaining` empty; the first draw shuffles
export function drawPiece(bag: BagState): { readonly piece: PieceKind; readonly bag: BagState };
export function drawPieces(bag: BagState, n: number): { readonly pieces: PieceKind[]; readonly bag: BagState };
// Shuffle = Fisher–Yates over a copy of PIECE_KINDS, i from 6 down to 1, j = rngInt(state, i + 1).

// garbage.ts
export function comboBonus(combo: number): number;                           // min(COMBO_BONUS_CAP, floor(combo / 2))
export function attackFor(linesCleared: number, combo: number): number;      // LINE_ATTACK[n] + comboBonus(combo)
export function pendingTotal(pending: readonly GarbageAttack[]): number;     // rows
/** Oldest first; a partly cancelled entry keeps its holeColumn and its remaining rows. */
export function cancelGarbage(pending: readonly GarbageAttack[], attack: number):
  { readonly pending: readonly GarbageAttack[]; readonly cancelled: number; readonly leftover: number };
/** Appends to pendingGarbage, garbageReceived += rows. No-op (same reference) when toppedOut. */
export function receiveGarbage(state: PlayerState, attack: GarbageAttack): PlayerState;

// player.ts
export interface CreatePlayerOptions {
  readonly bag?: BagState | null;                  // server: createBag(pieceSeed); tests and prediction: null
  readonly queue?: readonly PieceKind[];           // drawn before the bag; the first one spawns unless `active` is given
  readonly board?: Board;                          // default emptyBoard()
  readonly active?: ActivePiece | null;            // tests: place a piece directly (no spawn)
  readonly pendingGarbage?: readonly GarbageAttack[];
  readonly tick?: number;                          // default 0
}
export function createPlayerState(options?: CreatePlayerOptions): PlayerState;
export function applyAction(state: PlayerState, action: Action): StepResult;  // pure; never advances tick
export function tick(state: PlayerState, level: number): StepResult;          // pure; processes tick `state.tick`
export function ghostPosition(state: PlayerState): ActivePiece | null;
export function isGrounded(board: Board, piece: ActivePiece): boolean;         // collides at y + 1
export function playerStats(state: PlayerState): PlayerStats;

// simulate.ts — the prediction helper (design §6.1)
export function simulate(from: PlayerState, toTick: number, inputs: readonly StampedInput[]): SimulateResult;
```

### 2.5 Rule pins (resolve the ambiguities in source §3.7; engine tests and REQ-082 depend on them)

**An unchanged state returns the same reference.** A blocked move, a failed rotation, rotating O, and any
action or tick on a topped-out or starved state all return `{ state, events: [] }` with the input object
itself (REQ-003/005/007).

**`applyAction(state, a)`** (never touches `state.tick`):
1. If `toppedOut` or `active === null`, return unchanged.
2. **moveLeft / moveRight:** shift x by ∓1. If it collides, return unchanged. Otherwise take
   `wasGrounded = isGrounded(before)`. If `wasGrounded && lockResets < MAX_LOCK_RESETS`, set
   `lockCounter = 0` and `lockResets += 1`. Emit `moved`.
3. **rotateCW / rotateCCW:** O is unchanged. Call `tryRotate`; null means unchanged. Apply the same
   lock-reset rule, then emit `rotated`.
4. After any successful move or rotate: if `piece.y > lowestY`, set `lowestY = piece.y` and `lockResets = 0`.
5. **softDropStart / softDropStop** set `softDrop`. Same reference if it already has that value.
6. **hardDrop:** move to the ghost y, then run the **lock sequence** immediately.

**`tick(state, level)`:**
1. If `toppedOut` or `active === null`, return unchanged. The tick is **not** advanced (REQ-007).
2. Set `interval = fallInterval(level, softDrop)` and `gravityCounter += 1`. If `gravityCounter ≥ interval`,
   reset it to 0 and, if the piece can move down, move it: `y += 1`, `lockCounter = 0`, then apply the
   lowestY rule.
3. If `isGrounded` after step 2, set `lockCounter += 1`. If `lockCounter ≥ LOCK_DELAY_TICKS`, run the
   **lock sequence**. The landing tick counts as grounded tick 1.
4. `tick += 1`, also after a lock or a top-out on this tick.

**Lock sequence** (design §5.1). The order of steps and of events is exact:
1. Write the cells and emit `locked {kind, cells}`. `piecesPlaced += 1`.
2. `rows = fullRows(board)`. If it is non-empty: capture the best-moment candidate board (piece written),
   call `removeRows`, and emit `linesCleared {count, rows}`. `rows` are indices in the pre-removal board.
3. **Clearing lock:**
   - `combo += 1`; `bestCombo = max(bestCombo, combo)`; emit `combo {count}`.
   - `attack = attackFor(n, combo)`. If `attack > 0`, call `cancelGarbage`, then emit `garbageCancelled`
     (if > 0) and `attack {rows: leftover}` (if > 0). `garbageSent += leftover`; `garbageCancelled += cancelled`.
   - Best moment: the candidate replaces the current one iff `combo > best.combo`, or the combos are equal
     and `attack > best.attack`. Otherwise the earlier one stays. Pending garbage is **not** inserted.
4. **Non-clearing lock:**
   - `combo = 0`.
   - If pending is non-empty, insert the attacks **sequentially, oldest first**. Each insertion pushes the
     stack up and places its rows at the bottom, so **the newest attack ends lowest**.
   - Let `k` = total rows. `overflow = k > 20 || any filled cell in the top k rows of the pre-insertion board`.
   - Keep the last 20 rows. `garbageInserted += k`. Emit `garbageInserted {rows: k}`. Clear pending.
   - On overflow: `toppedOut = true`, `active = null`, emit `toppedOut {GARBAGE_OVERFLOW}`, stop (no spawn).
5. **Spawn:**
   - If the queue is empty (only possible when `bag === null`): `active = null`, emit `starved`, stop.
   - Otherwise take `queue[0]`. If `bag` is set, refill the queue to exactly PREVIEW_COUNT.
   - Reset `gravityCounter`, `lockCounter` and `lockResets` to 0, and set `lowestY = spawnY`.
   - If any spawn cell collides: `active = null`, `toppedOut = true`, emit `toppedOut {SPAWN_BLOCKED}`.
     Otherwise emit `spawned {kind}`.

### 2.6 Piece queue, purity and a preview that runs dry
- The bag lives **inside** `PlayerState` (`bag: BagState | null`), so refilling stays pure and
  deterministic. The server creates each seat with `createPlayerState({ bag: createBag(pieceSeed), tick: startTick })`.
  That gives two separate bag instances from one seed, so both seats see an identical sequence (REQ-023).
- **The view functions do the information hiding** (§3.8). They copy named fields only, so `bag` and any
  queue beyond the preview never reach the wire.
- The client rebuilds its own state from a snapshot with `bag: null` and `queue = you.next` (5 pieces).
  Prediction can spawn up to 5 pieces ahead. On a 6th, the lock sequence sets `active = null` and emits
  `starved`, and `simulate` stops with `stoppedBy: 'starved'`. The board then shows no falling piece until
  the next snapshot. To starve, a player would need more than 5 locks inside one run-ahead window
  (≤ 30 ticks) with no snapshot, and the server sends a snapshot right after every lock.

### 2.7 `simulate(from, toTick, inputs)` — exact semantics
For `t = from.tick … toTick − 1`:
1. Apply every not-yet-applied input with `input.tick ≤ t`, in ascending `(tick, seq)` order, **at most
   MAX_ACTIONS_PER_TICK**. The rest carry over to the next t. This mirrors the server drain (§4.6).
2. Call `tick(state, levelForTick(t))`.
3. Tag the events from steps 1–2 with `tick: t`. Stop early if `state.toppedOut` or `state.active === null`.

If `toTick ≤ from.tick`, return `from` unchanged. Inputs stamped before `from.tick` are applied at
`t = from.tick`, which is what the server does with late arrivals: it never rewinds. The caller passes
only unacknowledged inputs (`seq > lastAckSeq`).

---

## 3. Protocol (`packages/protocol`)

The protocol is the shared netcode kernel: wire contract, views, clock and predictor. It runs in the browser,
so `types: []` and no `node:*` imports.

### 3.1 Modules (all re-exported from `src/index.ts`; keep `PROTOCOL_VERSION` until W2 removes the placeholder imports)
| File | Contents |
|---|---|
| `constants.ts` | paths, timings, shared limits, storage keys, `ERROR_CODES`, `CLOSE_CODES` (§3.3) |
| `schemas.ts` | every zod schema (§3.7) |
| `messages.ts` | `export type X = z.infer<typeof XSchema>` for every shape below. Types are derived, never hand-written twice. |
| `typeAssertions.ts` | compile-time checks that the wire `Action`, `PieceKind`, `Rotation` and `GarbageAttack` are mutually assignable with the engine's |
| `views.ts` | `toOwnView`, `toPublicView`, `toPlayerStats`, `toWireBestMoment`, `ownViewToPlayerState` (§3.8) |
| `codes.ts` | `normalizeRoomCode`, `isSeatToken`, `gamePath`, `shareUrl`, `tokenStorageKey` |
| `clock.ts` | `TickEstimator`, `toLocalMs` (§3.9). Pure; time is passed in. |
| `predict.ts` | `Predictor` (§3.10). The one prediction algorithm, used by the client **and** the REQ-082 harness. |
| `parse.ts` | `parseClientMessage(text)`, `parseServerMessage(text)` |

### 3.2 Units (pinned for every numeric field on the wire)
| Unit | Fields |
|---|---|
| **match ticks** (integer, 60/s, absolute; a round's first play tick is `startTick`, 0 in production) | `input.tick`, `countdown.tick`, `resumed.tick`, `snapshot.tick`, `gameOver.tick`, `BestMoment.tick`, `SnapshotEvent.tick`, `OwnView.gravityCounter`, `OwnView.lockCounter`, `RoundReport.durationTicks`, `RoundSummary.durationTicks` |
| **server wall clock, ms since Unix epoch** (integer) | `startsAt`, `serverNow`, `graceEndsAt` |
| **duration ms** (integer) | `ping.rtt` (null until the first measurement) |
| **opaque server monotonic ms** (integer, echoed back) | `ping.t`, `pong.t` |
| **rows** (integer) | `GarbageAttack.rows`, `PublicView.pendingGarbage` (total), `SnapshotEvent.rows`, all `garbage*` stats, `heightSamples[i]` (0..20), `lowestY` (row index) |
| **cells** (integer) | `ActivePiece.x/y` (box origin, may be negative), `Cell.x/y`, `holeColumn` (0..9), `clearedRows[i]` (0..19) |
| **counts** | `seq` (≥ 1), `combo`, `bestCombo`, `linesCleared`, `piecesPlaced`, `actions`, `lockResets`, `pausesLeft`, `spectators`, `score.A/B` (0..2), `round` (1..3) |
| **level** | `snapshot.level`: 0-based GRAVITY_TABLE index, 0..12. The HUD shows `level + 1`. |
| **client-local** (never on the wire) | `performance.now()` ms; CSS px for layout; canvas device px = CSS px × devicePixelRatio |

### 3.3 `constants.ts`

```ts
export const WS_PATH = '/ws';
export const HEALTH_PATH = '/healthz';
export const GAME_PATH_PREFIX = '/g/';                 // share link /g/<CODE>
export const WATCH_QUERY_PARAM = 'watch';              // /g/<CODE>?watch=1
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
export const NAME_MIN_LENGTH = 1;                      // after trim
export const NAME_MAX_LENGTH = 16;
export const SEAT_TOKEN_BYTES = 16;                    // 128-bit
export const SEAT_TOKEN_LENGTH = 22;                   // base64url chars, no padding
export const MAX_FRAME_BYTES = 1024;                   // client→server UTF-8 bytes
export const MAX_INPUT_LEAD_TICKS = 30;
export const TICK_MS = 1000 / 60;                      // float; timing maths only
export const COUNTDOWN_MS = 3000;                      // start and resume countdowns (the standoff)
export const PING_INTERVAL_MS = 3000;
export const PONG_TIMEOUT_MS = 10_000;
export const GRACE_MS = 20_000;
export const MAX_PAUSES_PER_SERIES = 3;
export const SEAT_HOLD_MS = 120_000;
export const SNAPSHOT_EVERY_TICKS = 2;
export const SERIES_WINS_NEEDED = 2;
export const HEIGHT_SAMPLE_EVERY_TICKS = 30;
export const DEFAULT_RTT_MS = 100;                     // the client's assumption until the first ping.rtt
export const TOKEN_STORAGE_PREFIX = 'token:';          // sessionStorage key = token:<CODE> (REQ-021)
export const MUSIC_STORAGE_KEY = 'stackerist:music';   // localStorage, 'on' | 'off', default 'on' (DESIGN.md)
export const ERROR_CODES = [
  'BAD_MESSAGE',          // binary, > MAX_FRAME_BYTES, bad JSON, schema failure, unknown type (counts toward 20)
  'ROOM_NOT_FOUND',       // join/rejoin: unknown or malformed code (charges the failed-join budget)
  'BAD_TOKEN',            // rejoin: the token matches no seat (charges the failed-join budget)
  'ROOM_FULL',            // spectator cap reached (OQ-3); never sent while the cap is Infinity
  'NOT_A_PLAYER',         // input/rematch from a spectator
  'NOT_PLAYING',          // input while status ≠ playing (before start, paused/resuming, after round end)
  'BAD_SEQ',              // input seq ≤ the last accepted seq for that seat
  'BAD_TICK',             // input tick > serverTick + 30, or < that seat's previous stamp
  'ALREADY_IN_ROOM',      // create/join/rejoin from a socket already bound to a live room
  'NOT_IN_ROOM',          // input/rematch from an unbound socket
  'NOT_FINISHED',         // rematch while status ∉ {roundOver, seriesOver}
  'TOO_MANY_CREATES',     // per-IP creates: 10 per minute (DESIGN.md copy: "created a lot of games")
  'TOO_MANY_JOINS',       // per-IP failed joins: 20 per minute (DESIGN.md copy: "too many wrong codes")
  'SERVER_BUSY',          // 500 live rooms
  'INTERNAL_ERROR',       // a handler threw; it was logged and the process keeps running
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export const CLOSE_CODES = {
  REPLACED: 4000,              // a newer socket rejoined this seat (REQ-035)
  RATE_LIMITED: 4001,          // 200 dropped inputs in a round (REQ-038)
  TOO_MANY_BAD_MESSAGES: 4002, // 20 BAD_MESSAGEs on one connection (REQ-039)
  PONG_TIMEOUT: 4003,          // no pong for 10 s (REQ-031)
  ROOM_CLOSED: 4004,           // room deleted (empty / waiting TTL / abandoned / aborted)
  SERVER_SHUTDOWN: 1001,
} as const;
export type CloseCodeName = keyof typeof CLOSE_CODES;  // the close `reason` string is the key name
```
`ws` itself closes frames above 16384 bytes (`maxPayload`, close code 1009) before the app sees them (§4.3).
**Client close handling:**
- 4000, 4001, 4002, 4004: do **not** reconnect. Show the DESIGN.md error plate (REPLACED → "This seat is now
  open in another tab…"; RATE_LIMITED → "You were disconnected for sending inputs too fast…").
- 1001, 1006, 4003: reconnect with backoff 0.5 → 1 → 2 → 4 s, retrying throughout the 20 s grace, then
  `rejoin` with the stored token.

### 3.4 Shared wire shapes (the `z.infer` targets)

```ts
type Seat = 'A' | 'B';
type RoomCode = string;                      // 6 chars of ROOM_CODE_ALPHABET, upper case (normalizeRoomCode)
type RoomStatus = 'waiting' | 'countdown' | 'playing' | 'paused' | 'roundOver' | 'seriesOver';
type GameOverReason = 'TOP_OUT' | 'OPPONENT_LEFT' | 'OPPONENT_DISCONNECTED' | 'DRAW';
type SeriesEndReason = 'TWO_WINS' | 'OPPONENT_LEFT' | 'OPPONENT_DISCONNECTED';

interface PlayerInfo { name: string; connected: boolean }
interface WireActivePiece { kind: PieceKind; rotation: 0 | 1 | 2 | 3; x: number; y: number }
interface WireGarbageAttack { rows: number; holeColumn: number }
/** Live stats in every view. */
interface LiveStats {
  linesCleared: number; garbageSent: number; garbageCancelled: number;
  garbageReceived: number; garbageInserted: number; piecesPlaced: number; bestCombo: number;
}
/** Opponents and spectators: board, active piece, next 1, pending total, stats (+combo). Nothing else. */
interface PublicView {
  board: string[];                 // 20 × 10
  active: WireActivePiece | null;
  next: PieceKind[];               // length 0..1
  pendingGarbage: number;          // total rows
  combo: number;
  stats: LiveStats;
  toppedOut: boolean;
}
/** The board's owner only. The piece timers are included so prediction re-simulates exactly (REQ-054/082);
 *  they describe the owner's own piece and reveal nothing hidden. */
interface OwnView {
  board: string[];
  active: WireActivePiece | null;
  next: PieceKind[];               // length 0..PREVIEW_COUNT (5)
  pendingGarbage: WireGarbageAttack[]; // oldest first, with hole columns (needed to predict insertion)
  lastAckSeq: number;              // semantics in §4.6; 0 = nothing acknowledged
  combo: number;
  stats: LiveStats;
  toppedOut: boolean;
  softDrop: boolean;
  gravityCounter: number;          // ticks
  lockCounter: number;             // ticks
  lockResets: number;
  lowestY: number;                 // row
}
interface WireBestMoment {
  board: string[]; clearedRows: number[]; pieceCells: { x: number; y: number }[]; // exactly 4
  combo: number; linesCleared: number; attack: number; sent: number; cancelled: number; tick: number;
}
interface PlayerStats {            // design §6, REQ-046
  linesCleared: number; garbageSent: number; garbageCancelled: number;
  piecesPlaced: number; bestCombo: number; bestMoment: WireBestMoment | null;
}
/** REQ-090, design §5.7: one per seat per round. */
interface RoundReport {
  piecesPlaced: number;
  actions: number;                 // inputs the server drained and passed to applyAction this round
  garbageSent: number;             // rows, after cancelling
  garbageReceived: number;         // rows routed to this player (cancelled, inserted or still pending)
  garbageCancelled: number;        // rows
  durationTicks: number;           // ticks processed while playing (pauses and countdowns excluded)
  heightSamples: number[];         // stackHeight at round-relative ticks 0, 30, 60, … ≤ durationTicks; ≤ 7200 entries
}
// Derived on the client (design §5.7): PPS = piecesPlaced / (durationTicks / 60);
// APM = actions × 60 / (durationTicks / 60). DESIGN.md shows "—" under one second of play.
interface RoundSummary { round: number; replay: boolean; winner: Seat | null; reason: GameOverReason; durationTicks: number }
interface SeriesView {
  round: number;                   // 1..3: the current round, or the last one played
  replay: boolean;                 // true while this round number is being replayed after a draw
  score: { A: number; B: number }; // round wins, 0..2 (a forfeit adds no win)
  over: boolean;
  winner: Seat | null;             // non-null iff over
  endReason: SeriesEndReason | null;
  rounds: RoundSummary[];          // completed rounds in order, incl. draws and a forfeited round; ≤ 64
}
/** REQ-087: visual-only events since the previous snapshot. No hole columns; nothing beyond PublicView. */
type SnapshotEvent =
  | { type: 'attack'; from: Seat; rows: number; tick: number }  // leftover rows routed from `from` to the other seat
  | { type: 'cancel'; seat: Seat; rows: number; tick: number }; // rows `seat` cancelled from its own pending
```

### 3.5 Client → server (every member is a `z.strictObject`; unknown keys → BAD_MESSAGE)

```ts
type ClientMessage =
  | { type: 'create'; name: string }                                   // trimmed, 1..16
  | { type: 'join'; code: string; name?: string; asSpectator?: boolean } // name required unless asSpectator === true
  | { type: 'rejoin'; code: string; token: string }                    // token /^[A-Za-z0-9_-]{22}$/
  | { type: 'input'; seq: number; tick: number; action: Action }       // seq int 1..2^31-1; tick int 0..2^31-1
  | { type: 'leave' }
  | { type: 'rematch' }                                                 // "Next round" in roundOver, "New series" in seriesOver
  | { type: 'pong'; t: number };                                        // echo of ping.t
```
`code` in join and rejoin is `z.string().min(1).max(16)`. The server normalises it with `normalizeRoomCode`
(trim, upper-case, alphabet and length check). A code that fails normalisation gets ROOM_NOT_FOUND, not
BAD_MESSAGE, so a typo never counts toward the disconnect. No client message carries game state (REQ-036).
The full set of keys across all client → server messages is `type, name, code, asSpectator, token, seq, tick, action, t`.

### 3.6 Server → client

```ts
type ServerMessage =
  | { type: 'created'; code: RoomCode; token: string; seat: 'A' }
  | { type: 'joined'; code: RoomCode; seat: Seat | 'spectator'; token?: string } // token only on a first seat join
  | { type: 'room'; code: RoomCode; status: RoomStatus; players: { A?: PlayerInfo; B?: PlayerInfo };
      spectators: number; series: SeriesView }
  | { type: 'countdown'; startsAt: number; serverNow: number; tick: number }      // play starts at `tick` at `startsAt`
  | { type: 'snapshot'; tick: number; level: number; you?: OwnView;
      players: { A?: PublicView; B?: PublicView }; events: SnapshotEvent[] }    // ≤ 64 events
  | { type: 'paused'; seat: Seat; graceEndsAt: number; serverNow: number; pausesLeft: number }
  | { type: 'resumed'; startsAt: number; serverNow: number; tick: number }
  | { type: 'gameOver'; round: number; replay: boolean; winner: Seat | null; reason: GameOverReason;
      tick: number;                                                               // the match tick the round ended at
      series: SeriesView;                                                         // after applying this round
      stats: { A?: PlayerStats; B?: PlayerStats };
      report: { A?: RoundReport; B?: RoundReport } }
  | { type: 'rematchStatus'; A: boolean; B: boolean }                             // ready flags (Next round / New series)
  | { type: 'error'; code: ErrorCode; message: string }
  | { type: 'ping'; t: number; rtt: number | null };
```
`snapshot.players` always carries a PublicView for every seated player, the recipient's own seat included, so
players and spectators render the same way. `you` goes only to a seated recipient. `level = levelForTick(tick)`.
Every recipient gets both seats' `stats`, `report` and `bestMoment`; spectators see both best moments (design §4).

**Ordering guarantees** (the client relies on these):
- Bind: `created`/`joined` → `room` → catch-up (`snapshot`, plus `paused`, `gameOver` and `rematchStatus`
  as the status requires).
- Round start: `room{countdown}` → `snapshot` (the initial state at `startTick`, so boards show under the
  standoff) → `countdown`.
- Round end: final `snapshot` → `gameOver` → `room{roundOver | seriesOver}`.
- Resume: `snapshot` → `resumed`. `room.status` stays `paused` until `startsAt`, then becomes `room{playing}`.

### 3.7 Schema strategy (zod 4.6.7, `import * as z from 'zod'`; checked against `zod/v4/classic/schemas.d.ts`)
- **Building blocks:**
  - `SeatS = z.enum(['A','B'])` and `PieceKindS = z.enum([...])`.
  - `RotationS = z.literal([0, 1, 2, 3])`. The array form of `literal` is declared in the d.ts.
  - `BoardS = z.array(z.string().regex(/^[.IOTSZJLG]{10}$/)).length(20)`.
  - `IntS = z.int()` (safe-integer range).
  - `ActionS = z.discriminatedUnion('type', [7 × z.strictObject({ type: z.literal(…) })])`.
- **Unions:** `ClientMessageSchema` and `ServerMessageSchema` are each a `z.discriminatedUnion('type', [...])`,
  and every member is a `z.strictObject`. Strict **server** schemas mean any leaked extra key (`seed`, `bag`,
  `queue`) fails parsing in tests (REQ-028).
- **Names:** `z.string().trim().min(1).max(16)`; `trim()` is declared as `trim(): this`.
- **Join:** `name` is optional, plus `.refine(m => m.asSpectator === true || m.name !== undefined)`. `refine`
  is declared to return `this`, so the member stays a `ZodObject` and is allowed in a discriminated union.
  Protocol tests must prove trim-then-length ordering and the refine at runtime (R6).
- **Types:** `messages.ts` exports `z.infer<>` types only. `typeAssertions.ts` checks them against the engine's
  `Action`, `PieceKind`, `Rotation` and `GarbageAttack` with
  `type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false`, which ignores readonly by design.
- **Parsing:**
  - `parseClientMessage(text: string): { ok: true; msg: ClientMessage } | { ok: false; reason: 'BAD_JSON' | 'BAD_SCHEMA' }`
    wraps `JSON.parse` in try/catch, then calls `safeParse`.
  - The server checks byte size and binary frames **before** calling it.
  - `parseServerMessage(text): ServerMessage | null` is the client's counterpart.

### 3.8 `views.ts` — the information-hiding boundary (the server uses it; the client uses the inverse)

```ts
export function toPublicView(state: PlayerState): PublicView;               // next = queue.slice(0, 1); pending = pendingTotal
export function toOwnView(state: PlayerState, lastAckSeq: number): OwnView; // next = queue.slice(0, PREVIEW_COUNT)
export function toWireBestMoment(m: BestMoment): WireBestMoment;
export function toPlayerStats(state: PlayerState): PlayerStats;
/** Rebuild a predictable state: bag null, queue = view.next, bestMoment null, tick = the snapshot tick. */
export function ownViewToPlayerState(view: OwnView, tick: number): PlayerState;
```
Each function copies named fields and arrays only. `bag`, the queue beyond the slice, and the seeds are
unreachable from them.

### 3.9 `clock.ts` — tick estimation (design §6.1)

```ts
export class TickEstimator {
  /** On countdown/resumed: play (re)starts at `tick` at server time `startsAt`. Clears samples, unfreezes. */
  anchor(msg: { startsAt: number; serverNow: number; tick: number }, recvLocalMs: number): void;
  /** On every snapshot. Keeps the last 120 samples s = recvLocalMs − tick × TICK_MS. */
  observeSnapshot(tick: number, recvLocalMs: number): void;
  /** From ping.rtt; null keeps the previous value (initially DEFAULT_RTT_MS). */
  setRtt(rttMs: number | null): void;
  readonly rttMs: number;
  /** Freeze at the current estimate (on `paused`). */
  freeze(localMs: number): void;
  /** The server's next tick to process (integer).
   *  With ≥ 1 sample: floor((localMs − min(samples)) / TICK_MS + (rtt / 2) / TICK_MS).
   *  Otherwise:       tick + max(0, floor((localMs + offset − startsAt) / TICK_MS)),
   *                   where offset = serverNow + rtt / 2 − recvLocalMs (server epoch ≈ local + offset). */
  serverTick(localMs: number): number;
  /** serverTick + ceil((rtt / 2) / TICK_MS) + 1, clamped to ≤ serverTick + MAX_INPUT_LEAD_TICKS and
   *  monotonic non-decreasing until the next anchor(). Used both for the display and as the input stamp. */
  targetTick(localMs: number): number;
  /** Local ms at which play (re)starts: the DUEL! instant and the input-live instant (REQ-086). */
  goAtLocalMs(): number | null;
}
/** recvLocalMs − rtt / 2 + (serverEpochMs − serverNow). */
export function toLocalMs(serverEpochMs: number, serverNow: number, recvLocalMs: number, rttMs: number): number;
```
Taking the minimum sample picks the least-delayed snapshot. Adding rtt/2 leans slightly ahead, which is safe:
a stamp that arrives early is applied at its own tick. The 120-snapshot window (about 4 s) lets the estimate
recover after a server stall.

### 3.10 `predict.ts` — the single prediction algorithm (REQ-054, REQ-069, REQ-082)

```ts
export interface DisplayResult {
  readonly state: PlayerState;                 // the displayed own board at targetTick
  readonly newEvents: readonly TickedEvent[];  // only events with tick > the high-water mark (fx fire once)
}
export class Predictor {
  /** base = ownViewToPlayerState(view, tick); drop pending inputs with seq ≤ view.lastAckSeq. */
  onOwnSnapshot(view: OwnView, tick: number): void;
  addInput(input: StampedInput): void;
  /** On paused / countdown / joined: forget the base and the pending inputs. */
  clear(): void;
  /** simulate(base, targetTick, pending), memoised on (base, pending length, targetTick). Snaps to the result; no smoothing. */
  display(targetTick: number): DisplayResult | null;
  readonly pendingCount: number;
}
```
- Garbage reaches the own board only through snapshots: the base `pendingGarbage` includes the hole columns.
- Hard drop is predicted all the way through the lock, and the next piece comes from the preview (design §4).
- The opponent and spectator boards are drawn straight from `PublicView`, with no prediction.

---

## 4. Server (`apps/server`)

### 4.1 Modules (this replaces the placeholder `src/index.ts`; `buildApp`'s static/SPA/error-handler logic moves into `http.ts`)
| File | Responsibility |
|---|---|
| `index.ts` | entry: env → `createServer` → `listen`; `installProcessHandlers`; SIGINT/SIGTERM → `close()`; keeps `resolvePort`, `DEFAULT_PORT` and the `import.meta.main` guard |
| `server.ts` | `createServer(options)`: Fastify app, plugins, routes, wiring |
| `config.ts` | `Limits` and `DEFAULT_LIMITS` (server-only numbers) |
| `clock.ts` | `Clock`, `realClock`, `ManualClock` |
| `clientIp.ts` | `ClientIpConfig`, `clientIpConfigFromEnv`, `resolveClientIp` |
| `codes.ts` | `generateRoomCode(isTaken)`, `generateSeatToken()`, `tokenMatches(stored, candidate)` (uses `crypto.timingSafeEqual`) |
| `rateLimit.ts` | `TokenBucket`, `SlidingWindowCounter` |
| `connection.ts` | the per-socket ingress pipeline (§4.3), the bad-message counter, ping/pong/RTT |
| `rooms.ts` | `RoomRegistry` and the `Room` state machine (§4.4): seats, timers, broadcasts |
| `series.ts` | pure series bookkeeping (§4.5) |
| `match.ts` | `Match`, one per round: engine states, the input pipeline, `step()`, routing, events, report sampling |
| `loop.ts` | `GameLoop`: an accumulator over `clock.monotonicMs()` with a 5-tick catch-up cap |
| `http.ts` | `/healthz`, static files, SPA fallback, the bad-URL page, the error handler |
| `log.ts` | logger factory, `LogEventName`, anticheat coalescing |
| `safe.ts` | `safeCall` wrappers, `installProcessHandlers` |

### 4.2 `createServer` and its injectable dependencies

```ts
export interface Clock {
  /** Wall clock, ms since Unix epoch (integer). Used ONLY for wire timestamps. */
  nowEpochMs(): number;
  /** Monotonic ms (performance.now() timebase). Loop accumulator, buckets, RTT, timers. */
  monotonicMs(): number;
  setTimeout(fn: () => void, ms: number): TimerId;   // callbacks are wrapped by safeCall
  clearTimeout(id: TimerId): void;
}
export type TimerId = { readonly __timerId: unique symbol };
export const realClock: Clock;
export class ManualClock implements Clock { constructor(startEpochMs?: number); advance(ms: number): void } // fires due timers in order

export interface MatchSeeds { readonly pieceSeed: number; readonly holeSeed: number }   // each 0..2^31-1
export interface ServerOptions {
  readonly port?: number;                     // default resolvePort(process.env.PORT) → 3000; tests pass 0
  readonly host?: string;                     // default process.env.HOST ?? '0.0.0.0'
  readonly clientDist?: string | null;        // default <dist>/../../client/dist (scaffold logic); null disables static
  readonly logger?: Logger;                   // a pino instance; tests inject one that writes to memory
  readonly clock?: Clock;                     // default realClock
  readonly seedProvider?: () => MatchSeeds;   // default crypto.randomInt(2 ** 31) for each seed, per round
  readonly holeRngFactory?: (holeSeed: number) => () => number; // returns a hole column 0..9 per call
  readonly clientIp?: ClientIpConfig;         // default clientIpConfigFromEnv(process.env)
  readonly limits?: Partial<Limits>;
  readonly test?: TestOptions;                // never set in production
}
export interface TestOptions {
  readonly manualTick?: boolean;              // no loop timer; drive ticks with testing.step()
  readonly startTick?: number;                // first play tick of every round (21600 → level 12 at once)
  readonly throwOn?: (msg: ClientMessage) => boolean; // fault injection inside the wrapped handler (REQ-072)
}
export interface TestControls {
  step(ticks?: number): void;                 // manualTick only: process N ticks for every playing room, then flush sends
  framesHandled(): number;                    // total client frames fully handled (an I/O barrier for tests)
  inspect(code: string): RoomInspection | null;
}
export interface RoomInspection {
  readonly status: RoomStatus; readonly tick: number | null;
  readonly players: { readonly A?: PlayerState; readonly B?: PlayerState };   // deep-frozen engine states
  readonly series: SeriesView;
  readonly seats: { readonly A?: SeatInspection; readonly B?: SeatInspection };
  readonly spectators: number;
}
export interface SeatInspection { readonly connected: boolean; readonly pausesUsed: number; readonly ready: boolean; readonly bufferLength: number; readonly drops: number }
export interface StackeristServer {
  readonly app: FastifyInstance;
  listen(): Promise<{ readonly port: number; readonly url: string }>;
  close(): Promise<void>;                     // closes sockets with 1001 and clears timers
  readonly testing: TestControls | null;      // non-null iff options.test was given
}
export function createServer(options?: ServerOptions): Promise<StackeristServer>;

export interface Limits {
  inputBurst: number;                // 20 tokens
  inputRefillPerSec: number;         // 30
  maxDropsPerRound: number;          // 200 → close 4001
  maxBadMessages: number;            // 20  → close 4002
  maxQueuedInputs: number;           // 60
  maxCatchUpTicks: number;           // 5
  maxCreatesPerIpPerMin: number;     // 10
  maxFailedJoinsPerIpPerMin: number; // 20
  maxLiveRooms: number;              // 500
  maxSpectatorsPerRoom: number;      // OQ-3: proposed 8; Infinity if declined
  emptyRoomTtlMs: number;            // 120_000
  waitingRoomTtlMs: number;          // 900_000
  wsHardMaxPayloadBytes: number;     // 16_384
  maxHeightSamples: number;          // 7_200
}
```

### 4.3 Ingress pipeline (`connection.ts`) — the gate order is a contract
Wiring:
- Register `@fastify/websocket` with `{ options: { maxPayload: limits.wsHardMaxPayloadBytes }, errorHandler }`.
- The route is `app.get(WS_PATH, { websocket: true }, (socket, req) => …)`. Attach the `message`, `close` and
  `error` listeners **synchronously** inside that handler, as the README requires; messages can be lost otherwise.
- Every frame runs inside `safeCall`, and `framesHandled += 1` runs in `finally`.

The gates, in order:
1. `isBinary`, or the frame's byte length `> MAX_FRAME_BYTES` → `error BAD_MESSAGE`; `badMessages += 1`;
   at 20 → close 4002.
2. `parseClientMessage` fails → same as step 1.
3. `test.throwOn?.(msg)` → throw. Only the REQ-072 test exercises this.
4. Dispatch:
   - **create:** socket bound → ALREADY_IN_ROOM · this IP's create window is full → TOO_MANY_CREATES ·
     live rooms ≥ 500 → SERVER_BUSY · *only then* charge the create window and create the room.
   - **join / rejoin:**
     - socket bound → ALREADY_IN_ROOM
     - this IP's failed-join window is full → TOO_MANY_JOINS, with no lookup
     - `normalizeRoomCode` returns null, or the room is missing → charge failed-join, ROOM_NOT_FOUND
     - rejoin token matches neither seat → charge failed-join, BAD_TOKEN. Compare against both seats every
       time, and length-check before `timingSafeEqual`.
     - spectator join over the cap → ROOM_FULL
     - otherwise success
   - **input:** unbound → NOT_IN_ROOM · spectator → NOT_A_PLAYER · `status ≠ playing` → NOT_PLAYING ·
     otherwise `match.receiveInput(seat, input)`, which runs these steps in order:
     a. **`bucket.take()`.** This is the only charge: at receipt, before queueing; the drain never charges.
        Bucket empty → `drops += 1`, drop silently; at 200 → close 4001.
     b. `seq ≤ seqFloor` → BAD_SEQ.
     c. `tick > match.tick + MAX_INPUT_LEAD_TICKS`, or `tick < lastStampTick` → BAD_TICK. This does **not**
        count toward bad messages.
     d. `buffer.length ≥ 60` → drop silently, `drops += 1`.
     e. Push the input, **then** set `seqFloor = seq` and `lastStampTick = tick`.
     At every terminal outcome from (a) on, set `lastSeenSeq = max(lastSeenSeq, seq)`. Nothing else is
     written before its gate decides.
   - **leave:** unbound → no-op. Otherwise transition rows L1–L3.
   - **rematch:** unbound → NOT_IN_ROOM · spectator → NOT_A_PLAYER · status ∉ {roundOver, seriesOver} →
     NOT_FINISHED · otherwise set ready (N1–N3).
   - **pong:** `lastPongAt = now` (liveness). If `0 ≤ now − t ≤ PONG_TIMEOUT_MS`, set `rttMs = round(now − t)`.

### 4.4 Room state machine
Per-room state:
- `code`, `status`, `createdAtMs`, `everStarted`.
- `seats {A?, B?}`. Each seat holds `token: Buffer(16)`, `name`, `conn | null`, `holdTimer`, `graceTimer`,
  `graceEndsAt`, `pausesUsed` and `ready`.
- `spectators: Set<Connection>`, `series: SeriesState`, `match: Match | null`.
- `countdownTimer`, `resumeAt`, `lastGameOver`, `emptyTimer`, `waitingTtlTimer`.

| # | From | Event | Guard | To | Effects (in order) |
|---|---|---|---|---|---|
| C1 | — | `create` | gates §4.3 | waiting | seat A bound; `created`; `room`; waiting TTL timer (15 min); log `room.created` |
| J1 | waiting | `join` (player) | a seat is free (not held) | waiting | bind seat B (or A) with a new token; `joined{token}`; `room` |
| J2 | waiting | both seats connected (after J1 / R1) | — | countdown | `match = new Match(seeds, startTick)`; `room`; initial `snapshot`; `countdown{startsAt = now + 3000, serverNow, tick: startTick}` |
| J3 | any | `join` | no free seat, or `asSpectator` | same | add a spectator; `joined{seat:'spectator'}`; `room` (new count); catch-up |
| R1 | any | `rejoin` (valid) | — | per row | mark the old conn replaced and close it with 4000; bind; `match?.resetSeatSequence(seat)`; `joined` (no token); `room`; catch-up; cancel this seat's hold and grace timers |
| R2 | paused | rejoin completes | other seat connected | paused (resuming) | `snapshot`; `resumeAt = now + 3000`; `resumed{startsAt: resumeAt, serverNow, tick: match.tick}` |
| R3 | paused | rejoin completes | other seat disconnected | paused | `snapshot` only |
| R4 | roundOver / seriesOver | rejoin | — | same | re-send `lastGameOver` and `rematchStatus` |
| T1 | countdown | countdown timer fires | — | playing | `everStarted = true`; `loop.add(room)`; log `match.started{round}` |
| T2 | paused | `resumeAt` timer fires | both connected | playing | reset the accumulator; `room`; log `match.resumed` |
| D1 | waiting / countdown | seat X closes or pongs out | — | waiting | cancel the countdown and drop the prepared match; hold seat X for 2 min; `room`; log `conn.disconnected` |
| D2 | waiting | seat X's hold expires | — | waiting | free seat X; `room` |
| D3 | playing, or paused while resuming | seat X disconnects | `pausesUsed[X] < 3` | paused | `pausesUsed[X] += 1`; clear `resumeAt`; `match.clearBuffers()`; start X's 20 s grace; `paused{seat X, graceEndsAt, serverNow, pausesLeft: 3 − pausesUsed[X]}`; `room` |
| D4 | playing / paused | seat X disconnects | `pausesUsed[X] = 3` | seriesOver | **forfeit X**: OPPONENT_DISCONNECTED |
| D5 | paused | the other seat Y disconnects | `pausesUsed[Y] < 3` | paused | Y's own grace; `pausesUsed[Y] += 1`; `paused{seat Y …}` |
| G1 | paused | X's grace expires | Y's grace has not also expired at this instant | seriesOver | **forfeit X**: OPPONENT_DISCONNECTED |
| G2 | paused | X's grace expires | Y's `graceEndsAt ≤ now` as well | deleted | log `room.closed{ABANDONED}`; close the remaining sockets with 4004 |
| E1 | playing | after a tick, exactly seat Y has topped out | `score[X] + 1 < 2` | roundOver | `score[X] += 1`; append the round summary; final `snapshot`; `gameOver`; `room`; `loop.remove` |
| E2 | playing | after a tick, one seat has topped out | `score[X] + 1 = 2` | seriesOver | as E1, plus `series.over = true` and `endReason TWO_WINS` |
| E3 | playing | both seats top out in the same tick | — | roundOver | DRAW: the score is unchanged; the next round reuses the round number with `replay = true` |
| L1 | waiting / countdown | `leave` X | `!everStarted` | waiting | free seat X; unbind its conn; `room` |
| L2 | countdown / playing / paused / roundOver, or waiting with `everStarted` | `leave` X | — | seriesOver | **forfeit X**: OPPONENT_LEFT; free seat X; unbind its conn |
| L3 | seriesOver | `leave` X | — | seriesOver | free seat X; `room` (the opponent sees "Opponent left" and a disabled button) |
| N1 | roundOver / seriesOver | `rematch` X | — | same | `ready[X] = true`; `rematchStatus` |
| N2 | roundOver | both ready | both connected | countdown | `nextRound(series)`; new seeds; reset ready; then as J2 |
| N3 | seriesOver | both ready | both seats occupied and connected | countdown | `newSeries()`: 0–0, round 1, `pausesUsed` reset, `rounds = []`; then as J2 |
| D6 | roundOver / seriesOver | seat X disconnects | — | same | `ready[X] = false`; hold the seat 2 min; `room`. No pause, no grace (OQ-4). |
| D7 | roundOver | X's hold expires | — | seriesOver | **forfeit X**: OPPONENT_DISCONNECTED |
| D8 | seriesOver | X's hold expires | — | seriesOver | free seat X; `room` |
| X1 | any | no player socket connected for 2 min | — | deleted | log `room.closed{EMPTY}`; close spectators with 4004 |
| X2 | waiting | 15 min since creation | `!everStarted` | deleted | log `room.closed{WAITING_EXPIRED}`; close sockets with 4004 |
| X3 | any | a handler or `step()` throws for this room | — | deleted | send `error INTERNAL_ERROR` to the room's sockets; close them with 4004; log `room.aborted`. Other rooms are unaffected. |

**Forfeit X (reason).**
1. If a round is in progress, it ends: final `snapshot`, then `gameOver` with `winner = other`, the reason,
   and the partial `stats` and `report`.
2. Set `series.over = true`, `winner = other`, `endReason = reason`. The forfeited round is appended to
   `rounds` **without adding a win**, so the score stays truthful (DESIGN.md: "Sam left, so the series is yours").
3. Send `room`. If no round was in progress (for example L2 from roundOver), only `room` is sent.

**Messages by status.** `input` is accepted only in `playing`, which excludes `paused` while resuming.
`rematch` is accepted only in `roundOver` and `seriesOver`. `create`, `join` and `rejoin` on a bound socket
get ALREADY_IN_ROOM in every status.

### 4.5 Series (`series.ts`: pure and unit-tested; REQ-083, REQ-092)
```ts
export interface SeriesState { round: number; replay: boolean; score: { A: number; B: number };
  over: boolean; winner: Seat | null; endReason: SeriesEndReason | null; rounds: RoundSummary[] }
export function newSeries(): SeriesState;                                        // round 1, 0–0
export function applyRoundResult(s: SeriesState, r: { winner: Seat | null; reason: GameOverReason; durationTicks: number }): SeriesState;
export function applyForfeit(s: SeriesState, forfeiter: Seat, reason: 'OPPONENT_LEFT' | 'OPPONENT_DISCONNECTED', durationTicks: number | null): SeriesState;
export function nextRound(s: SeriesState): SeriesState;    // after a draw: same round, replay true; otherwise round + 1, replay false
export function toSeriesView(s: SeriesState): SeriesView;
```
- **Per seat per series** (REQ-032): the pause count.
- **Per round** (one `Match`): the drop counter, token bucket, seq state, buffer, `actions` and report samples.

### 4.6 Match loop, input buffer, acknowledgement (design §6.1)
- **GameLoop, real mode:** one process-wide `clock.setTimeout` chain that wakes every `TICK_MS`. On each wake,
  for each playing room:
  - `acc += now − lastWake`; `n = floor(acc / TICK_MS)`.
  - If `n > 5`: `n = 5` and `acc = acc mod TICK_MS`. The backlog is dropped, so there is no death spiral.
    Otherwise `acc −= n × TICK_MS`.
  - Call `room.step()` n times, each wrapped (X3).
- **Manual mode:** no timer is registered. `testing.step(n)` calls the same `room.step()`.
- **`Match.step()`** processes tick `N = match.tick`:
  1. For seat A, then seat B: pop from the front of the buffer while `front.tick ≤ N`, up to
     `MAX_ACTIONS_PER_TICK`, and `applyAction` each; `actions += 1` per applied input. The buffer is a FIFO:
     accepted inputs arrive with increasing seq and non-decreasing tick, so receipt order equals
     `(tick, seq)` order.
  2. `tick(stateA, levelForTick(N))`, then `tick(stateB, levelForTick(N))`.
  3. Route the `attack` events from steps 1–2, A's first and then B's, in event order:
     `receiveGarbage(opponent, { rows, holeColumn: holeRng() })`, one `holeRng()` call per attack.
     Record SnapshotEvents: `attack{from, rows, tick: N}`, and `cancel{seat, rows, tick: N}` from each
     `garbageCancelled`.
  4. The top-out check produces the outcome (E1–E3).
  5. `match.tick = N + 1`. If `(match.tick − startTick) % 30 === 0` and fewer than 7200 samples exist, push
     `stackHeight(board)` for each seat. Sample 0 is taken when the round is created.
  6. Send a snapshot if a piece locked this tick, or if `match.tick − lastSnapshotTick ≥ 2`, then clear the
     accumulated events. REQ-027: at most every 2 ticks, except immediately after a lock.
- **`lastAckSeq(seat)`** = `buffer.length > 0 ? buffer[0].seq − 1 : lastSeenSeq`. Every lower seq has been
  either applied or discarded, so dropped and rejected inputs get acknowledged too and fall out of prediction.
- **Resets:**
  - On pause, `clearBuffers()` for both seats: empty the buffer, `lastStampTick = −1`, keep `lastSeenSeq`.
  - On every bind, `resetSeatSequence(seat)`: `seqFloor = 0`, `lastSeenSeq = 0`, `lastStampTick = −1`,
    empty buffer.
  - A new Match per round resets everything.
  - The client resets `nextSeq = 1` on `created`, `joined` and `countdown`.
- **Gravity and lock delay run only in `step()`.** A client's stamp can only delay its own input, never move it
  before the current server tick (REQ-037).

### 4.7 Snapshots, gameOver, report
- Each snapshot builds the PublicViews once, then one OwnView per seated recipient with `toOwnView(state, lastAckSeq)`.
- `gameOver` contents:
  - `stats[seat] = toPlayerStats(state)`.
  - `report[seat]`: `piecesPlaced`, `garbageSent`, `garbageCancelled` and `garbageReceived` from the engine
    state; `actions`, `durationTicks = match.tick − startTick` and `heightSamples` from the Match.
  - `tick = match.tick`.
- `lastGameOver` is kept for R4 catch-up. Nothing outlives the room's deletion.

### 4.8 Rate limits, flood limits, client IP (REQ-038, REQ-081)
- **Input bucket:** a `TokenBucket` with capacity 20, refilling 30/s, lazily topped up from
  `clock.monotonicMs()`. One per seat per round.
- **Per-IP windows:** a `SlidingWindowCounter(60_000 ms)` keyed by client IP, with two counters:
  - `creates`: limit 10, charged on success.
  - `failedJoins`: limit 20, checked before the lookup, charged on failure.
  Entries are pruned on access and by a 60 s sweep timer. IPs live in memory only and are never logged.
- **Room limits:** one live room per connection (ALREADY_IN_ROOM); 500 live rooms (SERVER_BUSY).
- **Client IP — Fastify `trustProxy` is not used.** In the installed `fastify.d.ts`, `trustProxy` is typed
  `boolean | string | string[] | TrustProxyFunction`. There is no hop-count number, and the 5.12 docs say
  "Hop-count-only trust is disabled". So:
```ts
export type ClientIpConfig =
  | { readonly source: 'socket' }                                    // dev default: req.socket.remoteAddress
  | { readonly source: 'x-real-ip' }                                 // production default on Railway
  | { readonly source: 'x-forwarded-for'; readonly trustedHops: number }; // client = xff[max(0, len − trustedHops)]
export function clientIpConfigFromEnv(env: NodeJS.ProcessEnv): ClientIpConfig; // CLIENT_IP_SOURCE, TRUSTED_PROXY_HOPS
export function resolveClientIp(req: { headers: IncomingHttpHeaders; socket: { remoteAddress?: string } }, cfg: ClientIpConfig): string;
```
  A header value must pass `net.isIP`; if it doesn't, the socket address is used.
  **Flag:** Railway's "Specs & Limits" page documents "`X-Real-IP` for identifying client's remote IP". It does
  **not** document an XFF hop count, or whether a client-supplied `X-Real-IP` is overwritten. R3 describes the
  post-deploy spoof test that settles it.

### 4.9 Ping / pong / RTT (REQ-080, REQ-031)
- On socket open, send a `ping` immediately, then every 3 s via the clock. Each is
  `{ t: round(monotonicMs), rtt: conn.rttMs }`.
- At each ping, if `now − lastPongAt > 10 000`: close with 4003 and treat it as an unexpected disconnect
  (D1, D3–D6).

### 4.10 Disconnect, pause, grace, replace
- A socket `close` for a conn marked `replaced` is ignored (R1). Any other close is an unexpected disconnect
  for the bound seat (the D rows) or a spectator removal (`room`).
- While paused, nothing ticks and the engine states are untouched, so resume continues from the exact paused
  state (REQ-031). The test asserts deep equality through `inspect()`.

### 4.11 Logging (REQ-071)
- **Setup:** `pino({ level: LOG_LEVEL ?? 'info', serializers: { err: pino.stdSerializers.err, req: r => ({ method: r.method, url: r.url }) } })`
  is passed as Fastify `loggerInstance`, with `logController: new LogController({ disableRequestLogging: true })`.
  `LogController` is exported from the installed `fastify.d.ts`; the `disableRequestLogging` top-level option is
  deprecated there. Every line is a domain event: `log.info({ event, …fields })`.
- **`LogEventName`:** `room.created`, `room.joined`, `room.rejoined`, `room.left`, `match.started`,
  `match.paused`, `match.resumed`, `match.ended`, `series.ended`, `room.closed`, `room.aborted`,
  `conn.disconnected`, `anticheat`, `handler.error`, `process.unhandledRejection`,
  `process.uncaughtException`, `server.listening`.
- **Allowed fields:** `room` (code), `seat`, `conn` (numeric id), `round`, `tick`, `status`, `reason`, `rule`,
  `count`, `winner`, `closeCode`. **Never** names, IPs, tokens or headers.
- **`anticheat.rule`** is one of `BAD_MESSAGE, TOO_MANY_BAD_MESSAGES, RATE_LIMIT_DROP, RATE_LIMITED_KICK,
  QUEUE_FULL, BAD_SEQ, BAD_TICK, NOT_A_PLAYER, NOT_PLAYING, BAD_TOKEN, ROOM_NOT_FOUND, CREATE_LIMIT,
  JOIN_LIMIT, SERVER_BUSY, ALREADY_IN_ROOM, PAUSE_LIMIT_FORFEIT`.
- **Coalescing:** the first trigger per `(conn, rule)` logs immediately; repeats within 1 s collapse into one
  line with a `count`. Every trigger is counted, and log volume stays bounded.

### 4.12 Robustness (REQ-072)
- **`safeCall(log, ctx, fn)`** wraps every WS `message`, `close` and `error` handler, every timer callback
  (inside `Clock.setTimeout`) and every `room.step()`. A throw is logged as `handler.error`, with no PII.
  A message handler then replies `error INTERNAL_ERROR`; a room-level throw aborts that room only (X3).
- **`@fastify/websocket` `errorHandler(error, socket, request, reply)`** (signature from its `types/index.d.ts`)
  logs the error and calls `socket.terminate()`.
- **Fastify `setErrorHandler`** keeps the scaffold's behaviour: log, then a generic 4xx/5xx. Errors thrown by
  async routes land there.
- **`installProcessHandlers(log, proc = process)`:**
  - `unhandledRejection` → log and keep running.
  - `uncaughtException` → log as fatal and `exit(1)`; Railway restarts the service (`restartPolicyType: ON_FAILURE`).
  - It is called from `index.ts` only; the test passes a fake emitter.

### 4.13 HTTP: one port, static files, SPA fallback, malformed paths (REQ-073)
- `GET /healthz` → `200 {"ok":true}` with `cache-control: no-store`.
- `GET /ws` → the websocket route.
- If `clientDist` exists, register `@fastify/static` with `{ root: clientDist, wildcard: true, index: 'index.html', dotfiles: 'ignore', setHeaders }`.
  `setHeaders` gives `/assets/*` `public, max-age=31536000, immutable` and everything else `no-cache`.
- `setNotFoundHandler` keeps the scaffold rule: GET or HEAD on an extension-less path → `index.html` (200);
  anything else → 404. The scaffold test proves `/g/ABC234` → 200 and `/assets/missing.js` → 404.
- `frameworkErrors(error, req, res)` (typed in `fastify.d.ts`): if `error.code === 'FST_ERR_BAD_URL'`, reply 400
  with a small "That link is broken" HTML page that links to `/`. Otherwise `res.send(error)`. The scaffold
  already shows `/g/%` → 400 with the process still alive; this only makes the page human. The http test covers
  `/g/%`, `/%`, `/g/%E0%A4%A` and `/..%2f..%2fetc%2fpasswd` (each 4xx), followed by `/healthz` → 200.

---

## 5. Client (`apps/client`)

### 5.1 Ownership split (two parallel agents, contract first)
| Area | Owner | Paths |
|---|---|---|
| net, game state, input, keyboard, canvas rendering, arena fx, audio | **CORE** (`cdt:frontend-engineer` #1) | `src/net/**`, `src/game/**`, `src/render/**`, `src/audio/**`, `test/core/**` |
| React shell, screens, overlays, HUD DOM, combo banner, standoff, routing, CSS, art wiring | **UI** (`cdt:frontend-engineer` #2) | `src/main.tsx`, `src/App.tsx`, `src/ui/**`, `src/styles/**`, `index.html`, `public/**`, `test/ui/**`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.app.json`, `tsconfig.node.json`, `src/vite-env.d.ts` |

UI components get the CORE implementations by **dependency injection** from `main.tsx`, typed by
`src/game/contract.ts`. CORE commits that file first as a checkpoint. UI builds against it with fakes in
parallel, and only `main.tsx` imports concrete CORE modules.

**Design inputs:**
- **DOM:** CSS custom properties from `design/tokens/tokens.css`, imported once in `main.tsx`.
- **Canvas and layout maths:** `design/tokens/tokens.ts`. It provides `color`, `pieceColor`, `board`, `ghost`,
  `flash`, `danger`, `meter`, `projectile`, `chart`, `motion`, `computeCellSizes`, `computeBestMomentCell`,
  `projectileSizePx`, `nudgePx` and `pingQuality`.
- **Behaviour, copy and states:** `DESIGN.md` §Layout and §Components. **Art:** `design/assets/{logo,backdrop,win}.webp`.
- **Never** use the concept PNGs, and never write a colour or duration that isn't a token.

### 5.2 `src/game/contract.ts` (the CORE checkpoint; types only)

```ts
import type { ActivePiece, Board, PieceKind } from '@stackerist/engine';
import type { CloseCodeName, ErrorCode, GameOverMessage, LiveStats, RoomCode, RoomMessage, Seat, WireBestMoment } from '@stackerist/protocol';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';
export type Role = Seat | 'spectator';
export type Side = 'left' | 'right';        // players: left = self, right = opponent; spectators: left = A, right = B
export type StandoffPhase = 'dim' | '3' | '2' | '1' | 'duel' | null; // 'duel' from goAt (input live) for DESIGN.md's hold time

export interface CountdownInfo { readonly kind: 'start' | 'resume'; readonly goAtMs: number /* performance.now() at DUEL! */; readonly tick: number }
export interface PauseInfo { readonly seat: Seat; readonly graceEndsAtMs: number /* performance.now() */; readonly pausesLeft: number }
export interface HudSide { readonly seat: Seat; readonly name: string; readonly connected: boolean; readonly stats: LiveStats; readonly pendingGarbage: number /* rows */ }

export interface ClientState {
  readonly connection: ConnectionStatus;
  readonly closedBy: CloseCodeName | null;
  readonly code: RoomCode | null;
  readonly role: Role | null;
  readonly room: RoomMessage | null;              // latest `room`: status, players, spectators, series
  readonly countdown: CountdownInfo | null;
  readonly paused: PauseInfo | null;
  readonly level: number;                         // 0..12 (the HUD shows level + 1)
  readonly roundStartTick: number | null;
  readonly hud: { readonly left: HudSide | null; readonly right: HudSide | null }; // updated at snapshot rate
  readonly result: GameOverMessage | null;        // latest round result; cleared at the next countdown
  readonly ready: { readonly A: boolean; readonly B: boolean };
  readonly rttMs: number | null;
  readonly error: { readonly code: ErrorCode; readonly message: string } | null;
}

export interface BoardModel {
  readonly seat: Seat;
  readonly board: Board;
  readonly active: ActivePiece | null;
  readonly ghost: ActivePiece | null;             // own board only (REQ-061)
  readonly next: readonly PieceKind[];            // own ≤ 5; opponent and spectator ≤ 1
  readonly pendingGarbage: number;                // rows
  readonly combo: number;                         // own: predicted; opponent: snapshot
  readonly chain: { readonly sent: number; readonly cancelled: number }; // totals since the chain started (snapshot events)
  readonly danger: boolean;                       // stackHeight(board) + pendingGarbage ≥ tokens.danger.rows (REQ-088)
  readonly toppedOut: boolean;
}
export type FxEvent =
  | { readonly kind: 'flash'; readonly side: Side; readonly rows: readonly number[] }   // own: predicted linesCleared
  | { readonly kind: 'nudge'; readonly side: Side; readonly rows: number }              // stats.garbageInserted went up
  | { readonly kind: 'projectile'; readonly from: Side; readonly rows: number; readonly originRow: number | null } // snapshot `attack`
  | { readonly kind: 'burst'; readonly side: Side; readonly rows: number };             // snapshot `cancel`
export interface FrameModel {
  readonly nowMs: number;                         // the rAF timestamp this frame was computed for
  readonly left: BoardModel | null;
  readonly right: BoardModel | null;
  readonly fx: readonly FxEvent[];                // new since the previous frame; each emitted once
  readonly level: number;
  readonly standoff: StandoffPhase;
  readonly inputLive: boolean;                    // flips in the same frame that paints DUEL! (REQ-086)
}

export interface GameStore {
  getState(): ClientState;                        // the same object until something changes (useSyncExternalStore contract)
  subscribe(listener: () => void): () => void;
  /** Called synchronously from CORE's rAF callback with the frame it just drew. UI drives per-frame DOM
   *  (standoff numerals and DUEL!, the combo banner) imperatively through refs here, so the DUEL! paint and
   *  the input-live flip happen in the same frame. */
  subscribeFrame(listener: (frame: FrameModel) => void): () => void;
  connect(): void;
  create(name: string): void;
  join(code: RoomCode, name: string | null, asSpectator: boolean): void;
  resume(code: RoomCode): boolean;                // rejoin with the stored token; false when there is none
  leave(): void;                                  // sends `leave`, clears the token, unbinds
  ready(): void;                                  // sends `rematch` (Next round / New series)
  clearError(): void;
  matchElapsedMs(nowMs: number): number | null;   // (serverTick − roundStartTick) × TICK_MS; frozen while paused
}

export interface ArenaCanvases { readonly left: HTMLCanvasElement; readonly right: HTMLCanvasElement; readonly leftNext: HTMLCanvasElement; readonly rightNext: HTMLCanvasElement; readonly fx: HTMLCanvasElement }
export interface ArenaHandle { destroy(): void }
/** Starts the single rAF loop: frame() → draw boards, previews and fx → notify subscribeFrame listeners. */
export type MountArena = (canvases: ArenaCanvases, store: GameStore, options: { readonly reducedMotion: boolean }) => ArenaHandle;
export type DrawBestMoment = (canvas: HTMLCanvasElement, moment: WireBestMoment, cellCssPx: number) => void;

export type MusicStatus = 'on' | 'off' | 'blocked' | 'unavailable';   // DESIGN.md "Music control"
export interface Music {
  unlock(): void;                                 // call from the Create / Join / Next round click (autoplay rules)
  start(level: number): void;                     // at DUEL!
  setLevel(level: number): void;                  // the tempo steps up per level
  stop(): void;                                   // round end, pause, leave
  status(): MusicStatus;
  toggle(): void;                                 // the M key and the Music button; persists MUSIC_STORAGE_KEY
  subscribe(listener: () => void): () => void;
}
export interface CoreServices { readonly store: GameStore; readonly mountArena: MountArena; readonly drawBestMoment: DrawBestMoment; readonly music: Music }
```

### 5.3 net/ (CORE)
- **`socket.ts`:** `class GameSocket` follows the close policy in §3.3, answers `ping` with `pong{t}` itself,
  and parses with `parseServerMessage`. `wsUrl(location)` maps `https:` → `wss:` and uses the same host and
  `WS_PATH`.
- **`session.ts`:** `loadToken`, `saveToken` and `clearToken`, all keyed by `tokenStorageKey(code)` in
  **sessionStorage** (REQ-021).
  - On `/g/:code` with a stored token, the store sends `rejoin`.
  - On ROOM_NOT_FOUND or BAD_TOKEN it clears the token, and the UI shows home with the DESIGN.md copy
    "That game has ended or your seat expired…".

### 5.4 Input (CORE: `game/input.ts` is the pure core, `game/keyboard.ts` the DOM binding) — REQ-053
- `class InputController({ emit(action: Action): void; timers })` with `keyDown(code, repeat)`, `keyUp(code)`,
  `blur()`, `setEnabled(boolean)`.
- **Keys:**
  - ← / → move. DAS 170 ms, then ARR 50 ms; each repeat emits one move; the last-pressed direction wins.
  - ↑ or X = rotateCW. Z or Ctrl = rotateCCW (the macOS legend shows Z only).
  - ↓ = softDropStart on keydown; softDropStop on keyup **and on window blur**.
  - Space = hardDrop.
  - `event.repeat === true` is ignored.
- **Keyboard binding** (`keyboard.ts`, window capture listeners):
  - While a round is live, game keys always go to the game and get `preventDefault`, even when focus is on a
    HUD button, so Space can never press one (DESIGN.md).
  - Keys typed into `input`/`textarea` are ignored.
  - **M** toggles music on the lobby, game and result screens, ignoring repeat. **Esc** is left to UI (Leave confirm).
- **Sending:** an emit sends only when `frame.inputLive`. It does
  `tick = estimator.targetTick(performance.now())` (already monotonic and clamped), `seq = nextSeq++`,
  sends `input`, then calls `predictor.addInput(...)`. Keys pressed before the DUEL! frame are dropped,
  not queued (DESIGN.md).

### 5.5 Render (CORE: `render/**`) — REQ-055, 061, 087, 088 and the board half of 049, 051, 060
- **One rAF loop per mounted arena.** Each frame:
  1. Compute `frame(ts)` from the store, the protocol `TickEstimator` and the protocol `Predictor`.
  2. Draw the boards, previews and fx.
  3. Notify the `subscribeFrame` listeners.
- **Canvas sizing:** the CSS size comes from `computeCellSizes(vw, vh)` and `boardOuterPx(cell)` (tokens.ts).
  Then `canvas.width = round(cssW × devicePixelRatio)` and `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`.
  A ResizeObserver on the stage recomputes this.
- **Board canvas:**
  - Well: 10 × 20 cells with grid lines (`board.*`). Block style uses `board.bevel*`; G is hatched
    (`board.garbageStripe*`); ghost per `ghost.*`.
  - Garbage meter (`meter.*`): one segment per pending row, each segment exactly one cell tall, capped at 20.
  - Frame: when `danger`, the frame turns `danger.color` and a ring pulses between 1 and
    `danger.ringMinAlpha` over `danger.periodMs`. Under reduced motion, use `ringMinAlphaReduced`, which gives
    a steady frame (REQ-088). The canvas is padded by `danger.ringWidthPx` so the ring doesn't shift layout.
- **Fx canvas** (an absolute overlay over the arena: `aria-hidden="true"`, `data-overlay`, `pointer-events: none`,
  `--z-projectiles`):
  - Line-clear flash: `flash.*`, 150 ms, over the cleared row positions. It never delays input or state.
  - Garbage nudge: `nudgePx(rows, reducedMotion)` with `motion.nudge*`.
  - Projectile: `projectileSizePx(rows)`, `projectile.*`, from the sender's board (the topmost cleared row if
    known, else mid-board) to the receiver's meter, with at most 4 in flight per direction.
  - Cancel burst from the defender's meter.
  - Reduced-motion variants follow DESIGN.md.
- **`render/hooks.ts`** exports `DATA_HOOKS`, the canvas `data-*` attributes the renderer keeps current. They
  are updated on change, not every frame, and e2e reads them as measurable state:
  `data-active` (`kind:rotation:x:y`), `data-ghost`, `data-next` (letters), `data-combo`, `data-danger`
  (`true|false`), `data-pending`, `data-fx` (active fx count), `data-flash-count`, `data-nudge-count`,
  `data-projectile-count`.
- **`drawBestMoment`** draws the recorded board in block style, with cleared rows outlined 1 px in
  `bestMoment.clearedOutline` and the finishing piece outlined 2 px in `bestMoment.finisherOutline`. Cell size
  comes from `computeBestMomentCell(vh)` (REQ-051).

### 5.6 Audio (CORE: `audio/**`) — REQ-089
- Web Audio only (oscillators, gains, a noise buffer). There is no audio file anywhere in the repo.
- A lookahead scheduler: a 25 ms timer schedules 100 ms ahead.
- `bpmForLevel(level) = 100 + 6 × level` (100 → 172) is exported and unit-tested to be strictly increasing.
- Starts at DUEL! (from the frame where `inputLive` flips). Stops on `gameOver`, `paused` and leave.
- Persisted in `localStorage[MUSIC_STORAGE_KEY]` as `'on' | 'off'`, default `on`.
- `unlock()` runs on the Create, Join or Next round click. Until audio is unlocked, `status()` is `'blocked'`;
  without Web Audio it is `'unavailable'`.

### 5.7 UI (the UI agent) — screens, routing, overlays, styling
- **Routing** (`ui/router.ts`, no router dependency):
  `parseRoute(pathname, search): { name: 'home' } | { name: 'room'; code: RoomCode; watch: boolean } | { name: 'notFound' }`.
  `decodeURIComponent` is wrapped in try/catch, and a malformed path becomes notFound. The code goes through
  `normalizeRoomCode`. After `created` or `joined`, navigate with `history.pushState(gamePath(code))` so a
  refresh rejoins.
- **Screens** (layout, copy and states per DESIGN.md §Home, §Lobby, §Game HUD):
  - Home (REQ-047): on `/g/:code` the code is prefilled and the name field focused.
  - Lobby (REQ-048 and 085).
  - Game (REQ-049, 085): Speed shows `level + 1`; the match clock comes from `matchElapsedMs`; the ping uses
    `pingQuality`; series pips and the round tag; the spectator count; Music; Leave with the confirm popover
    and Esc.
- **Overlays:**
  - Standoff (REQ-086): DOM updated from `subscribeFrame`. DESIGN.md times it; DUEL! paints in the same frame
    as `inputLive`.
  - Combo banner (REQ-052): DOM at `--z-board-fx`, also driven per frame. Own board: `COMBO ×N` plus the
    `+sent · cancelled` sub-line from `chain`. Opponent: the title only.
  - Disconnect.
  - Round card and series card (REQ-050, 051, 059, 084, 091): one card, three panels, no tabs. It has the
    500 ms activation guard and the focus rules.
  - Keyboard needed (REQ-058).
  - Error plates (DESIGN.md error catalogue, mapped from `ErrorCode` and `CloseCodeName` in `ui/copy.ts`).
- **Chart** (`ui/HeightChart.tsx`, REQ-091): hand-rolled SVG per DESIGN.md §Report chart. `viewBox` 300 × 180,
  y fixed at 0–20, a danger rule at `danger.rows`, `role="img"` with title and desc, a visually hidden table,
  and an empty state when there are fewer than 2 samples. No chart library.
  `ui/reportMath.ts` exports `pps(report)` and `apm(report)`, returning `null` under 60 ticks so the UI shows "—".
- **Device** (`ui/device.ts`): touch-only means no fine pointer and no hover. The first trusted `keydown`
  proves a keyboard (kept in memory only).
- **Styling:** no Tailwind. Plain CSS in `src/styles/**` using `tokens.css` custom properties. Fonts are
  self-hosted through `@fontsource/big-shoulders-display` (700/800/900) and `@fontsource/archivo` (400/600).
  Art comes from `design/assets/*.webp` via Vite imports.
- **Single sources for e2e:** `ui/copy.ts` holds every user-facing string (DESIGN.md wording, including
  "Waiting for opponent…", "Copied!", "Waiting for opponent to accept…", "Opponent left", "Stackerist needs a
  keyboard", "DUEL!"). `ui/testIds.ts` holds every `data-testid`. Both files are dependency-free constants,
  because e2e imports them.
- Names render only as React text children (REQ-044, enforced by `test/ui/no-html.test.ts`).

---

## 6. Testing

### 6.1 Rules
- Every `it()` title starts with its REQ id(s). Umbrella requirements go on the `describe`, for example
  `describe('REQ-063 source spec §8.1', …)` → `it('REQ-006 #18 non-adjacent rows clear …')`. The same applies
  to REQ-064 (engine combo, cancel and best moment) and REQ-065 (server §8.2).
- Engine tests use `parseBoard` fixtures and deep-freeze their inputs (REQ-011).
- e2e fixtures are written **after** the client and server land, against the real DOM, through
  `ui/testIds.ts`, `ui/copy.ts` and `render/hooks.ts`. Specs import them with explicit `.ts` extensions; QA
  adds `allowImportingTsExtensions` to `e2e/tsconfig.json`, which is safe because it is `noEmit`.

### 6.2 Test files → REQ
| File | REQs |
|---|---|
| `packages/engine/test/board.test.ts` | 001, 012 |
| `…/pieces.test.ts` | 002 (§8.1 #27) |
| `…/movement.test.ts` | 003 (#1–4) |
| `…/rotation.test.ts` | 004, 005 (#5–12) |
| `…/drops.test.ts` | 010 (#13–16) |
| `…/lines.test.ts` | 006 (#17–20) |
| `…/garbage.test.ts` | 016, 017, 018 (#21–26; #24 as changed by REQ-063; newest attack lowest) |
| `…/held-garbage.test.ts` | 016 (garbage held through a combo, lands when it breaks) |
| `…/spawn.test.ts` | 007 (#27–28) |
| `…/rng-bag.test.ts` | 008 (#29–30) |
| `…/config.test.ts` | 009 (constants, `levelForTick`) |
| `…/purity.test.ts` | 011 (#31 deep-freeze; plus a source scan for Date, Math.random and timers) |
| `…/combo.test.ts` | 013, 014 (every step c1…c9 of the bonus table) |
| `…/cancel.test.ts` | 015 (full, partial, oldest first, hole column kept) |
| `…/best-moment.test.ts` | 019 (both tie-breaks, the null case) |
| `…/property.test.ts` | 063 (the fast-check property) |
| `…/simulate.test.ts` | 054 engine side (stamps, the 10-per-tick cap, starvation) |
| `packages/protocol/test/schemas.test.ts` | 045, 036, 039 (schema half), 044 (trim and length) |
| `…/views.test.ts` | 028 (view half) |
| `…/clock.test.ts` | 079 (stamp clamp, monotonic), 080 (client half) |
| `…/predict.test.ts` | 054, 069 (reconciliation, acked drop, fx high-water mark) |
| `…/codes.test.ts` | 020 (case-insensitive normalisation) |
| `apps/server/test/series.test.ts` | 083, 092 (two wins end the series, a draw is replayed, a forfeit ends it) |
| `…/report.test.ts` | 090, 092 (report stats, a sample every 30 ticks) |
| `…/lobby.test.ts` | 020, 025, 040 (§8.2 #1, #9) |
| `…/gameplay.test.ts` | 023, 026, 027, 046, 017 (server hole RNG per attack), 065 leftover-only attack (#2–5) |
| `…/hiding.test.ts` | 028 (#14: the opponent sees ≤ 1 next; no message has seed, bag or queue keys) |
| `…/disconnect.test.ts` | 030–035 (#6–8) |
| `…/lifecycle.test.ts` | 029 |
| `…/anticheat.test.ts` | 036, 037, 038, 039, 041, 043, 079 (#10–12) |
| `…/spectators.test.ts` | 042, 062 (#13) |
| `…/rematch.test.ts` | 059 |
| `…/limits.test.ts` | 081: one room per connection; 10 creates/min/IP through the `X-Real-IP` header; 20 failed joins; the 500 cap via `limits.maxLiveRooms: 3` |
| `…/ping.test.ts` | 080, 031 (pong timeout) |
| `…/loop.test.ts` | 024 (accumulator on a ManualClock, the 5-tick cap, 10 actions per tick, the queue cap of 60) |
| `…/logging.test.ts` | 071 |
| `…/robustness.test.ts` | 072 |
| `…/http.test.ts` | 073 (fixture client dist in a temp dir, as the scaffold test does) |
| `apps/server/test/latency.test.ts` (QA) | 082, 069 |
| `apps/server/test/perf.test.ts` (QA) | 068 |
| `apps/client/test/core/*.test.ts` | 021 session, 053 input, 055 canvas maths, 087 fx, 088 danger, 089 music |
| `apps/client/test/ui/*.test.ts` | 047 router, 044 no-HTML scan, 057 tokens (not the classic set), 091 PPS and APM, 086 standoff phases |
| `tools/test/repo.test.ts` (OPS, Δ3) | 074, 075 (multi-stage Dockerfile `FROM node:24-alpine`; railway.json health check, watch patterns and region; `.node-version`; `engines`) |
| `tools/test/docs.test.ts` (DOC) | 078 (README headings; DECISIONS.md has one line and one reason per entry) |
| `e2e/smoke.spec.ts` | 066 (also evidence for 022 and 026) |
| `e2e/geometry.spec.ts` | 056, 058 (390 px) |
| `e2e/ui.spec.ts` | 047–053, 055, 057, 058 (touch) |
| `e2e/signature.spec.ts` | 059–062, 084–089, 091 |

### 6.3 Server integration harness (`apps/server/test/helpers/`, owned by SRV)
- **`startTestServer(opts)`** creates the server with
  `{ port: 0, clientDist: null, clock: new ManualClock(), test: { manualTick: true, … } }`, calls `listen()`,
  and returns `{ url, testing, clock, close }`.
- **`TestClient`** wraps a real `ws` client on `ws://127.0.0.1:<port>/ws`. It accepts optional `headers`
  (`ws` `ClientOptions.headers`, e.g. `X-Real-IP`) and offers a typed inbox with `next(type, timeoutMs)`,
  `all(type)` and `send(msg)`. Every inbound message is checked against the strict `ServerMessageSchema`, so
  the no-leak assertions for REQ-028 and 036 happen on every test.
- **I/O barrier:** after sending N frames, `await until(() => testing.framesHandled() >= expected)`
  (polling with setImmediate, 2 s timeout).
- **Time and ticks:** `clock.advance(ms)` fires timers (countdown, grace, ping); `testing.step(n)` runs ticks.
- **Determinism:** `seedProvider: () => ({ pieceSeed: 12345, holeSeed: 678 })`, and
  `holeRngFactory: () => () => 3` when a fixed hole column is needed.

### 6.4 Latency-injection harness for REQ-082 (QA, W3: `apps/server/test/helpers/latency.ts`, `latency.test.ts`)
- **Virtual time.** One `ManualClock` drives the server. The predicting client reads
  `clientNow = clock.monotonicMs() + 7_919`, a fixed skew that proves skew correction works.
- **`LatencyLink(client: TestClient, clock, oneWayMs = 75)`.**
  - Outbound frames queue with `dueAt = now + 75` and are written to the real socket when due, followed by
    the barrier.
  - Inbound messages are captured at once but released to the predicting client at `receivedAt + 75`.
  - That makes the RTT 150 ms. The server's ping and pong cross the link too, so `ping.rtt` reports about 150.
- **`PredictingClient`** is the production composition minus React and the DOM: protocol `TickEstimator` +
  protocol `Predictor` (which uses engine `simulate`). It is the same code the client runs (§3.10), so the
  harness proves the real algorithm. This needs OQ-1.
- **Loop, per virtual tick:** `clock.advance(TICK_MS)` → `link.pump()` → barrier → `testing.step(1)` →
  capture the sends.
- **Scenario:**
  - `test.startTick = 21_600`, so level 12 (1 tick per row) from the first tick.
  - Seat B is a passive client that sends nothing; the test finishes before B tops out.
  - For K = 12 pieces, A follows a scripted plan: moves, rotations, then either hardDrop or waiting for the
    lock-delay lock. Each key is issued when A's display shows the piece at a chosen row.
  - **Displayed** = the predicted board right after the predicted `locked` event.
  - **Asserted:** A's server board after that lock (`testing.inspect(code).players.A.board` at the lock tick)
    equals the predicted board exactly. B sends no garbage, which satisfies REQ-069's "except garbage inside
    the window".
- **REQ-069 sweep:** the same plan at levels 0, 3, 6, 9 and 12 (`startTick = level × 1800`); all must pass.
- **Negative control (the harness checking itself):** the same scenario with a naive client that stamps
  `serverTick` instead of `targetTick` and does no run-ahead. It **must mismatch** at level 12, which shows the
  test can fail.

### 6.5 Property test (REQ-063)
- `fc.assert(fc.property(seedArb, stepsArb, (seed, steps) => …), { numRuns: 200 })`. `fc.assert`,
  `fc.property`, `fc.integer`, `fc.array`, `fc.oneof`, `fc.constantFrom` and `fc.record` are all declared in
  `fast-check/lib/fast-check.d.ts` 4.10.2.
- Steps: an array (≤ 400) of `{ action }` | `{ tick, level 0..12 }` | `{ garbage: rows 1..4, hole 0..9 }`.
- Checked after every step:
  - the board is 20 × 10;
  - active cells are in bounds and don't overlap filled cells;
  - no full row remains after any `locked` event;
  - the inputs are never mutated.

### 6.6 Coverage (REQ-067) and mutation
- Coverage is already configured in `packages/engine/vitest.config.ts` (v8, `src/**/*.ts`, `thresholds.lines: 90`).
  `pnpm test:coverage` runs it, and CI runs it.
- Mutation testing (ledger gate 10a): `@stryker-mutator/core` and `vitest-runner` 10.1.1 are installed. QA owns
  `stryker.config.mjs` (W5) and scopes it to `packages/engine/src/**`.

### 6.7 Playwright (config as scaffolded: `e2e/playwright.config.ts`)
- **Scaffolded config:** `testDir` is `e2e/`, `testMatch: **/*.spec.ts`, one worker, Desktop Chrome. Chromium
  revision 1243 matches the cached browsers. The webServer is `node apps/server/dist/index.js` on a free
  `E2E_PORT` with `HOST=127.0.0.1`, health-gated on `/healthz`. `pnpm e2e` builds first.
- **`e2e/smoke.spec.ts` (REQ-066):**
  - Two `browser.newContext()`s. A creates a game and reads the share link in the lobby. B opens the link,
    enters a name and joins.
  - Both see the standoff and two boards. Both then press Space every 60 ms until either page shows a result.
  - Assert that both show a result headline and that the pair is {You win, You lose} or {Draw, Draw}, using
    the strings from `ui/copy.ts`.
- **`e2e/geometry.spec.ts`** (the committed geometry gate):
  - **Viewports and screens:** 1280 × 600 for home, lobby, game, round card and series card; 390 × 844 for home
    and lobby. Use `page.setViewportSize` per test.
  - **Fixture-health precheck first:** the target screen's `data-testid` is visible,
    `document.fonts.status === 'loaded'`, the game canvases have non-zero size, and there are no console
    errors. If any fails, the test fails as "fixture unhealthy" instead of passing vacuously.
  - **page-h-overflow:** fail when `document.documentElement.scrollWidth - document.documentElement.clientWidth > 0`.
    On the 1280 × 600 game screen, also fail when `scrollHeight - clientHeight > 0` (no scroll, REQ-056).
  - **unclipped-v-overflow:** a visible element with computed `overflow-y: visible` and `scrollHeight > clientHeight + 1`.
  - **sibling-overlap:** in-flow visible siblings whose bounding boxes intersect by more than 1 px².
  - **small-touch-target:** a visible `button`, `input`, `select`, `[role=button]` or non-inline `a` smaller
    than 24 × 24 CSS px. DESIGN.md's own floors are higher: 44 px on home, lobby and result, 32 px in the HUD.
  - **Exclusions:** `svg` and its descendants; `.sr-only` (or a 1 px clip); `[aria-hidden="true"]` subtrees;
    inline links inside text (touch-target check only); and **`[data-overlay]`**, which marks intentional
    overlays such as the fx canvas, standoff, combo banner and result scrims (R12).
- **Windows:** before a local run, kill any orphaned `node` holding the port (ledger lesson).

---

## 7. Wave plan

The scaffold (W0) is merged and every dependency is installed. Parallel writers within a wave work in
**separate git worktrees**, and the orchestrator merges them in the stated order. After every wave the
orchestrator greps the §7.4 producer/consumer pairs.

| Wave | Agents (parallel within the wave) | Gate before the next wave |
|---|---|---|
| W1a | ENG: checkpoint commit with `src/types.ts`, `src/config.ts` and `src/index.ts` (§2.2–2.3 verbatim; index re-exports them and keeps `ENGINE_VERSION`) → merge. In parallel the orchestrator or OPS applies **Δ1** (OQ-1). | both merged; `pnpm typecheck` green |
| W1b | ENG (the rest of the engine) ∥ PRO (protocol, including `predict.ts`) | both merged; the W1 DONE WHEN commands green |
| W2 | SRV (the full server, including series, report and snapshot events) ∥ CORE (checkpoint `game/contract.ts` → merge, then the core scope) ∥ UI (starts after the CORE checkpoint) | merge order SRV → CORE → UI (UI rebases so `main.tsx` typechecks) |
| W3 | QA (core e2e, geometry, latency, perf) ∥ OPS (Δ2, Δ3, push to the private GitHub repo, CI green) | REQ-001–058 evidence green → unlocks W4 |
| W4 | CORE (signature and nice-to-have render, audio) ∥ UI (series, standoff, report, rematch UI, spectators, previews) | merged |
| W5 | QA (`e2e/signature.spec.ts`, geometry re-run, Stryker) ∥ DOC (README, DECISIONS) ∥ OPS (deploy prep) | then review gates (code-reviewer; security-reviewer, which vetoes at medium risk or above) → ship (REQ-076) |

### 7.1 Agent contracts

**ENG — `cdt:backend-engineer` (W1a + W1b)**
- EXCLUSIVE: `packages/engine/**`
- READ: §1–2 and §6 of this file; design §5; `spec (1).md` §3 and §8.1
- DONE WHEN:
  - `pnpm typecheck`, `pnpm lint`, `pnpm vitest run --project engine` and `pnpm test:coverage` (≥ 90% lines) all pass
  - `git diff --exit-code -- pnpm-lock.yaml '**/package.json'`
  - `rg -n "Math\.random|\bDate\b|performance\.|setTimeout|setInterval" packages/engine/src` finds nothing
- DO NOT: add dependencies; change the §2.2 shapes after the checkpoint without the orchestrator; put floats in
  state; mutate inputs; import `node:*`; remove `ENGINE_VERSION` (W2 does that).

**PRO — `cdt:backend-engineer` (W1b, after Δ1)**
- EXCLUSIVE: `packages/protocol/**`. This includes adding the `@stackerist/source` conditions to its
  `vitest.config.ts`, but **not** dependency fields.
- READ: §3; engine `src/**`; design §6, §6.1, §5.6–5.7; source spec §5; the DESIGN.md error catalogue
- DONE WHEN: `pnpm typecheck` (which includes `typeAssertions.ts`), `pnpm lint` and `pnpm vitest run --project protocol`
  pass, and the lockfile is unchanged after Δ1
- DO NOT: add fields, codes or messages that aren't in §3; use `any`; import `node:*`; hand-duplicate a
  `z.infer` type.

**SRV — `cdt:backend-engineer` (W2)**
- EXCLUSIVE: `apps/server/**`, **except** `apps/server/test/latency.test.ts`, `apps/server/test/perf.test.ts`
  and `apps/server/test/helpers/latency.ts`, which are reserved for QA
- READ: §3, §4 and §6.1–6.3; engine and protocol `src/**`; design §5.6–5.7, §6 and §6.1; source spec §4 and §8.2
- DONE WHEN:
  - `pnpm typecheck`, `pnpm lint`, `pnpm vitest run --project server` and `pnpm build` pass
  - `PORT=3999 node apps/server/dist/index.js`, then `curl -fsS localhost:3999/healthz`
  - `curl -s -o /dev/null -w "%{http_code}" "localhost:3999/g/%"` returns `400`, and `/healthz` still returns 200 afterwards
  - the lockfile is unchanged
- DO NOT: retype protocol literals; log names or IPs; use Fastify `trustProxy`; write state before its gate;
  charge the bucket at drain time; edit `packages/**`.

**CORE — `cdt:frontend-engineer` (W2, W4)**
- EXCLUSIVE: `apps/client/src/{net,game,render,audio}/**`, `apps/client/test/core/**`
- READ: §3, §5 and §6; engine and protocol `src/**`; `design/tokens/tokens.ts`; DESIGN.md §Layout,
  §Components and §Motion; design §6.1–6.2 and §7
- W2 scope: the `game/contract.ts` checkpoint first, then REQ-021, 053, 054 and 055, plus the board and meter
  drawing for 022, 049 and 051, and the `subscribeFrame` hook that 052 and 086 use. W4 scope: 061, 087, 088 and
  089, plus the preview drawing for 060.
- DONE WHEN: `pnpm typecheck`, `pnpm lint`, `pnpm vitest run --project client` and
  `pnpm --filter @stackerist/client build` pass, and the lockfile is unchanged
- DO NOT: touch `src/ui/**` or `main.tsx`; draw names on a canvas; add audio files; add a state library;
  hard-code a colour or duration.

**UI — `cdt:frontend-engineer` (W2 after the CORE checkpoint, then W4)**
- EXCLUSIVE: `apps/client/src/main.tsx`, `apps/client/src/App.tsx`, `apps/client/src/ui/**`,
  `apps/client/src/styles/**`, `apps/client/src/vite-env.d.ts`, `apps/client/index.html`,
  `apps/client/public/**`, `apps/client/test/ui/**`, `apps/client/{vite,vitest}.config.ts`,
  `apps/client/tsconfig.{app,node}.json`
- READ: §3, §5 and §6.7; `src/game/contract.ts`; DESIGN.md; PRODUCT.md; `design/tokens/*`; `design/assets/*`
- W2 scope: REQ-022, 044, 047, 048, 049, 050, 051, 052, 056, 057 and 058. W4 scope: 060, 084, 085, 086 and
  091, plus the UI parts of 059 and 062.
- DONE WHEN:
  - after rebasing on CORE: `pnpm typecheck`, `pnpm lint` and `pnpm vitest run --project client` pass
  - `pnpm build && pnpm start` serves `/` and `/g/ABCDEF`
  - `.claude/skills/impeccable/scripts/impeccable detect apps/client/src` is clean (the ledger's substitute instrument)
  - the lockfile is unchanged
- DO NOT: use Tailwind or raw hex values (tokens only); use `innerHTML` or `dangerouslySetInnerHTML`; add a router
  or chart dependency; edit CORE paths; use the concept-art PNGs.

**QA — `cdt:qa-engineer` (W3, W5)**
- EXCLUSIVE: `e2e/**` (including `e2e/playwright.config.ts` and `e2e/tsconfig.json`),
  `apps/server/test/latency.test.ts`, `apps/server/test/perf.test.ts`, `apps/server/test/helpers/latency.ts`,
  `stryker.config.mjs` (W5)
- READ: everything that has landed; §6
- DONE WHEN:
  - `pnpm e2e` is green: smoke, geometry and ui (W5 adds signature)
  - `pnpm vitest run --project server -t "REQ-082|REQ-069|REQ-068"` is green, and the negative control mismatches
- DO NOT: write fixtures before the system lands; edit product code (report defects to the owner); rely on
  screenshots alone for canvas features (read `DATA_HOOKS` instead).

**OPS — `cdt:devops-engineer` (W1a Δ1, W3, W5, ship)**
- EXCLUSIVE: the root configs (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, root `tsconfig*.json`,
  `vitest.config.ts`, `eslint.config.js`, `.prettier*`), `.node-version`, `.github/**`, `Dockerfile`,
  `.dockerignore`, `railway.json`, `tools/**` except `tools/test/docs.test.ts`. For Δ1 only:
  `packages/protocol/{package.json,tsconfig.lib.json,tsconfig.test.json}`.
- DONE WHEN:
  - W3: Δ2 and Δ3 are applied; `pnpm vitest run --project tools -t "REQ-074|REQ-075"` is green; CI is green on
    the private repo (`gh run list`).
  - Ship: the deploy is confirmed from Railway's deployment status, never from the CLI's exit code; the region
    is `asia-southeast1`; a two-network match has been played (REQ-076).
  - Docker isn't installed on this machine, so the first real image build is the Railway build (ledger).
- DO NOT: change package dependencies beyond Δ1; trust the `railway up` exit code.

**DOC — `cdt:technical-writer` (W5)**
- EXCLUSIVE: `README.md`, `DECISIONS.md`, `tools/test/docs.test.ts`
- READ: everything; §8.1 seeds DECISIONS.md
- DONE WHEN: `pnpm vitest run --project tools -t REQ-078` is green
- DO NOT: document features that didn't land.

### 7.2 REQ ownership (92/92 — exactly one owner each; contributors in brackets)

| REQ | Owner | Wave | REQ | Owner | Wave | REQ | Owner | Wave |
|---|---|---|---|---|---|---|---|---|
| 001 | ENG | W1 | 032 | SRV | W2 | 063 | ENG | W1 |
| 002 | ENG | W1 | 033 | SRV | W2 | 064 | ENG | W1 |
| 003 | ENG | W1 | 034 | SRV | W2 | 065 | SRV | W2 |
| 004 | ENG | W1 | 035 | SRV | W2 | 066 | QA | W3 |
| 005 | ENG | W1 | 036 | PRO [SRV] | W1 | 067 | ENG | W1 |
| 006 | ENG | W1 | 037 | SRV | W2 | 068 | QA | W3 |
| 007 | ENG | W1 | 038 | SRV | W2 | 069 | QA [PRO, CORE] | W3 |
| 008 | ENG | W1 | 039 | SRV [PRO] | W2 | 070 | OPS [all] | W0 |
| 009 | ENG | W1 | 040 | SRV | W2 | 071 | SRV | W2 |
| 010 | ENG | W1 | 041 | SRV | W2 | 072 | SRV | W2 |
| 011 | ENG | W1 | 042 | SRV | W2 | 073 | SRV [OPS] | W2 |
| 012 | ENG | W1 | 043 | SRV | W2 | 074 | OPS | W3 |
| 013 | ENG | W1 | 044 | UI [PRO] | W2 | 075 | OPS | W3 |
| 014 | ENG | W1 | 045 | PRO | W1 | 076 | OPS | ship |
| 015 | ENG [SRV] | W1 | 046 | SRV | W2 | 077 | OPS | W3 |
| 016 | ENG | W1 | 047 | UI | W2 | 078 | DOC | W5 |
| 017 | ENG [SRV] | W1 | 048 | UI | W2 | 079 | SRV [PRO, CORE] | W2 |
| 018 | ENG | W1 | 049 | UI [CORE] | W2 | 080 | SRV [PRO] | W2 |
| 019 | ENG | W1 | 050 | UI | W2 | 081 | SRV | W2 |
| 020 | SRV [PRO, UI] | W2 | 051 | UI [CORE] | W2 | 082 | QA [PRO] | W3 |
| 021 | CORE [SRV] | W2 | 052 | UI [CORE] | W2 | 083 | SRV | W2 |
| 022 | UI [CORE] | W2 | 053 | CORE [UI legend] | W2 | 084 | UI [SRV] | W4 |
| 023 | SRV | W2 | 054 | CORE [PRO, ENG] | W2 | 085 | UI | W4 |
| 024 | SRV | W2 | 055 | CORE | W2 | 086 | UI [CORE] | W4 |
| 025 | SRV | W2 | 056 | UI | W2 | 087 | CORE [SRV] | W4 |
| 026 | SRV [UI] | W2 | 057 | UI | W2 | 088 | CORE | W4 |
| 027 | SRV | W2 | 058 | UI | W2 | 089 | CORE [UI button] | W4 |
| 028 | SRV [PRO] | W2 | 059 | SRV [UI W4] | W2 | 090 | SRV | W2 |
| 029 | SRV | W2 | 060 | UI [CORE] | W4 | 091 | UI | W4 |
| 030 | SRV | W2 | 061 | CORE | W4 | 092 | SRV | W2 |
| 031 | SRV | W2 | 062 | SRV [UI W4] | W2 | | | |

**Counts:** ENG 22 · PRO 2 · SRV 34 · CORE 8 · UI 16 · QA 4 · OPS 5 · DOC 1 = **92**. QA writes the e2e evidence
for the UI- and CORE-owned REQs (§6.2); the owner fixes any failures.

### 7.3 One server agent or two
- **Option A (recommended): one SRV agent.** `rooms.ts` and `match.ts` share the transition table and the
  ingress gates. Splitting them recreates exactly the producer/consumer drift this vault has paid for before.
- **Option B: two agents.** SRV-NET takes connection, rooms, series, limits, http and log, plus the integration
  tests. SRV-MATCH takes `match.ts` and `loop.ts`, plus the unit tests. The seam is the `Match` surface in §4.6.
  This saves wall-clock time, but SRV-NET's integration tests wait for SRV-MATCH.

### 7.4 Producer/consumer pairs to grep after each wave
| Literal set | Defined in | Producer | Consumer |
|---|---|---|---|
| message `type`s and field names | `packages/protocol/src/schemas.ts` | server send sites | client store `switch`, `TestClient` |
| `ERROR_CODES`, `CLOSE_CODES` | `protocol/src/constants.ts` | `connection.ts`, `rooms.ts` | client `socket.ts`, the `ui/copy.ts` mapping |
| `WS_PATH`, `HEALTH_PATH`, `GAME_PATH_PREFIX`, `WATCH_QUERY_PARAM` | constants | `http.ts`, `server.ts` | `socket.ts`, `ui/router.ts`, e2e |
| `tokenStorageKey`, `MUSIC_STORAGE_KEY` | `constants.ts` / `codes.ts` | `session.ts`, `audio/` | the same modules only (no inline `'token:'` or `'stackerist:music'`) |
| `DATA_HOOKS` | `apps/client/src/render/hooks.ts` | the renderer | `e2e/*.spec.ts` |
| `TEST_IDS`, `COPY` | `apps/client/src/ui/testIds.ts`, `ui/copy.ts` | UI components | `e2e/*.spec.ts` |
| `LogEventName`, anticheat rules | `apps/server/src/log.ts` | the server | `logging.test.ts` |
| design tokens | `design/tokens/tokens.{css,ts}` | ui-ux | UI CSS, CORE render (no raw hex values in `apps/client/src`) |

**Grep rule.** No literal from these sets may appear outside its defining file except through an import. For
example, `rg -n "'(BAD_MESSAGE|BAD_TICK|token:|stackerist:music|/ws|/healthz)'" apps packages e2e` should hit
only the defining files. Also check that `rg -n "#[0-9A-Fa-f]{6}" apps/client/src` finds nothing.

---

## 8. Decisions & risks

### 8.1 Decisions (one line and one reason each; these seed DECISIONS.md)
1. Board = `readonly string[]` (20 × 10 characters). It is immutable for free, a copy is 20 references, and it is the same as the fixture and wire form.
2. Rotation is numeric, 0–3. It indexes the kick tables directly and is compact on the wire.
3. `PlayerState.tick` lives inside the state. `bestMoment.tick` and `simulate` need it, and the source spec's `tick(state, level)` API is kept.
4. The bag lives inside `PlayerState` and is nullable. Server refill stays pure, and the client predicts from the 5-piece preview.
5. An empty queue gives `active: null` and a `starved` event, not a top-out. Prediction stops cleanly when the preview runs dry.
6. Garbage is inserted sequentially, so the newest attack ends lowest. This is the literal reading of "in arrival order, existing rows shift up".
7. On garbage overflow the engine inserts, truncates and tops out. The board shown at game over is the one that ended the round.
8. Lock delay counts the landing tick and resets on any downward move. Engine and harness share one unambiguous rule.
9. Each tick runs inputs (A, then B), then gravity (A, B), then attack routing. It is deterministic, and `simulate` mirrors it.
10. `simulate` caps actions per tick with the server's `MAX_ACTIONS_PER_TICK`. Prediction matches the server even under bursts.
11. `OwnView` carries the piece timers. Exact re-simulation (REQ-082) is impossible without them, and they reveal nothing hidden.
12. `lastAckSeq` is the buffer head − 1, or the last seen seq when the buffer is empty. Dropped and rejected inputs get acknowledged, so phantom moves don't stay predicted.
13. The seq space resets on each seat binding and each round. Refresh-rejoin and new rounds work without the client persisting counters.
14. BAD_TICK doesn't count toward the 20-bad-message kick. Clock drift on an honest client must not disconnect it.
15. Stamps are monotonic and clamped to `serverTick + 30`. RTT jitter can then never cause BAD_TICK.
16. The tick estimate is the minimum over 120 snapshot samples plus rtt/2. It recovers after server stalls and leans safely ahead.
17. The input bucket is charged after the seat and status gates, before the seq, tick and cap checks and the queue. One charge at receipt, and mashing keys before the start can't drain it.
18. Frames over 1 KB get BAD_MESSAGE from the app; `ws` `maxPayload` closes at 16 KiB. Over-limit frames get an answer, and huge frames are never buffered.
19. Close codes are 4000–4004, and the reason string is the key name. Clients branch on the code without parsing text.
20. Packages resolve through the `@stackerist/source` condition in dev and test, and through `dist` in production (scaffold). No prebuild, and the build stays real.
21. Protocol depends on engine (Δ1, OQ-1). Views, the type checks and the one `Predictor` need engine types, and REQ-082 must test the real algorithm.
22. No router or state library. Three routes and one store don't justify a dependency.
23. No Fastify `trustProxy`; a custom resolver reads `X-Real-IP` in production. Fastify 5.12 types and docs drop numeric hop trust, and Railway documents `X-Real-IP`.
24. Server-side series, report and snapshot events land in W2. They are part of the one room state machine and protocol, and retrofitting them is rework (OQ-2).
25. A forfeit sets the series winner without adding a round win. The score stays truthful; DESIGN.md's reason line carries the forfeit.
26. A draw keeps the round number and sets `replay`. That is how design §5.6 words it.
27. A disconnect between rounds holds the seat for 2 min, then forfeits the series. No match is running, so there is no pause or grace, but a series can't hang forever (OQ-4).
28. Snapshot events are only `attack` and `cancel`, with no hole columns. Enough for REQ-087, and nothing beyond PublicView.
29. `heightSamples` are taken at round-relative ticks 0, 30, 60, …, capped at 7200. Matches design §5.7 and bounds memory.
30. `actions` counts inputs drained and applied. That is the literal "accepted and applied".
31. `gameOver` carries `tick`. "Topped out at 04:51" comes from ticks, never wall clocks.
32. The initial snapshot is sent when the countdown starts. Boards show under the standoff, and prediction has a base before DUEL!.
33. The standoff and combo banner are DOM, painted from a `subscribeFrame` callback inside CORE's rAF. DUEL! and input-live share one frame (DESIGN.md), and the text keeps the design's typography.
34. Only the own board flashes cleared rows. PublicView doesn't carry the opponent's cleared rows (OQ-6).
35. Fastify request logging is off through `LogController`; only domain events are logged; anticheat lines coalesce per second. No IPs leak, and log volume stays bounded.
36. `uncaughtException` → log and exit(1); `unhandledRejection` → log and continue. Continuing after an unknown synchronous throw is unsafe, and Railway restarts on failure.
37. There is no WebSocket Origin check. Tokens live in sessionStorage, not cookies, so a cross-site socket gains nothing.
38. Music is a Web Audio lookahead scheduler at bpm = 100 + 6·level, persisted as `stackerist:music`. It meets REQ-089 with no files or dependencies, using DESIGN.md's key.
39. The level comes from the absolute tick; tests use `startTick`. Top-speed tests need no special hook.
40. Room statuses `roundOver` and `seriesOver` replace `finished`. The table needs to tell "Next round" from "New series".
41. The waiting TTL counts from creation, and only if no round has started. Rooms mid-series follow the empty-room rule instead.
42. Client unit tests are DOM-free (Vitest `environment: 'node'`), and UI behaviour is proven by Playwright. No jsdom dependency, and the evidence comes from a real browser.
43. e2e locates elements by `data-testid` and asserts copy from `ui/copy.ts`. CSS text-transform can't break a locator, and each string has one source.
44. Error codes split per-IP limits into `TOO_MANY_CREATES` and `TOO_MANY_JOINS`. The DESIGN.md error catalogue has different copy for each.

### 8.2 Risks and unknowns (verify; owner in brackets)
- **R1 [OPS, W3, high]** Δ2: the Docker build context excludes `design/`, while the client imports
  `design/tokens/*` and `design/assets/*`. The Railway build fails until this is fixed. Docker isn't installed
  locally, so the first real image build is on Railway.
- **R2 [orchestrator, before W1b]** Δ1 / OQ-1: protocol has no engine dependency. Without it, `views.ts`, the
  type assertions and `predict.ts` can't live in protocol, and REQ-082 can't exercise the shared algorithm.
- **R3 [OPS, after deploy]** Railway's `X-Real-IP` behaviour is undocumented. Test it from one machine: send 11
  creates within a minute, each with a different spoofed `X-Real-IP`.
  - If the 11th succeeds, the header passes through and the limit can be bypassed. Switch to the XFF hop mode
    or fall back to the socket address.
  - Never log the IP while testing.
- **R4 [SRV]** The default 400 for `/g/%` is proven by the scaffold. The custom HTML page through
  `frameworkErrors` still has to be proven by the http test; the fallback is `routerOptions.onBadUrl` (typed in
  `fastify.d.ts`).
- **R5 [PRO]** The zod types allow `.trim()` → `.min/.max` ordering, and `.refine` on a `z.strictObject` inside
  `discriminatedUnion` (it returns `this`). Runtime behaviour must still be proven by protocol tests. Fallback:
  a server-side name rule.
- **R6 [UI]** The result card (three panels plus the series bug) must fit 1280 × 600. DESIGN.md sizes it at
  513–535 px ≤ 552 px; the geometry gate decides.
- **R7 [CORE/QA]** At an RTT of roughly 900 ms or more, the +30 tick clamp makes inputs land late. Accepted:
  REQ-069 is capped at 150 ms.
- **R8 [CORE]** Web Audio autoplay: `unlock()` must run inside a click handler, otherwise `status()` stays
  `blocked` and DESIGN.md's blocked state shows.
- **R9 [SRV]** Spectators amplify 30 Hz snapshots, one copy per spectator (OQ-3).
- **R10 [orchestrator]** The two parallel client agents depend on the `contract.ts` checkpoint and on merging
  CORE before UI.
- **R11** The SRV agent carries 34 REQs; Option B in §7.3 is the alternative.
- **R12 [QA]** The geometry gate adds a `[data-overlay]` exclusion beyond the requested set. The orchestrator
  should accept or reject it.
- **R13** context7 was unavailable. Every API claim here is checked against an installed d.ts or the official
  docs; anything the types can't prove (runtime behaviour) is assigned to a test above.
- **R14 [OPS]** `railway.json` pins `multiRegionConfig: asia-southeast1-eqsg3a`. Confirm the region from the
  Railway deployment status at ship time.

---

## 9. Dependency set (cross-checked against the merged lockfile and package.json files)

| Workspace | dependencies | devDependencies |
|---|---|---|
| root | — | `typescript 6.0.3` · `vitest 5.1.0` · `@vitest/coverage-v8 5.1.0` · `fast-check 4.10.2` · `@playwright/test 1.63.0` · `@stryker-mutator/core 10.1.1` · `@stryker-mutator/vitest-runner 10.1.1` · `eslint 10.14.0` · `@eslint/js 10.0.1` · `typescript-eslint 8.72.1` (peer `typescript <6.1.0`, so 6.0.3 is correct) · `eslint-plugin-react-hooks 7.1.1` · `globals 17.14.0` · `prettier 3.9.10` · `concurrently 10.0.6` · `@types/node 24.19.2` |
| `packages/engine` | — | `vitest`, `@vitest/coverage-v8`, `fast-check` |
| `packages/protocol` | `zod 4.6.7` · **`@stackerist/engine workspace:*` (Δ1, missing today)** | `vitest`, `fast-check` |
| `apps/server` | `fastify 5.12.8` · `@fastify/websocket 11.3.7` · `@fastify/static 10.1.10` · `pino 10.4.0` · `zod 4.6.7` · `@stackerist/engine` · `@stackerist/protocol` | `ws 8.22.1` · `@types/ws 8.18.2` · `tsx 4.23.15` · `vitest` · `fast-check` · `@types/node` |
| `apps/client` | `react 19.3.1` · `react-dom 19.3.1` · `@fontsource/big-shoulders-display 5.3.0` · `@fontsource/archivo 5.3.0` · `zod 4.6.7` · `@stackerist/engine` · `@stackerist/protocol` | `vite 8.3.6` · `@vitejs/plugin-react 6.2.1` · `@types/react 19.3.0` · `@types/react-dom 19.3.0` · `vitest` · `@types/node` |

**Absent, and must stay absent:** tailwind, react-router, zustand or redux, any chart library, tone or howler,
jsdom or happy-dom, sharp, `@fastify/rate-limit`, eslint-config-prettier (Prettier runs as its own
`prettier --check`).

---

## 10. Open questions for the orchestrator
1. **OQ-1 (blocking before W1b): protocol → engine workspace link (Δ1).** I recommend it: the shared views,
   the `Predictor` and the REQ-082 harness depend on it, and it adds no external package (the lockfile only
   gains a `link:` importer entry). If you decline: `views.ts` moves to `apps/server/src/views.ts`;
   `ownViewToPlayerState` and `Predictor` move to `apps/client/src/game/`; protocol re-declares
   PieceKind/Rotation/Action/GarbageAttack via zod, with the type assertions moving to a server test. REQ-082
   then re-composes the predictor from engine + protocol inside the test helper and no longer proves the
   client's exact code.
2. **OQ-2: scheduling.** I plan the server side of REQ-059, 062, 083, 090 and 092 in W2, because it is the same
   state machine and protocol. Only the client signature and nice-to-have work waits for W4. That deviates from
   "build 083–092 after REQ-001–058 pass". Accept, or move it to a W4 server pass? The protocol stays as in §3
   either way.
3. **OQ-3: spectator cap.** The design doesn't say. I propose `maxSpectatorsPerRoom = 8` → `error ROOM_FULL`,
   which DESIGN.md already has copy for. Declining means a cap of `Infinity`. Without a cap, spectators are a
   bandwidth amplifier.
4. **OQ-4: a disconnect between rounds.** The plan holds the seat for 2 min, then forfeits the series
   (OPPONENT_DISCONNECTED), with no 20 s grace and no pause counted. Confirm.
5. **OQ-5: drop-counter scope.** "200 drops in a match" is implemented per round. Should it be per series?
6. **OQ-6: opponent line-clear flash.** It would need a `clear{seat, rows, tick}` snapshot event, which is visual
   only like `attack` and `cancel`. Add it, or keep the flash on the own board only (the current plan)?

### 10.1 Resolutions (orchestrator + owner, 2026-11-08)
- **OQ-1 — accepted (orchestrator).** Δ1 applied before W1b: protocol depends on `@stackerist/engine` (workspace link only).
- **OQ-2 — accepted (orchestrator).** Server side of REQ-059/062/083/090/092 lands in W2 with the one room state machine; client signature work still waits for W4 behind the REQ-001–058 gate.
- **§7.3 — Option A (orchestrator).** One SRV agent.
- **OQ-3 — Ariel: cap 8 spectators** → `ROOM_FULL` beyond 8 (REQ-062 reworded).
- **OQ-4 — Ariel: disconnect between rounds holds the seat 2 min, no pause used, then the series goes to the opponent** (REQ-034 reworded).
- **OQ-5 — Ariel: the 200-drop RATE_LIMITED counter runs across the whole series** (REQ-038 reworded), matching the per-series pause cap.
- **OQ-6 — Ariel: cleared-row flash on the own board only.** No `clear` snapshot event; decision 34 stands.
- **R12** (`[data-overlay]` geometry exclusion) — decided at W3 when the probe exists: accepted only if overlay content is still measured for its own overflow.

### 10.2 Rulings on gaps found by PRO in W1b (orchestrator, 2026-11-08)
- **G1 — forfeit between rounds.** No round is in progress, so **no `RoundSummary` is appended**; `RoundSummary.durationTicks` stays a plain `number`. `applyForfeit(…, durationTicks: null)` means "no round to summarise". SRV implements; series tests cover it (REQ-092).
- **G2 — `views.ts` pending total.** PRO switches its local loop to the engine's `pendingTotal` in W1c, together with `predict.ts`.
- **G3 — error copy.** DESIGN.md has no copy for `BAD_SEQ`, `NOT_IN_ROOM`, `NOT_FINISHED`, `ALREADY_IN_ROOM`, `INTERNAL_ERROR` or the `ROOM_CLOSED` close, and its `ROOM_FULL` copy ("already has two players") is wrong now that a full room means **2 players + 8 spectators** (a third player becomes a spectator). UI writes these in `ui/copy.ts` in DESIGN.md's voice (name the problem **and** the recovery). `ROOM_FULL`: "This room is full — two players and eight spectators are already in. Ask for a new game code." The internal codes (`BAD_SEQ`, `NOT_FINISHED`, `INTERNAL_ERROR`) get one generic recoverable line ("Something went wrong on our side. Reload to rejoin.") and are logged, not explained.
- **G4 — catch-up during a countdown.** A spectator who joins, or a player who rejoins, while the room is in `countdown` (or a resume countdown) must also receive the current `countdown` (or `resumed`) message as part of catch-up, so the client has a clock anchor. No protocol change; SRV implements, with an integration test.
- **G5 — name length unit.** zod 4.6.7 counts code points (16 astral letters is a valid name; emoji are refused since 2026-11-10). The UI validates names only via `NameSchema`, never `.length`.
- **Process.** Agent worktrees are created from `main`, not the current branch: every contract now starts with `git merge --ff-only <base commit>` and a check that `git log -1` shows it.

**Known limitation (security review F6, WAIVED by the owner on 2026-11-09: "stay on 31-bit random seed generator; we will fix this later").** The per-round piece seed and hole seed are 31-bit integers (`randomInt(2 ** 31)` in `server.ts`, `defaultSeeds`) feeding the engine's mulberry32 streams, and both seats' bags are created from the same piece seed (`match.ts`). The reviewer measured recovering a seed in about 52 s of brute force after roughly 15 placements, because the pieces a player has already seen pin it down. A recovered seed lets that player see their **own** future pieces beyond the 5-piece preview (the same sequence the opponent gets) and, for the hole seed, the columns of the garbage holes they will receive. It reveals nothing about the opponent's board or inputs and cannot alter server-authoritative state, so the impact is an information advantage, not a forgery. The engine and RNG are deliberately unchanged in this pass. Possible remedies, each a larger change than a hardening fix: a server-side 128-bit seed (keep it server-only and derive the bag and hole streams from a keyed hash of it), or a crypto-backed bag (draw each shuffle from `crypto.randomInt`, so the stream is not a function of a small seed). Decision: owner.
