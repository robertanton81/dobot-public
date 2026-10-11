# Semgrep scan

Semgrep is a static analysis tool. It matches code against rules and reports risky patterns.
This page records what ran, what it found and what was done about it.

## What runs

- **In CI:** the `semgrep` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs
  `semgrep scan --config p/default --config p/typescript --error` in the official
  `semgrep/semgrep` container. `--error` makes the job fail when a finding is left.
- **Rule packs:** `p/default` (the general security and correctness rules) and `p/typescript`.
- **Locally, before the first commit of this snapshot:** Semgrep 1.180.0, started with
  `uvx semgrep`, the same two packs, metrics off, `node_modules` excluded. The CI job could not be
  run locally, but the command is the same.
- **Scope of the last local run:** 313 files, 510 rules, 0 findings, exit code 0 with `--error`.

## What it found

The first run reported 4 findings in 3 places, before the CI workflow existed. A later run added a
fifth finding in the workflow itself.

| Rule | File | Verdict | What was done |
| --- | --- | --- | --- |
| `javascript.lang.security.audit.detect-non-literal-regexp` | `src/server/agent/gate.ts` (`globToRegExp`) | Accepted risk | The pattern is escaped first: every regex metacharacter is quoted and only `*` becomes `.*`. The patterns come from the operator's approval rules and are matched against short control labels. A `nosemgrep` comment with this reason sits above the line. |
| `javascript.lang.security.insecure-object-assign` | `src/server/agent/run.test.ts` | False positive | A test helper adds two fields to an error object that it builds from a fixed fixture. No user input is involved. A `nosemgrep` comment with this reason sits above the line. |
| `python.lang.security.audit.dynamic-urllib-use-detected` and `python.lang.security.audit.insecure-transport.urllib.insecure-urlopen` | `src/server/companion/companion.py` (`list_pages`) | False positive | The URL is built from the constant `CDP_HTTP`, which is Chrome's debugging port on `127.0.0.1` inside the sandbox. It is never user input, and plain HTTP to the loopback address is how the Chrome DevTools protocol works. One `nosemgrep` comment names both rules and gives the reason. |
| `yaml.github-actions.security.github-actions-mutable-action-tag` (4 steps) | `.github/workflows/ci.yml` | Real, fixed | The steps used `@v4` tags, which the action owner can move. They are now pinned to the commit of the v4 tag, with `# v4` in a comment. |

Only the workflow finding was fixed in code. The other three are accepted or false positives,
and only comments were added for them. The last run reported 0 findings.

## Limits of this scan

- Semgrep could not parse `src/server/store/store.test.ts` (Semgrep reported a syntax error and
  gave no further detail), so that test file was not scanned.
- `src/server/agent/tools.ts` was parsed only in part: the parser stopped at one regular
  expression literal (line 104).
- The rule packs are public rules from the Semgrep registry. They do not know this project's
  approval gate, so they say nothing about whether the gate is complete. The tests in
  `src/server/agent/gate.test.ts` and `connector-gate.test.ts` cover that, and
  [verification.md](verification.md) lists the known gaps.
- Registry rules change over time. A later CI run can report findings that this run did not.
