# Bot cooperation: architecture proposal

**Status:** Proposal for discussion, not an approved design or implementation plan.
**Date:** 2026-09-25.
**Scope:** Cooperation between existing persistent bots in the same team, inside the current
TypeScript application. No application code changes.
**Backlog mapping:** Reconsiders the parked bot-to-bot hand-off item in the private backlog. Group chat,
shared logins and arbitrary peer delegation are not needed for this first proposal.

## Recommendation

Use an owner bot with explicit delegated tasks. One bot remains responsible for the user's goal.
It may ask an allowed specialist bot for a bounded result. A deterministic coordinator in the
platform stores, schedules and tracks those tasks. The owner combines results and reports what
is complete, missing or uncertain. The coordinator is ordinary code, not another model.

Cooperation is useful when bots have different persistent responsibilities, context or permitted
tools. A research bot and a finance bot can contribute different evidence to a supplier assessment.
Creating separate bots for every step of one otherwise coherent job adds cost and coordination
without necessarily improving the result. A skill or connector remains the smaller choice there.

This follows the original [isolation and hand-off decision](2026-09-11-platform-design.md):
one computer per bot, sharing through a visible message with an artifact, not a shared drive.
It extends the mechanism beyond chat by giving every request a durable identity and lifecycle.

## Alternatives

| Approach | Gain | Cost or risk | Assessment |
| --- | --- | --- | --- |
| Fixed sequence of bots | Predictable dependencies and easy validation. | Every different job needs another predefined workflow. | Prefer when a single repeatable business process is the product. |
| Owner bot with bounded delegation | Flexible division of work with one accountable result and explicit limits. | Requires durable task tracking and checking returned results. | Recommended for Dobot's persistent coworkers. |
| Any bot can message and delegate to any other bot | Flexible peer collaboration. | Cycles, repeated context, unclear ownership and uncontrolled spending. | Do not start here. |

These are proposed trade-offs, not measured performance claims. No new external framework or
messaging protocol is required to establish the internal contract.

## User experience

The user asks one bot: “Prepare a supplier assessment. Ask Research for public evidence and
Finance to check the quoted costs. Bring me one recommendation.” The named roles are an example,
not platform-specific rules.

The owner posts a visible hand-off card naming the recipient, task and shared attachments.
Each specialist runs on its own bot and screen when computer use is needed. The user can open
those views, see progress or take over a blocked screen. Results return as cards with evidence
and artifact links. The owner identifies disagreements and missing work in its final answer.

The user does not configure a workflow graph. Natural-language instructions can establish which
bots may cooperate, but the platform stores and enforces that permission. A bot cannot grant
itself access to another bot. A first grant may require a user decision; routine use within that
grant should not generate another permission question for every harmless internal hand-off.

## Internal responsibilities

| Component | Responsibility |
| --- | --- |
| Owner bot | Understand the goal, choose allowed helpers, specify outputs and evaluate their relevance. |
| Cooperation coordinator | Validate delegation, persist tasks, schedule ready work, accept results once and resume the owner. |
| Task store | Preserve dependencies, attempts, status, cancellation, costs and artifact references across restart. |
| Existing Runner | Execute one attempt on one bot using existing tool, approval and screen controls. |
| Artifact access layer | Give a recipient read access to selected immutable artifact versions. |
| UI event projection | Show hand-offs and results from persisted task state through the existing event stream. |

These are responsibilities inside one application. They do not require separate services or a
network message broker. Existing [per-bot queues](../../src/server/agent/queue.ts) serialize runs
on a bot and already permit different bots to run concurrently.

## The task contract

A cooperative job is distinct from a model run. A job may contain several delegated tasks;
a task may need more than one execution attempt. Preserve those identities separately.

Each task records:

- Identity: task ID, root job ID, parent task ID, attempt ID, team scope, owner bot and worker bot.
- Request: goal, acceptance conditions, constraints, deadline and explicit input artifact versions.
- Authority: the user-authorized delegation grant and the permitted scope for this task.
- Scheduling: dependencies, status, revision and delivery key used to reject duplicate acceptance.
- Limits: maximum attempts, allocated cost allowance and cancellation state.
- Result: completed, partial, blocked or failed; output artifact versions; sources; checks performed;
  unresolved questions; external operations with uncertain outcomes.

Store authority outside model-authored content. The model supplies the proposed task, not its
team identity, permission grant or additional budget. The coordinator derives and validates those.
Chat is a view of this state, not the source of truth or a command parser for hand-offs.

The recipient sees its task and explicitly shared inputs. It does not automatically receive the
sender's conversation, memory, filesystem, cookies, credentials or existing approvals. Artifacts
are immutable snapshots so one bot cannot change the evidence another bot is already using.
Updates create new versions rather than modifying a shared working copy.

## Suspend and resume without holding a bot's execution queue

The owner asks for work with a conceptual `delegate_task` tool and receives a task ID. It may
continue independent work, then suspend its task while awaiting dependencies. The worker returns
a structured result through `complete_task`. These names describe proposed tool contracts.

Do not implement delegation as an owner run awaiting `runner.enqueue(otherBot).done` indefinitely.
That leaves a live run and potentially a computer held while the worker waits for its own human.
Cycles can also deadlock serialized queues: a bot waiting for another bot that needs work from
the first cannot progress.

