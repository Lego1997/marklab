# MarkLab — Project Spec

> **Status (2026-06-08): Gate 9 — ✅ Passed.** Pilot invite confirmed working. Fixed app installed, edit link active.
> PAN-7 Done · PAN-11 Done (e0b941d → upstream/main) · PAN-12 Done. Next: Gate 9.5 deferred; Gate 10 (PAN-9).

---

## 1. Product

MarkLab is a **local-first Markdown collaboration app for macOS**. The canonical document is a
plain `.md` file on disk. The native app + a Y-Sweet (Yjs) CRDT relay add:

- Live native/browser co-editing
- Share links (edit + view)
- Version snapshots and manual checkpoints
- Conflict review (local vs. shared divergence)
- A safe write path for AI agents (via CLI/daemon)

No cloud document database. No editor lock-in.

---

## 2. Architecture (current generation)

| Component | Stack | Notes |
|-----------|-------|-------|
| `apps/marklab-macos` | Swift 6, MarkEdit shell, SwiftUI inspector | Native app; Sharing & Versions inspector |
| `apps/api` | Express, Postgres/Neon, Y-Sweet supervisor | Control plane; Y-Sweet proxied at `/d/<docId>` & `/collab`; Fly.io `marklab-relay-alpha`, region `sin` |
| `apps/collab-web` | React/TypeScript | Browser collaborator; served from the API origin |
| `apps/cli` | Node ESM | `marklab` CLI/daemon — agent/automation surface |
| `packages/{shared,markdown,collab-editor}` | TypeScript | Shared libs |

Toolchain: pnpm@10, Node 22, ESM. Monorepo workspaces: `apps/*`, `packages/*`.

**Hosted alpha:** `https://marklab-relay-alpha.fly.dev`
Health check: `curl -fsS https://marklab-relay-alpha.fly.dev/healthz` → `ok: true` + schema/provider/store/db ready.

---

## 3. Gate Roadmap

| Gate | Area | Status |
|------|------|--------|
| 0 | RC freeze | ✅ Passed — patched RC `cf3a2691` |
| 1 | Manual pilot acceptance | ✅ Passed — Phases 1–5, no open P0/P1 |
| 2 | P0/P1 fix pass | ✅ Passed — P1-001 fixed (`WKSecurityOrigin.port` normalization) |
| 2.5 | Dead-code removal | ✅ Passed — old `/relay`, daemon, `apps/web` removed |
| 3 | Server/data lifecycle | ✅ Passed — Delete Cloud Copy, version retention, cleanup jobs; Fly v13 |
| 4 | Cost instrumentation / unit economics | ✅ Passed (small free pilot scope; paid pricing deferred to Gate 11) |
| 5 | Clean install / controlled distribution | ✅ Passed — ad-hoc signed, Gatekeeper workaround documented |
| 6 | Login, onboarding, workspace UI (OIDC) | ✅ Passed — Google OIDC owner login, workspace select/create |
| 7 | Security, privacy & ops | ✅ Passed — Fly v32, token/leak/revocation/rollback tests |
| 8 | Public docs cleanup + old-approach archive | ✅ Passed |
| **9** | **Small external pilot (3–10 users)** | **✅ Passed — pilot launched 2026-06-08, invite confirmed working** |
| 9.5 | Post-pilot simplification | ⏸ Deferred (await pilot findings) |
| 10 | Brand, website, video | ⬜ Not started (PAN-9) |
| 10.5 | Signed distribution + Sparkle auto-update | ⏸ Paused — plumbing done; EdDSA key/appcast/signing deferred (PAN-8) |
| 11 | Paid billing & pricing | ⏸ Deferred (PAN-10) |

---

## 4. Gate 9 — Current State

### Objective

Run a controlled 3–10 user external pilot, capture evidence, and produce an explicit
stay/expand/stop decision. Everything beyond Gate 9 is deliberately out of scope.

### Active Linear issues

| Issue | Title | Status | Priority |
|-------|-------|--------|----------|
| PAN-7 | Plan and run Gate 9 small external pilot | In Progress | High |
| **PAN-11** | **Accept or rebuild the Gate 9 pilot artifact** | **Done (2026-06-08)** | **Urgent** |
| PAN-12 | Close Gate 9 roster/logistics by agent simulation | Done (2026-06-06) | High |
| PAN-8 | Gate 10.5 signed distribution + Sparkle | Backlog | Medium |
| PAN-9 | Gate 10 website + demo video | Backlog | Medium |
| PAN-10 | Gate 11 paid billing | Backlog | Low |

