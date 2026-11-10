import {
  CLOSE_CODES,
  GRACE_MS,
  RECOVERABLE_CLOSE_CODES,
  WS_PATH,
  type ClientMessage,
  type ServerMessage,
} from '@stackerist/protocol';
import { describe, expect, it } from 'vitest';
import type { ConnectionStatus } from '../../src/game/contract.ts';
import {
  GameSocket,
  RECONNECT_BACKOFF_MS,
  closeCodeName,
  recoverableCloseCode,
  reconnectDelayMs,
  shouldReconnect,
  wsUrl,
  type SocketConnection,
  type SocketHandlers,
} from '../../src/net/socket.ts';
import { ManualTimers } from './helpers.ts';

class FakeConnection implements SocketConnection {
  readonly sent: string[] = [];
  closedWith: number | null = null;
  constructor(readonly handlers: SocketHandlers) {}
  send(text: string): void {
    this.sent.push(text);
  }
  close(code?: number): void {
    this.closedWith = code ?? 1000;
  }
}

function harness() {
  const timers = new ManualTimers();
  const connections: FakeConnection[] = [];
  const messages: ServerMessage[] = [];
  const statuses: { status: ConnectionStatus; closedBy: string | null }[] = [];
  const drops: number[] = [];
  let opens = 0;
  const socket = new GameSocket({
    url: 'ws://example.test/ws',
    timers,
    now: () => timers.now,
    createSocket: (_url, handlers) => {
      const conn = new FakeConnection(handlers);
      connections.push(conn);
      return conn;
    },
    events: {
      onOpen: () => {
        opens += 1;
      },
      onMessage: (msg) => messages.push(msg),
      onStatus: (status, closedBy) => statuses.push({ status, closedBy }),
      onDropped: (code) => drops.push(code),
    },
  });
  const last = (): FakeConnection => {
    const conn = connections.at(-1);
    if (conn === undefined) throw new Error('no connection');
    return conn;
  };
  return { timers, connections, messages, statuses, drops, socket, last, opens: () => opens };
}

