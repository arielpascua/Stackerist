import { describe, expect, it } from 'vitest';
import {
  bindKeyboard,
  createKeyHandlers,
  isTextEntryTarget,
  type KeyEventLike,
  type KeyboardOptions,
} from '../../src/game/keyboard.ts';

interface FakeEvent extends KeyEventLike {
  prevented: boolean;
}

function key(code: string, extra: Partial<KeyEventLike> = {}): FakeEvent {
  const event: FakeEvent = {
    code,
    repeat: false,
    target: null,
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
    ...extra,
  };
  return event;
}

function rig(overrides: Partial<KeyboardOptions> = {}) {
  const calls: string[] = [];
  let capturing = true;
  let musicActive = true;
  const options: KeyboardOptions = {
    controller: {
      keyDown: (code, repeat) => calls.push(`down:${code}:${String(repeat)}`),
      keyUp: (code) => calls.push(`up:${code}`),
      blur: () => calls.push('blur'),
    },
    capturingGameKeys: () => capturing,
    musicKeyActive: () => musicActive,
    onMusicKey: () => calls.push('music'),
    ...overrides,
  };
  const handlers = createKeyHandlers(options);
  return {
    calls,
    handlers,
    setCapturing: (value: boolean) => {
      capturing = value;
    },
    setMusicActive: (value: boolean) => {
      musicActive = value;
    },
  };
}

describe('REQ-053 keyboard binding', () => {
  it('REQ-053 game keys are routed and preventDefault-ed while a round is live (no page scroll)', () => {
    const { calls, handlers } = rig();
    const space = key('Space');
    const down = key('ArrowDown');
    handlers.keydown(space);
    handlers.keydown(down);
    handlers.keyup(down);
    expect(space.prevented).toBe(true);
    expect(down.prevented).toBe(true);
    expect(calls).toEqual(['down:Space:false', 'down:ArrowDown:false', 'up:ArrowDown']);
  });

  it('REQ-053 OS repeat events are still prevented but reach the core flagged as repeat', () => {
    const { calls, handlers } = rig();
    const held = key('ArrowLeft', { repeat: true });
    handlers.keydown(held);
    expect(held.prevented).toBe(true);
    expect(calls).toEqual(['down:ArrowLeft:true']);
  });

  it('REQ-053 outside a live round game keys keep their default (Space presses buttons on menus)', () => {
    const { handlers, setCapturing } = rig();
    setCapturing(false);
    const space = key('Space');
    handlers.keydown(space);
    expect(space.prevented).toBe(false);
  });

  it('REQ-053 keys typed into text fields are ignored', () => {
    const { calls, handlers } = rig();
    const typed = key('Space', { target: { tagName: 'INPUT' } });
    handlers.keydown(typed);
    handlers.keydown(key('KeyM', { target: { tagName: 'TEXTAREA' } }));
    expect(typed.prevented).toBe(false);
    expect(calls).toEqual([]);
    expect(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTextEntryTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });

  it('REQ-053 window blur releases every key (softDropStop)', () => {
    const { calls, handlers } = rig();
    handlers.blur();
    expect(calls).toEqual(['blur']);
  });

  it('REQ-053 non-game keys are left alone; Esc stays with the UI', () => {
    const { calls, handlers } = rig();
    const esc = key('Escape');
    const tab = key('Tab');
    handlers.keydown(esc);
    handlers.keydown(tab);
    expect(esc.prevented || tab.prevented).toBe(false);
    expect(calls).toEqual([]);
  });

  it('REQ-053 M toggles music in a room, ignoring repeat, modifiers and text fields', () => {
    const { calls, handlers, setMusicActive } = rig();
    handlers.keydown(key('KeyM'));
    handlers.keydown(key('KeyM', { repeat: true }));
    handlers.keydown(key('KeyM', { ctrlKey: true }));
    expect(calls).toEqual(['music']);
    setMusicActive(false);
    handlers.keydown(key('KeyM'));
    expect(calls).toEqual(['music']);
  });

  it('REQ-053 bindKeyboard installs capture listeners and removes them on unbind', () => {
    const added: string[] = [];
    const removed: string[] = [];
    const target = {
      addEventListener: (type: string, _listener: unknown, capture?: boolean) =>
        added.push(`${type}:${String(capture)}`),
      removeEventListener: (type: string, _listener: unknown, capture?: boolean) =>
        removed.push(`${type}:${String(capture)}`),
    };
    const unbind = bindKeyboard(target, rig().handlers);
    expect(added).toEqual(['keydown:true', 'keyup:true', 'blur:false']);
    unbind();
    expect(removed).toEqual(added);
  });
});
