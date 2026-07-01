# Codex Goal Template: MarkLab for Codex

## Objective

Build and verify the MarkLab for Codex plugin so Codex can safely coordinate edits to MarkLab-shared Markdown files through coordination-only MCP tools.

## Context To Read First

- `docs/goals/codex-plugin-prd.md`
- `apps/codex-plugin/AGENTS.md`
- `apps/codex-plugin/skills/marklab/SKILL.md`
- `apps/codex-plugin/README.md`

## Hard Boundaries

- Do not edit provider, auth, schema, storage, WebView, `apps/cli`, Swift app, manifests, or root files unless the goal owner explicitly expands scope.
- Do not create a content-write tool. Codex edits local Markdown files directly.
- Do not log or expose tokenized share URLs by default.
- Treat `marklab_doctor(file?)` as side-effecting and approval-gated.
- Use explicit absolute paths for per-document tools.

## Required Tool Surface

Register and test exactly these seven MCP tools:

- `marklab_open(file)`
- `marklab_share(file, role)`
- `marklab_join(link, target)`
- `marklab_status(file?)`
- `marklab_wait_synced(file, timeout_ms?)`
- `marklab_conflict(file)`
- `marklab_doctor(file?)`

## Safety Protocol

Every agent path that edits a MarkLab-watched Markdown file must follow:

1. Edit the local file.
2. Run `marklab_wait_synced(file, timeout_ms?)`.
3. Run `marklab_status(file)`.
4. Run `marklab_conflict(file)` when conflict state is possible or reported.
5. STOP on `hasConflict: true` or `syncState: "conflict"` and make no further content edits to that watched file.

`syncState: "provider_unknown"` is caution. Do not claim convergence while provider verification is unknown.

## CLI Envelope Mapping

Map CLI JSON into MCP tool results exactly once:

```ts
// CLI success:
// { ok: true, ...payload } -> { ok: true, data: payload }

// CLI error:
// { ok: false, code, message, details? } -> { ok: false, error: { code, message, details? } }
```

Preserve actionable `nextStep` values in `error.nextStep` when available.

## Validation Checklist

- `pnpm --filter @marklab/codex-plugin test:mcp-registration` confirms the seven tool names.
- `pnpm --filter @marklab/codex-plugin test:roundtrip-unit` passes.
- `pnpm --filter @marklab/codex-plugin test:conflict-surface` passes.
- `pnpm --filter @marklab/codex-plugin test:share-join` passes.
- `pnpm --filter @marklab/codex-plugin test:conflict-stop-e2e` demonstrates no post-conflict writes on the skill path.
- `pnpm --filter @marklab/codex-plugin scope-gate` passes.
- `pnpm --filter @marklab/codex-plugin typecheck` and `pnpm --filter @marklab/codex-plugin test` pass.
- `git diff --check` is clean.

For real convergence sign-off, run the macOS/app-backed E2E or faithful Y-Sweet collaborator check and verify both the human sentinel and Codex sentinel survive on disk and in server export.
