import type { Action, ActionType } from '@stackerist/engine';
import { describe, expect, it } from 'vitest';
import { ARR_MS, DAS_MS, InputController, gameKeyForCode } from '../../src/game/input.ts';
import { ManualTimers } from './helpers.ts';

function rig(enabled = true) {
  const timers = new ManualTimers();
  const log: { at: number; type: ActionType }[] = [];
  const controller = new InputController({
    emit: (action: Action) => log.push({ at: timers.now, type: action.type }),
    timers,
  });
  controller.setEnabled(enabled);
  const types = (): ActionType[] => log.map((entry) => entry.type);
  return { timers, log, controller, types };
}

describe('REQ-053 keyboard controls (pure input core)', () => {
  it('REQ-053 maps the source-spec keys: arrows, X, Z, Ctrl and Space', () => {
    expect(gameKeyForCode('ArrowLeft')).toBe('moveLeft');
    expect(gameKeyForCode('ArrowRight')).toBe('moveRight');
    expect(gameKeyForCode('ArrowUp')).toBe('rotateCW');
    expect(gameKeyForCode('KeyX')).toBe('rotateCW');
    expect(gameKeyForCode('KeyZ')).toBe('rotateCCW');
    expect(gameKeyForCode('ControlLeft')).toBe('rotateCCW');
    expect(gameKeyForCode('ControlRight')).toBe('rotateCCW');
    expect(gameKeyForCode('ArrowDown')).toBe('softDrop');
    expect(gameKeyForCode('Space')).toBe('hardDrop');
    expect(gameKeyForCode('KeyM')).toBeNull();
    expect(gameKeyForCode('Escape')).toBeNull();
  });

  it('REQ-053 DAS is 170 ms and ARR 50 ms', () => {
    expect(DAS_MS).toBe(170);
    expect(ARR_MS).toBe(50);
  });

  it('REQ-053 a held arrow moves once, again at DAS, then every ARR; each repeat is one move', () => {
    const { timers, log, controller } = rig();
    controller.keyDown('ArrowLeft', false);
    timers.advance(DAS_MS - 1);
    expect(log).toEqual([{ at: 0, type: 'moveLeft' }]);
    timers.advance(1 + 3 * ARR_MS);
    expect(log.map((entry) => entry.at)).toEqual([
      0,
      DAS_MS,
      DAS_MS + ARR_MS,
      DAS_MS + 2 * ARR_MS,
      DAS_MS + 3 * ARR_MS,
    ]);
    expect(log.every((entry) => entry.type === 'moveLeft')).toBe(true);
  });

  it('REQ-053 releasing the arrow stops auto-repeat at once', () => {
    const { timers, controller, types } = rig();
    controller.keyDown('ArrowRight', false);
    timers.advance(DAS_MS + ARR_MS);
    controller.keyUp('ArrowRight');
    timers.advance(1000);
    expect(types()).toEqual(['moveRight', 'moveRight', 'moveRight']);
    expect(timers.pending).toBe(0);
  });

  it('REQ-053 OS key repeat (event.repeat) is ignored: DAS/ARR is ours', () => {
    const { timers, controller, types } = rig();
    controller.keyDown('ArrowLeft', false);
    for (let i = 0; i < 5; i += 1) controller.keyDown('ArrowLeft', true);
    controller.keyDown('Space', false);
    controller.keyDown('Space', true);
    controller.keyDown('Space', true);
    controller.keyDown('ArrowUp', true);
    expect(types()).toEqual(['moveLeft', 'hardDrop']);
    timers.advance(DAS_MS - 1);
    expect(types()).toEqual(['moveLeft', 'hardDrop']);
  });

  it('REQ-053 the last-pressed direction wins; releasing it hands back to the held one after DAS', () => {
    const { timers, log, controller } = rig();
    controller.keyDown('ArrowLeft', false);
    timers.advance(100);
    controller.keyDown('ArrowRight', false);
    timers.advance(DAS_MS);
    expect(log.map((entry) => `${entry.type}@${String(entry.at)}`)).toEqual([
      'moveLeft@0',
      'moveRight@100',
      `moveRight@${String(100 + DAS_MS)}`,
    ]);
    controller.keyUp('ArrowRight');
    const before = log.length;
    timers.advance(DAS_MS - 1);
    expect(log).toHaveLength(before);
    timers.advance(1);
    expect(log.at(-1)?.type).toBe('moveLeft');
  });

  it('REQ-053 releasing the older direction keeps the newer one repeating', () => {
    const { timers, controller, types } = rig();
    controller.keyDown('ArrowLeft', false);
    controller.keyDown('ArrowRight', false);
    controller.keyUp('ArrowLeft');
    timers.advance(DAS_MS);
    expect(types()).toEqual(['moveLeft', 'moveRight', 'moveRight']);
  });

  it('REQ-053 rotation and hard drop fire once per press', () => {
    const { controller, types } = rig();
    controller.keyDown('ArrowUp', false);
    controller.keyDown('KeyX', false);
    controller.keyDown('KeyZ', false);
    controller.keyDown('ControlLeft', false);
    controller.keyDown('Space', false);
    expect(types()).toEqual(['rotateCW', 'rotateCW', 'rotateCCW', 'rotateCCW', 'hardDrop']);
  });

  it('REQ-053 soft drop starts on keydown and stops on keyup', () => {
    const { controller, types } = rig();
    controller.keyDown('ArrowDown', false);
    controller.keyDown('ArrowDown', true);
    controller.keyUp('ArrowDown');
    expect(types()).toEqual(['softDropStart', 'softDropStop']);
  });

  it('REQ-053 window blur sends softDropStop and cancels auto-repeat', () => {
    const { timers, controller, types } = rig();
    controller.keyDown('ArrowDown', false);
    controller.keyDown('ArrowLeft', false);
    controller.blur();
    timers.advance(1000);
    expect(types()).toEqual(['softDropStart', 'moveLeft', 'softDropStop']);
    controller.keyUp('ArrowDown');
    expect(types()).toEqual(['softDropStart', 'moveLeft', 'softDropStop']);
  });

  it('REQ-053 keys pressed while input is not live are dropped, not queued', () => {
    const { timers, controller, types } = rig(false);
    controller.keyDown('ArrowLeft', false);
    controller.keyDown('Space', false);
    controller.keyDown('ArrowDown', false);
    controller.setEnabled(true);
    timers.advance(1000);
    expect(types()).toEqual([]);
  });

  it('REQ-053 disabling mid-hold stops repeat; a soft drop released meanwhile is stopped on re-enable', () => {
    const { timers, controller, types } = rig();
    controller.keyDown('ArrowLeft', false);
    controller.keyDown('ArrowDown', false);
    controller.setEnabled(false);
    timers.advance(1000);
    controller.keyUp('ArrowDown');
    expect(types()).toEqual(['moveLeft', 'softDropStart']);
    controller.setEnabled(true);
    expect(types()).toEqual(['moveLeft', 'softDropStart', 'softDropStop']);
  });

  it('REQ-053 a soft drop still held across a pause carries on without a duplicate start', () => {
    const { controller, types } = rig();
    controller.keyDown('ArrowDown', false);
    controller.setEnabled(false);
    controller.setEnabled(true);
    controller.keyUp('ArrowDown');
    expect(types()).toEqual(['softDropStart', 'softDropStop']);
  });

  it('REQ-053 unknown keys are ignored', () => {
    const { controller, types } = rig();
    controller.keyDown('KeyA', false);
    controller.keyUp('KeyA');
    expect(types()).toEqual([]);
  });
});
