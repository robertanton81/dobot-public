# Homer — portable house-search example

Homer was created and taught through chat. He searched two property sites, researched the towns
around the offers, and sent three reports after approval. The records of those original runs are
not part of this public snapshot.

## What this copy includes

- The original persona and learned house-search skill, reduced to at most two houses to limit costs.
- A fresh memory file with the example preferences and setup instructions.
- Approval required for every gated action, no standing allow rules, and no automatic routines.

The skill has two adaptations: the shortlist and report are limited to two houses, with one town
researched per part, and email setup asks for the current user's configuration. The original
staged workflow and distance heuristic remain. That heuristic does not guarantee every house
is within 50 km by road. The five-house sample predates the two-house constraint.

The bot ID is `homer`, its remote computer ID is empty, and its status is reset. Original chat,
run records, credentials, browser sessions, sent-mail claims and unfinished work are not included.
This is a portable starting point, not a backup of the author's live computer. The portable copy
has local loading checks; the live evidence belongs to the original bot and is not included.

## Restore and use

Follow [Restore Homer in the README](../../README.md#example-bots).
The copy goes into `data/bots/homer/`; future changes are saved there, not in this template.
The copy command leaves an existing Homer folder untouched.

Ask for Part A to start a fresh shortlist. The
skill separates shortlist, research and sending into Parts A–D to keep context costs bounded.
Start each next part through chat after the preceding one is complete. There are no automatic
routines. Email delivery is optional and requires your own bot mailbox and a takeover sign-in.
No mailbox is needed for research and saving a report in the app.

The original six-candidate searches cost several dollars in model usage and needed multiple runs.
The two-house limit reduces the example's scope to control costs; its actual cost has not been
measured in a live run. Listings change and a run can still reach its step limit.
See the [operating guide](../../docs/operating-guide.md#use-the-example-bot) for the parts and limits.
