/**
 * Robustness (architecture §4.12, REQ-072): one failing message, timer or tick must never take the
 * process (and every live match) down. `safeCall` logs a throw as `handler.error` with no PII and runs
 * the caller's recovery (reply INTERNAL_ERROR, or abort that one room).
 */
import type { EventLog, LogFields } from './log.js';

export function safeCall<T>(
  log: EventLog,
  ctx: LogFields,
  fn: () => T,
  onError?: (err: unknown) => void,
): T | undefined {
  try {
    return fn();
  } catch (err) {
    log.error('handler.error', ctx, err);
    if (onError !== undefined) {
      try {
        onError(err);
      } catch (recoveryErr) {
        log.error('handler.error', ctx, recoveryErr);
      }
    }
    return undefined;
  }
}

/** The slice of `process` the handlers need; tests pass a fake emitter. */
export interface ProcessLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  exit(code?: number): unknown;
}

/**
 * unhandledRejection → log and keep running. uncaughtException → log as fatal and exit(1): continuing
 * after an unknown synchronous throw is unsafe, and Railway restarts on failure (decision 36).
 */
export function installProcessHandlers(log: EventLog, proc: ProcessLike = process): void {
  proc.on('unhandledRejection', (reason: unknown) => {
    log.error('process.unhandledRejection', {}, reason);
  });
  proc.on('uncaughtException', (err: unknown) => {
    try {
      log.fatal('process.uncaughtException', {}, err);
    } finally {
      proc.exit(1);
    }
  });
}
