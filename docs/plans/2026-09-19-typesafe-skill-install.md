# TypeSafe skill installation

Requested by the owner on 2026-09-19. Install the TypeSafe agent skill for Codex in
this project, using only the requested `npx skills add` method. Use the skill for
relevant TypeSafe and AI decision work in this project.

## Installer checks

Checked live on 2026-09-19 before installation:

| Check | Result | Source |
| --- | --- | --- |
| Exact installer version | `skills@1.7.0`, latest stable, published 2026-09-17 | [npm registry](https://registry.npmjs.org/skills) |
| Maintainers | `rauchg`, `quuu`; no install lifecycle scripts | npm registry above |
| Weekly downloads | 4,173,672 for September 10–16 | [npm downloads](https://api.npmjs.org/downloads/point/last-week/skills) |
| GitHub activity | 31,978 stars; last push September 18; 1,196 open issues and pull requests combined | [repository](https://github.com/vercel-labs/skills) |
| Maintainer response | Pull requests 2242 and 2243 merged on their creation date, September 16 | [pull requests](https://github.com/vercel-labs/skills/pulls?q=is%3Apr+is%3Aclosed) |
| OSV advisories | No advisories returned for npm `skills` version `1.7.0` | [OSV API](https://api.osv.dev/v1/query) |
| Snyk | Package health 80/100; no known direct security issues in version `1.7.0` | [Snyk Advisor](https://snyk.io/advisor/npm-package/skills) |
| Skill repository | 337 stars; one open issue or pull request; last push September 12; not archived | [TypeSafe skills](https://github.com/typesafe-ai/skills) |

These checks do not prove the absence of vulnerabilities in transitive dependencies.
Snyk's maintenance counts lag GitHub, so the table uses GitHub's live activity data.

## Installation and verification

The [installer documentation](https://github.com/vercel-labs/skills#options)
supports selecting Codex with `--agent codex` and skipping prompts with `--yes`.
The [TypeSafe documentation](https://docs.typesafe.ai/agent-skill.md) confirms that
this method installs into the current project by default.

```bash
npx --yes skills@1.7.0 add typesafe-ai/skills --skill typesafe-ai --agent codex --yes
```

Verify the installed skill, its source lock entry, and the project's full preflight.
Read the installed instructions and the live TypeSafe documentation index before
using the skill. Installation adds agent guidance; it does not add a runtime SDK
or change the application's model provider.
