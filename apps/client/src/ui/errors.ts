/**
 * Maps protocol error codes and close codes to DESIGN.md's error catalogue (problem + recovery) and
 * to where each one is shown. Ruling G3: ROOM_FULL has its own copy; the internal codes share one
 * generic recoverable line; codes only a bug or a cheat can cause are logged, never shown.
 */
import { RECOVERABLE_CLOSE_CODES, type CloseCodeName, type ErrorCode } from '@stackerist/protocol';
import { COPY } from './copy.ts';
import type { IntentKind } from './intent.ts';

/**
 * `code`: under the room-code row. `plate`: at the top of the current plate or card, with
 * `role="alert"`. `hidden`: logged only.
 */
export type ErrorPlacement = 'code' | 'plate' | 'hidden';

export interface ErrorPresentation {
  readonly placement: ErrorPlacement;
  readonly text: string;
  /** Show a Try again button that repeats the last request. */
  readonly retry: boolean;
}

const HIDDEN: ErrorPresentation = { placement: 'hidden', text: '', retry: false };

function plate(text: string, retry = false): ErrorPresentation {
  return { placement: 'plate', text, retry };
}

/** The presentation of an `error` message, given what the user last asked for. */
export function presentError(
  code: ErrorCode,
  context: { readonly intent: IntentKind; readonly roomCode: string | null },
): ErrorPresentation {
  switch (code) {
    case 'ROOM_NOT_FOUND':
      if (context.intent === 'resume') return plate(COPY.errors.seatExpired);
      return {
        placement: 'code',
        text: COPY.errors.roomNotFound(context.roomCode ?? ''),
        retry: false,
      };
    case 'BAD_TOKEN':
      return plate(COPY.errors.seatExpired);
    case 'ROOM_FULL':
      return { placement: 'code', text: COPY.errors.roomFull, retry: false };
    case 'TOO_MANY_JOINS':
      return plate(COPY.errors.tooManyJoins);
    case 'TOO_MANY_CREATES':
      return plate(COPY.errors.tooManyCreates);
    case 'SERVER_BUSY':
      return plate(COPY.errors.serverBusy, true);
    case 'ALREADY_IN_ROOM':
      return plate(COPY.errors.alreadyInRoom);
    case 'NOT_IN_ROOM':
      return plate(COPY.errors.notInRoom);
    case 'BAD_SEQ':
    case 'NOT_FINISHED':
    case 'INTERNAL_ERROR':
      return plate(COPY.errors.generic);
    case 'BAD_MESSAGE':
    case 'BAD_TICK':
    case 'NOT_PLAYING':
    case 'NOT_A_PLAYER':
      return HIDDEN;
  }
}

export type CloseAction = 'reload' | 'home';

export type ClosePresentation =
  /** A full-screen plate: the session cannot continue. */
  | { readonly kind: 'fatal'; readonly text: string; readonly actions: readonly CloseAction[] }
  /** The connection dropped; the reconnect banner (or the in-match overlay) covers it. */
  | { readonly kind: 'connection'; readonly text?: string };

/** The presentation of a socket close, by its close-code name. */
export function presentClose(name: CloseCodeName): ClosePresentation {
  switch (name) {
    case 'REPLACED':
      return { kind: 'fatal', text: COPY.errors.replaced, actions: ['reload', 'home'] };
    case 'RATE_LIMITED':
      return { kind: 'fatal', text: COPY.errors.rateLimited, actions: ['home'] };
    case 'TOO_MANY_BAD_MESSAGES':
      return { kind: 'fatal', text: COPY.errors.generic, actions: ['reload', 'home'] };
    case 'ROOM_CLOSED':
      return { kind: 'fatal', text: COPY.errors.roomClosed, actions: ['home'] };
    case 'SERVER_SHUTDOWN':
      return { kind: 'fatal', text: COPY.errors.serverRestarted, actions: ['home'] };
    case 'PONG_TIMEOUT':
      return { kind: 'connection' };
  }
}

/**
 * The close codes the server sends that `CLOSE_CODES` doesn't name (`RECOVERABLE_CLOSE_CODES`): the
 * socket reconnects and rejoins with its token on its own, so this is only the reason to show.
 */
export function presentRecoverableClose(code: number): ClosePresentation | null {
  switch (code) {
    case RECOVERABLE_CLOSE_CODES.SLOW_CONSUMER:
      return { kind: 'connection', text: COPY.errors.slowConnection };
    case RECOVERABLE_CLOSE_CODES.TRY_AGAIN_LATER:
      return { kind: 'connection', text: COPY.errors.serverBusy };
    default:
      return null;
  }
}

/** Errors that are never shown are still logged for whoever opens the console. */
export function logHiddenError(code: ErrorCode, message: string): void {
  console.warn(`[stackerist] ${code}: ${message}`);
}
