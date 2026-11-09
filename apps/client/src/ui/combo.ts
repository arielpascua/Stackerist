/**
 * The combo banner's timeline (REQ-052; DESIGN.md "Combo banner" and the motion table). Driven once
 * per frame from CORE's `subscribeFrame` with the frame's own timestamp, so it needs no timers:
 * - combo reaches 2: the banner wipes in;
 * - combo grows: only the ×N numeral swaps;
 * - combo breaks: it holds the final count, then wipes out.
 */
import { COPY } from './copy.ts';

/** The banner shows while a player's combo is at least this. */
export const COMBO_BANNER_MIN = 2;

export type BannerPhase = 'hidden' | 'in' | 'shown' | 'hold' | 'out';

export interface BannerState {
  readonly phase: BannerPhase;
  /** The count on the banner (kept through hold and out). */
  readonly combo: number;
  readonly sent: number;
  readonly cancelled: number;
  /** Frame time the phase began, ms. */
  readonly sinceMs: number;
}

export interface BannerTiming {
  readonly inMs: number;
  readonly holdMs: number;
  readonly outMs: number;
}

export interface BannerInput {
  readonly combo: number;
  readonly chain: { readonly sent: number; readonly cancelled: number };
}

export const BANNER_HIDDEN: BannerState = {
  phase: 'hidden',
  combo: 0,
  sent: 0,
  cancelled: 0,
  sinceMs: 0,
};

function withValues(prev: BannerState, input: BannerInput, phase: BannerPhase, sinceMs: number) {
  if (
    prev.phase === phase &&
    prev.combo === input.combo &&
    prev.sent === input.chain.sent &&
    prev.cancelled === input.chain.cancelled &&
    prev.sinceMs === sinceMs
  ) {
    return prev;
  }
  return {
    phase,
    combo: input.combo,
    sent: input.chain.sent,
    cancelled: input.chain.cancelled,
    sinceMs,
  };
}

function withPhase(prev: BannerState, phase: BannerPhase, sinceMs: number): BannerState {
  return prev.phase === phase ? prev : { ...prev, phase, sinceMs };
}

/** The next banner state. Returns `prev` itself when nothing changed. */
export function stepBanner(
  prev: BannerState,
  input: BannerInput | null,
  nowMs: number,
  timing: BannerTiming,
): BannerState {
  const active = input !== null && input.combo >= COMBO_BANNER_MIN;
  if (active) {
    switch (prev.phase) {
      case 'hidden':
      case 'hold':
      case 'out':
        return withValues(prev, input, 'in', nowMs);
      case 'in':
        return nowMs - prev.sinceMs >= timing.inMs
          ? withValues(prev, input, 'shown', nowMs)
          : withValues(prev, input, 'in', prev.sinceMs);
      case 'shown':
        return withValues(prev, input, 'shown', prev.sinceMs);
    }
  }
  switch (prev.phase) {
    case 'hidden':
      return prev;
    case 'in':
    case 'shown':
      return withPhase(prev, 'hold', nowMs);
    case 'hold':
      return nowMs - prev.sinceMs >= timing.holdMs ? withPhase(prev, 'out', nowMs) : prev;
    case 'out':
      return nowMs - prev.sinceMs >= timing.outMs ? BANNER_HIDDEN : prev;
  }
}

/** The sub-line's running totals, "+3 sent · 1 cancelled", each part only when above 0. */
export function comboSubline(sent: number, cancelled: number): string {
  const parts: string[] = [];
  if (sent > 0) parts.push(COPY.combo.sent(sent));
  if (cancelled > 0) parts.push(COPY.combo.cancelled(cancelled));
  return parts.join(' · ');
}
