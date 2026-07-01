# MarkLab for Codex

MarkLab for Codex is a bridge plugin that lets Codex safely coordinate edits to MarkLab-shared Markdown files. Codex still edits the local `.md` file directly; the plugin exposes MCP tools for opening, sharing, joining, waiting for sync, checking status, checking conflicts, and running diagnostics.

## Safety Contract

The required workflow is:

1. Edit the local Markdown file on disk.
2. Run `marklab_wait_synced(file, timeout_ms?)`.
3. Run `marklab_status(file)` and, when needed, `marklab_conflict(file)`.
4. STOP on `hasConflict: true` or `syncState: "conflict"`.

When stopped, do not make additional content edits to the watched file. Surface the file path, conflict state, and any `nextStep` to the user.

`syncState: "provider_unknown"` is a caution state, not convergence. Do not claim the shared document converged while provider verification is unknown.

## MCP Tools

The plugin registers these seven coordination tools:

- `marklab_open(file)`
- `marklab_share(file, role)`
- `marklab_join(link, target)`
- `marklab_status(file?)`
- `marklab_wait_synced(file, timeout_ms?)`
- `marklab_conflict(file)`
- `marklab_doctor(file?)`

`marklab_status`, `marklab_wait_synced`, and `marklab_conflict` are read-only checks. `marklab_open`, `marklab_share`, and `marklab_join` may launch MarkLab.app. `marklab_doctor` is approval-gated because it is side-effecting: it may write and remove a temporary probe file and may call `/healthz` unless `MARKLAB_DOCTOR_SKIP_NETWORK=1`.

## Share URL Redaction

Share URLs embed access tokens. Redact full share URLs by default in logs, transcripts, and summaries. Prefer returning or reporting separate `docId`, `branchId`, `grantId`, role, and a redacted URL. Reveal the full tokenized link only through an explicit user-facing path after the user asks for it.

## CLI Envelope Mapping

The MCP server wraps the installed `marklab` CLI and maps its JSON envelope into tool results:

```ts
// CLI success:
// { ok: true, ...payload } -> { ok: true, data: payload }

// CLI error:
// { ok: false, code, message, details? } -> { ok: false, error: { code, message, details? } }
```

If the CLI provides a next step, include it as `error.nextStep`. Tool code should return structured envelopes instead of throwing raw strings across the MCP boundary.

## Development Gates

Useful package scripts:

```bash
pnpm --filter @marklab/codex-plugin typecheck
pnpm --filter @marklab/codex-plugin test
pnpm --filter @marklab/codex-plugin scope-gate
```

The scope gate permits plugin work under `apps/codex-plugin/**`, Codex goal specs under `docs/goals/codex-*.md`, and workspace wiring files (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`). It blocks changes in provider, auth, schema, WebView, `apps/cli`, and Swift app surfaces.

## Local Marketplace

This package includes a local marketplace at `.agents/plugins/marketplace.json`. From the repository root, add it to Codex with:

```bash
codex plugin marketplace add apps/codex-plugin
codex plugin add marklab-codex --marketplace marklab-local
```

Build the package before installing from a clean checkout so `.mcp.json` can launch `./dist/server.js`:

```bash
pnpm --filter @marklab/codex-plugin build
```

## Goal Usage

Use `goal-template.md` with Codex `/goal` when building or validating the plugin. Enable Codex goals and multi-agent support before using that path, and run with workspace-write sandboxing plus network when tests require MarkLab or MCP installation checks.
