/**
 * Per-frame DOM painting, called from CORE's `subscribeFrame` inside its rAF (decision 33): the combo
 * banner, the countdown and the match clock. Writes only `textContent` and data attributes, and only
 * when a value changes, so a 60 Hz loop costs a few comparisons per frame.
 */
import type { StandoffPhase } from '../../../game/contract.ts';
import { type BannerState, comboSubline } from '../../combo.ts';
import { COPY } from '../../copy.ts';
import { formatClock } from '../../format.ts';

export interface BannerElements {
  readonly root: HTMLElement;
  readonly count: HTMLElement;
  readonly sub: HTMLElement | null;
}

function flipSwap(element: HTMLElement): void {
  // Two identical keyframe sets, so flipping restarts the swap animation without a reflow.
  element.dataset.swap = element.dataset.swap === 'a' ? 'b' : 'a';
}

/** Applies `next` to the banner's DOM; returns it so the caller keeps it as the new `prev`. */
export function paintBanner(
  elements: BannerElements,
  prev: BannerState,
  next: BannerState,
): BannerState {
  if (next === prev) return prev;
  const { root, count, sub } = elements;
  if (next.phase !== prev.phase) root.dataset.phase = next.phase;
  if (next.combo !== prev.combo && next.combo > 0) {
    count.textContent = COPY.combo.count(next.combo);
    // Only a growing combo swaps the numeral; a new chain wipes in as a whole.
    if (next.phase === 'shown' || (next.phase === 'in' && prev.phase === 'in')) flipSwap(count);
  }
  if (sub !== null && (next.sent !== prev.sent || next.cancelled !== prev.cancelled)) {
    sub.textContent = comboSubline(next.sent, next.cancelled);
  }
  return next;
}

export interface CountdownElements {
  readonly root: HTMLElement;
  readonly numeral: HTMLElement;
  readonly duel: HTMLElement;
  readonly live: HTMLElement;
}

const NUMERALS: ReadonlySet<StandoffPhase> = new Set(['3', '2', '1']);

/** What the polite countdown region says when the phase changes (DESIGN.md: 4 updates). */
export function countdownAnnouncement(
  prev: StandoffPhase,
  next: StandoffPhase,
  intro: string,
): string | null {
  if (next === prev || next === null) return null;
  const spoken = next === 'duel' ? COPY.countdown.duelSpoken : NUMERALS.has(next) ? next : '';
  if (prev === null) return spoken === '' ? intro : `${intro} ${spoken}`;
  return spoken === '' ? null : spoken;
}

/** Applies a standoff phase to the countdown overlay; returns it as the new `prev`. */
export function paintCountdown(
  elements: CountdownElements,
  prev: StandoffPhase,
  next: StandoffPhase,
  intro: string,
): StandoffPhase {
  if (next === prev) return prev;
  const { root, numeral, duel, live } = elements;
  root.dataset.phase = next ?? 'none';
  root.hidden = next === null;
  if (next !== null && NUMERALS.has(next)) {
    numeral.textContent = next;
    flipSwap(numeral);
  } else {
    numeral.textContent = '';
  }
  duel.hidden = next !== 'duel';
  const announcement = countdownAnnouncement(prev, next, intro);
  if (announcement !== null) live.textContent = announcement;
  return next;
}

/**
 * Paints the match clock; returns the text now shown. While the connection is down the digits hold their
 * last value and the box is marked stale (dimmed in CSS): a clock that keeps counting under a
 * "connection lost" overlay would look like the match is still running.
 */
export function paintClock(
  clock: HTMLElement,
  shown: string,
  elapsedMs: number | null,
  connected: boolean,
): string {
  const stale = connected ? undefined : 'true';
  if (clock.dataset.stale !== stale) {
    if (stale === undefined) delete clock.dataset.stale;
    else clock.dataset.stale = stale;
  }
  if (!connected) return shown;
  const text = formatClock(elapsedMs ?? 0);
  if (text !== shown) clock.textContent = text;
  return text;
}
