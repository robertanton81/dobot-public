#!/usr/bin/env bash
# Proof that a change touched comments only. For every file under src/ that differs from the base
# commit, the JavaScript that esbuild emits with --minify (which drops every comment) must be the
# same at the base commit and in the working tree. Python files are compared by their syntax tree,
# which holds no comments. A file with a real code change prints DIFFERS.
# Usage, from the repository root: bash docs/evidence/2026-09-19-platform-boundary/comments-only.sh <base-commit>
set -uo pipefail
BASE="${1:?give the base commit}"
ESBUILD="$(ls node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild 2>/dev/null | head -1)"
[ -x "$ESBUILD" ] || { echo "esbuild not found: run pnpm install first"; exit 2; }
same=0; differ=0
while IFS= read -r f; do
  [ -f "$f" ] || { echo "GONE     $f"; differ=$((differ+1)); continue; }
  case "$f" in
    *.ts|*.tsx|*.js)
      loader="${f##*.}"
      old=$(git show "$BASE:$f" | "$ESBUILD" --loader="$loader" --minify --legal-comments=none --log-level=error)
      new=$("$ESBUILD" --loader="$loader" --minify --legal-comments=none --log-level=error < "$f")
      ;;
    *.py)
      old=$(git show "$BASE:$f" | python3 -c 'import ast,sys; print(ast.dump(ast.parse(sys.stdin.read())))')
      new=$(python3 -c 'import ast,sys; print(ast.dump(ast.parse(sys.stdin.read())))' < "$f")
      ;;
    *) echo "SKIPPED  $f"; continue ;;
  esac
  if [ "$old" = "$new" ]; then same=$((same+1)); else echo "DIFFERS  $f"; differ=$((differ+1)); fi
done < <(git diff --name-only "$BASE" -- src)
echo "emitted code identical: $same file(s); different: $differ file(s)"
