# Clean-clone check, and the defect it found — 18 September 2026

> Snapshot note: this record names raw logs, screenshots, generated documents or bot files that are not part of this public snapshot. The written results and the small result files in this folder remain.

Result: **the README's setup works on a fresh clone of commit `839b76a`**, from `git clone` to a
finished first run on a newly created computer. The check also found a defect that only a new
computer shows: the browser window was not maximised. Root cause found, fixed, and verified live.

This is not the last step of the TODO item. That step is the owner's: a clone on a machine that has
never seen the project. See "What this check does not prove".

## What was done

A fresh clone in a scratch folder, then the README's "Setup" block, literally:

| README step | Result |
| --- | --- |
| `git clone … && cd dobot` | cloned the local repository at `839b76a`, which is what GitHub gets at the next push |
| `pnpm install` | pass; Node 24.21.0, pnpm 12.3.4 |
| `cp .env.example .env.local`, fill in the two keys | pass; the values were copied file to file by a script that prints key names only. `E2B_DOMAIN` was copied too, because the author's key belongs to the EU project. No mailbox variables, as for a reviewer without a mailbox. |
| `mkdir -p data/bots`, copy the example bot, copy a CV | pass |
| `pnpm preflight` (not in the Setup block; run as an extra) | pass: 483 TypeScript tests, 16 Python tests |
| `pnpm dev` | pass: "routines armed", "no mailbox configured; a routine waiting for the mail event will not fire", "server listening"; the API bound to `127.0.0.1:3000` |
| open <http://localhost:5173> | pass: the roster shows Hunter, idle; an empty chat; "no live screen right now" |
| the first goal ("open example.com in your browser and tell me the heading") | pass: "creating the bot computer", a computer 4 s later, the run `done` after 24 s with the right answer; 1 step, 3 model calls, $0.05 |

No routine started by itself: a fresh bot folder has no planned run on record, so the missed-run
rule has nothing to start. The example's `morning-search` fires at the next 07:00 on a weekday.

## The defect: a small browser window on a new computer

The server logged `could not maximise the browser window` (`CommandExitError`, exit status 1), and
the first screenshot shows a window of 1050 × 753 on the 1280 × 800 screen
(`first-run-screen.png`). Maximising runs only when the browser starts, so the window would have
stayed small for the life of that computer. A reviewer's first look at the visible computer would
be that window.

**Root cause, reproduced.** A probe created new computers and ran the maximise sequence piece by
piece (`probe-new-computer.mts`). On one of two, the search died:

```text
X Error of failed request:  BadWindow (invalid Window parameter)
  Major opcode of failed request:  3 (X_GetWindowAttributes)
  Resource id in failed request:  0x3000001
```

While Chrome starts it creates and destroys short-lived windows. `xdotool search --onlyvisible`
asks for the attributes of each window and dies on one that has just gone. In the one-shot command
the window id was then empty, the width empty, and
`xdotool windowactivate --sync "" key alt+F10` ended with exit 1. Nothing tried again. The same
sequence passed on every restart of a running browser (five trials, four of them with a cold
profile), which is why Hunter's computers never showed it: the race needs the first seconds of a
new desktop.

**The fix** (`src/server/sandbox/e2b.ts`, `maximizeChromeCommand`): a small shell loop inside the
same single command. It looks again every half second until a budget of 8 s is over; it presses
Alt+F10 only while the window is narrow; and after a press it polls the width for 3 s before
another press, because the key is a toggle. The state table is in the comment above the function:
success, no window yet or the search died, the key was sent, the key was lost, budget over,
timeout, Stop. The warning now names the computer.

**Tests first.** Five tests run the real command text through `sh` against a stand-in `xdotool` on
`PATH`. Against the old text, the first failed with the same exit 1 as the live run. A mutation
check confirmed the fifth: with the width guard weakened, it fails. Both reviews passed with no
blocking finding; four of their suggestions are in (the Stop row, the smaller budget, the
computer's id in the warning, the fifth test). Preflight: 488 TypeScript tests, 16 Python tests.

**Live.** `probe-verify-fix.mts` ran the platform's own `startChrome` on six newly created
computers: a window of 1288 on all six, no warning. `startChrome` now takes about 6 s, because the
command returns only when the window is wide. That cost falls on the creation of a computer and on
the one-time browser restart after a zone change, not on a normal connect.

**Named limit.** A window left small stays small until the browser starts again, because only the
browser's start runs the command. The upgrade is the same check on every connect. It is left out
on purpose: connect is on the filmed path, and the check would add a command to it for a case the
retry already makes rare.

## What this check does not prove

- **A machine that has never seen the project.** This Mac has a warm pnpm store (the install took
  half a second), the right Node through Volta, and Python 3. A cold install and a missing tool
  show only on another machine. That step stays the owner's.
- **The default E2B cluster.** The author's key needs `E2B_DOMAIN`; a reviewer on the Hobby plan
  leaves it empty. The default cluster last ran a full act on 13 September.
- **The mail routine on a clean clone.** No mailbox was configured, as for most reviewers.

## Left in the real systems

- The clean clone's computer `iibqc4hlh0atdmg5gd3vb` sat paused in the EU project, with its small
  window, until the afternoon. After the owner's cleanup that day the project listed one computer,
  Hunter's.
- Eight throwaway computers made by the probes were killed by the probes themselves.
- The scratch clone, with its copy of the keys, is deleted at the end of the session.

## Files

- `first-run-events.jsonl`, `first-run-screen.png`: the clean clone's first run.
- `server-log.jsonl`: the clean clone's server log, without the computer's id.
- `probe-new-computer.mts`, `probe-verify-fix.mts`: the two probes, as run from `data/`.
