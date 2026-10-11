#!/usr/bin/env bash
# SessionStart hook: tell the agent where to start and warn about uncommitted changes.
#
# The warning matters because a dirty working tree usually means that a previous session
# ended before its commit. The hook never blocks and never edits files.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

echo "Start with CLAUDE.md or AGENTS.md (invariants, workflow) and docs/README.md (document map)."

if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  dirty=$(git status --porcelain 2>/dev/null | head -5)
  if [ -n "$dirty" ]; then
    echo "WARNING: uncommitted changes in the working tree - a previous session may have ended before committing. Review 'git status' before starting new work."
  fi
fi

exit 0
