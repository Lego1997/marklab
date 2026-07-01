# Codex init prompt — MarkLab for Codex

> Finalized against PRD v0.3 (hardened via reader-tests + a Codex adversarial review).
> **How to use:** open a Codex session, `cd` into the worktree below, paste the fenced block into Codex.
> Adjust the 3 defaults if your answers to the PRD §8 open questions differ.

---

```
You are working in a DEDICATED git worktree on the MarkLab repo. Build a new feature described by a PRD,
using Plan mode → Goal mode → subagents, to a verifiable, test-enforced finish-line.

## Where you are (separate worktree — do ALL work here)
- Worktree: /Users/pan/Library/CloudStorage/GoogleDrive-zhengfan.pan@gmail.com/My Drive/side projects/marklab_obsidian_plugin/.claude/worktrees/codex-plugin
- Branch: `codex-plugin` (tracks `upstream/main`). Do not switch branches or touch other worktrees.

## The contract (read it fully, first)
- PRD: docs/goals/codex-plugin-prd.md  ← source of truth. Read it end to end before doing anything.
- Building: "MarkLab for Codex" — a `.codex-plugin` bundle whose local stdio MCP server wraps the existing
  `marklab` CLI so a Codex agent can safely co-edit LIVE, human-shared Markdown docs (CRDT-converged,
  conflict-safe). The local `.md` file is the ONLY content write-surface; the 7 MCP tools are
  coordination-only (open, share, join, status, wait_synced, conflict, doctor). Direct write verbs are
  forbidden by the CLI. There is intentionally NO save-version tool.

## Setup (do first)
- Enable + verify the features you'll use: `codex features enable goals`; confirm `features.multi_agent` is on
  (`codex features` / config; if a subcommand differs on your version, consult `codex --help`).
- Run with sandbox `workspace-write` + network access (the acceptance tests talk to a control plane).
- PIN EXTERNAL SCHEMAS (PRD §H / M0): the `.codex-plugin/plugin.json` and `.mcp.json` formats drift between
  Codex versions. Before building the bundle, read the current plugin-build docs for THIS CLI
  (codex-cli 0.142.5) and pin working `plugin.json` (uses `name` + `interface.displayName`, `mcpServers`,
  `skills`) and `.mcp.json` (a server MAP: `{ "marklab": { "command":"node", "args":[...] } }`) examples.

## How to work
1. PLAN FIRST (`/plan`): read the PRD, then `apps/cli/marklab.mjs`, `apps/cli/agent-json.mjs`,
   `apps/api/src/routes/import-export-routes.ts`, and `packages/shared`. Verify the PRD's "CLI-contract
   reference" still matches the code (flag drift). Produce a concrete, dependency-ordered plan.
2. USE SUBAGENTS (the "agents team"): an *explorer* to map the CLI/packages; *workers* to implement the 7
   tools and author tests in parallel (PRD §7).
3. ENVELOPE MAPPING (PRD R2/§D): the CLI returns `{ok:true, ...payload}` / `{ok:false, code, message}`. Map to
   the MCP `ToolResult` (`{ok:true,data}` / `{ok:false,error}`) exactly once — don't double-wrap `ok`.
4. TEST-FIRST, TWO TIERS (PRD §6): author fail-first and NEVER edit the tests to pass.
   - CI tier (deterministic): test:mcp-registration, test:roundtrip-unit (AC2a), test:conflict-surface (AC3a),
     test:share-join, scope-gate, typecheck+vitest.
   - REAL tier (the actual safety proof): test:roundtrip-e2e (AC2b) — with the real app (or a faithful headless
     Y-Sweet client) running and a SECOND collaborator making a concurrent edit, prove disk AND export.md
     contain BOTH the human sentinel and the Codex sentinel (real CRDT merge, zero data-loss). And
     test:conflict-stop-e2e (AC3b) — a scripted run down the Skill/goal path, given an injected conflict, must
     make ZERO writes to the file (write-guard). STOP lives in SKILL.md, not in any single tool.
5. STAY IN BOUNDS (PRD §E): never touch provider/auth/schema/WebView, `apps/cli/marklab.mjs` behavior, or the
   Swift app; add no content-write tool; never log/persist secrets, tokens, or FULL share URLs (the share tool
   returns ids + a REDACTED url by default); build any artifacts only in `/tmp`; do NOT commit/push unless
   asked; no Fly deploys; never send real share invites/links. Adding `@modelcontextprotocol/sdk` + local
   build/test deps WITHIN `apps/codex-plugin/**` is PRE-AUTHORIZED — no need to ask.
6. CAVEATS: `marklab doctor` is NOT read-only (temp-write + `/healthz` fetch) — set
   `MARKLAB_DOCTOR_SKIP_NETWORK=1` in tests and treat it as approval-gated. `MARKLAB_NO_OPEN=true` suppresses
   app launch — use it for UNIT tests only, never for the AC2b E2E. Inject conflicts using the EXACT filename
   algorithm (base64 of the resolved path, `/`→`_`, `+`→`-`, `=` stripped) via a shared helper.
7. DEFAULTS for the PRD's 3 open decisions (unless Pan overrides): (a) run AC2b/AC4 against a LOCAL `apps/api`
   with auth disabled (deterministic, offline); (b) MVP requires explicit absolute file paths (no discovery
   tool); (c) treat the SLO (p50 ≤ 3s / p95 ≤ 10s) as provisional — measure real numbers and report; change
   only with Pan's OK.

## The goal (finish-line) — after planning, set it:
/goal Build the MarkLab-for-Codex plugin exactly per docs/goals/codex-plugin-prd.md. Do not stop until the
Definition of Done in §6 is met: the CI tier is green — `pnpm --filter @marklab/codex-plugin
test:mcp-registration` (7 tools), test:roundtrip-unit (AC2a), test:conflict-surface (AC3a), test:share-join,
the scope-gate, `npx -y pnpm@10.0.0 typecheck` = 0, and `npx -y pnpm@10.0.0 test` green with no regressions —
AND the real safety tier is demonstrated with recorded evidence: test:roundtrip-e2e (AC2b — a concurrent human
edit and the Codex edit BOTH survive on disk and in export.md within the SLO) and test:conflict-stop-e2e
(AC3b — zero writes through the skill path after an injected conflict). Author AC2/AC3 tests fail-first and
never edit them. Stay within the PRD boundaries; do not commit, push, or deploy.

## When you believe you're done
- Self-check: enumerate PRD R1–R9 / NFR1–NFR7 / AC1–AC6 and list anything not addressed; continue if any remain.
- Summarize what you built, exact test results (incl. measured convergence latency and the AC2b/AC3b evidence),
  and any deviations/assumptions. Do not commit unless Pan explicitly asks.
```

---

**Notes for Pan (not part of the paste):**
- The `/goal` objective points at the PRD file (Codex reads it for the rest), matching the documented `/goal` pattern.
- If Codex isn't logged in, run `codex login` (or set the API key) first.
- The biggest honest caveat: **AC2b (real convergence) needs the macOS app or a headless Y-Sweet client**, so it isn't CI-friendly — it runs manually/nightly on a Mac until the post-MVP headless client lands. Everything else is CI-enforceable.