### PAN-11 — DONE (2026-06-08)

**Original symptom:** `dist/MarkLab-gate9-clean-7bba036-20260531.zip` (SHA-256
`19930d40a773fbc047db083df28527e473e5b7d13f1f49a351f77a36f0c490de`) passed all structural/codesign
checks but crashed before UI launch with a fatal error in `resource_bundle_accessor.swift:12`.

**Root cause fixed:** `rootURL()` now uses sequential if-checks; `Bundle.module` is no longer
evaluated eagerly in the packaged app. Fix committed as e0b941d on branch
`fix/pan-11-resource-bundle` (Lego1997/marklab on GitHub).

**Accepted artifact:** `dist/MarkLab-gate9-pan11-20260608.zip`
SHA-256: `1fabd339d24b452cb0f2a0250b40ff5485e49d217a4e5c489d79145e1e4b7246`
103/103 Swift tests passed · launchSmokePassed: true ("packaged app stayed alive for 2000ms") · verify:package exit 0 · 9/9 QA criteria passed, 0 critical failures.

**Gate 9 is now invite-ready. No invites without explicit action-time approval from Pan.**

### Roster state

All pilot user slots are TBD. No real external users have been invited.
Candidate contact (Linear project member Yumin Fu) has not confirmed Gate 9 pilot participation.
Do not record private contact data or personal details in repo files or Linear.

### Definition of Done (Gate 9)

- [ ] ≥3 real external users complete the full core flow (§ Core Flow) with zero data-loss incidents.
- [ ] No unresolved P0 bug; every blocker has a `bug.md` entry or Linear issue.
- [ ] Per-user support time, friction notes, and cost signal recorded.
- [ ] Expansion decision written: **stay 3–10 / expand 10–50 / stop & fix first** with one-line rationale.
- [ ] Gate 9 row appended to `docs/manual-acceptance/pre-pilot-launch-checklist-progress-log.md`;
      `docs/manual-acceptance/gate9-small-external-pilot-evidence.md` updated.
- [ ] Linear PAN-7 has a final summary comment (users, support load, bugs, cost, expansion decision).
- [ ] No regressions to Gates 0–8 evidence; Gate 10/10.5/11 untouched.

### Core Flow (per user — all steps must pass)

1. Install & open the accepted build (Gatekeeper workaround applied).
2. Sign in / account ready.
3. Open a local `.md` file.
4. **Start Sharing** → edit link created.
5. A browser collaborator joins via the edit link.
6. A collaborator edit **converges into the local `.md` file on disk** (bytes change locally).
7. **No data-loss incident** (any silent drop = P0 = blocks Done).

A user "passes" only when all 10 evidence fields in the pilot roster are green.

---

## 5. Non-Goals & Guard Rails

**Do not do** in this loop:
- Gate 10 brand/site/video work (PAN-9).
- Gate 10.5 signing / notarization / Sparkle appcast / auto-update (PAN-8).
- Gate 11 paid billing / Stripe (PAN-10).
- Broad active-code simplification before pilot evidence (Gate 9.5).
- Rewriting provider / auth / schema / storage / WebView architecture.
- Sending any external invite, creating access links, or starting sharing **without explicit
  action-time approval from Pan**.
- Writing any secret, token, private key, or private contact detail into repo files or Linear.
- Adding dependencies without a verified blocker and explicit approval.

**Human approval required before acting:** strategic pivot · destructive change · dependency change ·
schema/migration change · public-API change · scope expansion (>10 pilot users) · Gate 10.5 work ·
marking data-loss risk "non-blocking" · sending invites / creating access links.

---

## 6. Technical Reference

### Build & Test

