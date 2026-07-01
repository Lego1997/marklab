# PRD — MarkLab for Codex (Bridge Plugin)

> **Owner:** Pan · **Status:** Draft v0.3 (hardened via reader-tests + a Codex adversarial review) · **Date:** 2026-07-01
> **Worktree:** `.claude/worktrees/codex-plugin` · **Branch:** `codex-plugin` → tracks `upstream/main` (`marklab-org/marklab` @ `e0b941d`)
> **Grounding:** every factual claim traces to actual `upstream/main` code (file:line in §CLI-contract), not the stale `docs/goals/spec.md`. Survived a read-only Codex red-team (9 findings folded in).
> **Related (present on this branch):** [`docs/agent/marklab-agent-guide.md`](../agent/marklab-agent-guide.md) · [`docs/agent/marklab-codex-instructions.md`](../agent/marklab-codex-instructions.md)

## How to read this document

Dual-purpose: (1) a human PRD, and (2) an **agent-executable spec** — the Acceptance Criteria (§6) + the
Agent-execution appendix (§A–§H) are written so Codex's **`/goal`** can be pointed at this file and run to a
verifiable stopping condition, optionally fanning work to **subagents**.

**Codex terminology — grounded against live Codex docs (mid-2026), use the *real* names:**

| Common shorthand | Real Codex feature (use this) |
|---|---|
| "Codex plugin" | ✅ Real — a `.codex-plugin/plugin.json` bundle that packages skills, hooks, and a **local MCP server** (via `.mcp.json`); installed via `/plugins` + git marketplaces (public directory "coming soon"). **Pin exact manifest fields from the installed version's docs — see §H.** |
| "`/go`" | ❌ Not a command. The feature is **`/goal`** (flag `features.goals`) — a persisted long-running objective pointed at a spec file, run to a verifiable end-state. |
| "Agents team" | ⚠️ **Subagents** (flag `features.multi_agent`; roles `default`/`worker`/`explorer`). User-initiated; no autonomous "team" object. |

---

## 1. Problem / Why

Codex is excellent at editing local files — but Markdown authoring is increasingly **live and shared**:
humans co-edit the same doc from a browser or the native app in real time. When an AI agent edits a `.md`
that is *also* being edited live, the file is a last-writer-wins surface: the agent can silently clobber
concurrent human edits, with **no conflict-safety, no presence, no shareable link**.

MarkLab already solves this **for humans**. The canonical document is a plain `.md` on disk; the native
macOS app (the collaboration engine) plus a **Y-Sweet (Yjs) CRDT** backend add live co-editing, share links,
version checkpoints, and conflict review. Crucially, MarkLab already defines a **safe write path for agents**:
*edit the local `.md` directly, then coordinate via the `marklab` CLI* — direct content-write CLI verbs are
**forbidden by design** (`marklab.mjs:929`: `marklab write … is forbidden for agents. Edit the local Markdown
file directly, then use marklab wait, marklab status, and marklab conflict for coordination`).

