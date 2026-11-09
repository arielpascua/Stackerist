import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  ROOT,
  asArray,
  asRecord,
  asString,
  copyInstructions,
  dockerignoreMatcher,
  listFiles,
  parseDockerfile,
  parseYaml,
  readJson,
  readText,
} from './helpers.ts';

// Everything below parses the REAL files (JSON.parse, a Dockerfile/.dockerignore parser, a YAML
// reader, the TypeScript compiler API). Nothing is asserted by grepping raw text, so a comment
// or a string literal cannot satisfy a check.

const pkg = asRecord(readJson('package.json'), 'package.json');
const scripts = asRecord(pkg.scripts, 'package.json scripts');
const startScript = asString(scripts.start, 'scripts.start');
const dockerfile = parseDockerfile(readText('Dockerfile'));
const railway = asRecord(readJson('railway.json'), 'railway.json');
const railwayBuild = asRecord(railway.build, 'railway.json build');
const railwayDeploy = asRecord(railway.deploy, 'railway.json deploy');
const watchPatterns = asArray(railwayBuild.watchPatterns, 'watchPatterns');
const included = dockerignoreMatcher(readText('.dockerignore'));

/** `NODE >=24` pin shared by .node-version and engines (Railway/Railpack defaults to Node 20). */
const NODE_24_ALPINE = /^node:24(\.\d+){0,2}-alpine(\d+(\.\d+)*)?$/;

