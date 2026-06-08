# CLAUDE.md — MarkLab (macOS)

MarkLab is a **local-first Markdown collaboration app for macOS**. The canonical document is a
plain `.md` file on disk; a native macOS app + a **Y‑Sweet (Yjs) CRDT** relay add live
browser/native co-editing, share links, version snapshots, conflict review, and a safe path for
AI agents to edit the file. No cloud document database, no editor lock-in. pnpm/TypeScript
monorepo + Swift.

## ⚠️ IMPORTANT — read the *current* docs, not the stale ones
This repo contains **three generations** of design docs. Trust sources in THIS order; do **not**
build your mental model from the older ones:
1. **Ground truth:** the Linear project **"MarkLab Pre-Pilot Launch"** (team `PAN`) ·
   **`docs/goals/spec.md`** (current objective + live state) ·
   `docs/manual-acceptance/pre-pilot-launch-checklist-progress-log.md` (the gate ledger).
2. **One generation stale:** `README.md` + `plans/01–06` describe a hosted `/relay/<room>` layer
   that has since been **deleted** and replaced by Y‑Sweet. The README does not mention the native
   app, MarkEdit, or Y‑Sweet.
3. **Archival only:** `00_…09_*.md` are the original **cloud-first** design (self-labeled superseded).

## Current objective → `docs/goals/spec.md`
The single source of truth for what we're doing now: **Gates 0–9 passed** (Gate 9 closed 2026-06-08).
Next active gate: **Gate 10 — brand, website, video (PAN-9)**. Gates 9.5/10.5/11 deferred.
PAN-7 Done · PAN-11 Done (e0b941d → upstream/main) · PAN-12 Done.

## YOU MUST — working rules
- **Check Linear first.** Start every session by reading the "MarkLab Pre-Pilot Launch" project;
  update the relevant issue/project state before finishing (see `AGENTS.md`).
- **The local `.md` file is the write surface.** Edit it with normal filesystem tools — there is
  **no** content-mutation API. Coordinate via `marklab status --json`, `marklab wait --synced`,
  `save-version`, `versions`, `conflict`.
- **On conflict, STOP.** If `marklab status` reports `syncState:"paused"` or `hasConflict:true`,
  stop editing the watched file, run `marklab conflict`, and report — never keep mutating it.
- **Never commit/push unless asked. Never write secrets/tokens/private contact data** to repo files
  or Linear. Build app artifacts in `/tmp`, never inside this Google‑Drive‑synced worktree.

## Architecture (current generation)
- `apps/marklab-macos` — native macOS app (Swift, MarkEdit shell + Sharing/Versions inspector).
- `apps/api` — Express + Postgres/Neon control plane; supervises a **Y‑Sweet** CRDT provider
  (proxied under `/d/<providerDocId>` & `/collab`); hosted on **Fly.io** (`marklab-relay-alpha`, region `sin`).
- `apps/collab-web` — browser collaborator app. `apps/cli` — the `marklab` CLI/daemon (agent/automation surface).
- `packages/{shared,markdown,collab-editor}` — shared libs. Workspaces: `apps/*`, `packages/*` (pnpm@10, Node 22, ESM).

## Build / test  (full gotchas in `docs/goals/spec.md` §6)
- Typecheck: `npx -y pnpm@10.0.0 typecheck` · JS tests: `npx -y pnpm@10.0.0 test`
- Swift: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --package-path apps/marklab-macos`
  — **plain Command Line Tools SwiftPM is broken here** (manifest `__allocating_init` link error);
  use Xcode's toolchain or the pinned `swift-6.2.4` one.
- Package/verify: `npx -y pnpm@10.0.0 --filter @marklab/marklab-macos package:app` / `verify:package`
  (build in `/tmp`). Always `git diff --check` after edits. The Fly CLI is unauthenticated (no deploys from here).

## Deeper docs
`AGENTS.md` (Linear checkpoint) · `docs/agent/marklab-{claude-code,codex,cursor}-instructions.md` ·
`docs/agent/marklab-agent-guide.md` (agent file-editing protocol) · `docs/goals/spec.md` (consolidated project spec).
