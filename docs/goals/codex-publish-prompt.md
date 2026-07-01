# Codex init prompt — publish "MarkLab for Codex"

> Grounded in live `codex-cli 0.142.5` + OpenAI docs. Reality check: Codex's `$plugin-creator` skill only
> scaffolds/validates locally — it does NOT publish. OpenAI's public Plugin Directory is "coming soon."
> Real distribution = (1) an npm package for the MCP server (so `npx` can run it) + (2) a GitHub marketplace repo.
> **Before pasting:** be ready to run `npm login` when Codex asks (publishing is yours to approve).

---

```
You are finalizing and PUBLISHING an already-built Codex plugin. Work only in this worktree.

## State (do not rebuild from scratch)
- Worktree: /Users/pan/Library/CloudStorage/GoogleDrive-zhengfan.pan@gmail.com/My Drive/side projects/marklab_obsidian_plugin/.claude/worktrees/codex-plugin  (branch: codex-plugin)
- The plugin already exists at apps/codex-plugin: plugin.json manifest, a stdio MCP server (src/ → dist/),
  SKILL.md, .mcp.json, .agents/plugins/marketplace.json, tests. Build + tests are GREEN; the ESM
  extensionless-import boot bug and a wait_synced timeout bug are already fixed. Read
  docs/goals/codex-plugin-prd.md for full context. DO NOT scaffold a new plugin — finalize this one.

## Ground truth (verified on codex-cli 0.142.5 — don't re-litigate)
- `$plugin-creator` is a LOCAL scaffolder + validator only. Use it ONLY to validate
  (~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py <plugin-path>) and for its
  existing-plugin update/reinstall flow. It does NOT publish, npm, or bundle.
- OpenAI's public Plugin Directory + self-serve publishing are "coming soon" — NOT available. Distribution
  today = a Git marketplace repo that users add with `codex plugin marketplace add <owner/repo>`.
- The validator REQUIRES `.mcp.json` as the wrapper `{"mcpServers": {...}}`; a bare server map is rejected.
- Codex spawns a plugin MCP server from the USER'S cwd with no plugin-root env var, and the install cache
  has no node_modules — so the server MUST be launched via `npx` + a PUBLISHED npm package (a relative
  `node ./dist/server.js` fails for real users). `npx -y <pkg> --stdio` reaches `status: ready` from any cwd.

## Goal
Ship "MarkLab for Codex" so a fresh user can install it and have the marklab MCP tools actually launch:
(A) publish the MCP server to npm, (B) point .mcp.json at it via npx, (C) validate, (D) distribute via a Git
marketplace repo, (E) prove the round-trip.

## Tasks
1. VERIFY BASELINE: `npx -y pnpm@10.0.0 --filter @marklab/codex-plugin build` and `... test` and root
   `npx -y pnpm@10.0.0 typecheck` all pass. Confirm `node apps/codex-plugin/dist/server.js --stdio` answers
   an MCP `initialize` handshake.
2. MAKE THE SERVER PUBLISHABLE (npm): in apps/codex-plugin/package.json — remove `"private": true`; set a
   public package name (check availability with `npm view <name>`; propose `@marklab/codex-mcp-server` if the
   @marklab org is available, else an available unscoped name — ASK me to confirm the final name); set a real
   semver; keep `"type":"module"` + `bin` → `dist/server.js` (shebang present); keep `@modelcontextprotocol/sdk`
   in dependencies and all test-only libs (@y-sweet, yjs, ws, vitest) in devDependencies; add
   `"files": ["dist"]`, `"publishConfig": {"access":"public"}`, and a `"prepublishOnly": "pnpm build"`.
   (No bundler needed — `npx` installs the package's dependencies.)
3. WIRE .mcp.json to the wrapper + npx form (replaces the bare map):
   { "mcpServers": { "marklab": { "command": "npx", "args": ["-y", "<final-name>@<version>", "--stdio"] } } }
4. VALIDATE: run the plugin-creator validator
   `python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py apps/codex-plugin` — it MUST print
   "Plugin validation passed". Fix anything it flags (mcpServers wrapper, no `hooks`, no leftover `[TODO]`).
5. GIT MARKETPLACE LAYOUT: arrange the distributable repo shape the docs expect — the plugin under
   `plugins/marklab-codex/` and a repo-root `.agents/plugins/marketplace.json` whose entry has
   `source.path: "./plugins/marklab-codex"`. Keep the working copy in apps/codex-plugin; produce the
   marketplace layout without breaking the build (a thin repo or a `dist-marketplace/` staging dir is fine —
   propose the cleanest option and ASK before creating a new repo/remote).
6. PUBLISH — these are outward/irreversible, so PREPARE fully then get my approval:
   - npm: run `npm publish --dry-run` and show me the file list; then STOP. Tell me to `npm login`, and run
     `npm publish --access public` ONLY after I confirm. Do not publish without explicit approval.
   - marketplace repo: stage/commit but DO NOT push or create a remote without my approval.
7. ROUND-TRIP PROOF: after the package is live (or via `npm pack` + a local install for a dry run), install the
   plugin into a clean Codex profile from the marketplace and confirm the `marklab` MCP server reaches
   `status: ready` and all 7 tools register.
8. REPORT: final package name@version, the marketplace repo layout, and the EXACT commands I must run
   (`npm login`, `npm publish --access public`, any `git push`, `codex plugin marketplace add <repo>`,
   `codex plugin add marklab-codex@<marketplace>`), plus anything still manual.

## Boundaries
- Never run `npm publish`, `git push`, or create a remote without my explicit approval (outward + irreversible).
- Keep code changes within apps/codex-plugin/** (plus the marketplace repo layout in step 5). Do not touch
  provider/auth/schema/the Swift app or apps/cli behavior. No secrets/tokens in the repo. Don't commit unless asked.
- If `$plugin-creator` tries to scaffold a NEW plugin, stop — we are finalizing the existing one.
```

---

**What you'll need on hand:** a free **npm account** (`npm login` when Codex asks) and a **GitHub repo** to host the marketplace. **No OpenAI account.** Codex prepares everything; you run `npm login`, approve `npm publish`, and approve the repo push.
