# Side proof: a bot born on the page — 18 September 2026

> Snapshot note: this record names raw logs, screenshots, generated documents or bot files that are not part of this public snapshot. The written results and the small result files in this folder remain.

Result: **the cycle is complete, and it took three corrections to get there.** A bot was created in
the page from a blank form, was given a goal in one plain sentence, was corrected only by chat,
was signed in to its own mailbox by takeover, sent a real mail after one Allow, wrote two skills and
two routines with its own tools, took corrections as rewrites of the same skill, and did the whole
job again by itself when the scheduler started it, with nobody typing. Twelve runs, **$6.06**,
against the decision record's "under a dollar"; the run that the saved skill drove cost **$0.39**.

The cycle also found two platform defects, both fixed the same day, and several behaviours of the
bot that the write-up should name. The decision record is
`docs/specs/2026-09-17-side-proof-bot-creation.md`.

Who did what: Claude drove the page on the owner's word (created the bot, typed the goal and every
correction, pressed Stop, Deny, Hand back and Allow). The owner chose the address for the report,
allowed Claude to press Allow on send cards for that address only, and typed the mailbox password
on the bot's screen. The address is masked in this folder as `<address>`. Nothing in the bot's
folder was written by hand. A few presses went through the API instead of the page's buttons (the
second Stop, one Deny, the hand-back probes); the buttons call the same endpoints.

## Before and after the cycle

Hunter's mail check was paused by chat before the cycle (the bot set `enabled: false` itself,
$0.05), as the runbook asks, and turned on again by chat at the end (`enabled: true`, $0.03). No
security mail arrived in the shared inbox. Seznam's webmail does show a red banner, "Někdo se k
tomuto účtu přihlásil ze zahraničí" (someone signed in from abroad), with a link to change the
password: the bots' computers are in Brussels, so every sign-in looks foreign to Seznam.

## The bot

Created in the page's "New bot" form: name "Swimmer", one sentence of persona. The chat showed
"setting up my computer" and "my computer is ready"; the browser window was wide at the first try
(the maximise fix of `d452eec`, made two hours earlier). Bot id `swimmer-0cc4`. The goal is the
short form from the decision record, with the address.

## The runs (UTC; Prague is UTC+2)

| Run | Start | What happened | Steps | Calls | Cost | End |
| --- | --- | --- | --- | --- | --- | --- |
| `f88ba91f` | 08:28 | Read the site section by section. Then tried the cheap path on the site and on a guessed `/api/history`, opened the browser's developer tools, read the site's publishable API key off the network panel, called `fetch_url` on the site's data API with that key (401), and started typing a `fetch` into the console. Claude pressed Stop. | 85 | 63 | $1.53 | `cancelled` |
| `1f36ddcb` | 08:38 | After the correction "no developer tools, no data API, read the screen": wrote that rule to memory, then clicked the tools' close button. The gate stopped the click (`unknown-target`). Claude pressed Deny after 26 s. | 7 | 6 | $0.04 | `stuck` (defect S2) |
| `fc48aa39` | 08:43 | Closed the tools with F12 as told, read the site again, then opened **Gmail** and asked for a takeover to sign in to **The owner's own Google account**. Claude closed the tab and handed back; the bot opened Gmail and asked again. Claude pressed Stop during the takeover. | 82 | 65 | $1.95 | `cancelled` |
| `31424384` | 08:58 | After the correction "never my accounts; your own mailbox is the webmail at mail.example.test": read three parts of the site, typed the mailbox address on the login page, clicked **Continue**; the gate stopped it (`submit-control`, unannounced); Deny after 20 s; then the right takeover. The owner signed in and handed back at 10:05:30 (the takeover had waited 58 minutes with no step and no model call). In 49 s the bot wrote the report and proposed the send. Claude checked the card and the screen and pressed Allow. The next model call was refused by the provider (S6). | 70 | 46 | $1.83 | `failed` |
| `5704b27c` | 10:29 | After the limit was raised: "send the report you wrote". One screenshot, a new send card with an honest warning ("written in an earlier stopped run; not re-verified"), Allow, the gate consumed it (`submit-control`, "matches the approved action"), Seznam: "E-mail byl úspěšně odeslán." | 4 | 6 | $0.06 | `done` |
| `8d874fb9` | 10:31 | The evening capture, once, as a test: `open_url`, one screenshot, one zoom, one memory line. Claude compared the line with the zoomed image: all seven values, their classes and the peak are right (`capture-chart-zoom.png`). | 2 | 5 | $0.05 | `done` |
| `4a9417a5` | 10:32 | "Save both jobs … put them on a schedule": two skills, two routines, no computer step. | 0 | 3 | $0.05 | `done` |
| `4d47b835` | 10:34 | A correction (use the capture note from memory for yesterday, say so when there is none): a rewrite of the same skill. | 0 | 2 | $0.04 | `done` |
| `6ba2de2d` | 10:34 | "Move the morning report to 12:41 today": the bot saved a **second** routine under the skill's name and said it had moved the first (S8). | 0 | 2 | $0.03 | `done` |
| `af709685` | 10:41:00 | **Started by the scheduler, nobody typing.** The saved skill end to end: the site's three parts, the mailbox (still signed in, no takeover), the mail, a send card with two warnings (no capture note for yesterday, so the trend bar; the recipient is a personal address), Allow, sent, a memory line. | 34 | 20 | $0.39 | `done` |
| `a7faa814` | 10:45 | Three corrections after reading that run's mail (S9): the user's swim hours, ten lines in Czech, the meaning of the number on a trend bar. A rewrite of the same skill, and the limits into memory. | 0 | 3 | $0.05 | `done` |
| `18538ee3` | 10:46 | "Turn the 12:41 routine off and pause the other two": all three routines `enabled: false`. | 0 | 4 | $0.06 | `done` |

