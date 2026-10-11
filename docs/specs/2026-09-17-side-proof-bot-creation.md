# Side proof: a bot born on the page

**Date:** 2026-09-17
**Status:** In progress. The pool-site job is chosen for the proof; whether it is filmed is open
until the live cycle has run. A second candidate, a used-item auction watcher, is assessed at the end.
**Decided by:** The owner, in the session of 2026-09-16 evening and 2026-09-17, after a menu of
candidates (below).

## Purpose

Hunter stays the flagship. It ships with hand-written skills so the filmed run has a known path,
and its flaws are named openly in the write-up: a single developer's spare evenings, alongside a
day job and a second case study; every live run, its cost and its defects are in the rehearsal
notes. Nobody expects a flawless Grok Bot alternative in a week.

What the flagship never shows is a bot being made. Invariant 7 says the user configures the bot in
plain language and the bot writes its own skills. That is proven only by the Scout run of
2026-09-15 (`docs/plans/2026-09-15-learning-gap-plan.md`, "Evidence"): ten runs typed through the
API, no page, no screen, a blog read the cheap way. The side proof closes that gap: a new bot,
created in the page from a blank roster, learns a small job on its own screen.

1. New bot in the roster: name, emoji, one sentence of persona. "My computer is ready" appears.
2. A goal in plain language.
3. The bot asks only for what is missing, one question at a time; the answers land in memory.
4. It does the job once, on its visible computer.
5. "Save this so you can do it again" gives the skill card. "Every morning at 7" gives the routine
   card. A correction in chat rewrites the skill under its own name.
6. The next morning the ring turns blue with nobody typing.

It might be a short clip in the video, to show how the product is understood, or it might be a
proof for the author only. The owner decides after seeing the live cycle. It never replaces Hunter.

## What a side proof needs, and what it does not

Different from the flagship rubric in `.claude/skills/discover/SKILL.md`, because Hunter already
carries the approval gate, the takeover and the real irreversible action on camera.

- The screen must be needed for real, not as a costume: a page the cheap path (`fetch_url`, twenty
  thousand characters of stripped HTML from the operator's machine) cannot read.
- Something real should exist afterwards.
- The job should repeat, so the routine has a reason.
- It must not touch Hunter's surfaces: the `mail-arrived` event fires every bot's mail routines
  (`fireEvent` in `src/server/scheduler/scheduler.ts`), so the side bot runs on a clock, and the
  booking page's risks stay Hunter's.
- Gate and login are optional. Cheap: one live cycle on a fresh bot, under a dollar, about thirty
  minutes of the owner's time, no platform code.
- Not: payment, scarce public slots, posting to third-party sites, the user's own accounts (the
  credentials rule), government portals behind bank identity.

## Candidates considered

| Candidate | Screen needed | Real result | Gate | Login | Repeats | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Booking secretary: act two alone, born on camera | yes | a calendar event | yes | yes | per invitation | Rejected as a side proof: it overlaps Hunter's mailbox trigger and booking page and shares their risks. |
| AI news digest, typed into webmail | reading is the cheap path; only the send is on screen | a mail | yes | yes | daily | Rejected: the screen would carry only the send, "the whole world" is vague, and the record already rejected an email-only action on G1. |
| Morning check of a deployed site of the owner's | yes, a flow | a note | optional | no | daily | Kept as a shape; the pool site is its everyday version. |
| Renew library loans due this week | yes | loans extended | yes | yes, PIN by takeover | weekly | Good; needs a card with a current loan. Not pursued. |
| Weekly competitor pricing watch | maybe; server-rendered pages read cheaply | a note plus memory | no | no | weekly | Story for the client, weak on the screen. Not pursued. |
| First trains Prague to Brno after eight | yes, a search form | a note | no | no | daily | Fallback that needs nothing. |
| Pool occupancy, air quality, cinema tonight | maybe | a note | no | no | daily | Same class, less use. |
| Log a value into a form the owner owns | yes | a row | yes | no | daily | Shows the gate on a bot-written skill; looks staged. |
| Free-webinar registrations | yes | a confirmation mail | yes | no | weekly | No: vendors get a bot as a lead, the mail wakes Hunter. |
| Tidy the bot's mailbox | yes | mailbox state | yes | yes | weekly | No: shares Hunter's inbox, could delete its mail. |
| Parcel tracking | yes | a note | no | no | while parcels exist | No: timing-bound. |
| Register for a seminar on the owner's registration site | yes, a form | a row in his database, a confirmation mail | yes | no | when an event is open | Good alternative: a real record and a card on a bot-written skill; needs an active event, and a public test event can collect real registrations. Kept in reserve. |
| **Pool site: best time to swim, mailed every morning** | yes | a mail in the owner's inbox | yes, the send | yes, the mailbox | daily | **Chosen.** |
| Used-item auction watcher | see the assessment at the end | | | | | Assessed 2026-09-17. |