describe('REQ-021 socket: URL, close policy and reconnect', () => {
  it('REQ-021 wsUrl maps https to wss on the same host and the protocol WS_PATH', () => {
    expect(wsUrl({ protocol: 'https:', host: 'stackerist.up.railway.app' })).toBe(
      `wss://stackerist.up.railway.app${WS_PATH}`,
    );
    expect(wsUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      `ws://localhost:5173${WS_PATH}`,
    );
  });

  it('REQ-021 close codes map to their protocol names; others are unnamed', () => {
    expect(closeCodeName(CLOSE_CODES.REPLACED)).toBe('REPLACED');
    expect(closeCodeName(CLOSE_CODES.PONG_TIMEOUT)).toBe('PONG_TIMEOUT');
    expect(closeCodeName(1006)).toBeNull();
  });

  it('REQ-021 4005 (slow consumer) and 1013 (try again later) are recoverable, not named close codes', () => {
    expect(recoverableCloseCode(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER)).toBe(4005);
    expect(recoverableCloseCode(RECOVERABLE_CLOSE_CODES.TRY_AGAIN_LATER)).toBe(1013);
    expect(recoverableCloseCode(1006)).toBeNull();
    expect(recoverableCloseCode(CLOSE_CODES.PONG_TIMEOUT)).toBeNull();
    expect(closeCodeName(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER)).toBeNull();
    expect(shouldReconnect(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER)).toBe(true);
    expect(shouldReconnect(RECOVERABLE_CLOSE_CODES.TRY_AGAIN_LATER)).toBe(true);
  });

  it('REQ-021 every drop reports its close code before the reconnect status', () => {
    const h = harness();
    h.socket.connect();
    h.last().handlers.onOpen();
    h.last().handlers.onClose(RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER);
    expect(h.drops).toEqual([4005]);
    expect(h.statuses.at(-1)?.status).toBe('reconnecting');
    h.timers.advance(reconnectDelayMs(0));
    expect(h.connections).toHaveLength(2);
    h.last().handlers.onClose(1006);
    expect(h.drops).toEqual([4005, 1006]);
  });

  it('REQ-021 reconnects after 1001, 1006 and 4003; never after 4000, 4001, 4002 or 4004', () => {
    expect(shouldReconnect(CLOSE_CODES.SERVER_SHUTDOWN)).toBe(true);
    expect(shouldReconnect(1006)).toBe(true);
    expect(shouldReconnect(CLOSE_CODES.PONG_TIMEOUT)).toBe(true);
    expect(shouldReconnect(CLOSE_CODES.REPLACED)).toBe(false);
    expect(shouldReconnect(CLOSE_CODES.RATE_LIMITED)).toBe(false);
    expect(shouldReconnect(CLOSE_CODES.TOO_MANY_BAD_MESSAGES)).toBe(false);
    expect(shouldReconnect(CLOSE_CODES.ROOM_CLOSED)).toBe(false);
  });

  it('REQ-021 backoff is 0.5, 1, 2, then 4 s for every later attempt', () => {
    expect([0, 1, 2, 3, 4, 9].map(reconnectDelayMs)).toEqual([500, 1000, 2000, 4000, 4000, 4000]);
    expect(RECONNECT_BACKOFF_MS.at(-1)).toBe(4000);
  });

  it('REQ-021 answers ping with pong{t} itself and still forwards the ping', () => {
    const h = harness();
    h.socket.connect();
    h.last().handlers.onOpen();
    h.last().handlers.onMessage(JSON.stringify({ type: 'ping', t: 1234, rtt: 80 }));
    const pong: ClientMessage = { type: 'pong', t: 1234 };
    expect(h.last().sent).toEqual([JSON.stringify(pong)]);
    expect(h.messages).toEqual([{ type: 'ping', t: 1234, rtt: 80 }]);
  });

  it('REQ-021 ignores frames that fail the server schema', () => {
    const h = harness();
    h.socket.connect();
    h.last().handlers.onOpen();
    h.last().handlers.onMessage('{"type":"snapshot","seed":1}');
    h.last().handlers.onMessage('not json');
    h.last().handlers.onMessage(42);
    expect(h.messages).toEqual([]);
  });

  it('REQ-021 send works only while open', () => {
    const h = harness();
    h.socket.connect();
    expect(h.socket.send({ type: 'leave' })).toBe(false);
    h.last().handlers.onOpen();
    expect(h.socket.send({ type: 'leave' })).toBe(true);
    expect(h.last().sent).toEqual(['{"type":"leave"}']);
  });

  it('REQ-021 an unexpected drop reconnects with backoff and reports reconnecting then open', () => {
    const h = harness();
    h.socket.connect();
    h.last().handlers.onOpen();
    h.last().handlers.onClose(1006);
    expect(h.statuses.at(-1)).toEqual({ status: 'reconnecting', closedBy: null });
    expect(h.connections).toHaveLength(1);
    h.timers.advance(499);
    expect(h.connections).toHaveLength(1);
    h.timers.advance(1);
    expect(h.connections).toHaveLength(2);
    h.last().handlers.onClose(1006); // the retry fails too
    h.timers.advance(999);
    expect(h.connections).toHaveLength(2);
    h.timers.advance(1);
    expect(h.connections).toHaveLength(3);
    h.last().handlers.onOpen();
    expect(h.statuses.at(-1)).toEqual({ status: 'open', closedBy: null });
    expect(h.opens()).toBe(2);
  });

  it('REQ-021 gives up after the grace window and reports closed', () => {
    const h = harness();
    h.socket.connect();
    h.last().handlers.onOpen();
    h.last().handlers.onClose(CLOSE_CODES.PONG_TIMEOUT);
    for (let i = 0; i < 20 && h.statuses.at(-1)?.status === 'reconnecting'; i += 1) {
      h.timers.advance(reconnectDelayMs(i));
      h.last().handlers.onClose(1006);
    }
    expect(h.timers.now).toBeGreaterThanOrEqual(GRACE_MS - RECONNECT_BACKOFF_MS[3]);
    expect(h.statuses.at(-1)).toEqual({ status: 'closed', closedBy: null });
    const count = h.connections.length;
    h.timers.advance(60_000);
    expect(h.connections).toHaveLength(count);
  });

  it('REQ-021 a no-reconnect close reports closed with the close code name', () => {
    const h = harness();
    h.socket.connect();
    h.last().handlers.onOpen();
    h.last().handlers.onClose(CLOSE_CODES.REPLACED);
    expect(h.statuses.at(-1)).toEqual({ status: 'closed', closedBy: 'REPLACED' });
    h.timers.advance(60_000);
    expect(h.connections).toHaveLength(1);
  });

  it('REQ-021 a deliberate close never reconnects, and connect() starts again', () => {
    const h = harness();
    h.socket.connect();
    h.last().handlers.onOpen();
    h.socket.close();
    expect(h.last().closedWith).toBe(1000);
    h.last().handlers.onClose(1000);
    h.timers.advance(60_000);
    expect(h.connections).toHaveLength(1);
    expect(h.statuses.at(-1)).toEqual({ status: 'closed', closedBy: null });
    h.socket.connect();
    expect(h.connections).toHaveLength(2);
    expect(h.statuses.at(-1)).toEqual({ status: 'connecting', closedBy: null });
  });

  it('REQ-021 connect() is a no-op while connected or already retrying', () => {
    const h = harness();
    h.socket.connect();
    h.socket.connect();
    expect(h.connections).toHaveLength(1);
    h.last().handlers.onOpen();
    h.socket.connect();
    expect(h.connections).toHaveLength(1);
    h.last().handlers.onClose(1006);
    h.socket.connect();
    expect(h.connections).toHaveLength(1);
  });
});
