/**
 * The game HUD's DOM parts (REQ-049; DESIGN.md "Game HUD"): ping, name plates with series pips, the
 * player columns around CORE's canvases, the VS column and the controls legend. Names are React text
 * children only (REQ-044); nothing here draws on a canvas.
 */
import { SERIES_WINS_NEEDED } from '@stackerist/protocol';
import type { Ref } from 'react';
import { pingQuality } from '../../../../../../design/tokens/tokens.ts';
import type { HudSide } from '../../../game/contract.ts';
import { Bdi } from '../../components/Bdi.tsx';
import { COPY } from '../../copy.ts';
import { TEST_IDS } from '../../testIds.ts';

export function Ping({ rttMs }: { readonly rttMs: number | null }) {
  const ms = rttMs === null ? null : Math.round(rttMs);
  const quality = pingQuality(ms);
  return (
    <p
      className="ping"
      data-quality={quality}
      role="img"
      aria-label={COPY.game.pingName(quality, ms)}
      data-testid={TEST_IDS.game.ping}
    >
      <span className="ping__dot" aria-hidden="true" />
      <span className="ping__ms" aria-hidden="true">
        {COPY.game.pingMs(ms)}
      </span>
    </p>
  );
}

export function Pips({
  name,
  won,
  size,
  testId,
}: {
  readonly name: string;
  readonly won: number;
  readonly size: 'own' | 'opp';
  readonly testId: string;
}) {
  const pips = Array.from({ length: SERIES_WINS_NEEDED }, (_, i) => i < won);
  return (
    <span
      className={`pips pips--${size}`}
      role="img"
      aria-label={COPY.game.pipsName(name, won)}
      data-won={won}
      data-testid={testId}
    >
      {pips.map((filled, i) => (
        <span key={i} className="pip" data-filled={filled ? 'true' : 'false'} />
      ))}
    </span>
  );
}

export interface PlayerColumnProps {
  readonly kind: 'own' | 'opp';
  /** Role label: "You", "Opponent", or nothing for spectators. */
  readonly roleLabel: string | null;
  readonly name: string;
  readonly won: number;
  readonly side: HudSide | null;
  readonly boardLabel: string;
  readonly canvasRef: Ref<HTMLCanvasElement>;
  readonly nextRef: Ref<HTMLCanvasElement>;
  readonly surfaceRef?: Ref<HTMLDivElement>;
  readonly bannerRef: Ref<HTMLDivElement>;
  readonly bannerCountRef: Ref<HTMLSpanElement>;
  /** Own board only: the "+3 sent · 1 cancelled" sub-line. */
  readonly bannerSubRef?: Ref<HTMLSpanElement>;
  readonly dimmed: boolean;
}

