/**
 * Arena-only overlays (DESIGN.md "Overlays"; the top bar stays usable above them):
 * - the countdown (REQ-050; W2 form — W4 upgrades it to the DUEL! standoff), painted per frame;
 * - the disconnect overlay with its live seconds timer (REQ-050, REQ-031).
 */
import { type Ref, useLayoutEffect, useRef } from 'react';
import { COPY } from '../../copy.ts';
import { secondsLeft } from '../../format.ts';
import { TEST_IDS } from '../../testIds.ts';

export interface CountdownOverlayProps {
  readonly rootRef: Ref<HTMLDivElement>;
  readonly numeralRef: Ref<HTMLParagraphElement>;
  readonly duelRef: Ref<HTMLParagraphElement>;
  readonly liveRef: Ref<HTMLParagraphElement>;
  readonly roundLabel: string;
}

/** Static DOM; `paintCountdown` drives it from the frame loop, so DUEL! paints with input-live. */
export function CountdownOverlay({
  rootRef,
  numeralRef,
  duelRef,
  liveRef,
  roundLabel,
}: CountdownOverlayProps) {
  return (
    <>
      <div
        ref={rootRef}
        className="countdown"
        data-phase="none"
        data-overlay=""
        hidden
        data-testid={TEST_IDS.countdown.overlay}
      >
        <div className="countdown__scrim" />
        <div className="countdown__content" aria-hidden="true">
          <p className="countdown__round label">{roundLabel}</p>
          <p
            ref={numeralRef}
            className="countdown__numeral"
            data-testid={TEST_IDS.countdown.numeral}
          />
          <p ref={duelRef} className="countdown__duel" hidden data-testid={TEST_IDS.countdown.duel}>
            <span className="onair-skew">{COPY.countdown.duel}</span>
          </p>
        </div>
      </div>
      <p ref={liveRef} className="sr-only" role="status" data-testid={TEST_IDS.countdown.live} />
    </>
  );
}

export interface DisconnectOverlayProps {
  /** null: your own connection dropped. */
  readonly opponent: {
    readonly name: string;
    readonly graceEndsAtMs: number;
    readonly pausesLeft: number;
  } | null;
  readonly spectator: boolean;
  readonly graceSeconds: number;
}

const ANNOUNCE_AT = [10, 5] as const;

export function DisconnectOverlay({ opponent, spectator, graceSeconds }: DisconnectOverlayProps) {
  const timerRef = useRef<HTMLParagraphElement>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);
  const name = opponent?.name ?? null;
  const graceEndsAtMs = opponent?.graceEndsAtMs ?? null;

  // The digits update every 250 ms from performance.now(); the polite region speaks at entry,
  // then at 10 s and at 5 s. The per-second digits are aria-hidden.
  useLayoutEffect(() => {
    if (name === null || graceEndsAtMs === null) return undefined;
    const spoken = new Set<number>();
    let entered = false;
    const tick = () => {
      const left = secondsLeft(graceEndsAtMs, performance.now());
      if (timerRef.current !== null) timerRef.current.textContent = COPY.disconnect.seconds(left);
      const live = liveRef.current;
      if (live === null) return;
      if (!entered) {
        entered = true;
        for (const at of ANNOUNCE_AT) if (left <= at) spoken.add(at);
        live.textContent = COPY.disconnect.announceEntry(name, left);
        return;
      }
      for (const at of ANNOUNCE_AT) {
        if (left <= at && !spoken.has(at)) {
          spoken.add(at);
          live.textContent = COPY.disconnect.announceLeft(left);
        }
      }
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [name, graceEndsAtMs]);

  return (
    <div className="disconnect" data-overlay="" data-testid={TEST_IDS.disconnect.overlay}>
      <div className="disconnect__content">
        {opponent === null ? (
          <>
            <h2 className="overlay-title" data-testid={TEST_IDS.disconnect.title}>
              {COPY.disconnect.connectionLostTitle}
            </h2>
            <p className="small" role="status">
              {COPY.disconnect.connectionLostLine(graceSeconds)}
            </p>
          </>
        ) : (
          <>
            <h2 className="overlay-title" data-testid={TEST_IDS.disconnect.title}>
              {COPY.disconnect.title(opponent.name)}
            </h2>
            <p
              ref={timerRef}
              className="disconnect__timer"
              aria-hidden="true"
              data-testid={TEST_IDS.disconnect.timer}
            />
            <p className="small">
              {spectator
                ? COPY.disconnect.waitingSpectator(opponent.name)
                : COPY.disconnect.waitingPlayer(opponent.name)}
            </p>
            <p className="table-text muted">
              {COPY.disconnect.pausesLeft(opponent.name, opponent.pausesLeft)}
            </p>
            <p ref={liveRef} className="sr-only" role="status" />
          </>
        )}
      </div>
    </div>
  );
}
