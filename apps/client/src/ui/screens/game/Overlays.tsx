/**
 * Arena-only overlays (DESIGN.md "Overlays"; the top bar stays usable above them):
 * - the DUEL! standoff countdown (REQ-050, REQ-086), painted per frame;
 * - the disconnect overlay with its live seconds timer (REQ-050, REQ-031).
 */
import { type Ref, useLayoutEffect, useRef } from 'react';
import { COPY } from '../../copy.ts';
import { secondsLeft } from '../../format.ts';
import { TEST_IDS } from '../../testIds.ts';
import { Pips } from './Hud.tsx';

export interface StandoffPlayer {
  readonly name: string;
  /** Rounds won in the series, shown as pips on the plate. */
  readonly won: number;
}

export interface CountdownOverlayProps {
  readonly rootRef: Ref<HTMLDivElement>;
  readonly numeralRef: Ref<HTMLParagraphElement>;
  readonly duelRef: Ref<HTMLParagraphElement>;
  readonly liveRef: Ref<HTMLParagraphElement>;
  readonly roundLabel: string;
  /** The left plate is yours (amber); for spectators it is seat A. */
  readonly left: StandoffPlayer;
  readonly right: StandoffPlayer;
  /** A resume after a pause shows the same sequence with the plates static (no slide). */
  readonly kind: 'start' | 'resume';
}

function StandoffPlate({
  side,
  player,
  nameId,
  pipsId,
  plateId,
}: {
  readonly side: 'left' | 'right';
  readonly player: StandoffPlayer;
  readonly nameId: string;
  readonly pipsId: string;
  readonly plateId: string;
}) {
  return (
    <p className={`standoff__plate standoff__plate--${side}`} data-testid={plateId}>
      <span className="onair-skew standoff__skew">
        <span className="standoff__name" title={player.name} data-testid={nameId}>
          {player.name}
        </span>
        <Pips name={player.name} won={player.won} size="own" testId={pipsId} />
      </span>
    </p>
  );
}

/**
 * The DUEL! standoff (REQ-086; DESIGN.md "Standoff countdown"): the name plates face off with VS
 * between them, the round tag above and the numeral below. Static DOM; `paintCountdown` drives it
 * from the frame loop by setting `data-phase`, so the numerals, DUEL! and the fade of the dim and
 * the plates all change in the same frame that enables input. CSS animates each phase, so no timer
 * or animation callback is ever in the path.
 */
export function CountdownOverlay({
  rootRef,
  numeralRef,
  duelRef,
  liveRef,
  roundLabel,
  left,
  right,
  kind,
}: CountdownOverlayProps) {
  return (
    <>
      <div
        ref={rootRef}
        className="countdown"
        data-phase="none"
        data-kind={kind}
        data-overlay=""
        hidden
        data-testid={TEST_IDS.countdown.overlay}
      >
        <div className="countdown__scrim" />
        <div className="countdown__content" aria-hidden="true">
          <p className="countdown__round label" data-testid={TEST_IDS.countdown.round}>
            {roundLabel}
          </p>
          <div className="standoff">
            <StandoffPlate
              side="left"
              player={left}
              plateId={TEST_IDS.countdown.plateLeft}
              nameId={TEST_IDS.countdown.nameLeft}
              pipsId={TEST_IDS.countdown.pipsLeft}
            />
            <p className="standoff__vs">
              <span className="onair-skew">{COPY.game.vs}</span>
            </p>
            <StandoffPlate
              side="right"
              player={right}
              plateId={TEST_IDS.countdown.plateRight}
              nameId={TEST_IDS.countdown.nameRight}
              pipsId={TEST_IDS.countdown.pipsRight}
            />
          </div>
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
