// Mutation testing (gate 10a). A green suite is only evidence if it can fail: Stryker mutates the
// source of the modules that carry the rules and the security and checks that the tests notice.
//
// Run ONE target at a time (the vitest projects are per package), from the repo root:
//
//   STRYKER_TARGET=engine   pnpm exec stryker run stryker.config.mjs
//   STRYKER_TARGET=protocol pnpm exec stryker run stryker.config.mjs
//   STRYKER_TARGET=server   pnpm exec stryker run stryker.config.mjs
//
// (PowerShell: `$env:STRYKER_TARGET='engine'; pnpm exec stryker run stryker.config.mjs`.)
// Narrow further with `--mutate "packages/engine/src/board.ts"` (the CLI replaces the list below).
// Output: reports/mutation/<target>/index.html and mutation.json (reports/ is git-ignored);
// the sandbox lives in .stryker-tmp/ (git-ignored, removed after each run).
// The server target mutates the server rules and gates; its integration tests use real WebSockets,
// so it is the slow one (per-test coverage analysis keeps each mutant to the tests that cover it).

const target = process.env.STRYKER_TARGET ?? 'engine';

const targets = {
  engine: {
    dir: 'packages/engine',
    mutate: ['packages/engine/src/{board,srs,player,garbage,bag,rng,simulate,pieces,config}.ts'],
    timeoutMS: 10_000,
  },
  protocol: {
    dir: 'packages/protocol',
    mutate: ['packages/protocol/src/{schemas,views,predict,clock,codes,parse}.ts'],
    timeoutMS: 10_000,
  },
  server: {
    dir: 'apps/server',
    mutate: ['apps/server/src/{match,codes,series,clientIp,http,rateLimit,config}.ts'],
    timeoutMS: 30_000,
  },
};

const t = targets[target];
if (!t) throw new Error(`Unknown STRYKER_TARGET "${target}" (engine | protocol | server)`);

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  // stryker/vitest.<target>.config.mjs = the package's own vitest config, minus tests that read source text.
  vitest: { configFile: `stryker/vitest.${target}.config.mjs`, dir: t.dir },
  mutate: t.mutate,
  coverageAnalysis: 'perTest',
  timeoutMS: t.timeoutMS,
  timeoutFactor: 2,
  concurrency: 4,
  reporters: ['clear-text', 'progress', 'json', 'html'],
  jsonReporter: { fileName: `reports/mutation/${target}/mutation.json` },
  htmlReporter: { fileName: `reports/mutation/${target}/index.html` },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
  thresholds: { high: 90, low: 80, break: null },
};