## The chosen job: the pool site

**The site.** <https://pool-occupancy.example/>, a public occupancy site: it imports the occupancy of
a local public pool and shows averages so a visitor can pick a quiet time. Checked on 2026-09-17 in the
browser and by a raw fetch.

- The raw HTML is 433 bytes with only the title. The app renders everything in the browser from
  Supabase (PostgREST), so the bot's cheap path reads nothing and the screen is needed for real.
- The bot has no page-text tool for its own browser (`src/server/agent/tools.ts`): it reads
  screenshots, with a `zoom` action that crops the last one. The site prints its numbers, which
  is what makes that reading exact.
- Honest line for the write-up: the numbers are one PostgREST call away, with the public key in
  the bundle as Supabase does it. The bot does not know that, and the product's claim is no
  integration work. A reviewer may still say it. The site also does the maths; the bot reads,
  filters by the user's constraints, and writes the mail.

| Part of the page | Form | Readable how |
| --- | --- | --- |
| Live status: occupancy now, temperatures, "updated 3 h ago" | text | screenshot |
| "Dnes vs. průměr": today against the weekday average | bars, numbers only on hover; empty at 7 in the morning | one hover per hour |
| Long-term heatmap, weekday by hour | numbers printed in every cell | screenshot, zoom |
| Best and worst times | list with percentages | screenshot |
| Weekday and weekend daily profile | numbers printed | screenshot |
| 14-day trend | one bar per day; hover shows date, peak and average | one hover for yesterday |
| Monthly, per-month and seasonal views | numbers printed | screenshot |

**Yesterday.** The owner's addition, "yesterday's free and busy times and any deviation from the
long-term pattern", exists on the page only as a day summary: one hover on the 14-day chart gives,
for 16 September, a peak of 38.9 percent and an average of 26.6 percent, against a Wednesday row in
the heatmap around 40 percent in the afternoon. Three routes:

1. **No site change.** The bot reports yesterday's average and peak against the weekday's heatmap
   row. A real deviation statement from one hover. The version to run first.
2. **A "Včera vs. průměr" panel on the site.** The same component as today's chart with
   yesterday's date and the values printed on the bars; then the bot can name the hours that
   differed. The owner's hours. The day bars are labelled 6, 8 or 10, which looks like readings per
   day, so the hour-level picture stays coarse either way.
3. **An evening run** that reads today's chart at closing time and writes one memory line the
   morning mail reports. Memory becomes the reason the mail can say anything about yesterday, at
   the price of two routines.

**Decided 2026-09-17 (the owner): route 3, the bot saves yesterday itself.** The site does not
change. Two skills and two routines:

- **Evening capture**, after the day's last reading (assumed 22:00; the pool closes at 21:00 and
  the importer's schedule is the owner's to confirm): open the site, read "Dnes vs. průměr". The site
  already classifies every hour against the weekday average (the legend: below, around, above), so
  one screenshot gives the classes and a hover is needed only for the hours that differed. Write
  one memory line: the date, the weekday, the hours below and above the usual pattern with their
  numbers, the peak. No mail, no gate; a cheap run.
- **Morning mail** at 7: read the heatmap row for today's weekday and the best times, read
  yesterday's line from memory, and after a few days the trend across lines ("quieter than usual
  three days running"), then write and send the ten lines as below.

Why this beats the panel: no site change, and persistence stops being a page-reload trick. One
routine writes what another reads the next day, across a paused computer and possibly a restart.
Costs and limits: memory grows by one line a day, which the Skills tab lets the user prune; the
first morning has no yesterday line and the mail must say so; the capture depends on the site's
own classification, which is the site's maths, not the bot's. The live cycle can be compressed
into one evening: the capture first, then "now do the morning report" against the fresh line.

**The goal sentence** (a test input, not the video script). The short form first, to see
whether the bot works out for itself that yesterday's hours are on the page only until midnight
and proposes the evening capture:

