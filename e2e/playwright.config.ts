import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * Asks the OS for a free TCP port. Runs synchronously in a child Node process because the
 * config is evaluated synchronously. The port is stored in E2E_PORT so the worker processes
 * (which re-load this file and inherit the env) agree with the runner on the same port.
 */
function findFreePort(): number {
  const script =
    "const s=require('node:net').createServer();" +
    "s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close();});";
  return Number(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }));
}

process.env.E2E_PORT ??= String(findFreePort());
const port = Number(process.env.E2E_PORT);
const baseURL = `http://127.0.0.1:${port}`;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // The production server (`pnpm build` output) on its own free port; `pnpm e2e` builds first.
  webServer: {
    command: 'node apps/server/dist/index.js',
    cwd: repoRoot,
    url: `${baseURL}/healthz`,
    env: { PORT: String(port), HOST: '127.0.0.1' },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
