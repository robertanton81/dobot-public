# Act One grounding correction

**Goal:** finish the follow-up list from the Act One rehearsal: establish a verified source of
career facts, correct draft and approval-card facts, and repeat the real form through Deny.
**Authorization:** The owner asked Codex to do that list and continue autonomously.
**Scope:** existing chat, memory and skill tools, plus the local access correction found during
the run and recorded below. No new library, agent tool or approval rule.

## Cause and choice

The previous live run is the reproduction: see `docs/evidence/2026-09-18-act-one/README.md`.
The search skill told Hunter to use the CV. The run prompt contains memory and skills, but no CV
text. `read_artifact` reads Markdown/text outputs, and `attach_file` does not read a PDF.
The concrete work-history claims therefore had no demonstrated source in Hunter's inputs.
The wrong company duration and application date were already in the model's output; they were
not changed by the UI.

Use the existing conversation path. Codex checks selected career facts against the local PDF,
supplies them through chat with their source, and asks Hunter to save them with `remember`.
Hunter rewrites its two existing skills through `save_skill`. The search skill must ask for
missing career facts, preserve source dates and quantities, and check a draft before filling.
The application skill must distinguish application history from booking history and use the
date inside the matching memory note. Keep the form, attachment, approval and takeover steps.

This is an operator-assisted profile setup, not automatic PDF reading. A user can supply the same
facts in chat. A newer PDF needs updated profile facts in chat. Document that limitation in setup
and known limits. The upgrade is a bounded workspace document reader if automatic CV ingestion
becomes necessary. Do not hand-edit the live profile or put the owner's career facts in the example.

## State table

No lifecycle code changes. The existing runner and store handle these states.

| State | Required behavior and verification |
| --- | --- |
| Success | The bot saves sourced facts and both complete corrected skills. A later run uses them. |
| Failure | Inspect actual saved files and events; do not claim a save from the chat summary alone. |
| Timeout | Existing run limits apply; inspect partial saves before retrying. Never submit to recover. |
| Stop | Preserve completed writes, then resume only missing work through a new goal. |
| Retry | Rewrite the same skill names. Do not add competing skills or duplicate conflicting facts. |
| Partial result | Compare memory and both skills with the teaching request; correct any missing part. |
| Restart | Restart the server after teaching, fingerprint the files, then run a fresh application goal. |
| Missing profile fact | Ask in chat before drafting that claim; do not fill the gap from the posting. |
| New CV | Ask for updated facts before treating the old profile as current. |
| Deny | Record the real application outcome and date. No click on the final send control. |

## Work and acceptance

- [x] Teach the checked profile and corrections through the product chat.
- [x] Inspect the saved memory and skills; copy only the reusable skill bodies to the example.
- [x] Review the skill changes with a code-reviewer agent and address blocking findings.
- [x] Run typecheck and full preflight.
- [x] Restart and verify the saved inputs survive unchanged.
- [x] Run a fresh dossier, letter, real form, CV attachment, proposal and Deny.
- [x] Check every concrete career claim against the supplied facts; check company facts and dates.
- [x] Record events, cost, screenshots and cleanup; update the Act One TODO accurately.

No unit test will claim to prove model factual accuracy. The previous failing run and the new
live run are the behavioral evidence. Existing persistence, skill and approval tests still run.

## First corrected run: remaining content issue

Run `b21a8f60-3548-4751-b5e0-f489acc85e83` used the saved profile after restart. The
dossier preserved company dates and separated applicant facts. The letter still connected the
transactional-outbox work specifically to payment integrations, although the profile supplied
these as separate achievements. It also used present tense for the ended Previous Employer role and
added an unverified enjoyment claim. The previous broad instruction to check facts did not
prevent these additions. Preserve this draft as `letter-first-rerun.md`, teach the exact
correction through chat, and require a fresh draft before accepting the content result.

## Local access correction found during rehearsal

`lsof -nP -iTCP:3000 -sTCP:LISTEN` showed `*:3000`. The entry point calls
`serve` without `hostname`; the installed adapter passes that undefined value to Node's
`server.listen`. The API has no login. The server was stopped before editing.
The request path also has no Host or Origin check before bot and approval routes. Add tests
for an outside origin submitting a goal and an outside Host reading local data. The conservative
fix is loopback binding for both local servers, numeric loopback proxy targets, and rejecting
outside Host/Origin requests before routes run. This is within the owner's autonomous safe-run request.

| State | Behavior |
| --- | --- |
| Local success | Local API and Vite proxy requests still work. |
| Outside request | Reject before reading bot state, writing chat or resolving approval. |
| Invalid host/origin | Fail closed with 403. |
| Listen failure | Existing startup error exits; never retry on a wider address. |
| Stop/timeout | Existing run behavior is unchanged. |
| Retry/partial result | Existing run and saved-file behavior is unchanged. |
| Restart | The entry point binds loopback again. Verify the real listening address. |

Trade-off: direct access from another computer and reverse-proxy hosting are unsupported.
A deployed version needs explicit authentication and an origin policy for its deployment.
Local programs running as the user still have access. This does not claim complete security.

The local boundary correction passed code and test-quality review. The added near-match and
HTTP-origin cases also pass. All 482 TypeScript and 16 Python tests passed. The actual API and
Vite listeners bind to 127.0.0.1, and both normal local UI access and rejected outside requests
were checked over HTTP. The source-check skill correction also passed review.

Final run `ed4d89fd-ae80-468d-8957-5b4f2b2a1c0c` passed the source check and real-form Deny
flow. It saved the correct local outcome, with zero computer actions after Deny. The evidence
report records the recovered 404, overlong-warning rejection and typing correction, plus the
assisted setup and placeholder-phone limits.

Cleanup verified: the normal idle timer paused the computer at 01:44:59 Prague; both local
servers stopped and refused connections; the temporary browser tab closed. The Act One TODO
is checked for this bounded Deny rehearsal. No application or booking was submitted.
