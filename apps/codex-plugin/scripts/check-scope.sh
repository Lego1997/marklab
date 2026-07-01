#!/usr/bin/env bash
set -euo pipefail

tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT
repo_root="$(git rev-parse --show-toplevel)"

if [[ -n "${SCOPE_BASE:-}" ]]; then
  git -C "$repo_root" diff --name-only "${SCOPE_BASE}...HEAD" >"$tmp_file"
else
  {
    git -C "$repo_root" diff --name-only
    git -C "$repo_root" diff --cached --name-only
    git -C "$repo_root" ls-files --others --exclude-standard
  } | sort -u >"$tmp_file"
fi

is_allowed() {
  local path="$1"
  case "$path" in
    apps/codex-plugin/*|apps/codex-plugin)
      return 0
      ;;
    docs/goals/codex-*.md)
      return 0
      ;;
    package.json|pnpm-lock.yaml|pnpm-workspace.yaml)
      return 0
      ;;
  esac
  return 1
}

is_blocked_surface() {
  local path="$1"
  case "$path" in
    apps/cli|apps/cli/*)
      return 0
      ;;
    *provider*|*Provider*|*auth*|*Auth*|*schema*|*Schema*|*WebView*|*webview*)
      return 0
      ;;
    *.swift|Package.swift|*.xcodeproj|*.xcodeproj/*|*.xcworkspace|*.xcworkspace/*|*.entitlements|*.storyboard|*.xib)
      return 0
      ;;
    apps/mac|apps/mac/*|apps/macos|apps/macos/*|apps/MarkLab|apps/MarkLab/*|MarkLab|MarkLab/*|Sources|Sources/*)
      return 0
      ;;
  esac
  return 1
}

violations=()

while IFS= read -r path; do
  [[ -z "$path" ]] && continue

  if is_allowed "$path"; then
    continue
  fi

  if is_blocked_surface "$path"; then
    violations+=("blocked surface: $path")
  else
    violations+=("outside allow-list: $path")
  fi
done <"$tmp_file"

if (( ${#violations[@]} > 0 )); then
  printf 'Scope gate failed. Only these paths are allowed:\n' >&2
  printf '  apps/codex-plugin/**\n' >&2
  printf '  docs/goals/codex-*.md\n' >&2
  printf '  package.json\n' >&2
  printf '  pnpm-lock.yaml\n' >&2
  printf '  pnpm-workspace.yaml\n' >&2
  printf '\nViolations:\n' >&2
  printf '  %s\n' "${violations[@]}" >&2
  exit 1
fi

printf 'Scope gate passed.\n'