```bash
# TypeScript typecheck
npx -y pnpm@10.0.0 typecheck

# JS tests (Vitest)
npx -y pnpm@10.0.0 test
# Scoped: npx -y pnpm@10.0.0 --filter @marklab/collab-web exec vitest run <file>

# Swift tests — MUST use Xcode toolchain (CLTools SwiftPM is broken — __allocating_init link error)
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test \
  --package-path apps/marklab-macos
# Scoped: ... --filter <SuiteName>
# Alternative: /Users/pan/Library/Developer/Toolchains/swift-6.2.4-RELEASE.xctoolchain/usr/bin/swift

# Package + verify (always build in /tmp, never in this Google Drive worktree)
npx -y pnpm@10.0.0 --filter @marklab/marklab-macos package:app
npx -y pnpm@10.0.0 --filter @marklab/marklab-macos verify:package
# or: node apps/marklab-macos/scripts/verify-packaged-app.mjs <path/to/MarkLab.app>

# Hygiene — always run after edits
git diff --check
```

### Toolchain Gotchas

- **CLTools SwiftPM broken** (system-wide, not MarkLab-specific): `PackageDescription.Package.__allocating_init` link error. Use `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` or the pinned swift-6.2.4 toolchain with `--scratch-path` under `/tmp`.
- **Google Drive xattrs break codesign:** CloudStorage injects `File-Provider`/`FinderInfo` xattrs inside this synced worktree; they corrupt Sparkle's `Installer.xpc`. **Always build/stage clean artifacts in `/tmp`**, then copy out / strip xattrs if needed.
- **Fly CLI unauthenticated** in this shell — no deploys. The deployed web bundle lacks the `editor-ready` marker; live timing uses the legacy markdown-snapshot fallback.
- **pnpm:** use `npx -y pnpm@10.0.0 …` — don't rely on a global pnpm.

### Artifacts

| Artifact | Source commit | Status | SHA-256 | Notes |
|----------|---------------|--------|---------|-------|
| `dist/MarkLab-gate9-pan11-20260608.zip` | e0b941d (merged → upstream/main 2026-06-08) | **CURRENT** | `1fabd339d24b452cb0f2a0250b40ff5485e49d217a4e5c489d79145e1e4b7246` | launchSmokePassed: true; 103/103 tests |
| `dist/MarkLab-gate9-clean-7bba036-20260531.zip` | 7bba036 | **SUSPENDED — crashes before UI launch (PAN-11)** | `19930d40a773fbc047db083df28527e473e5b7d13f1f49a351f77a36f0c490de` | Do not use |
| dirty-source candidate | — | Superseded — do not use | `a33c9a4100553bed6dd3840dba2852baf39d90b7964e54b5d4287bc5536f52c0` | Do not use |
| `dist/MarkLab.app` (ignored in repo) | — | Do not use | — | Missing `Sparkle.framework` |

App minimum: macOS 14+. Distribution: ad-hoc signed, Gatekeeper workaround, no auto-update.

### Security / Protocol

- Native sessions must send bearer `ml_user_…` + header `X-MarkLab-Native-App: 1`; without it the
  API downgrades `clientKind=app` to `browser`.
- First-party app editor URL is grantless / carries no access token.
- Never persist secrets in repo files. Protected globs: `.env*`, `**/*secret*`, `**/*key*`,
  `dist/updates/**`, Sparkle signing keys.
- Live owner timing (Gate 9.5-adjacent) requires a restored account at
  `~/Library/Application Support/MarkLab/account/account.json` + control-plane env vars
  (`MARKLAB_CONTROL_PLANE_API_URL`, `MARKLAB_PUBLIC_WEB_URL`, `MARKLAB_USER_TOKEN`,
  `MARKLAB_WORKSPACE_ID`).

---

## 7. Open Bugs

| ID | Severity | Description | State |
|----|----------|-------------|-------|
| PAN-11 | **P0 (pilot blocker)** | Clean artifact crashes before UI launch — `Bundle.module` resource lookup fatal | **Done (2026-06-08)** — fix committed e0b941d; new artifact verified (launchSmokePassed: true) |
| P2-002 | P2 (accepted) | Remote-cursor re-anchor lag in actively-editing surface (visual only; edits converge correctly) | Accepted for pilot |

No open P0/P1 in the codebase itself. All prior P0/P1 findings (P1-001 `WKSecurityOrigin.port`,
P2-003 projection error styling, P2-004 conflict review sidebar) are fixed.

See `bug.md` on `upstream/main` for the full ledger (note: item numbers restart per section —
cite by section + text, not number).

---

## 8. Decisions & Dead-Ends

### Decisions

