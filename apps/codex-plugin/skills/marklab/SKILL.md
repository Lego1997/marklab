---
name: marklab
description: Safely coordinate Codex edits to MarkLab-shared Markdown files using local filesystem edits plus MarkLab MCP tools.
---

# MarkLab

Use this skill when editing Markdown files that are shared or watched by MarkLab, or when the user asks Codex to open, share, join, check sync, wait for sync, inspect conflicts, or diagnose a MarkLab document.

MarkLab content edits happen on the local filesystem. The MCP tools are coordination-only wrappers around the installed `marklab` CLI; they must not read or write document content.

## Tools

The plugin exposes exactly these seven MCP tools:

- `marklab_open(file)`
- `marklab_share(file, role)`
- `marklab_join(link, target)`
- `marklab_status(file?)`
- `marklab_wait_synced(file, timeout_ms?)`
- `marklab_conflict(file)`
- `marklab_doctor(file?)`

Use absolute file paths for per-document tools. `marklab_status`, `marklab_wait_synced`, and `marklab_conflict` are read-only coordination checks. `marklab_open`, `marklab_share`, and `marklab_join` may launch MarkLab.app. `marklab_doctor` is side-effecting: it can write and remove a temporary probe file and may call `/healthz` unless `MARKLAB_DOCTOR_SKIP_NETWORK=1`, so ask for approval before running it.

## Safe Edit Protocol

1. Identify the absolute `.md` file path and check current state with `marklab_status(file)` when sync safety matters.
2. If a shared session is needed, use `marklab_open(file)` or `marklab_share(file, role)` before editing. Use `marklab_join(link, target)` only with an explicit target path unless the user asks for link-only join behavior.
3. Edit the local Markdown file with normal Codex file-editing tools. Do not use or invent any MarkLab content-write tool.
4. After each meaningful edit batch, run `marklab_wait_synced(file, timeout_ms?)`.
5. Then run `marklab_status(file)` and, when conflict state is possible or reported, `marklab_conflict(file)`.
6. If any result reports `hasConflict: true` or `syncState: "conflict"`, STOP immediately. Do not make more content edits to that watched file. Report the conflict state, file path, and any `nextStep` to the user.
7. If `syncState: "provider_unknown"`, treat it as caution. Do not claim the document converged. Report that local state may be updated but provider/server verification is unknown, then ask the user how to proceed or run a safer follow-up check.

## Convergence Language

Only say a document converged when local sync and provider verification support that conclusion. A local `synced` state alone is not enough if provider verification is pending or unknown. `provider_unknown` is not a conflict result from `marklab_conflict`; it is a caution state from status/wait handling.

## Share URL Handling

Share URLs contain access tokens. Redact tokenized URLs by default in summaries, logs, and final responses. Prefer reporting `docId`, `branchId`, `grantId`, role, and a redacted URL shape. Reveal a full share URL only when the user explicitly asks for it and the tool path intentionally returns it for user-facing use.

## CLI Envelope Mapping

Map the CLI JSON envelope exactly once at the MCP boundary:

```ts
// CLI success:
// { ok: true, ...payload } -> { ok: true, data: payload }

// CLI error:
// { ok: false, code, message, details? } -> { ok: false, error: { code, message, details? } }
```

If a CLI error includes an actionable next step, include it as `error.nextStep`. Do not throw raw strings across the MCP boundary.
