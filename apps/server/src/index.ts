/**
 * @stackerist/server entry (architecture §4.1): env → createServer → listen. Process handlers log
 * unhandled rejections and exit on an uncaught exception; SIGINT/SIGTERM close the server cleanly.
 */
import { realClock } from './clock.js';
import { resolvePort } from './config.js';
import { createLogger, EventLog } from './log.js';
import { installProcessHandlers } from './safe.js';
import { createServer } from './server.js';

export { DEFAULT_PORT, DEFAULT_LIMITS, resolvePort, type Limits } from './config.js';
export {
  createServer,
  defaultHoleRngFactory,
  type MatchSeeds,
  type RoomInspection,
  type SeatInspection,
  type ServerOptions,
  type StackeristServer,
  type TestControls,
  type TestOptions,
} from './server.js';
export { ManualClock, realClock, type Clock, type TimerId } from './clock.js';
export { clientIpConfigFromEnv, resolveClientIp, type ClientIpConfig } from './clientIp.js';
export { createLogger, EventLog } from './log.js';

async function main(): Promise<void> {
  const logger = createLogger();
  const log = new EventLog(logger, realClock);
  installProcessHandlers(log);
  const server = await createServer({ logger, port: resolvePort(process.env.PORT) });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      server.close().then(
        () => process.exit(0),
        (err: unknown) => {
          log.error('handler.error', {}, err);
          process.exit(1);
        },
      );
    });
  }

  await server.listen();
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
