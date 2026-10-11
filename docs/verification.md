# Verification summary

[Back to the README](../README.md)

These records describe tests already performed, not a promise that every future run succeeds.
They include failures, corrections, costs and limits. The remote computers and external outcomes
were real. Recorded costs are model costs unless a record says otherwise.

## Live evidence

| Capability | What was verified | Record |
| --- | --- | --- |
| Application preparation | Real forms, sourced letters and CV attachment; Deny caused no further computer action. | Grounded application run (record omitted from this snapshot), [batching checks](evidence/2026-09-19-cache-batching/README.md) |
| Report delivery and email orders | Full company reports reached the recipient; reply handling, interrupted selections, replay checks and a second site's form were exercised. | [Hunter mail checks](evidence/2026-09-19-hunter-mail-checks/README.md) |
| Interview booking | A supplied invitation started a run; one approval produced a real booking. Confirmation and cancellation mail did not create a second booking. | [Booking run](evidence/2026-09-18-act-two/README.md), [later run](evidence/2026-09-19-cache-batching/README.md) |
| Screen takeover | Human mailbox sign-in; hand-back refused while the password remained in its field; count-only scans checked for credential leakage. | [Takeover](evidence/2026-09-18-takeover/README.md), [report correction and cancellation](evidence/2026-09-18-takeover-report-fix/README.md) |
| Restart persistence | Chat, memory, skills and routines survived a server kill. A later goal reconnected to the same browser. | [Platform plan: Persistence check](plans/2026-09-11-platform-plan.md#persistence-check--2026-09-13-a-restart-mid-run-and-a-restart-of-a-blocked-bot) |
| Learning through chat | A fresh bot saved and corrected a skill, used it after restart, and saved, paused and resumed a routine. | [Learning checks](plans/2026-09-15-learning-gap-plan.md) |
| Other kinds of work | Bots created in the page reported a pool's occupancy and researched houses, with real report emails and skills written through chat. | [Pool bot](evidence/2026-09-18-side-proof/README.md), house bot (record omitted from this snapshot) |
| Clean installation | A fresh macOS user account without Node, pnpm or a warm package store reached a completed first goal. | [Clean-machine check](evidence/2026-09-20-clean-machine/README.md) |
| Budget refusal | A zero daily budget prevented a run from starting. | [Daily-budget plan](plans/2026-09-13-daily-budget-plan.md) |
| Connectors instead of the computer | A town was researched with the Wikipedia and Mapy.com connectors and no computer step ($0.39, baselines $0.55 to $1.93). An invitation was read from the bot's mailbox and a Cal.com time proposed with no computer step; the booking stopped at its card, was denied, and Cal.com still offered the time. Each connection was granted by one Connect click in the chat; each skill was corrected in the chat. The mail run with two grants cost more than its baseline ($0.44 against $0.26) because each grant rewrites the prompt cache; a later run with the connections granted cost $0.34, most of it the model's thinking about a duplicate invitation. | [Connectors check](evidence/2026-09-24-connectors-m1/README.md) |

Early sandbox, browser, upload and pause/resume experiments are recorded in the
[platform plan](plans/2026-09-11-platform-plan.md). The
[platform-boundary check](evidence/2026-09-19-platform-boundary/README.md) records both demo acts
after job-specific wording was removed from the shared prompt.

## What this does not establish

- **No real job application was sent.** Both application sites were tested through preparation
  and denial. Their actual submission paths remain unverified.
- **Delivery is not matching quality.** The delivered report in the mail checks flagged concerns
  about location, seniority or company type. Receiving it does not prove every candidate fits.
- **Interview invitations were seeded.** The author supplied them from a development address and
  used his own scheduling page. Bookings were real and cancelled afterwards.
- **Some rehearsals were driven by another agent**, including approval clicks authorized by the
  author. Those runs prove the mechanism, not a human interacting with every card.
- **Takeover does not prove universal secret protection.** The password-field typing guard has
  automated tests but no live exercise in these records. Stop during takeover was exercised
  through the API in the house-bot checks (record omitted from this snapshot); the page has
  no Stop button in that mode. Known frame and restart limitations are in the
  [operating guide](operating-guide.md#screen-controls-and-approvals).
- **The five fixes of the last audit had no live run.** Four are proven by tests that failed
  before the fix. The page fix was proven in a browser against the real server code, with a fake
  computer and a fake model. None ran against a real computer or a real model.
  [Audit record](evidence/2026-09-20-audit-five-findings/README.md).
- **The clean-machine check used the author's EU E2B project.** It did not reverify the default
  cluster, Linux or Windows, and did not run preflight in that new account. The first goal read a
  public page as text, so it proved setup and completion rather than screen interaction.
- **The shortened README is not a new clean-machine test.** The record above applies to the
  revision it names. Current commands and links are checked locally; historical evidence is not
  relabelled as a fresh live run.

## Portable Homer example

`examples/homer/` packages the original persona and learned skill with fresh preference memory
and one unchanged historical report. The portable skill limits new searches and reports to two
houses to reduce costs, and its email instruction asks for the current user's mailbox instead of
using the author's. The historical five-house report predates the new limit. No original sandbox, credentials, chat, pending work or routines
are restored. Boot recovery covers both shipped example folders; local checks also load Homer's
skill and sample through the real store. These checks do not establish a new live search or send.

## Automated checks

Run `pnpm preflight` for typechecking, TypeScript tests, Python companion tests and platform-boundary
checks. Python tests are skipped with a message if Python 3 is unavailable. Test totals change with
the code; each evidence record keeps the count for its own revision.

Focused records include [model-call lifecycle probes](evidence/2026-09-17-model-lifecycle-review/README.md),
[mail delivery and connection checks](evidence/2026-09-19-email-trigger-fixes/README.md) and
[what the chat says when the provider refuses a call](evidence/2026-09-20-provider-refusal-in-stream/README.md).
The last one is proven by probes through the real SDK over a local server; no refusal was seen live
after the fix.
[The five findings of a late audit](evidence/2026-09-20-audit-five-findings/README.md) holds the
browser check of the takeover page against the real server code with a fake computer and a fake
model.
Automated tests establish code behavior under their inputs. Changes to model instructions also
need live checks of completed work and external results.
