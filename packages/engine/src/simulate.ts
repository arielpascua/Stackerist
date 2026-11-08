/**
 * The prediction helper (design §6.1, architecture §2.7). It mirrors the server's per-tick order
 * (architecture §4.6, decision 9) for one seat, so a prediction is bit-exact with the server.
 */
import { MAX_ACTIONS_PER_TICK, levelForTick } from './config.js';
import { applyAction, tick } from './player.js';
import type {
  EngineEvent,
  PlayerState,
  SimulateResult,
  StampedInput,
  TickedEvent,
} from './types.js';

function stopReason(state: PlayerState): SimulateResult['stoppedBy'] {
  if (state.toppedOut) return 'toppedOut';
  return state.active === null ? 'starved' : 'none';
}

/**
 * For t = from.tick … toTick − 1:
 * 1. apply every not-yet-applied input with input.tick ≤ t, in ascending (tick, seq) order, at most
 *    MAX_ACTIONS_PER_TICK (the rest carry over to the next t);
 * 2. tick(state, levelForTick(t));
 * 3. tag the events with t; stop early once toppedOut or active === null.
 * toTick ≤ from.tick returns `from` unchanged. Inputs stamped before from.tick apply at from.tick.
 */
export function simulate(
  from: PlayerState,
  toTick: number,
  inputs: readonly StampedInput[],
): SimulateResult {
  if (toTick <= from.tick) {
    return { state: from, reachedTick: from.tick, stoppedBy: 'none', events: [], appliedSeqs: [] };
  }
  const ordered = inputs.toSorted((a, b) => a.tick - b.tick || a.seq - b.seq);
  const events: TickedEvent[] = [];
  const appliedSeqs: number[] = [];
  const record = (t: number, list: readonly EngineEvent[]): void => {
    for (const event of list) events.push({ tick: t, event });
  };

  let state = from;
  let nextInput = 0;
  for (let t = from.tick; t < toTick && stopReason(state) === 'none'; t += 1) {
    for (let applied = 0; applied < MAX_ACTIONS_PER_TICK; applied += 1) {
      const input = ordered[nextInput];
      if (input === undefined || input.tick > t) break;
      nextInput += 1;
      const result = applyAction(state, input.action);
      state = result.state;
      appliedSeqs.push(input.seq);
      record(t, result.events);
      if (stopReason(state) !== 'none') break;
    }
    const result = tick(state, levelForTick(t));
    state = result.state;
    record(t, result.events);
  }
  return { state, reachedTick: state.tick, stoppedBy: stopReason(state), events, appliedSeqs };
}
