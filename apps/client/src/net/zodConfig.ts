/**
 * Turns zod's JIT off for the client. zod 4 probes for `eval` with `new Function('')` when it builds an
 * object schema; the strict production Content-Security-Policy (no `unsafe-eval`) reports that probe as
 * a `securitypolicyviolation`, once per page load, although zod falls back and nothing breaks.
 *
 * The probe runs while the protocol package builds its schemas, so `main.tsx` imports this module
 * first: it must evaluate before anything that imports `@stackerist/protocol`.
 */
import { config } from 'zod';

config({ jitless: true });
