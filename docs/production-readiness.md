# Production readiness (gate 9f)

Written 2026-11-11 for the first deploy to Railway (Singapore), and updated the same day after it. The service was deployed from commit `9271b12`; the results are in the "First deploy results" section. Each row says what was checked, how, and what is still open.

| Area | Status | What was checked | Open or weak |
| --- | --- | --- | --- |
| Observability | OK for a small game | The server writes one JSON log line per domain event to stdout (pino): room created, joined, rejoined, closed, match started and ended, connection closed with its code, rate-limit refusals, errors. Railway keeps these logs. Request logging is off, and tests check that no seat token, name or IP address is logged. `LOG_LEVEL` sets the level (default `info`). | There is no metrics endpoint, tracing or alerting. `/healthz` returns `{"ok":true}`, so it proves the process answers, not that the game loop is healthy. |
| Configuration and secrets | OK | The server reads six environment variables: `PORT` (default 3000), `HOST` (default `0.0.0.0`), `NODE_ENV` (the image sets `production`, which turns on the strict style policy and the `X-Real-IP` client-address source), `CLIENT_IP_SOURCE`, `TRUSTED_PROXY_HOPS`, `LOG_LEVEL`. There are no secrets, keys, accounts or database URLs, so nothing to leak or rotate. | Per-IP limits only work if Railway overwrites `X-Real-IP` on the WebSocket route. This is checked after deploy (see the first-deploy checklist in the README). |
| Data and migrations | Not applicable | There is no database and no stored player data. Rooms live in memory in one process. | A restart or a deploy ends every running match. Deploy when nobody is playing. |
| Dependencies | OK | `pnpm audit --prod`: no known vulnerabilities. The full audit shows 5 moderate advisories, all in dev tools (`qs` under Stryker, `minimatch` under ESLint) that are not in the production image, which installs production dependencies only. 86 production packages, all permissive licenses (MIT, ISC, BSD-3-Clause, BlueOak-1.0.0, and OFL-1.1 for the two self-hosted fonts). The lockfile is committed and both the Dockerfile and CI install with `--frozen-lockfile`. | The 5 dev advisories stay until their tools update. |
| Performance | Partly measured | One running match used about 1 to 4 % of one core when the machine was quiet, with the loop at 60.0 ticks per second and snapshots of 1,734 bytes (budget 2,048). Latency harness: at 150 ms round trip, 12 of 12 shown landings equalled the server's. | The CPU test failed 3 of 11 runs on this busy development machine (see `docs/conformance.md`, REQ-068). On Railway a 70 second two-player match held 60.0 ticks per second with snapshots of at most 1,739 bytes, but the CPU percentage there has **not** been measured: read the service's CPU graph in the Railway dashboard during a match. One replica serves everything: the global caps are 500 rooms and 2,000 sockets. |
| Failure handling | OK | An error in one request or one room cannot crash the process (error handler, `stepSafely` per room). `SIGTERM` and `SIGINT` close the server cleanly. Slow readers are cut off at a 512 KB send buffer. Railway restarts on failure (up to 10 times) and checks `/healthz` with a 120 s timeout. | A server stall of about 600 ms or more can make inputs bounce for a few seconds (known limitation in the README). |
| Security | Reviewed twice | Independent security review with a veto: first pass vetoed on two findings (unbounded send buffer, room-cap exhaustion), both fixed and re-attacked with the reviewer's own scripts; the veto was lifted with conditions. A regex denial-of-service that one of the fixes introduced was found before any deploy and fixed (see the ledger). | The deploy conditions were checked on the live service (see below): `X-Real-IP` is overwritten, `Host` is preserved; IPv6 could not be tested. |
| Rollback | Simple | There are no migrations, so rollback is safe: redeploy the previous deployment from the Railway dashboard (or redeploy the previous commit). Players in a match are disconnected during either direction of a deploy. | None. |

## First deploy results (2026-11-11)

| Check | Result |
| --- | --- |
| Build and start | Railway deployment status went `BUILDING` then `SUCCESS` in about a minute, on the first build of this `Dockerfile`. The container logged `server.listening`. |
| Region | The deployment manifest shows `asia-southeast1-eqsg3a` with 1 replica; responses carry the `sin1` edge. |
| Health and headers | `/healthz` returns `{"ok":true}` with `no-store`. The strict production policy is served (`style-src 'self'`, no inline styles), plus `nosniff` and `no-referrer`. The JS, CSS, all self-hosted fonts and the art return 200 with the right content types. |
| `X-Real-IP` | Passed. Eight creates, each with a different made-up `X-Real-IP`: six rooms created, the seventh and later refused with `CREATE_LIMIT`. Railway overwrites the header. |
| `Host` header | Passed. The policy's `connect-src` names the public host, and a same-origin WebSocket create works while a foreign `Origin` gets 403. |
| Live match | Two scripted players played 70 seconds over `wss://`: 60.0 ticks per second, 1,122 inputs, no errors, snapshots at most 1,739 bytes. |
| Malformed URL | `/g/%` returns Railway's plain 502 "upstream error" from its edge, not our page. The app logged nothing and stayed healthy; the same URL on a local production server returns our 400 page. Minor, and not fixable in the app. |
| IPv6 | Not testable: the Railway domain has no IPv6 address. The `/64` keying is covered by unit tests only. |

## What has not been verified

- The CPU percentage of one running match on the host (no container shell or metrics access in the deploying session). Read the CPU graph in the Railway dashboard while a match runs.
- Two people on different networks playing a full match on the deployed URL (REQ-076).
- The Singapore region id was checked against Railway's documentation and the deployment manifest, not against the dashboard's region picker.
