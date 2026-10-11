# Documentation guide

Start with these documents for the current POC:

- [Decisions](decisions.md): product choices, trade-offs, limits and proposed next steps.
- [Operating guide](operating-guide.md): configuration, recovery and runtime limits.
- [Verification](verification.md): what was tested, supporting records and what remains unproven.
- [Build history](build-history.md): detailed rehearsal and review notes moved out of the decisions document.

## Design and development history

[Specs](specs/) record requirements and design decisions. [Plans](plans/) record intended
implementation steps and later execution notes. Both stay in Git so changes to the code can
be understood alongside their reasoning.

Read dates, status notes and later amendments before using an older document. A proposal is
not proof that a feature exists. Historical checkboxes are not the current task list.
Outstanding work is tracked in a private backlog that this snapshot does not include. Use the
documents above for current behavior.

## Evidence worth keeping

[Evidence](evidence/) supports specific verification claims. Keep concise results, useful
reproduction scripts and selected screenshots or measurements. A record should name what was
checked, the revision or date, the result and its limits. Include failures when they explain
a correction or a known limitation.

Save new raw logs, temporary screenshots and unreviewed captures under `.local/evidence/`,
which is already ignored by Git. Copy only the material needed to support a recorded claim
into `docs/evidence/`. Check it for secrets and unnecessary personal information first.
Existing tracked evidence stays available at its current paths so references still work.

Names of third parties in the records are replaced with placeholders: employers appear as
"Company A", "Company B" and so on, and job postings have example numbers. The mailbox address
is `bot@example.test`.

This is a public snapshot of a private repository. It leaves out raw run logs, screenshots, bot
files, generated letters and company dossiers, and the records of two live runs (a grounded
application run and a house-search bot). Older documents still name those files and folders; they
are not in this snapshot. The same holds for the original example bot folder
`examples/job-hunt-bot/`, which the older plans and records mention. Three screenshots in
`evidence/2026-09-17-loops/` stay because a test reads them; account details in them are painted over.

The project started as a take-home proof of concept for a company, September 2026.

Ignoring a directory does not remove files already tracked by Git. If evidence is later
removed or moved, update every reference and preserve the support for any remaining claim.
