import { tokenStorageKey } from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import { clearToken, loadToken, saveToken } from '../../src/net/session.ts';
import { MemoryStorage, OTHER_TOKEN, TOKEN } from './helpers.ts';

describe('REQ-021 seat token session', () => {
  it('REQ-021 saves under the protocol key token:<CODE> and loads it back', () => {
    const storage = new MemoryStorage();
    saveToken(storage, 'K7QM4X', TOKEN);
    expect([...storage.map.keys()]).toEqual([tokenStorageKey('K7QM4X')]);
    expect(loadToken(storage, 'K7QM4X')).toBe(TOKEN);
  });

  it('REQ-021 the code is case-insensitive: a lower-case share link finds the same seat', () => {
    const storage = new MemoryStorage();
    saveToken(storage, 'K7QM4X', TOKEN);
    expect(loadToken(storage, 'k7qm4x')).toBe(TOKEN);
  });

  it('REQ-021 tokens are per room: another code has no token', () => {
    const storage = new MemoryStorage();
    saveToken(storage, 'K7QM4X', TOKEN);
    saveToken(storage, 'ABCDEF', OTHER_TOKEN);
    expect(loadToken(storage, 'K7QM4X')).toBe(TOKEN);
    expect(loadToken(storage, 'ABCDEF')).toBe(OTHER_TOKEN);
    expect(loadToken(storage, 'ZZZZZZ')).toBeNull();
  });

  it('REQ-021 clearToken forgets only that room', () => {
    const storage = new MemoryStorage();
    saveToken(storage, 'K7QM4X', TOKEN);
    saveToken(storage, 'ABCDEF', OTHER_TOKEN);
    clearToken(storage, 'K7QM4X');
    expect(loadToken(storage, 'K7QM4X')).toBeNull();
    expect(loadToken(storage, 'ABCDEF')).toBe(OTHER_TOKEN);
  });

  it('REQ-021 a malformed stored value or code reads as no token', () => {
    const storage = new MemoryStorage();
    storage.map.set(tokenStorageKey('K7QM4X'), 'not a token');
    expect(loadToken(storage, 'K7QM4X')).toBeNull();
    expect(loadToken(storage, '%%%')).toBeNull();
    saveToken(storage, 'ABCDEF', 'short');
    expect(storage.map.has(tokenStorageKey('ABCDEF'))).toBe(false);
  });

  it('REQ-021 missing or throwing storage degrades to no token and never throws', () => {
    expect(loadToken(null, 'K7QM4X')).toBeNull();
    expect(() => {
      saveToken(null, 'K7QM4X', TOKEN);
      clearToken(null, 'K7QM4X');
    }).not.toThrow();
    const blocked = new MemoryStorage();
    blocked.failing = true;
    expect(loadToken(blocked, 'K7QM4X')).toBeNull();
    expect(() => {
      saveToken(blocked, 'K7QM4X', TOKEN);
      clearToken(blocked, 'K7QM4X');
    }).not.toThrow();
  });
});
