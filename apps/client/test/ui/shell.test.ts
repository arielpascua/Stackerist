import {
  CLOSE_CODES,
  ERROR_CODES,
  RECOVERABLE_CLOSE_CODES,
  type CloseCodeName,
} from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import {
  boardOuterPx,
  cellMetrics,
  computeCellSizes,
  danger,
  meter,
  motion,
} from '../../../../design/tokens/tokens.ts';
import { COPY } from '../../src/ui/copy.ts';
import { isApplePlatform, isTouchOnly, KeyboardProof } from '../../src/ui/device.ts';
import { presentClose, presentError, presentRecoverableClose } from '../../src/ui/errors.ts';
import { formatClock, formatTicks, secondsLeft } from '../../src/ui/format.ts';
import { fitScale, HIT_MIN_PX, legendIsShort, scaledHitMinPx } from '../../src/ui/layout.ts';
import { rememberState } from '../../src/ui/memory.ts';
import { entranceDelayMs } from '../../src/ui/screens/ResultCard.tsx';
import { makeClientState, makeRoom } from './fixtures.ts';

describe('REQ-058 touch-only devices are warned; a physical key proves a keyboard', () => {
  it('REQ-058 touch-only means no fine pointer and no hover', () => {
    expect(isTouchOnly({ finePointer: false, hover: false })).toBe(true);
    expect(isTouchOnly({ finePointer: true, hover: false })).toBe(false);
    expect(isTouchOnly({ finePointer: false, hover: true })).toBe(false);
    expect(isTouchOnly({ finePointer: true, hover: true })).toBe(false);
  });

  it('REQ-058 only a trusted, non-repeat key press proves a keyboard, once', () => {
    const proof = new KeyboardProof();
    let notified = 0;
    proof.subscribe(() => {
      notified += 1;
    });
    expect(proof.record({ isTrusted: false, repeat: false })).toBe(false);
    expect(proof.record({ isTrusted: true, repeat: true })).toBe(false);
    expect(proof.proven).toBe(false);
    expect(proof.record({ isTrusted: true, repeat: false })).toBe(true);
    expect(proof.record({ isTrusted: true, repeat: false })).toBe(false);
    expect(proof.proven).toBe(true);
    expect(notified).toBe(1);
  });

  it('REQ-058 the warning copy names the keys and the recovery', () => {
    expect(COPY.keyboard.title).toBe('Stackerist needs a keyboard');
    expect(COPY.keyboard.body).toContain('press any key to continue');
  });

  it('REQ-049 the legend drops Ctrl on Apple platforms', () => {
    expect(isApplePlatform('MacIntel', '')).toBe(true);
    expect(isApplePlatform('', 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true);
    expect(isApplePlatform('Win32', '')).toBe(false);
  });
});

describe('REQ-047 error catalogue: every code has a place, problem and recovery (ruling G3)', () => {
  const context = { intent: 'join' as const, roomCode: 'K7QM4X' };

  it('REQ-047 every error code maps; the bug-only codes are hidden', () => {
    const hidden = new Set(['BAD_MESSAGE', 'BAD_TICK', 'NOT_PLAYING', 'NOT_A_PLAYER']);
    for (const code of ERROR_CODES) {
      const view = presentError(code, context);
      expect(view.placement === 'hidden').toBe(hidden.has(code));
      if (!hidden.has(code)) expect(view.text.length).toBeGreaterThan(0);
    }
  });

  it('REQ-047 room errors sit under the code row, with the code in the copy', () => {
    expect(presentError('ROOM_NOT_FOUND', context)).toEqual({
      placement: 'code',
      text: "There's no game with code K7QM4X. Check the code with your friend, or create a new game.",
      retry: false,
    });
    expect(presentError('ROOM_FULL', context).text).toBe(
      'This room is full — two players and eight spectators are already in. Ask for a new game code.',
    );
  });

  it('REQ-047 a refused rejoin reads "your seat expired"; busy offers Try again', () => {
    expect(presentError('BAD_TOKEN', { intent: 'resume', roomCode: 'K7QM4X' }).text).toBe(
      COPY.errors.seatExpired,
    );
    expect(presentError('SERVER_BUSY', context)).toMatchObject({ placement: 'plate', retry: true });
  });

  it('REQ-047 the internal codes share one generic recoverable line', () => {
    for (const code of ['BAD_SEQ', 'NOT_FINISHED', 'INTERNAL_ERROR'] as const) {
      expect(presentError(code, context).text).toBe(
        'Something went wrong on our side. Reload to rejoin.',
      );
    }
  });

  it('REQ-047 every close code maps to a fatal plate or the reconnect banner', () => {
    for (const name of Object.keys(CLOSE_CODES) as CloseCodeName[]) {
      const view = presentClose(name);
      if (view.kind === 'fatal') expect(view.actions.length).toBeGreaterThan(0);
    }
    expect(presentClose('PONG_TIMEOUT')).toEqual({ kind: 'connection' });
    expect(presentClose('REPLACED')).toMatchObject({ text: COPY.errors.replaced });
  });

  it('F1 the recoverable close codes show a reconnect notice, never a fatal plate', () => {
    expect(presentRecoverableClose(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER)).toEqual({
      kind: 'connection',
      text: COPY.errors.slowConnection,
    });
    expect(COPY.errors.slowConnection).toMatch(/too slow/);
    expect(presentRecoverableClose(RECOVERABLE_CLOSE_CODES.TRY_AGAIN_LATER)?.kind).toBe(
      'connection',
    );
    expect(presentRecoverableClose(1006)).toBeNull();
  });
});

describe('REQ-048 lobby copy (single source for e2e)', () => {
  it('REQ-048 the waiting text and the copy confirmation', () => {
    expect(COPY.lobby.waiting).toBe('Waiting for opponent…');
    expect(COPY.lobby.copied).toBe('Copied!');
    expect(COPY.lobby.seriesLine(2, 'Ariel', 1, 0, 'Sam')).toBe('Round 2 · Ariel 1 – 0 Sam');
  });
});

describe('REQ-049 HUD numbers', () => {
  it('REQ-049 the match clock is mm:ss from ticks and never negative', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(192_000)).toBe('03:12');
    expect(formatClock(-5)).toBe('00:00');
    expect(formatTicks(17460)).toBe('04:51');
  });

  it('REQ-049 ping and pips have spoken names; colour is never the only cue', () => {
    expect(COPY.game.pingName('good', 38)).toBe('Connection good, 38 milliseconds');
    expect(COPY.game.pingMs(null)).toBe('— ms');
    expect(COPY.game.pipsName('Ariel', 1)).toBe('Ariel, 1 round won');
    expect(COPY.game.incomingGarbage(4)).toBe('Incoming garbage: 4 rows');
  });

  it('REQ-050 the disconnect timer counts whole seconds down to 0', () => {
    expect(secondsLeft(20_000, 0)).toBe(20);
    expect(secondsLeft(20_000, 19_001)).toBe(1);
    expect(secondsLeft(20_000, 25_000)).toBe(0);
  });

  it('REQ-050 the result card waits for the losing board to dim (none under reduced motion)', () => {
    expect(entranceDelayMs(false)).toBe(motion.resultDelayMs + 120);
    expect(entranceDelayMs(true)).toBe(0);
  });
});