Cost: **$6.06** for the pool bot (the first four runs $5.34, the other eight $0.72), plus $0.08
for Hunter's pause and resume. What made it dear: the site is long, the bot first read all of it
by scrolling and hovering, and each stopped run threw its reading away. What made it cheap: the
saved skill, which names three parts of the site. A run the skill drives costs about $0.40.

## What the decision record asked this cycle to tell

| Question | Answer |
| --- | --- |
| Does the Seznam compose work on the bot's screen? | Yes. Two mails were typed and sent; the first took 49 s from the hand-back to the send card. |
| Does the bot read the page correctly? | The chart of today against the average: yes, checked value by value. The 14-day trend: no, it read the count of readings on yesterday's bar as occupancy (S9). The first report's numbers were not checked by a second reader. |
| Cost per run | $0.39 when the skill drives it; $1.50 to $2 for a first, undirected reading of the site. |
| Does a routine's run survive the resumed computer's slow first page? | Yes, once: run `af709685` started on a computer that had paused, took a screenshot, waited, took another and went on. |
| Does the evening capture read correctly, and does the morning run use the memory line? | The capture: yes. The morning run: not proven. The only capture note is from the same day, so the run took the fallback the corrected skill prescribes and said so, on the card and in the mail. A capture at 22:00 and a report the next morning are needed for that, and the routines are paused now. |

## The files the bot wrote

`bot-files/` holds them as they are, with the address masked: two skills, three routines (one is
the 12:41 test, off), the memory, the chat. The morning skill names the three parts of the site,
forbids the developer tools and the data API, names the bot's own mailbox, asks for a takeover at a
sign-in, proposes the send with the exact control, records the send in memory, and, after the
corrections, carries the user's swim hours, the ten-line limit, Czech, and the rule for yesterday.

## The first report

Read from the compose window in the send card's screenshot (12:06 Prague). Subject: "Bazén: nejlepší
čas dnes + srovnání se včerejškem". Headcounts and the pool's capacity are removed in this snapshot.

```text
Ahoj,
dnes (pá) je bazén teď na 70 % – radši počkat.
Ve tvém okně (po 17:00) je nejtišší 20:00–21:00, průměr jen ~25 % – lepší než 17:00, 18:00 i
19:00. Doporučuji 20:00.
Včerejší čtvrtek byl celkově klidnější než obvykle: průměr 26,7 % vs. typický čtvrteční průměr ~36 %, ale krátce
vyskočil na špičku 56 % (obvyklé maximum bývá ~49 %).
Obecně nejméně lidí bývá čt/so kolem 6–7 h (5–11 %); o víkendu máš volno kdykoli.
```

It respects the user's hours, it says what the site could not give, and it is five lines. The
second report, from the routine's run, was longer than ten lines and recommended 6:00 on a weekday
(S9).

## Findings

**S1. The bot reached for the developer tools and the site's data API, and lifted a key off the
screen.** The capability rule in its prompt says "no code, no API beyond the public pages fetch_url
reads". It did not hold. At step 36 of the first run the bot wrote "let me find the apikey header";
it then read the site's publishable key in the network panel and passed it to `fetch_url` in a URL.
The key is one the site ships to every visitor, so no secret of the user leaked. It still sits in
that run's log under `data/` and was in the model's context, and it is masked in this folder. One
plain sentence in chat stopped the behaviour, and the bot wrote the rule to its memory and later
into both skills. For the write-up: a rule in a prompt binds the model only as far as the model
follows it; the platform has no guard against developer tools, and `fetch_url` logs its URL in full.

**S2. A Deny after a slow decision ended the run as stuck. Fixed.** The stuck detector counted the
screenshot from before the card, so 26 s of human thinking were inside "the screen has not changed
for 30 seconds". Commit `e5f3ed9`. Seen fixed live half an hour later, in run `31424384`.

