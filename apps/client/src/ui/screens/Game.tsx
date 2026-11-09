/**
 * The game screen (REQ-022, REQ-049, REQ-052, REQ-056; DESIGN.md "Game screen" and "Game HUD"): your
 * board large and the opponent's at about 60%, names as DOM text above them, stats, speed, clock,
 * ping and Leave. CORE draws boards, meters, previews and fx into the canvases mounted here; UI paints
 * the per-frame DOM (combo banner, countdown, clock) from `subscribeFrame`.
 */
import { GRACE_MS, type RoomMessage, type Seat } from '@stackerist/protocol';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { computeCellSizes, motion } from '../../../../../design/tokens/tokens.ts';
import type { ClientState, CoreServices, Role, StandoffPhase } from '../../game/contract.ts';
import { BANNER_HIDDEN, type BannerState, type BannerTiming, stepBanner } from '../combo.ts';
import { Button, Logo } from '../components/common.tsx';
import { LeaveConfirm } from '../components/LeaveConfirm.tsx';
import { COPY } from '../copy.ts';
import { formatClock } from '../format.ts';
import { useFitScale, useReducedMotion, useViewport } from '../hooks.ts';
import { legendIsShort } from '../layout.ts';
import { otherSeat, type ResultView, type SeatNames } from '../result.ts';
import { TEST_IDS } from '../testIds.ts';
import { paintBanner, paintCountdown } from './game/framePaint.ts';
import { Legend, PlayerColumn, Ping, VsColumn } from './game/Hud.tsx';
import { CountdownOverlay, DisconnectOverlay } from './game/Overlays.tsx';
import { ResultCard } from './ResultCard.tsx';

export interface GameProps {
  readonly services: CoreServices;
  readonly state: ClientState;
  readonly room: RoomMessage;
  readonly role: Role;
  readonly names: SeatNames;
  /** The result card's content, when a round or the series has ended. */
  readonly result: ResultView | null;
  readonly notice: string | null;
  readonly apple: boolean;
  readonly onLeave: () => void;
  readonly onPrimary: () => void;
  readonly onBackHome: () => void;
}

const LIVE_STATUSES: ReadonlySet<RoomMessage['status']> = new Set([
  'countdown',
  'playing',
  'paused',
]);

function bannerTiming(reducedMotion: boolean): BannerTiming {
  return reducedMotion
    ? { inMs: motion.reducedMs, holdMs: motion.bannerHoldMs, outMs: motion.reducedMs }
    : { inMs: motion.bannerInMs, holdMs: motion.bannerHoldMs, outMs: motion.bannerOutMs };
}

/** Which board dims while the result card enters: the loser's (both on a draw). */
function dimmedSides(result: ResultView | null, leftSeat: Seat): { left: boolean; right: boolean } {
  if (result === null) return { left: false, right: false };
  if (result.outcome === 'draw') return { left: true, right: true };
  if (result.outcome === 'win') return { left: false, right: true };
  if (result.outcome === 'lose') return { left: true, right: false };
  if (result.winner === null) return { left: true, right: true };
  return { left: result.winner !== leftSeat, right: result.winner === leftSeat };
}

