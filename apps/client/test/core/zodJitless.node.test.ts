/**
 * REQ-021: the client turns zod's JIT off before the protocol builds its schemas. zod 4 probes for
 * `eval` with `new Function('')` when it builds an object schema; the strict production
 * Content-Security-Policy reports that probe as a `securitypolicyviolation` (one per page load) even
 * though zod falls back. This file runs in its own worker, so the module graph starts empty: the probe
 * count below is the real one for "client start-up, then the first parsed message".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('REQ-021 zod runs jitless on the client, so the CSP sees no Function probe', () => {
  it('REQ-021 start-up plus a parsed server message never calls new Function("")', async () => {
    const original = globalThis.Function;
    let probes = 0;
    globalThis.Function = new Proxy(original, {
      construct(target, args: unknown[], newTarget) {
        if (args.length === 1 && args[0] === '') probes += 1;
        return Reflect.construct(target, args, newTarget) as object;
      },
    });
    try {
      await import('../../src/net/zodConfig.ts');
      const { parseServerMessage } = await import('@stackerist/protocol');
      const parsed = parseServerMessage(JSON.stringify({ type: 'ping', t: 1, rtt: null }));
      expect(parsed).not.toBeNull();
    } finally {
      globalThis.Function = original;
    }
    expect(probes).toBe(0);
  });

  it('REQ-021 the entry point imports the config before anything that builds the protocol schemas', () => {
    const entry = readFileSync(
      fileURLToPath(new URL('../../src/main.tsx', import.meta.url)),
      'utf8',
    );
    const imports = [...entry.matchAll(/^import (?:.* from )?'([^']+)';$/gm)].map(
      (match) => match[1],
    );
    const config = imports.indexOf('./net/zodConfig.ts');
    expect(config).toBeGreaterThanOrEqual(0);
    expect(imports.slice(0, config).filter((spec) => !spec?.endsWith('.css'))).toEqual([]);
  });
});
