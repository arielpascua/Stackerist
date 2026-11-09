/** Lock-step scripted play: each step sends one piece's actions per seat, then runs one tick. */
import type { Action } from '@stackerist/engine';
import type { Seat } from '@stackerist/protocol';
import type { Harness, TestClient } from './harness.js';
import { planClear, planSafe } from './planner.js';

export type SeatClients = Partial<Record<Seat, TestClient>>;

/** One tick: every listed seat sends its actions stamped with the current tick, then the server steps. */
export async function playTick(
  h: Harness,
  code: string,
  moves: Partial<
    Record<Seat, { readonly client: TestClient; readonly actions: readonly Action[] }>
  >,
): Promise<void> {
  const tick = h.tick(code);
  for (const seat of ['A', 'B'] as const) {
    const move = moves[seat];
    if (move === undefined) continue;
    for (const action of move.actions) move.client.input(action, tick);
  }
  await h.settle();
  h.step();
}

/** The server's current engine state for `seat`. */
export function stateOf(h: Harness, code: string, seat: Seat) {
  const state = h.inspect(code).players[seat];
  if (state === undefined) throw new Error(`no state for ${seat}`);
  return state;
}

/** A plan whose last piece clears exactly `lines` rows (and no earlier piece clears anything). */
export function mustPlanClear(h: Harness, code: string, seat: Seat, lines: number): Action[][] {
  const plan = planClear(stateOf(h, code, seat), lines);
  if (plan === null) throw new Error(`no ${String(lines)}-line plan for ${seat}`);
  return plan;
}

/** Runs per-seat plans in lock-step (one piece per seat per tick) up to `upTo[seat]` pieces each. */
export async function runPlans(
  h: Harness,
  code: string,
  plans: Partial<Record<Seat, { readonly client: TestClient; readonly plan: readonly Action[][] }>>,
  upTo: Partial<Record<Seat, number>> = {},
): Promise<void> {
  const limit = (seat: Seat): number => upTo[seat] ?? plans[seat]?.plan.length ?? 0;
  const progress: Record<Seat, number> = { A: 0, B: 0 };
  for (;;) {
    const moves: Parameters<typeof playTick>[2] = {};
    for (const seat of ['A', 'B'] as const) {
      const p = plans[seat];
      const actions = p?.plan[progress[seat]];
      if (p !== undefined && actions !== undefined && progress[seat] < limit(seat)) {
        moves[seat] = { client: p.client, actions };
        progress[seat] += 1;
      }
    }
    if (moves.A === undefined && moves.B === undefined) return;
    await playTick(h, code, moves);
  }
}

/** Hard-drops `seat` in place every tick until the round ends. */
export async function hardDropUntilOver(
  h: Harness,
  code: string,
  clients: SeatClients,
  maxTicks = 60,
): Promise<void> {
  for (let i = 0; i < maxTicks && h.inspect(code).status === 'playing'; i += 1) {
    const moves: Parameters<typeof playTick>[2] = {};
    for (const seat of ['A', 'B'] as const) {
      const client = clients[seat];
      if (client !== undefined) moves[seat] = { client, actions: [{ type: 'hardDrop' }] };
    }
    await playTick(h, code, moves);
  }
  if (h.inspect(code).status === 'playing') throw new Error('round did not end');
}

/** One safe placement for each listed seat, in one tick. */
export async function playSafe(h: Harness, code: string, clients: SeatClients): Promise<void> {
  const moves: Parameters<typeof playTick>[2] = {};
  for (const seat of ['A', 'B'] as const) {
    const client = clients[seat];
    if (client === undefined) continue;
    const actions = planSafe(stateOf(h, code, seat));
    if (actions === null) throw new Error(`no safe placement for ${seat}`);
    moves[seat] = { client, actions };
  }
  await playTick(h, code, moves);
}
