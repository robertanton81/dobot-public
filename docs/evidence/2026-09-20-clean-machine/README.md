# The README on a machine that has never seen the project — 20 September 2026

Result: **pass, on revision `4552678`.** On a fresh macOS user account with no Node, no pnpm and an
empty package store, the README's prerequisites and Setup block led from `git clone` to a page in the
browser and a first goal that ended `done` on a newly created bot computer. One part stays unproven:
E2B's default cluster, because the run used the author's EU project key together with `E2B_DOMAIN`.

Who did what: The owner created the account, typed every command in it, signed in to GitHub, and sent
the goal. Claude prepared the commands as text files in a shared folder, read the output from a shared
log, and never saw the other account's screen except in two photos.

## The machine

A new standard user, `dobottest`, on the owner's Mac. Checked from that account before anything was
installed: `node` and `pnpm` were "command not found". Tools that every account on this Mac sees:
`git`, `python3` (both from macOS) and `gh` in `/opt/homebrew/bin`, which a fresh account does not
have on its search path. The owner's own Node and pnpm live under his `~/.volta` and are invisible to
the new account. The package store was cold: `pnpm install` reports `reused 0, downloaded 139`.

## What ran, in the README's order

| README line | Result |
| --- | --- |
| Prerequisite "Node 24 LTS, `.nvmrc` says `24`" | nvm `v0.40.7` installed into the account's home (after `touch ~/.zshrc`, as nvm's own README asks on macOS), then `nvm install 24`: Node `v24.21.0`. |
| Prerequisite "pnpm 12, `corepack enable`" | corepack `0.36.0`; it downloaded pnpm `12.3.4` at the first `pnpm` command, after a yes-or-no question. |
| `git clone https://github.com/robertanton81/dobot.git && cd dobot` | Pass, revision `4552678`. The repository is private, so the account first signed in with `gh auth login` and `gh auth setup-git`; that sign-in is the reader's own matter and not part of the README. |
| `pnpm install` | Pass: 139 packages downloaded, the lockfile passed pnpm's supply-chain check, "Done in 3.3s using pnpm v12.3.4". |
| `cp .env.example .env.local`, then fill in the two keys | Done by a file instead of by hand: `.env.example` with `E2B_API_KEY`, `E2B_DOMAIN` and `ANTHROPIC_API_KEY` copied file to file by a script that prints key names only. The mailbox and notice keys stayed empty, so no mail watcher started. |
| `mkdir -p data/bots`, `cp -r examples/job-hunt-bot …`, the CV | Pass. |
| `pnpm dev` | Pass: `server listening` on port 3000, the page on port 5173. |
| A first goal ("open https://example.com and tell me the heading of the page") | "setting up my computer", a new computer created in 5 seconds, the answer "Example Domain", `run ended … done` 18 seconds after the goal. The platform paused the computer two minutes later, and the page then said "no live screen right now". |

## Findings for the README

1. **The Node row can be read as "nvm is required".** The owner himself asked whether `.nvmrc` was a
   requirement. Any way of installing Node 24 works.
2. **corepack asks a question** before it downloads pnpm ("Do you want to continue? [Y/n]"), and pnpm
   then advertises an update to 12.5.1. A reader should answer `Y` and ignore the update, because the
   project pins 12.3.4.
3. **Running the Setup block twice nests the example bot:** the second `cp -r` creates
   `data/bots/job-hunt-bot/job-hunt-bot`. The platform ignores it.
4. **The first goal used no computer step** (`"steps":0`): the bot read the page with its page-reading
   tool. The computer was created and its screen was live in the page, but a reader who wants to watch
   the bot work needs a goal that names the screen.
5. **In Safari the live picture sits low in its panel,** with black bands above and below. It works.
   Every rehearsal ran in Chrome.

Not findings about the README: `gh` was not on the fresh account's search path (its full address
works), and a long shell line with curly braces was hard to type by hand, so the commands went into
small text files.

## What this does not prove

- **The default E2B cluster.** The author's Pro subscription covers only his EU project; a project on
  the default cluster would run on the free plan, but the test used the EU key with `E2B_DOMAIN` set,
  as the README describes. The default cluster last ran a full act on 13 September.
- Linux and Windows.
- `pnpm preflight` on the cold account: it was not run there. It passed on the author's account on
  this revision's parents the same morning (617 tests).

## Secrets

Count-only scan of `clean-clone.log`: the Anthropic key, the E2B key and the mailbox password appear
0 times; the positive control was true for each. The shared copy of the environment file was deleted
by the same command that installed it. The sandbox id is masked in the log.