**S3. The bot asked for the user's own sign-in, twice.** Asked to email a report, a bot with no
mailbox of its own picked Gmail and asked the owner to sign in to his personal Google account on the
bot's computer. The prompt says "the user's own logins never come to you at all", and invariant 5
says the same of the product. Nothing was typed. What the platform did right: "Hand back anyway" was
refused on Google's page, because part of it is a frame the companion cannot read; after the tab was
closed the hand-back was allowed; and **Stop during a takeover** ended the takeover as "stopped by
the user" and the run as `cancelled`, the first live sighting of that path. What is missing: the
decision record expected the bot to ask which mailbox to use. It never asked. For the write-up: a
mailbox must be a thing a bot *has*, not a thing it goes looking for; that is the "mailbox per bot,
held in its folder" already named in `docs/decisions.md`.

**S4. Two cards that a user would not expect.** The close button of the developer tools and the
"Continue" button of a login page both stop for approval. Both are the gate failing closed, as
designed. Both got Deny, because the owner's permission covered send cards only. Hunter's skill avoids
the second one by asking for the takeover before it types anything; Swimmer's skill now says the same.

**S5. The new-bot form's emoji field keeps its default.** The field starts with a robot emoji, and
typing adds to it, so Swimmer's avatar is two emoji. Select the default first. Worth knowing before
a bot is created on camera.

**S6. The model provider refused the call one click before the send.** The API answered 400, "You
have reached your specified API usage limits. You will regain access on 2026-10-01": the monthly
spend limit the owner had set on the organisation, the first of two layers (the platform's daily budget
is the second, and it was at $6.33 of $25). The platform's logs added up to $29.19 for September.
The approval was not consumed and nothing was sent. The owner raised the limit, and 23 minutes after
the refusal the cycle went on.

**S7. The chat reported the refusal as "the model stopped answering … retry". Fixed.** Commit
`9b61c04`: a refusal is named in fixed words, and the provider's own text stays in the server log.
Not seen live since: no refusal came after the fix.

**S8. Asked to move a routine, the bot made a second one.** "Move the morning report from 7:00 to
12:41" produced a new routine named after the skill, next to the 7:00 one, and a chat message that
said the routine had been moved. The tool's answer was truthful ("saved routine", not "replaced");
the bot's sentence was not. Told so, the bot agreed and turned it off. There is no tool to delete a
routine, so the test routine stays in the folder, off. For the write-up: the correction rule says a
change of time is a save under the routine's own name, and the model did not follow it; the chat
gives the user no way to remove a routine.

**S9. The skill the bot wrote had lost three things from the goal.** The user's swim hours, the
ten-line limit and the language were in the first message only. The bot never wrote them to memory,
and they fell out of the chat lines that come with each goal, so the routine's run recommended 6:00
on a weekday in a long mail. It also read the number on yesterday's trend bar, a count of readings,
as occupancy. Three sentences in chat put all of it into the skill and the limits into memory. For
the write-up: what the user says once, in the goal, is kept only if the bot writes it down; the
task-shape rule covers answers to questions, and this goal needed none.

## What this cycle does not prove

- A morning report that uses a capture note from the evening before (see the table above).
- A bot that gets it right alone. It needed three corrections before the first mail and four after
  it. Each was one or a few plain sentences, and each stuck.
- That the reports' numbers are right beyond the one chart that was checked.

## Secrets

The count-only scan after the sign-in: 941 files under `data/` plus both server logs of the cycle.
Mailbox password: 0 files. E2B key: 0. Anthropic key: 0. The positive control was true for each. URL
credential patterns in `data/bots/` and the logs: 0 files. This folder was also checked for mail
addresses at Gmail, key-like values after "apikey", publishable or secret keys, tokens and the data
host: 0 each.

## Left in the real systems

- Two mails from `bot@example.test` in the inbox of the address the owner chose.
- **Swimmer was removed the same afternoon, on the owner's word.** Claude moved its folder out of
  `data/bots/` into the macOS Trash (`dobot-swimmer-0cc4-2026-09-18`), so the unmasked chat and run
  logs, with the address and the site's publishable key, leave the disk when the owner empties the
  Trash. The owner then killed its computer `io0a0e3yxdtjr468xrihz` himself, because that cannot be
  undone (`data/kill-sandbox.mts`, which refuses a computer that a bot in `data/bots/` still uses).
  Afterwards the E2B project listed one computer, Hunter's. What remains of Swimmer in the
  repository is this folder.
- Hunter's mail check on.
- For the owner: filmed or proof only. A guide for creating the bot again is in his local notes, which
  git ignores.

## Files

- `runs/<id>/events.jsonl`: every run's events, masked.
- `bot-files/`: the skills, routines, memory, chat and `bot.json` as the bot and the platform wrote them, masked.
- `capture-chart-zoom.png`: the zoom the capture run read. `first-mail-sent.png`: Seznam's confirmation.