> Every morning at 7, look at the pool site https://pool-occupancy.example/. Tell me the best
> time for me to swim today, and how yesterday compared with a usual day of that weekday, hour by
> hour. I can go weekdays after 17:00 and any time at weekends. Email it to <address>, ten lines
> at most, in Czech.

If it does not, the correction in chat, which is a plain-language instruction and not
engineering: "The page shows yesterday only until midnight. Every evening at 22:00 save the day's
readings and how they compared with the average, and use those notes in the morning."

**The shape of the first run.** A fresh bot has no memory of a mailbox, so it will say it cannot
send email or ask which account to send from; the answer ("the webmail at mail.example.test, this
address, I will sign you in") becomes a memory line, and the capability rule doing its job is
worth keeping. The bot opens the pool site on its screen and reads it. It opens the webmail, meets
the sign-in page and asks for a takeover; the owner types the password on the remote screen and hands
back. It writes ten lines; the send button hits the platform rule, so the card appears whether or
not the bot announced it. Allow once. The mail lands on the phone. Then the skill card, the
routine card (cron, seven in the morning), and one memory line per morning with yesterday's
verdict, so after a week the bot can say "quieter than usual four days running".

**Trade-off, written down.** The screen carries the send because this POC has no mail tool; the
production path is a mail tool with a masked secret card, already named in `docs/decisions.md`.
Every new bot starts with approval on everything, so "I get an email every morning" is true only
while the owner presses Allow at seven, or after a standing rule for that one send button is written
by hand. For the clip that is one press on camera; for real use it is the open "trust is earned"
item in the private backlog, and this job is its cleanest example.

**What one live cycle must tell.**

- Whether the Seznam compose works on the bot's screen. Nothing has driven it yet.
- Whether the bot reads the heatmap and the hover correctly; compare with the page.
- How long ten typed lines take, and the cost per run (expected: under a dollar for the cycle).
- Whether the routine's morning run survives the resumed computer's slow first page (round 4,
  finding A). Until the stuck-detector fix lands, a short goal a minute before keeps the computer
  awake.
- Whether the evening capture reads the site's classes and the hovers correctly, and whether the
  morning run finds and uses the memory line; compare both with the page.

**Decided 2026-09-17 (the owner): the shared mailbox.** The pool bot sends from Hunter's address,
`bot@example.test`, signed in by takeover on its own computer. Checked first in Seznam's help: a
free Seznam mailbox has no aliases of its own. What Seznam calls an alias is sending from another
address the user already owns, verified by a link sent there, up to ten, and mail to it keeps
going to its own mailbox ("Nastavení jiné e-mailové adresy jako aliasu nemá vliv na doručení zpráv
poslaných na danou adresu"); true aliases, an alternative address that lands in an existing
mailbox, exist only in Email Profi on an own domain; plus addressing is not documented. Even with
aliases the mail trigger would not separate bots: the watcher counts unseen mail in one inbox and
fires every bot's mail routine. So the shared address is named in the write-up as the shortcut it
is, and the production path stays the one recorded in `docs/decisions.md`: a mailbox per bot, held
in its folder. The only effect on the demo: a reply from the owner to the report starts a Hunter mail
run that says "nothing new", for a few cents. Creating a mailbox per bot by hand is the kind of
setup the product should not ask of a user. Sources:
Seznam Email help, pages "Nastavení odesílatele" (sender settings) and "Aliasy" (aliases).

**Decided 2026-09-17 (the owner): the report goes to his personal address**, the target of the
Seznam copy rule. The address is typed into the goal sentence in the page on the day, so it lands
in the bot's memory and is written nowhere in this repository.

**Nothing in this bot's folder is written by hand (the owner, 2026-09-17).** That is the whole point
of the side proof, and it is invariant 7: Claude prepares the goal sentence and the answers the owner
will give in chat; the bot writes its skills, its routines and its memory itself, through its own
tools, on the platform. The two-routine sketch above is what the goal needs, not a file to write.
If the bot arrives at another shape that meets the goal, that shape stands and is recorded as it
is; a shape that misses the goal is corrected in chat, in plain language, never in a file. Hunter's
hand-written skills are the flagship's fixture and the exception, named as such.

**Open, for the owner.** Filmed or proof only, after the cycle.

**Cycle runbook** (one step at a time when live; the owner at the keyboard, Claude recording):

1. Before: the server up on the EU cluster; Hunter idle, with its mail check turned off in chat
   for the cycle ("stop the mail check"), because the sign-in on a new computer may put a Seznam
   security notice into the shared inbox and start a Hunter run; the day's spend noted.
2. The owner, in the page: New bot with a name, an emoji and one sentence of persona. Wait for "my
   computer is ready".
3. The owner types the short goal sentence, with the personal address, and answers the bot's
   questions in plain language: the constraints if asked, the mailbox ("use the webmail at
   mail.example.test, address bot@example.test, I will sign you in"), Czech, ten lines.
4. First run: the takeover for the sign-in when the bot asks, hand back, Allow once on the send
   card. Check that the mail arrived.
5. If the bot did not propose the evening capture: the correction sentence, then let it do the
   capture now.
6. "Save this so you can do it again" if it was not offered; "every morning at 7" and "every
   evening at 22:00" for the routines. Read the skill and routine cards.
7. "Now do the morning report" once more, to see the memory line used. Allow once.
8. Claude records in the platform plan's rehearsal notes: steps, cost per run, the files verbatim,
   what the bot wrote against the sketch, defects. The owner decides filmed or proof only. Hunter's
   mail check back on.

**Plan.** After the Cal.com check and round 4 (they gate the flagship): one live cycle on a fresh
bot from the page, recorded in the platform plan's rehearsal notes with cost per run. If it goes to
the video: a README paragraph on creating a bot, a decisions entry, the TODO item ticked with the
proof. Delete the proof bot and its computer afterwards, as with Scout, or keep the folder as a
second example.

## Second candidate: a used-item auction watcher

The owner's idea, 2026-09-17: "I pick an item I want to buy, used; the bot searches auctions and
keeps me updated on the closing ones, with the highest bids and which auction is the best way to
get it."

**The surface: Aukro** (<https://aukro.cz>, the Czech auction site), checked 2026-09-17 from the
operator's machine, in the browser and by a raw fetch.

- The home page says JavaScript is required, and a search renders its result list in the browser.
  A raw fetch of a search returns the filter names and a few items; the filters the job needs
  (type of offer: Aukce; condition: Použité; "Končící za méně než", ending in less than N hours;
  sorting) need clicks. The screen is needed for the job as asked.
- Each result shows what the job needs: condition, title, the number of bids ("11 přihazuje"), the
  current price, the time left ("Končí za 3 dny, 19 hodin"), and a buy-now price where there is
  one. An item page adds the seller and the shipping.
- A cookie wall covers the page on the first visit ("Odmítnout" / "Souhlasím"); a click on it may
  cost one Allow, as the job board's banner did on 2026-09-16. eBay refuses a plain fetch with 403
  and is not the surface for Czech used goods anyway.
- Not checked: whether Aukro accepts the bot's datacenter address (a two-minute goal on a
  throwaway bot answers it, for cents), and Aukro's terms on automated reading (see below).

**What the job gives.** The screen is needed. The routine has a reason: auctions close at
different times, and "keep me updated" is a run every few hours, the platform's floor being
fifteen minutes. Memory has its richest job of all the candidates: the watchlist across runs, the
last price of each auction, which one closed, which it already reported. The deliverable is a
judgment (time left, price, bids, seller, shipping), which is coworker work. And it is legible to
anyone: "find me a used ThinkPad at auction and tell me which one to go for".

**What it lacks.** No real action: the bot must not bid, because a bid is a binding commitment
and bidding needs an account the bot cannot hold for the user, so the irreversible step is
the owner's own click on Aukro, outside the platform, and no card appears. No login. The result is a
note, or a mail typed into webmail with the same costume as the pool job. A third-party site
brings the datacenter risk, a cookie wall and a terms question the pool site does not have.
Frequent runs cost: five to ten screens a run, several runs a day on closing days, a few dollars a
day, inside the budget but not free. Reading many results by screenshot invites an invented bid,
so the skill must carry the link of every auction it names.

**Verdict.** A good side proof. Better than the pool job in memory and routines with visibly
changing content, in a need everyone has, and in a real marketplace on screen. Worse in the
external risks, in having no real result beyond a note, and in cost. If the purpose is a proof
for the author, the pool job is safer. If the purpose is a clip, the auction watcher may land
better with the audience, once one check has shown that Aukro opens from the bot's computer.
The owner decides; both are cheap.

**The goal sentence, if chosen** (a test input; the item and the ceiling are the owner's):

> I want a used Lenovo ThinkPad X1 Carbon for at most 6 000 Kč, from Aukro. Every evening at
> 20:00, find the auctions that close in the next 24 hours, tell me the current highest bid and
> the time left for each, and say which one you would go for and why. Never bid; I do that myself.