describe('REQ-056 the game screen fits 1280×600 and scales down below it', () => {
  // DESIGN.md vertical stack around the board canvas: padding 12, top bar 40, gap 12, plates 32,
  // gap 12, legend 24, padding 12. CORE's board canvas adds the ring padding to boardOuterPx.
  const chromeAroundBoard = 12 + 40 + 12 + 32 + 12 + 24 + 12;

  it('REQ-056 at 1280×600 the board canvas and its chrome fit without scaling', () => {
    const cells = computeCellSizes(1280, 600);
    expect(cells.own).toBe(22);
    expect(cells.scale).toBe(1);
    const canvasHeight = boardOuterPx(cells.own).height + 2 * danger.ringWidthPx;
    expect(chromeAroundBoard + canvasHeight).toBeLessThanOrEqual(600);
    // Width: page padding, both canvases (meter + gap + ring + board + ring), side columns, VS, gaps.
    const ownCanvas = 2 * meter.widthPx + 2 * danger.ringWidthPx + boardOuterPx(cells.own).width;
    const oppCanvas =
      meter.widthOppPx + meter.widthPx + 2 * danger.ringWidthPx + boardOuterPx(cells.opp).width;
    const width = 2 * 20 + ownCanvas + 12 + 96 + 32 + 112 + 32 + oppCanvas + 12 + 72;
    expect(width).toBeLessThanOrEqual(1280);
  });

  it('REQ-056 below the 12 px cell floor the stage scales uniformly and never above 1', () => {
    expect(computeCellSizes(640, 360).own).toBe(cellMetrics.minPx);
    expect(fitScale({ width: 640, height: 300 }, { width: 800, height: 400 })).toBe(0.75);
    expect(fitScale({ width: 1920, height: 1080 }, { width: 800, height: 600 })).toBe(1);
    expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1);
  });

  it('REQ-056 below 1100 px the legend drops M and Esc', () => {
    expect(legendIsShort(1099)).toBe(true);
    expect(legendIsShort(1280)).toBe(false);
  });
});

describe('REQ-050 result card buttons keep a 44 px tap height when the card is scaled down', () => {
  it('REQ-050 nothing is added at full size, so the 1280×600 layout is untouched', () => {
    expect(scaledHitMinPx(1)).toBe(0);
    expect(scaledHitMinPx(2)).toBe(0);
  });

  it('REQ-050 the rendered height after the scale is at least 44 px at every scale', () => {
    for (const scale of [0.99, 0.95, 0.87, 0.75, 0.56, 0.4, 0.2]) {
      expect(scaledHitMinPx(scale) * scale).toBeGreaterThanOrEqual(HIT_MIN_PX);
    }
  });

  it('REQ-050 the measured failure: 0.87 needs more than the 44 px box', () => {
    expect(scaledHitMinPx(0.87)).toBeGreaterThan(HIT_MIN_PX);
  });

  it('REQ-050 a bad scale never produces a negative, infinite or NaN height', () => {
    expect(scaledHitMinPx(0)).toBe(0);
    expect(scaledHitMinPx(-1)).toBe(0);
    expect(scaledHitMinPx(Number.NaN)).toBe(0);
  });
});

describe('REQ-050 session memory keeps names after a player leaves', () => {
  it('REQ-050 remembers each seat’s last name and whether the socket was ever open', () => {
    const first = rememberState(
      { code: null, names: { A: null, B: null }, everOpen: false },
      makeClientState({
        code: 'K7QM4X',
        room: makeRoom({
          players: { A: { name: 'Ariel', connected: true }, B: { name: 'Sam', connected: true } },
        }),
      }),
    );
    expect(first).toEqual({ code: 'K7QM4X', names: { A: 'Ariel', B: 'Sam' }, everOpen: true });
    const afterLeave = rememberState(
      first,
      makeClientState({ code: 'K7QM4X', room: makeRoom({ status: 'seriesOver' }) }),
    );
    expect(afterLeave).toBe(first);
    const newRoom = rememberState(first, makeClientState({ code: 'ABCDEF', room: null }));
    expect(newRoom.names).toEqual({ A: null, B: null });
  });
});