But that safety-and-collaboration layer is **locked behind the macOS app + a CLI an agent must be taught
about**. It is not a first-class, installable Codex capability. (The repo ships `marklab agent install
--target codex`, proving the seam exists — but it's manual and undiscoverable.)

**Opportunity:** package MarkLab's safe collaborative write-surface as a **Codex plugin** — a `.codex-plugin`
bundle whose local **MCP server** exposes the `marklab` CLI's coordination commands as Codex tools, plus a
Skill + AGENTS.md teaching the *edit → wait → conflict-STOP* protocol — so any Codex user can drop an AI
agent into a **live, human-shared Markdown doc**, installable in one step and drivable by `/goal`.

## 2. Goals & Success Metrics

**Goals**

- **G1 — Safe agent co-editing.** A Codex user's agent can join a shared MarkLab doc and co-edit it, without
  the user needing to know the `marklab` CLI exists — the plugin surfaces it as Codex tools.
- **G2 — Real convergence.** A Codex edit converges into the local `.md` **and** the shared server state a
  browser collaborator sees, **preserving a concurrent human edit** (real CRDT merge, zero data-loss).
- **G3 — Conflict-stop safety (core invariant).** When a conflict is present, the *agent* (via the Skill /
  `/goal` path) **stops editing** and surfaces state — it never keeps mutating the file.
- **G4 — One-step install + `/goal`-drivable.** Ships as a `.codex-plugin` installable from a personal/repo
  git marketplace; this PRD is consumable by `/goal` to build/verify the plugin itself.

**Success metrics (SMART — each ties to a named check in §6)**

| # | Metric | Target (⚙️ = ratify, §8) | How measured |
|---|--------|--------------------------|--------------|
| M1 | Steady-state edit convergence latency (already-shared doc) | ⚙️ p50 ≤ 3 s · p95 ≤ 10 s | AC2b E2E times local `synced` + server `export.md` update |
| M2 | Data-loss incidents (incl. a concurrent human edit) | **0** — both the human sentinel and the Codex sentinel survive on disk + server | AC2b both-edits-survive assertion |
| M3 | Injected conflict cases where the *agent path* STOPs (no post-conflict write) | **100%** | AC3b write-guard around a scripted skill/agent run |
| M4 | Fresh install → all **7** MCP tools registered & callable | 100% of the tool set | AC1 (`test:mcp-registration` + `codex mcp` in a clean profile) |

## 3. Non-Goals (hard boundaries — for humans and the agent)

- 🚫 **No rewrite** of the Swift app; **no changes** to provider / auth / schema / storage / WebView / the
  `marklab` CLI's behavior (the plugin *calls* the CLI; it does not modify it).
- 🚫 **No new backend / relay.** Reuse the native app + Y-Sweet + hosted alpha.
- 🚫 **Headless / app-independent operation is NOT in MVP.** The native app **is** the engine (file-watching,
  Y-Sweet session, conflict detection, versions). `share`/`join`/`open` require it; `status`/`wait`/`conflict`
  are read-only and work without it. Headless is a post-MVP north-star (§7).
- 🚫 **No content-write tool.** Write verbs are forbidden for agents by design (`marklab.mjs:929`); Codex edits
  the `.md` with its own file tools. The plugin's tools are **coordination-only**.
- 🚫 **No checkpoint tool.** `save-version` is **not** a CLI command on `upstream/main` (backing daemon removed);
  checkpointing lives in the app's Versions inspector. Agents rely on **git / Time Machine** for rollback.
- 🚫 **No public Plugin Directory publish** (MVP: personal/repo git marketplace).
- 🚫 **No paid billing, no Fly deploys, no signing/notarization/Sparkle work.**
- 🚫 **Not a general-purpose MCP filesystem server** — scope is strictly MarkLab collaborative docs.

---

## 4. Users & Use Cases

**Primary persona — the "Codex-using author":** a developer (primary) or writer/PM (secondary) in Codex who
wants an AI agent to help write/edit Markdown that humans are *also* editing live. **Human-in-the-loop is the
primary mode; agent-only sessions are supported.**

| # | User story |
|---|---|
| UC1 | *As a developer co-writing a spec,* I want my agent to edit a `.md` a teammate is live-editing in the browser, *so that* our edits merge safely (CRDT) instead of clobbering each other. |
| UC2 | *As an author,* I want Codex to create an **edit share link** for the current doc, *so that* I can invite a human collaborator into the same live session. |
| UC3 | *As an author,* I want Codex to **detect conflict and STOP + tell me**, *so that* an AI never silently overwrites human work. |
| UC4 | *As an author working async,* I want Codex to edit a shared doc **even when no human is connected**, *so that* work converges and humans pick it up on rejoin. |
| UC5 | *As an author,* I want Codex to **check sync health** (`status`) before/after edits, *so that* I trust the doc actually converged. |

## 5. Requirements

**Functional**

| # | Requirement |
|---|---|
| R1 | **Plugin package.** A `.codex-plugin/plugin.json` bundle (`name: "marklab-codex"`, `interface.displayName: "MarkLab for Codex"`) bundling a local **stdio MCP server** (via `.mcp.json`), a **Skill** (`SKILL.md`), and package-level **`AGENTS.md`**. Installable via `/plugins` from a personal/repo git marketplace. **Manifest field names must be pinned from the installed Codex version's plugin docs — see §H.** |
| R2 | **MCP server.** A stdio MCP server (TypeScript MCP SDK) that Codex launches; it invokes the installed `marklab` CLI (resolve via `PATH` / `MARKLAB_CLI_PATH`) with `--json` and **maps the CLI envelope** into the tool result (see R6/§D): CLI `{ok:true, …payload}` → `{ok:true, data: payload}`; CLI `{ok:false, code, message, details?}` → `{ok:false, error:{code, message, details?, nextStep?}}`. It never reimplements CLI logic. |
| R3 | **Tools — the 7 coordination commands, coordination-only.** `marklab_open(file)`, `marklab_share(file, role)`, `marklab_join(link, target)`, `marklab_status(file?)`, `marklab_wait_synced(file, timeout_ms?)`, `marklab_conflict(file)`, `marklab_doctor(file?)`. Every per-doc tool takes an **absolute `file` path** (MVP requires explicit paths, R8). **Read-only-safe:** `status`, `wait`, `conflict`. **Diagnostic (side effects):** `doctor` writes+removes a temp probe file and hits `/healthz` unless `MARKLAB_DOCTOR_SKIP_NETWORK=1` → mark it approval-gated, not "safe." **App-launching:** `open`/`share`/`join`. No `save_version`. |
| R4 | **Content stays on the filesystem (enforced by the CLI).** Tools never read/write doc *content*; the CLI forbids agent write verbs (`forbidden_agent_write`, `marklab.mjs:929`). Codex edits the `.md` with its own file tools. |
| R5 | **Skill (`SKILL.md`) — where STOP lives.** Encodes the safe protocol: ensure opened/shared → edit the local file → `marklab_wait_synced` → `marklab_status`/`marklab_conflict`; **on `hasConflict:true` / `syncState:"conflict"`, STOP** and surface state; **treat `syncState:"provider_unknown"` as caution — do not claim converged.** The STOP guarantee is a property of this skill + how the agent honors it (tested in AC3b), not of any single tool. |
| R6 | **AGENTS.md guidance.** Generate the package `AGENTS.md` by extending `marklab agent install --target codex --write apps/codex-plugin/AGENTS.md` (⚠️ `--write <path>` is **mandatory**; no default). It copies `marklab-codex-instructions.md`; append the plugin's tool names + STOP protocol + the CLI-envelope mapping. |
| R7 | **App lifecycle — three distinct modes** (do not conflate): (a) `marklab_open(file)` → `open -a MarkLab <file>` (no `--background`; it's rejected); (b) `marklab_share(file, role)` and target-file `marklab_join(link, target)` → `open -a MarkLab --args --marklab-cli-request …`; (c) link-only `join` → a `marklab://join?…` deep link returning `{link, nativeJoinUrl, opened, nextStep}` (no local file). Not installed/launchable → structured error + install guidance. Read-only tools succeed with the app closed. **`MARKLAB_NO_OPEN=true` suppresses launch — for unit tests only, NOT the AC2b E2E.** |
| R8 | **Agent-only sessions + explicit paths.** All tools work with no human peer. MVP **requires an explicit absolute file path** per tool; "active doc" discovery (reading `shared-document-bindings.json`) is a fast-follow (§8, R-6). |
| R9 | **Enablement.** Ship a `/goal` template (built from §6) and document enabling `features.goals` + `features.multi_agent` and running with `--sandbox workspace-write` + network. |

**Non-functional (NFRs)**

| # | NFR |
|---|---|
| NFR1 | **No-data-loss invariant (top safety req).** No path may silently drop/overwrite unconverged human edits; any divergence ⇒ STOP. Proven by AC2b (a concurrent human edit must survive). |
| NFR2 | **Conflict-stop behavior lives in the skill/agent path.** Given a conflict, the *agent* performs no further content write (AC3b). `provider_unknown` is handled in the status wrapper/skill as caution — **not** as a `marklab_conflict` result (that tool returns `hasConflict:false` when only provider verification failed). |
| NFR3 | **Convergence latency.** Steady-state p50 ≤ 3 s · p95 ≤ 10 s on hosted alpha (M1; ⚙️ ratify §8). `wait` polls ~250 ms; default timeout 10 000 ms. |
| NFR4 | **Security / token redaction.** Share URLs embed `token=`; the native binding store persists per-doc tokens (`0o600`). The `share` tool must **separate `docId`/`branchId`/`grantId` from a REDACTED url by default**, and reveal the full tokenized link **only** via an explicit user-facing response path. Never log secrets/tokens/full share URLs (they may land in transcripts). |
| NFR5 | **Offline / app-not-running.** Read-only tools degrade gracefully; app-launch tools return structured errors. |
| NFR6 | **Structured JSON I/O.** Every tool returns the mapped `ToolResult` (R2); errors are structured envelopes, never thrown strings. |
| NFR7 | **Platform / build.** macOS 14+ for app-dependent tools (incl. AC2b); Node `^20.19 \|\| ^22.12 \|\| >=24`; `pnpm@10.0.0`; **no Fly deploys**; any Swift/app artifacts built only in `/tmp`. |

**Known limitations (explicit):** polling (~250 ms), not events; conflict *resolution* is app-only; no
discovery API (explicit paths for MVP); `view` links are **browser-only** (only `mode=edit` links are
`join`-able into a local file).

## 6. Acceptance Criteria (Definition of Done → feeds `/goal`)

**Approach — test-first, two tiers.** CI enforces fast, deterministic tests (AC1, AC2a, AC3a, AC4–AC6). The
two safety-critical behaviors get an additional **real** tier (AC2b, AC3b) that must be demonstrated for
milestone sign-off (may run manually / nightly on a macOS-app-capable host, since GUI/app automation isn't
CI-friendly). Author AC2/AC3 tests **fail-first**, commit, implement to green **without editing the tests**.

| AC | Given / When / Then | Machine check |
|----|---------------------|---------------|
| **AC1 — Install & registration** (M4) | Clean Codex profile with `marklab-codex` installed → exactly the **7** tools register/callable. **Pin the real `plugin.json`/`.mcp.json` schema first (§H).** | `pnpm --filter @marklab/codex-plugin test:mcp-registration` asserts the 7 names; manual `codex mcp` cross-check. |
| **AC2a — Convergence logic (CI, deterministic)** | With `MARKLAB_NO_OPEN=true` + a temp `MARKLAB_APP_SUPPORT_DIR` and controlled binding/baseline/export fixtures, the plugin correctly maps `marklab_status`/`wait_synced` and reports `synced` **iff** `baseline.lastProjectedHash === observedHash === providerVerification.exportedHash`. | `test:roundtrip-unit` — fails first; proves the plugin's interpretation, not real convergence. |
| **AC2b — Real convergence E2E** (M1, M2) — *headline, non-mockable* | **Without** `MARKLAB_NO_OPEN`, with the real app (or a faithful headless Y-Sweet client) running and a **second collaborator (browser/Yjs) making a concurrent edit**, when Codex edits the local `.md`, then disk **and** `export.md` contain **both** the human sentinel and the Codex sentinel (real CRDT merge), within the SLO. | `test:roundtrip-e2e` (manual/nightly, macOS) — both-edits-survive + latency + zero-loss. |
| **AC3a — Conflict surfaced (CI)** | Inject a conflict by writing `conflicts/<name>.json` (`status:"open"`) into the temp support dir using the **exact filename algorithm** (§CLI-contract) → `marklab_conflict` returns `hasConflict:true`; `provider_unknown` is surfaced by the status wrapper as caution, **not** by `conflict`. | `test:conflict-surface` asserts tool outputs across the matrix. |
| **AC3b — Agent STOPs (write-guard)** (M3) — *the real safety proof* | A scripted run down the Skill/`/goal` path, given an injected conflict, attempts a representative edit → a write-guard/spy on the file path records **zero writes** after the conflict is visible; a STOP `nextStep` is surfaced. | `test:conflict-stop-e2e` fails if any post-conflict write is attempted through the skill path. |
| **AC4 — Share / join (3 modes)** | `marklab_share(file,"edit")` returns `{url:/collab?docId=…&branchId=…&token=…&mode=edit, docId, branchId, grantId}`; `marklab_join(url, target)` **with an explicit target path** binds a 2nd local file that converges. (View links browser-only; `open --background` not used.) | `pnpm --filter @marklab/codex-plugin test:share-join` asserts URL shape + ids + explicit-target join. |
| **AC5 — Scope gate** | Diff touches only `apps/codex-plugin/**` and `docs/goals/codex-*.md`; not provider/auth/schema/WebView/`apps/cli`/the Swift app. | `apps/codex-plugin/scripts/check-scope.sh` (committed allow-list over `git diff --name-only`) exits 0 (CI). |
| **AC6 — Gates green** | Repo gates pass. | `npx -y pnpm@10.0.0 typecheck` = 0 (add `apps/codex-plugin` to the chain) · `npx -y pnpm@10.0.0 test` green · `git diff --check` clean · AC2a/AC3a (fail-first) now pass · no regression. |

**Definition of Done = AC1, AC2a, AC3a, AC4, AC5, AC6 green in CI, PLUS AC2b and AC3b demonstrated at least
once with recorded evidence.** AC2b (real convergence w/ surviving concurrent edit) and AC3b (agent STOPs) are
the primary safety contract; the CI tiers guard against regression but do not, alone, prove safety.

## 7. Milestones (dependency-ordered)

| Milestone | Deliverable | Depends on | Parallelizable | Exit gate |
|-----------|-------------|------------|----------------|-----------|
| **M0 — Pin externals** | Confirmed `plugin.json`/`.mcp.json` schema from installed Codex docs (§H); confirmed CLI envelope (§CLI-contract) | — | — | schema + envelope pinned in-repo |
| **M1 — MCP server wraps CLI** | stdio server (TS MCP SDK) exposing 7 tools; envelope mapping; workspace + root-typecheck wiring; pre-authorized deps | M0 | ✅ *explorer* reads `apps/cli` + `packages/shared`; *workers* per tool | tools callable; AC2a green |
| **M2 — Plugin bundle + marketplace** | `plugin.json`, `.mcp.json` (server map), marketplace entry; installs clean | M1 | — | **AC1** |
| **M3 — Skill + AGENTS.md + `/goal` template** | `SKILL.md` (edit→wait→conflict-STOP + provider_unknown caution), `AGENTS.md` (extended), `/goal` template | M1 | ✅ parallel | skill auto-matches; AGENTS present |
| **M4 — Safety tests** *(headline)* | AC3a/AC3b write-guard; AC2a; **AC2b E2E harness** (real app or headless Y-Sweet client + concurrent collaborator edit) | M1, M2 | ✅ per test | **AC2a/b, AC3a/b, AC4** |
| **M5 — Packaging & docs** | README/install, `check-scope.sh`, CI wiring, redaction | M1–M4 | — | **DoD** |

**North-star (post-MVP):** headless Y-Sweet client (removes the app dependency — makes AC2b CI-able); event
stream (replace polling); discovery tool; public Plugin Directory publish.

---

## Agent-execution appendix

### CLI-contract reference (verified on `upstream/main`)
- **Envelope (all commands):** success `{ ok:true, …payload }`; JSON error `{ ok:false, code, message, details? }` (`agent-json.mjs:58-64`). Map per R2.
- `marklab share <file> --edit|--view --json` → `{ok, action, path, file, role, url, copied, docId, branchId, grantId, opened, requestId}`; `url = https://<host>/collab?docId=…&branchId=…&token=…&mode=edit`. Requires app. **View = browser-only.** (`marklab.mjs:780-797, 650-679`)
- `marklab status [file] --json` → `{ok, path, appSupportDir, shared, syncState, observedHash, providerVerification{status,httpStatus,exportedHash,error}, docId, branchId, binding{…}, baseline{lastProjectedHash,…}, conflict}`. Read-only. `syncState ∈ {local,pending,synced,conflict,provider_pending,provider_unknown}` (`marklab.mjs:608-647`). Note: `synced` is decided from local baseline==observed **before** export verification.
- `marklab wait <file> --synced [--timeout <ms=10000>] --json` → `{ok, path, syncState, observedHash, waitedMs}`; polls ~250 ms. Read-only.
- `marklab conflict <file> --json` → `{ok, path, hasConflict, syncState, conflict, nextStep}`; `hasConflict:false` when only provider verification failed. (`marklab.mjs:878-885`)
- `marklab open <file> [--json]` → `open -a MarkLab <file>`; **`--background` rejected**. (`marklab.mjs:338-341`)
- `marklab join <link> [<file>|--dir …] [--json]` → target-file: `{ok, action, path, docId, branchId, opened, requestId, nextStep}` (uses `--marklab-cli-request`); link-only: `{ok, link, nativeJoinUrl, opened, nextStep}` (deep link). (`marklab.mjs:456-467, 748-750, 965-975`)
- `marklab doctor [file] --json` → diagnostics; **writes/removes a temp probe file, starts a watcher, checks `W_OK`, fetches `/healthz` unless `MARKLAB_DOCTOR_SKIP_NETWORK=1`** (`doctor.mjs:32-45,173-180,250-254,278-280`). Not "read-only."
- `marklab agent install --target codex --write <path> [--force] [--json]` → `{ok, target, path, wrote, overwritten}`; `--write` **mandatory** (`agent-instructions.mjs:38-64`).
- **Conflict filename:** `base64(resolvedStandardizedPath)` with `/`→`_`, `+`→`-`, `=` stripped (`marklab.mjs:527-532`; `NativeConflictStore.swift:153-159`). Use a **shared test helper** to compute it — padded base64 won't match.
- **Forbidden:** `write`/`edit`/`hosted-write`/`hosted-edit` → `forbidden_agent_write` (`marklab.mjs:929`).
- **Export:** `GET /api/docs/{docId}/branches/{branchId}/export.md` — Bearer or `?token=`; `200`/`403`/`409 export_version_mismatch` (`import-export-routes.ts:104-170`, auth `app.ts`).

### A. Tech stack & versions
Node `^20.19 || ^22.12 || >=24`, `pnpm@10.0.0`, TS **ESM**; **TypeScript MCP SDK** (`@modelcontextprotocol/sdk`, stdio) — not yet a dep (clean slate). Vitest `^3`.

### B. Project structure
```
apps/codex-plugin/                 # @marklab/codex-plugin (ESM); add to pnpm-workspace + root typecheck
  src/server.ts · src/tools/* · src/marklab-cli.ts   # execFile wrapper → mapped ToolResult
  .codex-plugin/plugin.json        # name:"marklab-codex", mcpServers:"./.mcp.json", skills:"./skills/", interface.displayName  (VERIFY §H)
  .mcp.json                        # server MAP: { "marklab": { "command":"node", "args":["./dist/server.js","--stdio"] } }
  skills/marklab/SKILL.md · AGENTS.md · scripts/check-scope.sh · test/* · README.md
```
Reuses `apps/cli/marklab.mjs` (call; don't modify) + `packages/shared` (hashing, conflict-filename helper).

### C. Commands
`npx -y pnpm@10.0.0 typecheck` (add `apps/codex-plugin/tsconfig.json` to chain) · `… --filter @marklab/codex-plugin build|test|test:roundtrip-unit|test:roundtrip-e2e|test:conflict-surface|test:conflict-stop-e2e|test:share-join|test:mcp-registration` · repo: `… test`, `git diff --check`. Test env: `MARKLAB_NO_OPEN=true` (unit only), `MARKLAB_APP_SUPPORT_DIR=<tmp>`, `MARKLAB_DOCTOR_SKIP_NETWORK=1`, `MARKLAB_USER_TOKEN`, `MARKLAB_CONTROL_PLANE_API_URL`, `MARKLAB_WORKSPACE_ID`. Swift app **out of scope**.

### D. Code style & envelope mapping
TS ESM; **never throw across the MCP boundary.** Map the CLI envelope exactly once:
```ts
type ToolResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown; nextStep?: string } };
// CLI {ok:true, ...payload}  -> { ok:true, data: payload }
// CLI {ok:false, code, message, details} -> { ok:false, error:{ code, message, details, nextStep? } }
```
Read `apps/cli/marklab.mjs` + `apps/cli/agent-json.mjs` before writing tools.

### E. Boundaries (tiered)
- ✅ **Always / pre-authorized:** typecheck + tests before "done"; `git diff --check`; coordination-only tools; fail-first AC2/AC3; **adding `@modelcontextprotocol/sdk` + local build/test deps (typescript, vitest, tsx/esbuild) *within `apps/codex-plugin/**`* is pre-approved** (no need to ask).
- ⚠️ **Ask first:** any dependency *outside* `apps/codex-plugin/**` or beyond that list; scope beyond `apps/codex-plugin/**` + this PRD; any public-API change.
- 🚫 **Never:** touch provider/auth/schema/storage/WebView, `apps/cli/marklab.mjs` behavior, or the Swift app; add a content-write tool; log/persist secrets, tokens, or full share URLs; build inside this Google-Drive worktree (use `/tmp`); commit/push unless asked; Fly deploys; send real share invites/links without approval.

### F. Verification & gates
The §6 ACs are the gates. Test-first; implement to green **without editing tests**; CI enforces AC1/AC2a/AC3a/AC4/AC5/AC6; AC2b/AC3b demonstrated with recorded evidence. **Self-check before "done":** list any R1–R9 / NFR1–NFR7 / AC1–AC6 unaddressed; continue if any remain. Subagents: *explorer* reads `apps/cli` + `packages/*`; *workers* per tool/test.

### G. Glossary
Y-Sweet · Yjs/CRDT · **docId/branchId** · **grantId / access token** (embedded in the share URL) ·
**projection baseline** (`baseline.lastProjectedHash`) · **observedHash** (disk) ·
**providerVerification.exportedHash** (server, from `export.md`) · **conflict record**
(`conflicts/<transformed-base64(path)>.json`, `status:"open"`) · **MARKLAB_APP_SUPPORT_DIR** ·
**MARKLAB_NO_OPEN** (suppress launch — unit tests only) · **MARKLAB_DOCTOR_SKIP_NETWORK** · `.codex-plugin` ·
`/goal` · subagents. *(Relay-era `host_offline`/`paused` do NOT exist here; STOP is on `hasConflict` /
`syncState:"conflict"`.)*

### H. Externals to pin at build time (verify against the installed Codex version — schemas drift)
- `plugin.json` fields (`name` vs `id`, `interface.displayName`, `mcpServers`, `skills`, `hooks`) and `.mcp.json`
  shape (a **server map** `{ "<id>": { command, args } }`, not a bare `{command,args}`). Read the current
  `developers.openai.com/codex/plugins/build` for the installed CLI (`codex-cli 0.142.5`) and pin working
  examples into `apps/codex-plugin/` before AC1.

---

## 8. Risks & Open Questions

| # | Risk / question | Impact | Mitigation |
|---|-----------------|--------|-----------|
| R-1 | **App required for `share`/`join`/`open`** (macOS) + **AC2b needs the app or a headless Y-Sweet client** | Headline E2E isn't CI-friendly | AC2b runs manual/nightly on macOS; north-star headless client makes it CI-able |
| R-2 | **STOP is a skill property, not enforceable by a tool** | A tool alone can't guarantee safety | AC3b write-guard around the skill/`/goal` path; STOP encoded in `SKILL.md` |
| R-3 | **Polling ~250 ms, no events** | Detection lag | Tuned poll+timeout; event stream fast-follow |
| R-4 | **Control plane needed for AC2b/AC4** | Needs server + token/workspace | **[DECIDE]** local `apps/api` (auth disabled) vs hosted alpha + `MARKLAB_USER_TOKEN`/`MARKLAB_WORKSPACE_ID` — define DB/provider setup + flake policy |
| R-5 | **Plugin manifest / feature-flag drift** | AC1 registration or `/goal` may break per version | M0 pins schema from installed docs; init prompt verifies `codex features`/`--help` first |
| R-6 | **Discovery gap** ("which `.md` is active") | Agent must be told the path | **[DECIDE]** explicit paths for MVP (default yes); read `shared-document-bindings.json` later |
| R-7 | **`doctor` side effects** (temp write + `/healthz`) | Surprises in sandbox/CI | Approval-gate `doctor`; set `MARKLAB_DOCTOR_SKIP_NETWORK=1`; document |
| R-8 | **Token/URL leakage into transcripts** | Share tokens exposed | NFR4 redaction: ids + redacted URL by default; full link only on explicit reveal |
| R-9 | **⚙️ SLO numbers unratified** (M1/NFR3) | Headline gate rests on a number | **[DECIDE]** confirm p50/p95 against the alpha before locking AC2b |

**Open questions for Pan:** (1) control plane for AC2b/AC4 (R-4); (2) explicit-paths for MVP OK? (R-6);
(3) ratify the convergence SLO (R-9). *(v0.1 `save-version` question resolved: dropped.)*
