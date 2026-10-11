# Five findings of a late audit — 20 September 2026

Result: **all five were real. Each was reproduced first and fixed second. None ran against a real
computer or a real model after the fix.**

An outside audit read `main` at `67f6826` and reported five defects. This record says how each
one was reproduced, and keeps the two things that were measured by hand: what the page showed in
a browser, and how long the log's cleaning takes. The account of what changed is in
[the build history](../../build-history.md#five-findings-of-a-late-audit-20-september-2026).

| Finding | How it was reproduced | Fix |
| --- | --- | --- |
| A takeover the user opened stayed interactive when the bot started to work | In a browser, with the probe below: the server said `working` with a model call open, and the page still held the interactive stream | `9ad9cd2`, `7a1e9d1` |
| A long error message could put most of a registered secret into the log | A test: 48 of a marker's 49 characters were in the log field | `fc66c7e`, `13951ec` |
| A mail event could be lost while a bot's routines were armed again | A test: `fireEvent()` during `reload()` was acknowledged and started no run. A second test found a timer that `stop()` could not reach | `3cfe97a` |
| A Deny could be followed by the same card again | A test through the mail watcher, the scheduler, the runner and the run loop: the card read `denied`, the model failed on its next call, and the mail position stayed behind, so the event stayed pending | `7cfc3b4` |
| The budget card did not name an approved action that worked | A test: an allowed click at step 150 went through, and the card held only the general sentence | `a4120a0` |

Every test named above failed on the code before its fix. The two halves of the Deny rule were
also checked the other way round: with either half switched off, its test fails again.

## The page, in a browser, at no cost

The takeover page cannot be tested with a zero-budget server: without a computer the stream route
answers 409. [`takeover-probe.mts`](takeover-probe.mts) starts the real HTTP app, runner,
scheduler and store with a fake computer and a fake model. The fake computer's two streams are
pages of the probe itself, one marked view-only and one marked interactive. The fake model ends
its first call at once, which brings the fake computer up, and then keeps every call open until
it is released, so the bot stays `working` long enough to look at the page.

```bash
pnpm build
pnpm tsx docs/evidence/2026-09-20-audit-five-findings/takeover-probe.mts
```

Open `http://127.0.0.1:3199/` and pick the bot. `POST /probe/fire-mail` fires the mail event, so
the bot's routine starts. `POST /probe/release` lets the open model call end the turn;
`POST /probe/release?then=screenshot` makes the model ask for a screenshot instead, so the loop
makes another turn and can hand the screen over first. `GET /probe/state` gives the bot's state.
The page asks whether hand-back is allowed only while its tab is visible.

**Before the fix**, page built from `67f6826`. The user pressed Take over on the idle bot, then the
mail event fired:

```
page:   "you have the screen", button "Hand back", hint "you can hand back",
        stream = interactive
server: state "working", an active run, model call 2 open
```

**After the fix**, page built from `7a1e9d1`, four paths:

| Path | Page before the event | Page after it |
| --- | --- | --- |
| Take over on an idle bot, then the mail event fires | `you have the screen`, interactive stream, bot `idle` | view-only stream, buttons Stop and Take over, the line "the bot started working, so the screen went back to it", bot `working` |
| Page reloaded during a takeover, so the card switched the tab; the hand-back came through the API | `you have the screen`, interactive stream, bot `blocked` | view-only stream, no line, bot `working` |
| Take over during a run, then Hand back in the same tab | `you have the screen`, interactive stream, bot `blocked` | view-only stream, no line, bot `working` |
| Take over during a run; the hand-back came through the API, as from another copy of the page | `you have the screen`, interactive stream, bot `blocked` | view-only stream, the line, bot `working` |

A tab that pressed Take over during a run and still waited for the bot to hand over kept its
state while the bot was `working`: it held no interactive stream yet.

What this does not show: a real noVNC stream, and two real browser tabs at once. The second and
fourth paths stand in for a second tab by calling the hand-back route directly.

## How long the cleaning takes

The fix cleans the whole message before the cut, so the cleaning must be cheap on a large text.
[`clean-cost.mts`](clean-cost.mts) cleans eight kinds of text at 1 MB and 5 MB with three
registered values. [`clean-cost.txt`](clean-cost.txt) is its output on the author's laptop: at
most 17 ms for 5 MB, and five times the size takes about five times as long.
