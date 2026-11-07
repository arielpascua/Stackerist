# Stackerist — Build Ledger

Append-only. One row per gate as it closes: date · gate · verdict · artifact (or path) · reason if NOT RUN.
Verdicts for gates: PASS · FINDINGS · WAIVED · NOT RUN. A gate with no artifact did not run.

## Phase 0–1 (orient, lock the spec)

| Date | Step | Verdict | Artifact / evidence |
|---|---|---|---|
| 2026-11-07 | 1 Recall | PASS | `cdt-recall` ×2. Constraints carried to contracts: (a) wrap every WS/HTTP handler + unhandledRejection logger (2026-09-05); (b) `tsc -b`, never bare `tsc --noEmit` on a references root (2026-09-07); (c) protocol package lands before server/client agents; grep producer/consumer literal strings after each wave; e2e fixtures written against the landed system (Daloy 2026-09-19); (d) geometry probe measures `scrollWidth - clientWidth`, not `innerWidth`; kill orphaned node on Windows by port (Taruuv 2026-10-03). Adaptations: Railway pins `.node-version`, watch patterns include root config, never trust `railway up` exit code (2026-07-12); rate-limit bucket charged once at ingress, no write before gate (ailms 2026-09-11); judge canvas features by measurable state, not stills (2026-09-03). Noise dropped: Supabase realtime/staging, SSO/PKCE. |
| 2026-11-07 | 2 Spec found | PASS | `spec (1).md` (named by Ariel); greenfield repo, no commits. |
| 2026-11-07 | 4 Brainstorm | PASS | Design: `docs/superpowers/specs/2026-11-07-stackerist-design.md` (sha256 prefix `e1bb17d2088b8cb2` at approval). Mockups: `design/concept-art/`. |
| 2026-11-07 | 5 /cdt:spec | PASS | `node …/cdt/1.41.1/toolkit/dist/cli/cdt-spec.js` → 8 artifacts, 78 requirements. Source flagged "sensitive" — false positive (words "contract", "token:", room-code alphabet as high-entropy); artifacts local, regenerable from the design doc. |
| 2026-11-07 | 5a Reconcile | PASS | First run: 82 extracted, ids offset by 4 prose "must/should" lines → reworded, re-run. `reconcile_reqs.py` → `extracted=78 expected=78 aligned_ids=78 RECONCILED` exit 0. Every row carries a source line. OPEN_QUESTIONS.md holds only the sensitivity note; NEEDS_REVIEW count 0. |
| 2026-11-07 | 6 Approval | PASS | Ariel: "approved and implement". Accepted proposed answers Q1 (Node 24), Q3 (flood limits), Q4 (no name filter), Q5 (no sound), Q7 (REFERENCE tetr.io — HUD clarity). Then via question dialog: Q2 = Southeast Asia (Singapore); Q6 = yes, private GitHub repo + push; Q8 = full workflow, every gate. Doc §11 updated; re-extract → 78, RECONCILED exit 0. Builder check was still running at approval: its findings are merged as builder calls, or brought back to Ariel if they change what gets built. |

## Phase 2 — Plan & build

| Date | Step | Verdict | Artifact / evidence |
|---|---|---|---|
| 2026-11-07 | 8 Triage | T3 | 6 domains (engine, protocol, server, client, infra, tests); risk floor: seat tokens + public deploy → full mandate + security veto. `cdt-advise`: T3, ~3 iterations. `cdt-auto fanout T3` → 6. `gate team` DENY (Bug Council = 5 parallel read-only fallback), `gate scale` DENY (stay BOUNDED). |

### 7a Gate roster (per gate-use, live invocations, 2026-11-07)

| Gate-use | Instrument | Status | Evidence |
|---|---|---|---|
| 9 SAST (primary) | `guardian` MCP | **NOT RUN** | `~/.claude/settings.json:164` `"semgrep@claude-plugins-official": false`; no guardian tool loaded in session. |
| 9 SAST (fallback 1) | Semgrep CLI 1.174.0 (pip) | LIVE | `cdt-verify -- …\Python314\Scripts\semgrep.exe --version` → `1.174.0`, `recorded trusted verify event (exitCode=0)`. |
| 9 SAST (fallback 2) | `/security-review` skill | AVAILABLE | listed in session skills; used only if CLI fails. |
| 9 evidence wrapper | `node …/cdt/1.41.1/toolkit/dist/cli/cdt-verify.js` | LIVE | `-- node --version` → `v24.13.0`, `recorded trusted verify event (type=other, exitCode=0)`. Stale `~/.claude/bin/cdt-verify` fails (ERR_MODULE_NOT_FOUND) — never use it. |
| 9a screenshots | Playwright MCP | LIVE | `browser_navigate data:…<title>preflight` 12:47 → title `preflight`; mockup screenshots earlier today. |
| 9a-i blind A/B | Playwright MCP + fresh `cdt:ui-ux-engineer` | LIVE (tool); REFERENCE capture pending Wave 0 | REFERENCE = tetr.io, HUD clarity. |
| 9b design detector | `npx impeccable` 4.8.0 | LIVE | `npx -y impeccable --version` → `4.8.0`. |
| 9d geometry | `@playwright/test` run as a command via cdt-verify | LIVE (runner + browsers); project install pending scaffold | `npx -y playwright@1.56.1 --version` → `Version 1.56.1`; `%LOCALAPPDATA%\ms-playwright` has chromium-1200…1243. Re-prove inside the repo after scaffold. |
| 10 e2e | `@playwright/test` (same) | as 9d | — |
| 10a mutation | Stryker (JS/TS) | rostered at 10a | greenfield: nothing to mutate yet. |
| 9e conformance | `.claude/specs/EXTRACTED_REQUIREMENTS.json` | LIVE | 78 rows, RECONCILED exit 0. |
| 9f deps | `/cdt:deps` | **WRONG INSTRUMENT** | `commands/deps.md`: checks cdt's own prerequisites (python3/git/sqlite3/gh) only — output listed no project packages. Substitute: `cdt-verify -- pnpm install --frozen-lockfile`, `pnpm audit --prod`, `pnpm licenses list` — pending a lockfile (after scaffold). |
| 9f env/migrations | env audit + migration review | N/A migrations (no database); env audit LIVE at gate time | — |
| 2026-11-07 | 6a Builder check | FINDINGS → resolved | Fresh agent read the design cold. 1 owner-level question: top-speed latency (level 12 lands moves 3–5 rows low at 40–60 ms RTT). Ariel chose **smart prediction** (run-ahead + tick-stamped inputs, no rewind). Design §6.1 added; REQ-037/045/054/058/069/071/075/076/077 reworded; REQ-079–082 added (incl. the Q3 flood limits that were approved but had no requirement row). 8 minor items settled as builder calls (design §4). Re-extract → 82, RECONCILED exit 0. |
