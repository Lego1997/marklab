# AGENTS.md: MarkLab Local Agent Rules

This project uses MarkLab as a local-first Markdown collaboration tool.

Follow these rules when editing MarkLab-watched Markdown files:

1. Edit the local `.md` file on disk. The filesystem is the content editing surface.
2. Use only the CLI commands below for sharing and sync coordination.
3. If MarkLab.app reports paused sync or an open conflict, stop editing the watched file and report the state to the user.
4. For broad edits, ask the user to create or confirm an external checkpoint such as Git or Time Machine.
5. Do not list yourself as a collaborator. Agents are represented by local file edits, not presence sessions.

The current normal CLI surface routes files and hosted edit links through MarkLab.app:

```bash
marklab doctor --json
marklab open <file.md>
marklab share <file.md> --edit
marklab share <file.md> --view
marklab join 'https://<host>/collab?docId=...&branchId=...&token=...&mode=edit'
marklab status <file.md> --json
marklab wait <file.md> --synced --json
marklab conflict <file.md> --json
```

`share --edit` and `share --view` ask MarkLab.app to start or reuse native sharing in the background, create the requested access link, copy it to the clipboard, and print it. Use `status`, `wait`, and `conflict` before or after local edits when you need sync state.

## MarkLab for Codex Plugin

The Codex plugin exposes exactly seven coordination-only MCP tools:

- `marklab_open(file)`
- `marklab_share(file, role)`
- `marklab_join(link, target)`
- `marklab_status(file?)`
- `marklab_wait_synced(file, timeout_ms?)`
- `marklab_conflict(file)`
- `marklab_doctor(file?)`

Codex edits Markdown content by changing the local `.md` file on disk. After an edit batch, run `marklab_wait_synced(file, timeout_ms?)`, then `marklab_status(file)`, and use `marklab_conflict(file)` whenever conflict state is possible or reported.

If any result reports `hasConflict: true` or `syncState: "conflict"`, STOP immediately. Do not make additional content edits to that watched file. Surface the file path, conflict state, and any `nextStep` to the user.

Treat `syncState: "provider_unknown"` as caution. Do not claim the document converged while provider verification is unknown.

`marklab_doctor(file?)` is side-effecting and approval-gated: it can write and remove a temporary probe file and may call `/healthz` unless `MARKLAB_DOCTOR_SKIP_NETWORK=1`.

Share URLs contain access tokens. Redact tokenized URLs by default in logs, summaries, and final responses. Prefer separate `docId`, `branchId`, `grantId`, role, and a redacted URL. Reveal the full URL only when the user explicitly asks for it.

Map the CLI JSON envelope at the MCP boundary:

```ts
// CLI success:
// { ok: true, ...payload } -> { ok: true, data: payload }

// CLI error:
// { ok: false, code, message, details? } -> { ok: false, error: { code, message, details? } }
```

Preserve actionable `nextStep` values as `error.nextStep` when available.