- **Pilot size:** bounded to 3–10 controlled users. Expansion call defaults to "stop/fix first"
  if the same logistics wall recurs with zero users completing the flow.
- **Suspended artifact:** the old clean zip matches its SHA but crashes before UI launch —
  do not assign it until PAN-11 is rebuilt and accepted.
- **Distribution:** ad-hoc signed (Gatekeeper workaround only), not Developer-ID/notarized;
  auto-update intentionally not configured for this pilot.
- **PAN-12 closure:** Pan approved agent simulation as sufficient PAN-12 closure evidence on
  2026-06-06. This does not authorize invites or access links.
- **PAN-5 latencies:** Start Sharing median ≈ 13.1 s, reopen ≈ 9.6 s — deferred to Gate 9.5
  optimization, not blocking Gate 9.
- **Verify-packaged-app is not a launch-smoke proxy:** structure/codesign checks passing ≠
  app launches. After 2026-06-05, all packaged artifacts must also pass an extracted launch smoke
  against a scratch Markdown file.

### Dead-ends — do not repeat

- **Plain CLTools SwiftPM is broken** — `__allocating_init` link error. Always use Xcode or
  the pinned toolchain.
- **Building artifacts inside Google Drive worktree breaks codesign** — xattrs corrupt
  `Installer.xpc`. Build in `/tmp`.
- **Fly deploy not available** in this shell — don't plan work requiring a Fly deploy.
- **Native/browser smoke ≠ full GUI WKWebView coverage** — it isn't; full GUI automation is
  explicitly uncovered, backstopped by Swift WKWebView security tests + collab-web unit tests.
- **The Linear connector can be flaky** — retry writes; read via fallback.

---

## 9. Historical Context

### Gate 9 attempt log (summarized)

| Date | Event |
|------|-------|
| 2026-05-21–22 | Gates 0–4 accepted (manual acceptance, P1-001 fix, dead-code removal, lifecycle, cost). |
| 2026-05-22 | Gates 5–8 accepted (install, login/OIDC, security, docs cleanup). |
| 2026-05-30 | PAN-7 moved to In Progress. Artifact candidates surfaced; CLTools SwiftPM failure found. |
| 2026-05-31 | PAN-11 first pass: clean artifact built under Xcode, accepted. PAN-11 marked Done. |
| 2026-06-04 | Four scattered Goal Forge goal folders (PAN-5/7/11/12) consolidated into single GOAL.md. |
| 2026-06-05 | PAN-12 simulated real-user rehearsal: found clean artifact crashes before UI launch; PAN-11 reopened Urgent. Patch proven in `/tmp/marklab-pan12-artifact-fix`. |
| 2026-06-06 | Pan approved closing PAN-12 by agent simulation. PAN-12 Done; PAN-11 remains the only pre-invite blocker. |
| 2026-06-08 | PAN-11 Done: fix committed e0b941d (fix/pan-11-resource-bundle); artifact MarkLab-gate9-pan11-20260608.zip built and verified (103/103 Swift tests, launchSmokePassed: true, verify:package exit 0). Gate 9 invite-ready pending Pan action-time approval. |

### Predecessor goal folders (deleted)

The following Goal Forge goal folders were consolidated in June 2026 and are no longer present
in the repo:

| Folder | Linear issue | Status at deletion |
|--------|--------------|--------------------|
| `gate9-small-external-pilot/` | PAN-7 | In Progress (now the active objective) |
| `gate9-pan12-roster-logistics/` | PAN-12 | Done (agent simulation) |
| `gate9-pan11-artifact-sync/` | PAN-11 | Re-opened Urgent |
| `pilot-entry-readiness/` | PAN-5 | Done |

---

## 10. Stale Doc Warning

This repo contains three generations of design docs. Trust in this order:

1. **Ground truth:** Linear project "MarkLab Pre-Pilot Launch" (team PAN) · this file
   (`docs/goals/spec.md`) · `docs/manual-acceptance/pre-pilot-launch-checklist-progress-log.md`.
2. **One generation stale:** `README.md` + `plans/01–06` describe the old hosted `/relay/<room>`
   layer (now deleted, replaced by Y-Sweet). README does not mention the native app, MarkEdit,
   or Y-Sweet.
3. **Archival only:** `00_…09_*.md` under `plans/Archive/cloud-first-reference/` are the original
   cloud-first design (self-labeled superseded).
