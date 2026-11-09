/**
 * Scripted play for integration tests. Plans run on the server's own engine state (from
 * `testing.inspect`, bag included), so the planned boards are exactly what the server will compute
 * as long as each piece is placed in the tick it spawns (level 0 gravity needs 60 ticks per row).
 */
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  applyAction,
  type Action,
  type Board,
  type PlayerState,
} from '@stackerist/engine';

export interface Placement {
  readonly actions: readonly Action[];
  readonly state: PlayerState;
  readonly cleared: number;
}

const TURNS: readonly (readonly Action[])[] = [
  [],
  [{ type: 'rotateCW' }],
  [{ type: 'rotateCW' }, { type: 'rotateCW' }],
  [{ type: 'rotateCCW' }],
];

/** Every distinct hard-drop placement of the active piece reachable with turns, then shifts. */
export function placements(state: PlayerState): Placement[] {
  if (state.active === null || state.toppedOut) return [];
  const out: Placement[] = [];
  const seen = new Set<string>();
  for (const turn of TURNS) {
    for (let dx = -5; dx <= 5; dx += 1) {
      const shift: Action = dx < 0 ? { type: 'moveLeft' } : { type: 'moveRight' };
      const steps: Action[] = [...turn, ...Array.from({ length: Math.abs(dx) }, () => shift)];
      let s = state;
      let ok = true;
      for (const step of steps) {
        const next = applyAction(s, step).state;
        if (next === s) {
          ok = false;
          break;
        }
        s = next;
      }
      const active = s.active;
      if (!ok || active === null) continue;
      const key = `${String(active.rotation)}:${String(active.x)}:${String(active.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const drop = applyAction(s, { type: 'hardDrop' });
      let cleared = 0;
      for (const e of drop.events) if (e.type === 'linesCleared') cleared = e.count;
      out.push({ actions: [...steps, { type: 'hardDrop' }], state: drop.state, cleared });
    }
  }
  return out;
}

function heights(board: Board): number[] {
  const out: number[] = [];
  for (let x = 0; x < BOARD_WIDTH; x += 1) {
    let h = 0;
    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      if (board[y]?.[x] !== '.') {
        h = BOARD_HEIGHT - y;
        break;
      }
    }
    out.push(h);
  }
  return out;
}

/** Higher is better: fill the bottom `lines` rows with no holes and as little as possible above. */
function score(board: Board, lines: number): number {
  const top = BOARD_HEIGHT - lines;
  let filled = 0;
  let above = 0;
  let holes = 0;
  for (let x = 0; x < BOARD_WIDTH; x += 1) {
    let covered = false;
    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      const full = board[y]?.[x] !== '.';
      if (full) {
        covered = true;
        if (y >= top) filled += 1;
        else above += 1;
      } else if (covered) {
        holes += 1;
      }
    }
  }
  const h = heights(board);
  let bump = 0;
  for (let x = 1; x < h.length; x += 1) bump += Math.abs((h[x] ?? 0) - (h[x - 1] ?? 0));
  return 10 * filled - 40 * holes - 4 * above - bump;
}

/**
 * A sequence of placements (one action list per piece) whose last lock clears exactly `lines` rows and
 * whose earlier locks clear nothing. null when none is found within `depth` pieces.
 */
export function planClear(
  state: PlayerState,
  lines: number,
  options: { readonly width?: number; readonly depth?: number } = {},
): Action[][] | null {
  const width = options.width ?? 80;
  const depth = options.depth ?? 20;
  interface Node {
    readonly state: PlayerState;
    readonly plan: Action[][];
    readonly score: number;
  }
  let beam: Node[] = [{ state, plan: [], score: 0 }];
  for (let d = 0; d < depth; d += 1) {
    const next: Node[] = [];
    for (const node of beam) {
      for (const p of placements(node.state)) {
        if (p.state.toppedOut) continue;
        if (p.cleared === lines) return [...node.plan, [...p.actions]];
        if (p.cleared > 0) continue;
        next.push({
          state: p.state,
          plan: [...node.plan, [...p.actions]],
          score: score(p.state.board, lines),
        });
      }
    }
    next.sort((x, y) => y.score - x.score);
    const seen = new Set<string>();
    beam = [];
    for (const node of next) {
      const key = node.state.board.join('') + (node.state.active?.kind ?? '');
      if (seen.has(key)) continue;
      seen.add(key);
      beam.push(node);
      if (beam.length >= width) break;
    }
  }
  return null;
}

/** A safe placement: lowest stack, fewest holes (clears allowed). */
export function planSafe(state: PlayerState): Action[] | null {
  let best: Placement | null = null;
  let bestScore = -Infinity;
  for (const p of placements(state)) {
    if (p.state.toppedOut) continue;
    const h = heights(p.state.board);
    let holes = 0;
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      let covered = false;
      for (let y = 0; y < BOARD_HEIGHT; y += 1) {
        if (p.state.board[y]?.[x] !== '.') covered = true;
        else if (covered) holes += 1;
      }
    }
    const s = -10 * Math.max(...h) - 20 * holes - h.reduce((a, b) => a + b, 0) + 30 * p.cleared;
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best === null ? null : [...best.actions];
}
