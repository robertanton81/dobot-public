# Hunter mail checks and dossier delivery

> Snapshot note: this record names raw logs, screenshots, generated documents or bot files that are not part of this public snapshot. The written results and the small result files in this folder remain.

User scope: finish the remaining mailbox checks and include the dossier report in
Hunter's shortlist email. No real application or booking may be submitted.
The user authorized the necessary task actions while away from the computer.

Final result: the complete dossier email was delivered, and the remaining mail,
restart, form-preparation and replay checks passed. No application or booking
was submitted during these checks. Both final replays ended with only
`Nothing needs action`. Earlier failures and their corrections remain below.

## Dossier correction

Root cause: `shortlist-and-report` explicitly required a mail of at most 15 lines,
containing only the numbered shortlist, recommendation and reply instructions.
The saved artifact also held only a short fit note for each offer.

Teaching run `02ecfd82-8fd9-4ca3-858c-422386ef0dbe` updated that skill and the
existing `morning-search` routine through chat. Each listed offer now gets a
compact dossier in the artifact and in the email body: company, responsibilities,
stack, seniority, location, profile fit, concerns, unknowns and public source URLs.
The email starts with the numbered summary and recommendation. A local artifact
path is not a substitute for delivering the dossier.

All behavior lives in Hunter's saved skills/routine and the example bot. This
change adds no use-case instruction, field, branch or tool to `src/`.

### Delivery states

| State | Required behavior |
| --- | --- |
| Success | Send the complete report after approval; record sent only after mailbox confirmation. |
| Failure or timeout | Preserve the report; verify the Sent folder before assigning a delivery outcome. |
| Stop | Do not send; an unresolved outcome is checked in Sent on the next run. |
| Retry | Never click Send twice using one approval. |
| Partial research | Include a dossier for every listed offer; identify unverified facts and use fewer offers when needed. |
| Restart | Retain the artifact and numbered memory line; resolve an unknown send outcome from Sent. |
| Deny | Record not sent and do not retry without a new request. |

## Live results

Results below are filled from run events, saved memory and mailbox evidence.
Private addresses are masked in committed records. Local raw evidence stays in
the ignored `.local/hunter-final-checks-20260919/` directory.

| Check | Result | Evidence |
| --- | --- | --- |
| Dossier skill and routine saved through chat | PASS | Teaching run above; typecheck passed. |
| Same-minute greeting replies | PASS | Run `77695c0b`: UIDs 160 and 162 arrived at 23:36:12 and 23:36:55 Prague. Separate closure records preserved the whole greeting and order. |
| Same-minute long and short replies | PASS | Run `b8fb4733`: UIDs 184 and 186 arrived at 07:33:35 and 07:33:39 Prague on September 20. Separate closures; long-text question asked once; notice arrived at 07:38; a no-numbers answer created no selection. |
| Automatic mail trigger with Hunter's actual skills | PASS | Run `77695c0b-b904-4a9b-bb2e-c41832dd5daa` started without a chat goal. |
| Automatic replay of the same messages | PASS | Final run `4e879f7c` started from the real mail watcher after restart. No new verdict, question or approval; closing report only `Nothing needs action`. Earlier reporting failures and corrections are recorded below. |
| Direct chat request to replay the saved routine | PASS | Final run `8f9c959d` ended with only `Nothing needs action`, without new verdicts, questions or approvals. |
| Prepared but never sent shortlist | PASS | H8XM3T draft was stopped before Send. Run `b8fb4733` checked Sent, recorded not sent, and closed the owner reply. A wrong-sender reply in the same minute was separately closed with text not kept. |
| Sent-folder recovery after removing a sent memory line | PASS | Removed only the backed-up J7QX2K sent marker. Run `ebca698d` checked the real Sent folder and restored the sent fact before accepting the reply. |
| Interrupted selection and overlapping reply | PASS for recovery and no duplicate work | Runs `ebca698d`, `47eecf27`, `e48e2a22`: one claim per reply, uncertain number left after one question, new number reached its card, timeout denied it, later mail could not reopen the left number. |
| Second site's application form, ending with Deny | PASS for form preparation | Run `d0bad032`: native jobs.cz form filled, letter and CV attached; two optional consents and final Odeslat odpověď card denied. Nothing submitted. |
| Complete dossier delivered by email | PASS | Run `ad4f2d7d`, one Send card allowed. Sent UID 190 at 07:48 Prague; both complete dossiers inspected in the recipient Gmail. |

No application or booking approval has been allowed during these checks.

## Finding: oversized mail omitted the required question

Run `77695c0b-b904-4a9b-bb2e-c41832dd5daa` saved four correct closure records,
including the complete greeting lines and separate long/short records. All four
`remember` calls succeeded. It did not call `ask_user` or ask for numbers in chat.
The existing skill required this, so the failure is model adherence to Hunter's
skill, not an email transport or platform dispatch defect.