export function Game(props: GameProps) {
  const { services, state, room, role, names, result } = props;
  const { store } = services;
  const spectator = role === 'spectator';
  const leftSeat: Seat = spectator ? 'A' : role;
  const rightSeat = otherSeat(leftSeat);
  const viewport = useViewport();
  const reducedMotion = useReducedMotion();
  const cells = useMemo(
    () => computeCellSizes(viewport.width, viewport.height),
    [viewport.width, viewport.height],
  );

  const arenaRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(arenaRef, stageRef);

  const leftCanvas = useRef<HTMLCanvasElement>(null);
  const rightCanvas = useRef<HTMLCanvasElement>(null);
  const leftNext = useRef<HTMLCanvasElement>(null);
  const rightNext = useRef<HTMLCanvasElement>(null);
  const fxCanvas = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLParagraphElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);
  const leftBannerRoot = useRef<HTMLDivElement>(null);
  const leftBannerCount = useRef<HTMLSpanElement>(null);
  const leftBannerSub = useRef<HTMLSpanElement>(null);
  const rightBannerRoot = useRef<HTMLDivElement>(null);
  const rightBannerCount = useRef<HTMLSpanElement>(null);
  const countdownRoot = useRef<HTMLDivElement>(null);
  const countdownNumeral = useRef<HTMLParagraphElement>(null);
  const countdownDuel = useRef<HTMLParagraphElement>(null);
  const countdownLive = useRef<HTMLParagraphElement>(null);
  const [confirming, setConfirming] = useState(false);

  const roundIntro = COPY.countdown.intro(room.series.round, names[leftSeat], names[rightSeat]);
  const introRef = useRef(roundIntro);
  useEffect(() => {
    introRef.current = roundIntro;
  }, [roundIntro]);

  // CORE's rAF loop: one per mounted arena.
  const { mountArena } = services;
  useEffect(() => {
    const left = leftCanvas.current;
    const right = rightCanvas.current;
    const lNext = leftNext.current;
    const rNext = rightNext.current;
    const fx = fxCanvas.current;
    if (left === null || right === null || lNext === null || rNext === null || fx === null) {
      return undefined;
    }
    const handle = mountArena({ left, right, leftNext: lNext, rightNext: rNext, fx }, store, {
      reducedMotion,
    });
    return () => handle.destroy();
  }, [mountArena, store, reducedMotion, leftCanvas, rightCanvas, leftNext, rightNext, fxCanvas]);

  // Per-frame DOM: clock, combo banners, countdown. Same frame as CORE's draw (decision 33).
  useEffect(() => {
    const timing = bannerTiming(reducedMotion);
    let left: BannerState = BANNER_HIDDEN;
    let right: BannerState = BANNER_HIDDEN;
    let phase: StandoffPhase = null;
    let clock = '';
    return store.subscribeFrame((frame) => {
      const elapsed = store.matchElapsedMs(frame.nowMs);
      const nextClock = formatClock(elapsed ?? 0);
      if (nextClock !== clock && clockRef.current !== null) {
        clock = nextClock;
        clockRef.current.textContent = nextClock;
      }
      const lRoot = leftBannerRoot.current;
      const lCount = leftBannerCount.current;
      if (lRoot !== null && lCount !== null) {
        left = paintBanner(
          { root: lRoot, count: lCount, sub: leftBannerSub.current },
          left,
          stepBanner(left, frame.left, frame.nowMs, timing),
        );
      }
      const rRoot = rightBannerRoot.current;
      const rCount = rightBannerCount.current;
      if (rRoot !== null && rCount !== null) {
        right = paintBanner(
          { root: rRoot, count: rCount, sub: null },
          right,
          stepBanner(right, frame.right, frame.nowMs, timing),
        );
      }
      const cRoot = countdownRoot.current;
      const cNumeral = countdownNumeral.current;
      const cDuel = countdownDuel.current;
      const cLive = countdownLive.current;
      if (cRoot !== null && cNumeral !== null && cDuel !== null && cLive !== null) {
        phase = paintCountdown(
          { root: cRoot, numeral: cNumeral, duel: cDuel, live: cLive },
          phase,
          frame.standoff,
          introRef.current,
        );
      }
    });
  }, [store, reducedMotion]);

  // The board surface holds focus while a round is live (DESIGN.md "Focus during play").
  const status = room.status;
  useEffect(() => {
    if (status === 'countdown') surfaceRef.current?.focus({ preventScroll: true });
  }, [status]);

  const live = LIVE_STATUSES.has(status);
  const showResult = result !== null && !live;

  // Esc opens the Leave confirm (players only; spectators use Stop watching).
  useEffect(() => {
    if (spectator || showResult || confirming) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return;
      event.preventDefault();
      setConfirming(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [spectator, showResult, confirming]);

  const onLeaveClick = () => {
    if (spectator || !live) props.onLeave();
    else setConfirming(true);
  };

  const keepPlaying = () => {
    setConfirming(false);
    surfaceRef.current?.focus({ preventScroll: true });
  };

  const leftHud = state.hud.left;
  const rightHud = state.hud.right;
  const dim = dimmedSides(showResult ? result : null, leftSeat);
  const score = room.series.score;
  const lostConnection = live && state.connection === 'reconnecting';
  const resuming = state.countdown?.kind === 'resume';
  const paused = state.paused;
  const pausedName = paused !== null ? names[paused.seat] : null;

  const stageStyle = {
    '--stage-scale': scale,
    '--cell-own': `${String(cells.own)}px`,
    '--cell-opp': `${String(cells.opp)}px`,
    '--cell-next': `${String(cells.next)}px`,
  } as CSSProperties;

  return (
    <div
      className="game"
      data-role={spectator ? 'spectator' : 'player'}
      data-testid={TEST_IDS.game.screen}
    >
      <div className="game__backdrop" aria-hidden="true" />
      <header className="topbar">
        <Logo className="topbar__logo" />
        <p className="topbar__room">
          <span className="label">{COPY.game.roomLabel}</span>
          <span className="topbar__code" data-testid={TEST_IDS.game.roomCode}>
            {room.code}
          </span>
        </p>
        {props.notice !== null ? (
          <p className="topbar__notice" role="status" data-testid={TEST_IDS.game.notice}>
            {props.notice}
          </p>
        ) : null}
        <div className="topbar__right">
          {room.spectators > 0 ? (
            <p className="meta" data-testid={TEST_IDS.game.spectators}>
              {COPY.game.watching(room.spectators)}
            </p>
          ) : null}
          <Ping rttMs={state.rttMs} />
          <div className="topbar__leave">
            <Button
              ref={leaveRef}
              variant="hud"
              onClick={onLeaveClick}
              aria-expanded={spectator ? undefined : confirming}
              data-testid={TEST_IDS.game.leaveButton}
            >
              {spectator ? COPY.game.stopWatching : COPY.game.leave}
            </Button>
            {confirming ? (
              <LeaveConfirm
                opponent={names[rightSeat]}
                onKeep={keepPlaying}
                onLeave={props.onLeave}
              />
            ) : null}
          </div>
        </div>
      </header>
      <main ref={arenaRef} className="arena">
        <div
          ref={stageRef}
          className="stage"
          style={stageStyle}
          data-compact={cells.compact ? 'true' : undefined}
        >
          <div className="duel">
            <PlayerColumn
              kind="own"
              roleLabel={spectator ? null : COPY.game.you}
              name={names[leftSeat]}
              won={score[leftSeat]}
              side={leftHud}
              boardLabel={spectator ? COPY.game.boardOf(names[leftSeat]) : COPY.game.yourBoard}
              canvasRef={leftCanvas}
              nextRef={leftNext}
              surfaceRef={surfaceRef}
              bannerRef={leftBannerRoot}
              bannerCountRef={leftBannerCount}
              bannerSubRef={leftBannerSub}
              dimmed={dim.left}
            />
            <VsColumn
              round={room.series.round}
              replay={room.series.replay}
              level={state.level}
              clockRef={clockRef}
            />
            <PlayerColumn
              kind="opp"
              roleLabel={spectator ? null : COPY.game.opponent}
              name={names[rightSeat]}
              won={score[rightSeat]}
              side={rightHud}
              boardLabel={COPY.game.boardOf(names[rightSeat])}
              canvasRef={rightCanvas}
              nextRef={rightNext}
              bannerRef={rightBannerRoot}
              bannerCountRef={rightBannerCount}
              dimmed={dim.right}
            />
          </div>
          {spectator ? null : <Legend apple={props.apple} short={legendIsShort(viewport.width)} />}
        </div>
        <canvas
          ref={fxCanvas}
          className="fx-canvas"
          aria-hidden="true"
          data-overlay=""
          data-testid={TEST_IDS.game.fxCanvas}
        />
        <CountdownOverlay
          rootRef={countdownRoot}
          numeralRef={countdownNumeral}
          duelRef={countdownDuel}
          liveRef={countdownLive}
          roundLabel={
            room.series.replay
              ? `${COPY.game.roundTag(room.series.round)} · ${COPY.game.replay}`
              : COPY.game.roundTag(room.series.round)
          }
        />
        {lostConnection ? (
          <DisconnectOverlay opponent={null} spectator={spectator} graceSeconds={GRACE_MS / 1000} />
        ) : paused !== null && pausedName !== null && !resuming && paused.seat !== role ? (
          <DisconnectOverlay
            opponent={{
              name: pausedName,
              graceEndsAtMs: paused.graceEndsAtMs,
              pausesLeft: paused.pausesLeft,
            }}
            spectator={spectator}
            graceSeconds={GRACE_MS / 1000}
          />
        ) : null}
      </main>
      {showResult ? (
        <ResultCard
          key={`${String(room.series.round)}-${String(room.series.replay)}-${result.finalLabel}`}
          view={result}
          reducedMotion={reducedMotion}
          viewportHeight={viewport.height}
          drawBestMoment={services.drawBestMoment}
          onPrimary={props.onPrimary}
          onBack={props.onBackHome}
        />
      ) : null}
    </div>
  );
}