function parseSource(rel: string): ts.SourceFile {
  return ts.createSourceFile(rel, readText(rel), ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
}

/** Calls of `callee(<single argument text>)` anywhere in the file (real call expressions only). */
function callsOf(sf: ts.SourceFile, callee: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === callee
    ) {
      found.push(node.arguments.map((a) => a.getText(sf)).join(', '));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Runs `DEFAULT_PORT` + `resolvePort` from the server's config.ts in a bare VM context. */
function loadResolvePort(): (raw: string | undefined) => number {
  const sf = parseSource('apps/server/src/config.ts');
  const wanted = sf.statements.filter((s) => {
    if (ts.isFunctionDeclaration(s)) return s.name?.text === 'resolvePort';
    if (ts.isVariableStatement(s)) {
      return s.declarationList.declarations.some(
        (d) => ts.isIdentifier(d.name) && d.name.text === 'DEFAULT_PORT',
      );
    }
    return false;
  });
  expect(wanted).toHaveLength(2);
  const js = ts.transpileModule(wanted.map((s) => s.getText(sf)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText;
  const sandbox = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(js, sandbox);
  const fn = sandbox.exports.resolvePort;
  if (typeof fn !== 'function') throw new Error('resolvePort was not exported');
  return fn as (raw: string | undefined) => number;
}

function startEntry(): string {
  const tokens = startScript.split(/\s+/);
  expect(tokens[0]).toBe('node');
  return asString(tokens[1], 'start entry');
}

describe('REQ-074 root scripts', () => {
  it('REQ-074 defines dev, test, typecheck, lint, build, start and e2e', () => {
    for (const name of ['dev', 'test', 'typecheck', 'lint', 'build', 'start', 'e2e']) {
      const value = scripts[name];
      expect(typeof value === 'string' && value.trim() !== '', `script "${name}"`).toBe(true);
    }
  });

  it('REQ-074 start is one plain node process on the built server (a single production port)', () => {
    // No process manager, no chained commands: exactly `node <entry>`.
    expect(startScript.split(/\s+/)).toHaveLength(2);
    expect(startScript).not.toMatch(/&|;|\||concurrently|pnpm/);
    const entry = startEntry();
    expect(entry).toBe('apps/server/dist/index.js');
    // The entry is the build output of the server's own source entry and its own start script.
    const serverPkg = asRecord(readJson('apps/server/package.json'), 'apps/server/package.json');
    const serverStart = asString(asRecord(serverPkg.scripts, 'server scripts').start, 'start');
    expect(serverStart).toBe('node dist/index.js');
    expect(listFiles('apps/server/src')).toContain('apps/server/src/index.ts');
  });

  it('REQ-074 the server reads PORT, defaulting to 3000', () => {
    const resolvePort = loadResolvePort();
    expect(resolvePort(undefined)).toBe(3000);
    expect(resolvePort('')).toBe(3000);
    expect(resolvePort('8080')).toBe(8080);
    expect(() => resolvePort('not-a-port')).toThrow();
    // The process entry and the server factory both feed process.env.PORT into resolvePort.
    expect(callsOf(parseSource('apps/server/src/index.ts'), 'resolvePort')).toContain(
      'process.env.PORT',
    );
    expect(callsOf(parseSource('apps/server/src/server.ts'), 'resolvePort')).toContain(
      'process.env.PORT',
    );
  });
});

describe('REQ-075 Dockerfile and railway.json', () => {
  it('REQ-075 Dockerfile is multi-stage on a Node 24 Alpine image', () => {
    const { stages } = dockerfile;
    expect(stages.length).toBeGreaterThanOrEqual(2);
    const stageNames = new Set(stages.flatMap((s) => (s.name === null ? [] : [s.name])));
    const externalBases = stages.filter((s) => !stageNames.has(s.from));
    expect(externalBases.length).toBeGreaterThanOrEqual(2);
    for (const s of externalBases)
      expect(s.from, `stage ${s.name ?? s.index}`).toMatch(NODE_24_ALPINE);

    // The final stage is a fresh Node image that only receives artifacts from earlier stages.
    const last = stages.at(-1);
    expect(last).toBeDefined();
    expect(last?.from).toMatch(NODE_24_ALPINE);
    const finalOps = dockerfile.instructions.filter((i) => i.stage === last?.index);
    expect(finalOps.some((i) => i.op === 'COPY' && i.args.startsWith('--from='))).toBe(true);
    const finalRuns = finalOps.filter((i) => i.op === 'RUN').map((i) => i.args);
    expect(finalRuns.filter((r) => /pnpm|corepack|npm/.test(r))).toEqual([]);
    expect(finalOps.find((i) => i.op === 'USER')?.args).toBe('node');
  });

  it('REQ-075 the image starts the same server entry as `pnpm start`, signal-safe (no pnpm wrapper)', () => {
    const cmd = dockerfile.instructions.filter((i) => i.op === 'CMD').at(-1);
    expect(cmd).toBeDefined();
    const argv: unknown = JSON.parse(cmd?.args ?? 'null');
    expect(argv).toEqual(['node', startEntry()]);
  });

  it('REQ-075 pins Node 24 in .node-version and engines (Railpack would default to 20)', () => {
    expect(readText('.node-version').trim()).toMatch(/^24(\.\d+){0,2}$/);
    const engines = asRecord(pkg.engines, 'package.json engines');
    expect(asString(engines.node, 'engines.node')).toMatch(/^>=24(\.\d+){0,2} <25$/);
  });

  it('REQ-075 railway.json builds from the Dockerfile with a /healthz health check', () => {
    expect(railwayBuild.builder).toBe('DOCKERFILE');
    const dockerfilePath = asString(railwayBuild.dockerfilePath, 'dockerfilePath');
    expect(readFileSync(path.join(ROOT, dockerfilePath), 'utf8')).toBe(readText('Dockerfile'));
    expect(railwayDeploy.healthcheckPath).toBe('/healthz');
    expect(railwayDeploy.healthcheckTimeout).toEqual(expect.any(Number));
  });

  it('REQ-075 railway.json watchPatterns cover the root config files and the design inputs', () => {
    // Root config files must be watched, or a config-only commit deploys nothing.
    const required = [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'Dockerfile',
      'railway.json',
      '.node-version',
      'design/tokens/**',
      'design/assets/**',
    ];
    for (const pattern of required) expect(watchPatterns, pattern).toContain(pattern);
    // Plain (non-glob) entries must name files that really exist.
    for (const p of watchPatterns) {
      const pattern = asString(p, 'watch pattern');
      if (!pattern.includes('*')) expect(existsSync(path.join(ROOT, pattern)), pattern).toBe(true);
    }
  });

  it('REQ-075 the Docker build context keeps design tokens and assets, and nothing else from design/', () => {
    for (const file of [...listFiles('design/tokens'), ...listFiles('design/assets')]) {
      expect(included(file), file).toBe(true);
    }
    const sources = [...listFiles('design/concept-art'), ...listFiles('design/reference')];
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) expect(included(file), file).toBe(false);
    expect(included('design/DESIGN.md')).toBe(false);
    // Secrets and heavy directories never reach the context.
    for (const file of [
      '.env',
      '.env.production',
      'node_modules/x/index.js',
      '.git/HEAD',
      'e2e/smoke.spec.ts',
    ]) {
      expect(included(file), file).toBe(false);
    }
    // Everything the Docker build needs is still sent.
    for (const file of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.node-version',
      'tsconfig.base.json',
      'tsconfig.build.json',
    ]) {
      expect(included(file), file).toBe(true);
    }
  });

  it('REQ-075 every design/ file the client imports reaches the Dockerfile build stage', () => {
    // Real import specifiers from apps/client/src that resolve into design/.
    const imported = new Set<string>();
    const specifier = /(?:from\s+|import\s*\(?\s*)['"]([^'"]+)['"]/g;
    for (const file of listFiles('apps/client/src').filter((f) => /\.(ts|tsx)$/.test(f))) {
      for (const m of readText(file).matchAll(specifier)) {
        const spec = (m[1] ?? '').replace(/[?#].*$/, '');
        if (!spec.startsWith('.')) continue;
        const rel = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
        if (rel.startsWith('design/')) imported.add(rel);
      }
    }
    expect(imported.size, 'the client imports design/tokens').toBeGreaterThan(0);

    const buildRun = dockerfile.instructions.findIndex(
      (i) => i.op === 'RUN' && /(^|&&\s*)pnpm build(\s|$)/.test(i.args),
    );
    expect(buildRun).toBeGreaterThanOrEqual(0);
    const buildStage = dockerfile.instructions[buildRun]?.stage;
    const copiedBeforeBuild = copyInstructions(dockerfile)
      .filter((c) => c.stage === buildStage && c.from === null && c.order < buildRun)
      .flatMap((c) => c.sources.map((s) => s.replace(/\/+$/, '')));

    for (const file of imported) {
      expect(included(file), `${file} is in the build context`).toBe(true);
      const covered = copiedBeforeBuild.some((src) => file === src || file.startsWith(`${src}/`));
      expect(covered, `${file} is COPY'd before RUN pnpm build`).toBe(true);
    }

    // The runtime stage carries no design sources: built assets live in apps/client/dist.
    const lastStage = dockerfile.stages.at(-1)?.index;
    const runtimeCopies = copyInstructions(dockerfile).filter((c) => c.stage === lastStage);
    for (const c of runtimeCopies) {
      for (const src of c.sources)
        expect(src, `runtime COPY ${src}`).not.toMatch(/(^|\/)design(\/|$)/);
    }
    const fromBuild = runtimeCopies.filter((c) => c.from !== null).flatMap((c) => c.sources);
    expect(fromBuild).toContain('/app/apps/server/dist/');
    expect(fromBuild).toContain('/app/apps/client/dist/');
  });
});

describe('REQ-076 region', () => {
  it('REQ-076 railway.json pins the Southeast Asia (Singapore) region id from the Railway docs', () => {
    // docs.railway.com/reference/deployment-regions: "Southeast Asia Metal | Singapore |
    // asia-southeast1-eqsg3a". The deployed region must also be confirmed in Railway's status.
    const regions = asRecord(railwayDeploy.multiRegionConfig, 'multiRegionConfig');
    expect(Object.keys(regions)).toEqual(['asia-southeast1-eqsg3a']);
    expect(asRecord(regions['asia-southeast1-eqsg3a'], 'region').numReplicas).toBe(1);
  });
});

describe('REQ-077 CI workflow', () => {
  const workflow = asRecord(parseYaml(readText('.github/workflows/ci.yml')), 'ci.yml');
  const jobs = asRecord(workflow.jobs, 'jobs');

  interface Step {
    readonly job: string;
    readonly index: number;
    readonly run: string | null;
    readonly raw: Record<string, unknown>;
  }
  const steps: Step[] = Object.entries(jobs).flatMap(([job, def]) =>
    asArray(asRecord(def, `job ${job}`).steps, `${job}.steps`).map((s, index) => {
      const raw = asRecord(s, `${job} step ${index}`);
      return { job, index, run: typeof raw.run === 'string' ? raw.run.trim() : null, raw };
    }),
  );
  const findRun = (re: RegExp): Step => {
    const hit = steps.find((s) => s.run !== null && re.test(s.run));
    if (hit === undefined) throw new Error(`no CI step runs ${String(re)}`);
    return hit;
  };

  it('REQ-077 runs on push and pull_request', () => {
    const on = workflow.on;
    const events = Array.isArray(on) ? on : Object.keys(asRecord(on, 'on'));
    expect(events).toEqual(expect.arrayContaining(['push', 'pull_request']));
  });

  it('REQ-077 runs typecheck, lint and test after a frozen-lockfile install, none of them skippable', () => {
    const install = findRun(/^pnpm install --frozen-lockfile$/);
    const gates = [
      { script: 'typecheck', step: findRun(/^pnpm (run )?typecheck$/) },
      { script: 'lint', step: findRun(/^pnpm (run )?lint$/) },
      { script: 'test', step: findRun(/^pnpm (run )?test$/) },
    ];
    for (const { script, step } of gates) {
      expect(scripts[script], `package.json script ${script}`).toEqual(expect.any(String));
      expect(step.job).toBe(install.job);
      expect(step.index).toBeGreaterThan(install.index);
      // Not weakened: no condition, no continue-on-error.
      expect(step.raw.if, `${script} has an if:`).toBeUndefined();
      expect(step.raw['continue-on-error'], `${script} continue-on-error`).not.toBe(true);
    }
    // And the job itself must not be allowed to fail.
    const job = asRecord(jobs[install.job], 'job');
    expect(job['continue-on-error']).not.toBe(true);
    expect(job.if).toBeUndefined();
  });

  it('REQ-077 also runs engine coverage (REQ-067 gate) and the production build', () => {
    for (const [name, re] of [
      ['test:coverage', /^pnpm (run )?test:coverage$/],
      ['build', /^pnpm (run )?build$/],
    ] as const) {
      const step = findRun(re);
      expect(scripts[name], `package.json script ${name}`).toEqual(expect.any(String));
      expect(step.raw.if).toBeUndefined();
      expect(step.raw['continue-on-error']).not.toBe(true);
    }
  });

  it('REQ-077 the YAML reader sees real structure, not comments', () => {
    const parsed = asRecord(
      parseYaml(
        '# run: pnpm typecheck\njobs:\n  a:\n    steps:\n      - name: x\n        run: echo hi # pnpm lint\n',
      ),
      'sample',
    );
    const a = asRecord(asRecord(parsed.jobs, 'jobs').a, 'a');
    expect(asArray(a.steps, 'steps')).toEqual([{ name: 'x', run: 'echo hi' }]);
  });
});