Teaching run `6ae045b0-0c2a-4b46-a548-e90401419892` made the question explicit.
Review caught two gaps in the new wording before it was finalized: it did not
handle the question timeout, and it could start an answered order before the
routine had handled other mail. The correction follows these states:

| State | Required behavior |
| --- | --- |
| Valid answer | Validate the shortlist/numbers, record a chat selection, return to routine order. |
| No valid numbers | Create no selection; continue the remaining routine work. |
| Tool failure or timeout | Create no selection; a tool status or its timeout duration is not an order. Ask only once in this run. |
| Stop | End the run without creating a selection from an unanswered question. |
| Replay or restart | Previously closed mail remains closed and is skipped silently. |
| Partial intake | Finish intake verdicts before asking; application work waits for routine Step Four. |

The first question edit remains visible in the run history. It is not represented
as the final reviewed instruction.

Run `246fb168-7bd6-40ff-9642-dca55c50e5df` called `ask_user`; the question notice
arrived in the report mailbox at 23:45 Prague. The operator answered that it was
a test and gave no numbers. Hunter created no selection from that answer.
This pair arrived across a minute boundary (23:42:56 and 23:43:02); the earlier
pair is the same-minute separation proof.

## Finding: replay report was not silent

The same run wrote no duplicate closure for the four earlier test messages and
started no application, but its final report counted those messages and listed
their times while saying it had skipped them silently. This fails the explicit
report rule. The final-report correction limits output to new verdicts, current
questions/actions, and work still needing attention. Completed history and
already closed messages must not appear in that report.

## Restart-test isolation

The normal server also hosts other bots. The interruption check must use a
separate process containing only Hunter, after disabling Hunter's normal mail
routine and waiting for its normal sandbox holder to release. It must not kill
or recover runs belonging to another bot. The original routine is restored
after the test state is synchronized back.

## Final same-minute run and report finding

Run `b8fb4733-e5fc-4b23-85dc-df4f69f1ea28` wrote five accepted memory notes:
a Sent-folder outcome and four separate mail closures. No selection, application
or booking was created. The required `ask_user` notice arrived at 07:38 Prague.
The operator answered that it was a test and supplied no numbers.

The report still counted six earlier handled mails. Automatic replay run
`b72d9f32-d4b8-426a-9354-946dcdff6a1b` wrote no verdict and started no work,
but again described old mail. Thus duplicate-work protection passed while report
silence failed. The skill already prohibited that output. The routine's own
closing instruction did not point to that report rule; the next teaching run
aligns it explicitly. This remains a model-adherence finding until live replay
passes.

During the first run Hunter mistakenly discarded the open H8XM3T draft while
trying to close its compose window. It immediately used Undo and restored the
draft. IMAP confirmed the restored full draft as UID 190, addressed only to the
configured report recipient with no CC or BCC. No application or booking was sent.
This is recorded as an observed browser-action error, not hidden by the recovery.

## Dossier delivered

Run `ad4f2d7d-4d93-4433-9ce1-2baeee23da4f` reopened the existing report,
verified its body against the saved artifact, and reached one valid Send card.
An initial malformed `propose_action` input was rejected before a card existed;
the corrected call produced the one card. Codex allowed only that report to the
user's configured address under the user's task authorization. Hunter clicked
Send once and checked the mailbox confirmation and Sent folder before recording
`Sent`. IMAP found UID 190 at 05:48:23 UTC. The recipient Gmail showed the report
at 07:48 Prague, with both full dossier sections, fit, concerns, unknowns and
public source links. The delivered body is identical to the verified draft.
There were no CC or BCC recipients.

Content limit: this check produced two candidates with explicit concerns. One
requires commuting to Vyškov and fails the Prague/remote constraint; the other
is a client-services firm with mixed seniority. This proves dossier delivery,
not that the candidate filtering meets every preference. No application was sent.

Review of the final report correction passed: automatic continuation now covers
a selection from any earlier run, while previously handled mail and unrelated
finished selections remain excluded. Routine Steps One to Four are unchanged.
The original `handle-replies`, `apply-to-posting` and `search-job-board` skills
are byte-identical to the session baseline.

## Sent recovery and interruption

For Task 10(d), the test removed exactly one backed-up `Sent on ... J7QX2K`
line through Hunter's memory editor. It retained the numbered shortlist, earlier
history and the newly delivered H8XM3T report. A real owner email `apply 3`
arrived as UID 194. Run `ebca698d-ce74-41bb-974e-f319eb97c08c` checked Sent,
restored the sent fact, recorded selection J7QX2K/4 and then its Started line.