Persist the owner's goal, partial work, dependency IDs and pending decision before suspending.
End the model execution attempt and release resources that are safe to release. The job remains
waiting. A completed dependency makes an owner continuation ready; the scheduler starts a new
attempt with the saved task context. Do not claim to resume an in-memory model conversation.
Batch multiple ready results into one continuation where practical to avoid repeated model calls.

First version: only the root owner delegates, and workers cannot delegate further or back to the
owner. Reject self-delegation. Keep every bot's runs serialized. This removes cycles without a
general graph scheduler. More complex task dependencies require a later design.

## Permissions and approvals

Delegation must not turn a more privileged bot into a way around the caller's restrictions.
Effective authority is the intersection of the worker's permissions, the user's delegation grant
and the task scope. A worker may access its own specialist data only where the user explicitly
authorizes that use for the delegated task; the owner does not acquire the worker's credentials.

For the first version, specialist tasks gather evidence and create internal draft artifacts.
The owner handles proposed external writes through the existing human approval path. The
restriction must be enforced at tools and capabilities, not merely stated in a prompt. Arbitrary
signed-in browser navigation is not provably read-only under today's DOM gate, so that residual
must be addressed or the initial worker capability set limited accordingly.

Internal permission to share an artifact is different from approval to send or publish it.
Only the user may approve an irreversible external action. Neither the owner nor another worker
can answer an approval card on the user's behalf. A worker result is untrusted task data, not a
higher-priority instruction, even when it comes from another bot in the same team.

## Required lifecycle behaviour

| Event | Proposed behaviour |
| --- | --- |
| Success | Persist the worker result and completion notification together; schedule at most one matching owner continuation for the accepted result revision. |
| Failure before an external effect | Record the cause; retry only under the task's attempt and budget policy. |
| Timeout | Mark the task timed out and cancel its attempt; do not infer that a remote write failed to happen. Late results remain visible but cannot silently reopen a cancelled job. |
| Stop | Stop on the root job cancels its descendants and queued continuations; stopping one helper makes that dependency cancelled and informs the owner. Existing completed effects are not undone. |
| Duplicate request or completion | Recognize the delivery key and task revision; return the existing record rather than creating another task or continuation. |
| Partial result | Persist usable artifacts with explicit gaps; the owner may finish partially or request bounded additional work. Partial is never silently converted to complete. |
| Restart | Recover ready tasks and waiting dependencies from storage; assess interrupted attempts before retry, and never blindly repeat an uncertain external operation. |
| Human approval or takeover | Show the responsible bot and task; other independent tasks may continue within the root budget. Preserve existing secret-protection rules. |

Use durable delivery with duplicate detection. Claiming exactly-once remote execution would be
incorrect: the remote system can perform an action before the local process records its outcome.
A transactional outbox is one possible implementation: save the state change and a pending
notification in one transaction, then deliver the notification with retry and duplicate detection.
Database and package selection belongs in the implementation design, not this proposal.

## Cost and correctness

One root job has one total allowance, divided among execution attempts. Starting helpers must
not multiply that allowance. Reserve spending capacity before concurrent paid work and reconcile
actual usage afterwards. Include retries and owner continuations. Computer usage needs its own
accounting; the current model-only daily budget is not sufficient for this promise.

The coordinator can verify a task's required result fields, source references and artifact
existence. The owner can judge relevance and resolve conflicting conclusions, but another model
answer is not independent proof that a claim is true. Measure completed-job quality, elapsed time,
human interventions and total cost against one bot doing the same job. Keep cooperation only
where that comparison shows a benefit.

## Fit with the architecture review

This feature depends on the [review's reliability work](../evidence/2026-09-25-architecture-review/README.md):

1. Preserve uncertain external outcomes through tools, run results and retry policy.
2. Define durable tasks and execution attempts, with atomic result and delivery records.
3. Persist screen ownership safety checks across restart.
4. Establish team and delegation authority before cross-bot resource access.

The current [Runner](../../src/server/agent/runner.ts) is reusable as the attempt executor, but its
recovery currently closes unfinished runs. The current [RunInput](../../src/server/agent/run.ts)
only distinguishes messages and routines; delegation needs an explicit task/attempt association.
The current [Store](../../src/server/store/index.ts) is a useful migration boundary, but separate
file writes do not provide the proposed multi-record transactions.

A narrow first increment is one owner, one specialist, one attached input, one returned artifact,
and a visible hand-off in chat. No worker subdelegation, shared memory, shared computer, group
chat, external agent protocol or autonomous creation of new bots is required.

## Validation before expanding

Prove a real task end to end, then interrupt the same flow at delegation, worker completion and
owner continuation. Repeat delivery and verify no duplicate task or owner action. Cancel while
the helper is waiting for a human. Check that unauthorized artifacts and credentials cannot cross
the hand-off. Compare the same task with a single-bot baseline before adding more workers.

Initial planning allowance, not a measured estimate: one user decision defining cooperation
permissions, any required per-bot sign-ins, and at least three live cycles (normal completion,
interruption/cancellation, and comparison against one bot). Automated fault-injection tests cover
the individual lifecycle transitions; live cycles do not replace those tests.

The main product decision to confirm before a full design is whether cooperation means one owner
delegating bounded tasks, a fixed multi-bot process, or unrestricted peers. This proposal recommends
the first. It does not reverse the parked backlog entries or authorize implementation.