export function PlayerColumn({
  canvasRef,
  nextRef,
  surfaceRef,
  bannerRef,
  bannerCountRef,
  bannerSubRef,
  ...props
}: PlayerColumnProps) {
  const { kind, side, name } = props;
  const own = kind === 'own';
  const ids = own
    ? {
        name: TEST_IDS.game.ownName,
        pips: TEST_IDS.game.ownPips,
        canvas: TEST_IDS.game.ownCanvas,
        next: TEST_IDS.game.ownNextCanvas,
        stats: TEST_IDS.game.ownStats,
        meter: TEST_IDS.game.ownMeter,
        combo: TEST_IDS.game.comboOwn,
      }
    : {
        name: TEST_IDS.game.oppName,
        pips: TEST_IDS.game.oppPips,
        canvas: TEST_IDS.game.oppCanvas,
        next: TEST_IDS.game.oppNextCanvas,
        stats: TEST_IDS.game.oppStats,
        meter: TEST_IDS.game.oppMeter,
        combo: TEST_IDS.game.comboOpp,
      };
  const stats = side?.stats;
  const value = (n: number | undefined) => (n === undefined ? '0' : String(n));
  return (
    <section className={`player-col player-col--${kind}`} aria-label={name}>
      <div className="nameplate">
        <span className="nameplate__name" title={name} data-testid={ids.name}>
          <Bdi>{name}</Bdi>
        </span>
        {props.roleLabel !== null ? <span className="label">{props.roleLabel}</span> : null}
        <Pips name={name} won={props.won} size={kind} testId={ids.pips} />
      </div>
      <div className="player-col__body">
        <div
          ref={surfaceRef}
          className="board-slot"
          role="group"
          aria-label={props.boardLabel}
          tabIndex={own ? -1 : undefined}
          data-dimmed={props.dimmed ? 'true' : undefined}
          data-testid={own ? TEST_IDS.game.ownSurface : undefined}
        >
          <canvas ref={canvasRef} className="board-canvas" data-testid={ids.canvas} />
          <div
            ref={bannerRef}
            className={`combo-banner combo-banner--${kind}`}
            data-phase="hidden"
            data-overlay=""
            aria-hidden="true"
            data-testid={ids.combo}
          >
            <span className="combo-banner__title">
              {COPY.combo.word} <span ref={bannerCountRef} className="combo-banner__count" />
            </span>
            {bannerSubRef !== undefined ? (
              <span ref={bannerSubRef} className="combo-banner__sub" />
            ) : null}
          </div>
        </div>
        <div className="side-col">
          <p className="label">{COPY.game.next}</p>
          <canvas ref={nextRef} className="next-canvas" data-testid={ids.next} />
          <dl className="stats" data-testid={ids.stats}>
            <div className="stat">
              <dt className="label">{COPY.game.lines}</dt>
              <dd className="stat__value">{value(stats?.linesCleared)}</dd>
            </div>
            <div className="stat">
              <dt className="label">{COPY.game.sent}</dt>
              <dd className="stat__value">{value(stats?.garbageSent)}</dd>
            </div>
            <div className="stat">
              <dt className="label">{COPY.game.pieces}</dt>
              <dd className="stat__value">{value(stats?.piecesPlaced)}</dd>
            </div>
          </dl>
        </div>
      </div>
      <p className="sr-only" data-testid={ids.meter} data-pending={side?.pendingGarbage ?? 0}>
        {COPY.game.incomingGarbage(side?.pendingGarbage ?? 0)}
      </p>
    </section>
  );
}

export function VsColumn({
  round,
  replay,
  level,
  clockRef,
}: {
  readonly round: number;
  readonly replay: boolean;
  readonly level: number;
  readonly clockRef: Ref<HTMLParagraphElement>;
}) {
  return (
    <div className="vs-col">
      <p className="round-tag" data-testid={TEST_IDS.game.roundTag}>
        <span className="label">{COPY.game.roundTag(round)}</span>
        {replay ? <span className="label round-tag__replay">{COPY.game.replay}</span> : null}
      </p>
      <p className="vs" aria-hidden="true">
        <span className="onair-skew">{COPY.game.vs}</span>
      </p>
      <div className="speed">
        <p className="label">{COPY.game.speed}</p>
        <p className="speed__value" data-testid={TEST_IDS.game.speed}>
          <span key={level} className="speed__num">
            {level + 1}
          </span>
        </p>
      </div>
      <p
        ref={clockRef}
        className="clock"
        role="timer"
        aria-label={COPY.game.clockName}
        data-testid={TEST_IDS.game.clock}
      >
        00:00
      </p>
    </div>
  );
}

export function Legend({ apple, short }: { readonly apple: boolean; readonly short: boolean }) {
  const k = COPY.game.keys;
  const l = COPY.game.legend;
  return (
    <ul className="legend" aria-label={COPY.game.controls} data-testid={TEST_IDS.game.legend}>
      <li>
        <kbd>{k.left}</kbd>
        <kbd>{k.right}</kbd> {l.move}
      </li>
      <li>
        <kbd>{k.up}</kbd>
        <kbd>{k.x}</kbd> {l.rotate}
      </li>
      <li>
        <kbd>{k.z}</kbd>
        {apple ? null : <kbd>{k.ctrl}</kbd>} {l.rotateBack}
      </li>
      <li>
        <kbd>{k.down}</kbd> {l.softDrop}
      </li>
      <li>
        <kbd>{k.space}</kbd> {l.hardDrop}
      </li>
      {short ? null : (
        <li>
          <kbd>{k.esc}</kbd> {l.leave}
        </li>
      )}
    </ul>
  );
}