The test watcher killed only the isolated port-3001 server at 05:51:52.614 UTC,
133 ms after Started was recorded. No posting was opened after that marker.
While it was down, owner email `apply 3, 5` arrived as UID 196 at 05:52:25 UTC.
The restarted server closed the interrupted run as failed with the honest reason
`the server restarted during this run`. Automatic run
`47eecf27-e9cf-42e5-83e7-0c8753711952` claimed only number 5 as J7QX2K/5 and
wrote `left out: 3, named by selection J7QX2K/4`. It checked for confirmation
mail and asked once whether to retry number 3. The test answer was `Leave it`.
Hunter saved a Left line for number 3, then started number 5.

The question notice arrived in Gmail at 07:55 Prague. Number 5 reached the real
`Odeslat zájem` card with the letter and CV attached. The card expired after
30 minutes and the platform returned Deny. No submit happened. Hunter described
this as “you denied,” although the event was a timeout; this attribution is an
additional reporting defect. The report correctly named both selections and
contained no older mail inventory in that run.

The owner then sent another `apply 3` mail (UID 198, 07:57 Prague). Automatic
run `e48e2a22-d537-4fe9-adac-234088a0a570` closed it because selection J7QX2K/4
already owns the left number. It created no selection and no Started line.
The functional restart and overlap checks pass. Its report nevertheless began
with an inventory of previously handled mail and completed selections, so the
report-silence criterion still failed. The next correction replaces the long
report section with a short, explicit output format, including truthful timeout
attribution. No platform report filtering is added.

## Second-site form

Run `d0bad032-46bc-473b-883c-7388ad9dac1d` used H8XM3T offer 1 only as a
form-learning check. Its location mismatch remained explicit. Hunter inspected
the native jobs.cz form, wrote the dossier and letter, filled the contact and
letter fields, and attached cv.pdf through `attach_file`. Two optional marketing
consents each reached an approval card and received Deny. Both stayed unchecked.
The final `Odeslat odpověď` card named the implicit service-terms acceptance and
received Deny at 06:52:30 UTC. Hunter recorded the filled, unsent form.

The plan permitted required terms approval during the old supervised run. This
run needed none: both boxes were optional and denied. No agreement or application
was submitted. The form contains the existing test phone placeholder from memory;
it is not evidence that real contact details are ready for an actual application.
The Allow/submission branch remains deliberately untested on both job sites.

## Generic denial-attribution fix

The timeout attribution was not solely a Hunter instruction problem.
`Runner.waitForApproval` resolves timeout and Stop through the same denied result
as a manual Deny. `propose_action` then returned `the user refused this action`
for every denied result. That exact condition falsely assigned an expired card
to a human choice.

The minimal platform correction changes only that result to `this action was not
approved; do not retry it`. It keeps the denied prefix, approval status, Stop
behavior and retry prohibition. No bot-specific condition or word was added.
The strengthened run-loop assertion failed on the old message, then passed with
the fix. Both agent suites passed: 182 tests. Code and test-quality reviews passed.

| State | Result after the wording correction |
| --- | --- |
| Allow | Existing approved result and scoped permission remain unchanged. |
| Deny or timeout | Not approved; no claim about who decided; no retry. |
| Stop | Existing cancellation and fail-closed behavior remain unchanged. |
| Failure or partial result | Existing failure/unknown-outcome handling remains unchanged. |
| Retry or restart | No new permission is created; persisted denied state remains denied. |

Trade-off: the current binary approval result does not distinguish manual Deny
from expiry. Neutral wording is truthful for both. A richer reason field would
be needed for cause-specific reporting; it is not needed to preserve the gate.

## Reporting conflict in the shared prompt

Replay `139c8aad` still described old handled mail after the concise Hunter skill
was saved. Tracing the exact prompt found a conflicting platform instruction:
`DOUBT_RULE` unconditionally said to describe what memory shows for completed
work. `LENGTH_RULE` also prohibited the headings requested by the skill. More
Hunter wording alone could not remove that conflict.

The fix makes only those reporting defaults defer to the skill or routine's
reporting rules and format. It preserves the approval rule, duplicate-work guard,
memory updates and handling of uncertain matches. Bots without a custom report
keep the existing defaults. The platform receives no shortlist, dossier or
site-specific instruction. Two prompt-contract assertions failed before the fix;
all 20 prompt tests and typecheck passed afterward. Code review passed; its small
comment correction was applied. The final mailbox replay tests model behavior,
which the prompt-string tests cannot prove.

## Replay after the credit top-up

Run `12fc0d54` stopped before any action because the model provider account had
insufficient credit. The user then topped up the account. The thirteen exact
test messages were restored from Archive, matched by their subject and received
date, and marked read. No new email was sent for this replay.

