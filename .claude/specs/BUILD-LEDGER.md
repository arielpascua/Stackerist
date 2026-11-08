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
| 2026-11-07 | 5a Spec change | PASS | Ariel added signature features (duel identity, music, post-match report, best-of-3 series; name stays Stackerist). Design §5.6, §5.7, §6.2 added; REQ-032/045/050/059 reworded; REQ-083–092 added. Re-extract → 92, `RECONCILED` exit 0. Wave 0 architect + ui-ux briefed via message mid-run. |

### Wave 0 results

| Date | Item | Verdict | Artifact / evidence |
|---|---|---|---|
| 2026-11-07 | Design system (ui-ux) | PASS | Commit `0bd04b3`, merged `473f22c`. DESIGN.md (967 lines), PRODUCT.md, tokens.css/ts, optimized art. Orchestrator re-ran DESIGN.md token check → `184 refs missing: none · 108 CSS_VARS mismatches: none · 11 reduced-motion mismatches: none` exit 0. Logo: 1469×301 RGBA, corner alpha 0 (viewed). CVD min ΔE00: normal 19.49 · protan 11.51 · deutan 10.60 · tritan 10.38 (L adjusted `#00B3A4`→`#12978A`, tritan T/L collision). Contrast min text 4.59. |
| 2026-11-07 | Garbage contrast exception | FINDINGS → fixed | 1.94:1 vs well. Orchestrator call: fill `#776A5D` (3.74:1), stripe `#6A5E52` (3.12:1), commit `2e63f00`; token check exit 0 after. Owner can revert. |
| 2026-11-07 | Approved-look deviations (ui-ux) | NOTED for 9a | Game backdrop darkened to a flat 0.84 overlay (HUD labels were 1.09:1 over floodlights); display font has no italic → −12° synthetic slant. Home screen keeps the atmospheric backdrop. |
| 2026-11-07 | REFERENCE capture (9a-i input) | PENDING (owner) | Headless Chromium refused by tetr.io (`design/reference/tetrio-headless-blocked.png`); Playwright MCP reached the landing page only — the HUD needs "JOIN", which creates a guest account and accepts tetr.io's ToS/Rules: not done on the owner's behalf. About page has no media. Ask Ariel for one match screenshot. |
| 2026-11-07 | Scaffold (devops) | PASS | Commit `3e4c8e3`, merged `43a8ced`. Agent evidence: frozen install 0; `tsc -b` 0 with planted-error red proof (exit 2) in engine and client; lint 0 with red proof; tests 6/6; engine coverage threshold red proof; build 0; start → /healthz 200, `/g/%` 400 and server survives; Playwright 1.63.0 → chromium-1243. Orchestrator re-ran in main checkout via cdt-verify: install 0 · typecheck 0 · test 0 (6/6) · coverage 0 · build 0 · **lint 1** (DESIGN.md not prettier-ignored after merge) → fixed in `8cb96c6`, re-run lint 0. |
| 2026-11-07 | Docker build | **NOT RUN** | Docker not installed on this machine; stage replay by hand was green. First real Alpine build = first Railway deploy. |
| 2026-11-07 | 8b-ii impeccable hook | **NOT INSTALLED (owner consent)** | `impeccable install` registers SessionStart + PostToolUse(Edit\|Write) detector + Stop "Design deep pass" (30 s) hooks in `.claude/settings.local.json`. A config change the agent correctly didn't make on its own. Substitute instrument: every UI contract runs `.claude/skills/impeccable/scripts/impeccable detect <paths>` before reporting. Owner may enable: `npx -y impeccable install --project --providers=claude --yes --force`. |
| 2026-11-07 | context7 | UNAVAILABLE | MCP server requires authentication in this non-interactive session. Library grounding falls back to installed type definitions in node_modules + npm registry metadata. |
| 2026-11-08 | Architect | INTERRUPTED | Hit the account's 5-hour usage limit before writing `docs/architecture.md`; resumed via message (context saved). |
| 2026-11-08 | GitHub + first CI | PASS | Owner chose to keep the existing **public** repo `arielpascua/Stackerist` (was empty). Secret scan of tracked files: 0 matches. Pushed `main` (2ee3a39) and `build/v1` (498d193). CI run 42474337173 (Linux): install --frozen-lockfile, `tsc -b`, ESLint+Prettier, tests, engine coverage ≥90%, build — all `success`. |
| 2026-11-08 | Architecture (architect) | PASS | `docs/architecture.md` (1,815 lines), commit `3f7105a`. Orchestrator re-parsed §7.2: owned 92, missing [], duplicates {} (ENG 22 · PRO 2 · SRV 34 · CORE 8 · UI 16 · QA 4 · OPS 5 · DOC 1). Library claims grounded in installed d.ts (context7 unavailable). |
| 2026-11-08 | Open questions | RESOLVED | Orchestrator: OQ-1 yes (Δ1), OQ-2 accept (server series in W2), one SRV agent. Ariel: 8-spectator cap (REQ-062), 2-min hold then series forfeit between rounds (REQ-034), 200-drop limit per series (REQ-038), own-board-only clear flash. Re-extract 92, RECONCILED. |
| 2026-11-08 | Δ1 protocol→engine | PASS | `2d01ced`. Lockfile +3 lines (`link:../engine` only). cdt-verify: typecheck 0 · lint 0 · test 0 (6/6). |
| 2026-11-08 | W1a engine checkpoint | PASS | `47f9bbb`. types.ts/config.ts verbatim from §2.2–2.3 (+2 documented one-line bodies). cdt-verify: typecheck 0 · lint 0 · test 0. |
| 2026-11-08 | W1b dispatched | RUNNING | ENG (`packages/engine/**`, REQ-001–019, 063, 064, 067) ∥ PRO (`packages/protocol/{src,test}`, REQ-036, 045; predict.ts deferred to W1c after ENG merges). Separate worktrees from `47f9bbb`. Contracts carry recall constraints: frozen checkpoint, one-definition literals, canonicalize codes/names in the schema, round-trip tests through real schemas, REQ id in every test name. |
| 2026-11-08 | Δ2 Docker context | OPEN (high) | `.dockerignore` excludes `design/` which the client imports → Railway build would fail. Scheduled OPS W3, before first deploy. |