Run `8e9b3ef9-c9e2-416c-994f-3a8d238d3e56` completed five read-only computer
steps. It wrote no verdict, made no proposal and repeated no job. Its report
nevertheless listed old mail and completed selections. The platform prompt fix
therefore did not establish report compliance. This is a model-adherence
failure, not evidence of duplicate work or of an email dispatch failure.

Review found no remaining instruction requiring that inventory. Hunter's report
rules did use the broad terms "work performed" and "actions", which could count
read-only inspection as reportable work. This is a possible contributor, not a
proven sole cause. The next teaching correction narrows those terms in Hunter's
skill and routine only. Failed or incomplete inspection must remain visible as
work needing attention. The replay, rather than the wording alone, decides
whether the correction passed.

Teaching runs `3259203d` and `ce98962f` saved the clarified report definition.
They leave mail intake, sender validation, selection handling and routine Steps
One through Four byte-identical. Review required two details: incomplete checks
must be reported before evaluating the empty branch, and a newly recorded
Sent/not-sent finding must count as a new outcome. Both are in the saved text.

The first expanded skill save exceeded the tool's 20,000-character limit and was
rejected. Hunter then saved a shorter report section successfully, preserving
all earlier skill steps. It also placed `enabled: false` inside the routine's
instruction body instead of disabling the routine. The operator removed that
ineffective line through the existing routine editor and restored the actual
disabled setting before review. The routine was explicitly enabled only for the
automatic replay. These were observed teaching errors, not successful saves.

| Reporting state | Required result |
| --- | --- |
| Required checks complete, no new facts or unresolved work | Only `Nothing needs action`. |
| New verdict or delivery fact | Report the new fact without older mail inventory. |
| A selection resumed | Report every number's current outcome. |
| Failed, blocked or incomplete inspection | Needs attention names the missing check and next action. |
| Stop | Existing platform cancellation remains in effect. |
| Retry or restart | Saved verdicts stay closed; inspection alone creates no reportable outcome. |

The final code review passed the saved skill and routine. No further platform
change was made for this clarification.

## Final automatic replay

With the isolated server stopped, the test moved one existing test message to
Archive and back to Inbox, preserving its sender, received time, subject and
text. Its new Inbox UID made the real watcher detect mail after restart. No new
email was sent. Run `4e879f7c-4b44-49d9-a745-c2bfbdce95f5` was queued with
`source: routine` at 07:25:16 UTC and ended at 07:28:31 UTC.

It inspected the real mailbox, wrote no new verdict, asked no question and made
no approval proposal. Its closing message was only `Nothing needs action`.
A temporary black screen during navigation was reported while it worked, then
resolved; no old mail or completed-selection inventory appeared in its report.


## Final direct replay and verification

Run `8f9c959d-67e0-4054-b1dc-cbaebdd7069a` repeated the saved routine through
chat, the path that had failed before the clarification. It ended at 07:30:28
UTC with only `Nothing needs action`: four computer steps, no new verdict,
question or approval. Both final replay results are in `final-replays.json`.
The automatic replay took thirteen steps. Their combined recorded model cost
was $0.571241.

The evidence assertions pass for selection ownership, restart recovery, the
left-number guard, report delivery, form attachment and Deny. The original
`handle-replies`, `apply-to-posting` and `search-job-board` skills remain
byte-identical. The example bot and `bot-files/` contain the final reviewed
skills and routines. Private addresses are masked in `run-summary.json`.

Verification covers the current working tree. A clean installation was not
repeated in this follow-up; dependencies and setup commands did not change.
Real application submission remains deliberately untested on both sites.
Candidate filtering remains a separate limit: the delivered test report names
its mismatches rather than claiming every offer meets the profile.


## Cleanup and handoff

All thirteen identified test messages were marked read and moved to Archive;
none were deleted. A final IMAP check found Inbox empty. The delivered dossier
remains in Sent and in the recipient mailbox. No selection has an open or
uncertain number after the checks.

Hunter's remote computer was confirmed paused. The isolated server was stopped.
The normal server stopped independently during cleanup, so synchronization ran
with both local app ports closed. Before copying, hashes verified that original
Hunter state had changed only through this test's temporary routine pause. Only
Hunter's files were restored; other bots and the global mailbox watermark were
left alone. Hunter is idle, check-mail is enabled again, and its three new skills
and two routines exactly match the example fixture. See `sync-back.json`.

The verification commands are `pnpm typecheck`, `pnpm build`, `pnpm preflight`
and `git diff --check`. The final preflight includes the platform-boundary checks.
Code, test-quality and Hunter-skill reviews passed. `privacy-check.json` records
the count-only scan for configured secrets and the operator's private address.
