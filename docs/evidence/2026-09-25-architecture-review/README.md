# Architecture review

Reviewed on 2026-09-25 at `d015da4`. The working tree was clean at the start.
Scope: the current checkout, the local product, and the recorded direction toward a hosted
product for EU teams. Unmerged cost levers and proposed provider adapters are not treated as built.
This is a review, not an approved implementation plan. No application code was changed.

## Verdict

Keep TypeScript, React, Hono, and one application with separate internal modules. There is no
measured runtime bottleneck or language limitation in this review that warrants a rewrite.
The main constraints are process-local execution state, weakly represented external outcomes,
and a single-operator access model. Changing the language would preserve those constraints unless
the architecture also changed.

The application is a useful local foundation. It is not ready to serve multiple customer teams
in one shared deployment. A separate deployment per team is an alternative to shared tenancy,
but still needs authenticated access, credential isolation, recovery and operating procedures.
Choose that deployment boundary before implementing hosted storage or credentials.

## Evidence and limits

- Read startup wiring, HTTP and event delivery, run orchestration, approval logic, connector
  dispatch, model integration, storage, scheduling, sandbox lifecycle and frontend API types.
- Read current decisions, operating guidance, verification records, the product backlog and
  the approved multi-provider direction. Historical live evidence remains historical.
- Full preflight passed: typecheck, 893 TypeScript tests across 44 files, 16 Python tests,
  and the platform-boundary checks.
- The first restricted preflight encountered process/listener restrictions. The complete run
  outside that sandbox passed. Logs: `/tmp/dobot-architecture-review-preflight-unrestricted.log`.
- Three additional offline probes passed their assertions about current defective behaviour.
  They exercise the real loop, connector gate, HTTP route and file store. The model and connector
  are scripted; no remote computer or external service is called. Run from the repository root:

  ```sh
  pnpm exec tsx docs/evidence/2026-09-25-architecture-review/probes.mts
  ```

- This is not a load benchmark, penetration test, provider-residency audit or live workflow run.
  No claim of an actual duplicate external action is made. Production data and secrets were not read.

## Architecture worth preserving

| Existing boundary | Assessment |
| --- | --- |
| HTTP → Runner → run loop | Useful separation between requests, execution lifetime and model-driven steps. Keep it. |
| SandboxPort and SandboxManager | The computer adapter is already replaceable. Per-bot lifecycle serialization and holders handle real overlapping operations. Keep these guarantees. |
| Connector registry and fixed read/write classes | Services are isolated in adapters. Write approval is enforced by code, not the model's description. Keep that boundary. |
| Store module | A practical place to change persistence incrementally. It also exposes filesystem paths, so a database replacement is not a drop-in swap for every method. |
| BotEvents and SSE | Adequate in one process. The subscribe-before-snapshot ordering avoids a real connection race. No separate message broker is justified yet. |
| Frontend type imports | Type-only imports share contracts without shipping backend code. This is useful coupling inside one application, not a reason to create another package or service. |
| Python companion | An adapter running beside Chrome. Its language is independent of the backend language. Preserve the working protocol and tests. |

References: [startup](../../../src/server/index.ts), [run context](../../../src/server/agent/run-context.ts),
[sandbox manager](../../../src/server/sandbox/manager.ts), [registry](../../../src/server/connectors/registry.ts),
[store](../../../src/server/store/index.ts), [SSE](../../../src/server/http/sse.ts), [frontend API](../../../src/web/api.ts).

## Findings, in priority order

### 1. Unknown external outcomes are not a shared execution state

**Confirmed defect; address before expanding unattended writes.**

The connector gate warns when an approved write times out. It throws `ToolError`, and
`runPlatformTool` reduces this to `{text, isError}`. `handlePlatform` sends that text to the model
but does not record uncertainty in the loop's `unanswered` state. That state is updated only by
computer actions. A later model failure therefore closes the run as an ordinary `failed` result
without a terminal retry flag. The scheduler retries failed and unknown results unless `final`
is set. Merely renaming the outcome to `unknown` would not fix the retry policy.

The probes observed:

| Sequence | Current result |
| --- | --- |
| Approved connector write times out; next model call fails | Warning recorded, then `failed`, with no terminal retry flag. |
| Approved connector write times out; model ends its turn | Warning recorded, then `done`. |

Both probes invoke the synthetic connector once. They prove that the platform loses the outcome
distinction, not that a real service performed a duplicate write. Every repeated connector write
still needs a new approval. The risk is unsafe retry guidance and repeated workflows, not a claim
that the connector bypasses approval.

**Recommendation:** carry a structured action outcome through connector execution, computer
execution, run completion and scheduler policy: not attempted, confirmed, failed without effect,
or outcome unknown. Unknown writes need reconciliation or explicit human resolution before replay.
Reconciliation means checking the external system for the action's result. Record the operation
before dispatch and its outcome afterwards. Bind approval to that operation and its arguments.
An idempotency key, when supported by the service, can prevent repeats of the same operation;
a database alone cannot guarantee that an external side effect happens exactly once.

References: `src/server/agent/connector-gate.ts:83`, `src/server/agent/tools.ts:59`,
`src/server/agent/run.ts:435`, `src/server/agent/run.ts:555`, `src/server/scheduler/scheduler.ts:215`.

### 2. Screen safety depends on process-local state

**Known limitation confirmed by code inspection; high priority before hosted use.**

The runner checks a held screen before starting a new goal only when its in-memory blocked or
idle takeover maps say a human owned it. Boot recovery resets the bot to idle and expires cards.
Those maps do not survive restart. The next run can reconnect to the browser without that
hand-back check. The existing decisions document explicitly records the risk of a secret left
on screen reaching a later screenshot. This review did not repeat that scenario live.

Interactive screen URLs are another ownership boundary: the API controls when it returns one,
but a previously issued URL remains usable after the page changes mode. Hiding the iframe is
not server-side revocation of control.

**Recommendation:** persist a requirement to check the screen before model access. Enforce it
after reconnect as well as explicit hand-back. Keep that safety state independent of a chat card.
Revoke or rotate interactive access when screen ownership changes. Specify success, failure,
timeout, Stop, retry, partial result and restart before changing the lifecycle.

References: `src/server/agent/runner.ts:492`, `src/server/agent/recovery.ts:49`,
`src/server/http/app.ts:220`, [documented limits](../../decisions.md#takeover-with-a-hand-back-check-enforced-by-the-server).

The DOM approval gate also remains a heuristic: control labels, forms and known activation keys
do not describe every possible side effect. `open_url` can open an action-bearing link without
an approval check. Preserve the current guards, but do not promise universal enforcement on an
arbitrary signed-in website. Prefer typed connectors for supported writes and test the residual
browser path adversarially. This is an existing limitation, not a new exploit demonstrated here.

### 3. File-level integrity is not a transaction boundary

**One confirmed current defect; a broader constraint for recovery and hosting.**

Atomic rename prevents readers from seeing half a replacement file. Per-file promise chains
serialize some updates within one process. Neither provides transactions across records or
coordination between server processes.

The memory route compares the submitted base text with the stored text, then writes separately.
The memory append and replacement functions do not share a lock. The probe inserts a bot note
after the route reads the base snapshot and before it saves the user's edit. The route returns
HTTP 200 and the note disappears. This reproduces a legal asynchronous interleaving; it does not
measure how often the race occurs in normal use.

**Immediate recommendation:** make the base comparison and replacement one store operation,
serialized with appends. Test that the concurrent note survives or that the edit receives HTTP 409.
Check the equivalent skill and routine check-then-write paths; they were not separately reproduced.
This fix does not need a database or a rewrite.

For durable execution, acceptance, operation status, approvals, run completion and trigger receipts
need clearly defined transactional boundaries. The scheduler currently saves a receipt after the
run finishes; a crash in between can cause redelivery. Its pending receipts and retry counts are
process-local. The run queue records accepted goals, which is good, but boot closes them instead
of resuming them. Persistence of records is therefore different from durable execution.

**Later recommendation:** introduce transactional storage for execution records when designing
restart-safe work. Keep skills and ordinary artifacts as files if that remains useful. Select the
database after deciding whether the deployment has one writer or several. Do not add a queue
service merely because a queue exists in the code.

References: `src/server/http/app.ts:320`, `src/server/store/memory.ts:5`,
`src/server/store/memory.ts:21`, `src/server/store/paths.ts:63`,
`src/server/agent/runner.ts:114`, `src/server/agent/recovery.ts:43`,
`src/server/scheduler/scheduler.ts:175`.

### 4. The deployment boundary is one operator, not one customer team

**Intentional local design; a blocker for shared hosting.**

The HTTP server binds to loopback and rejects outside Host/Origin values. Routes select resources
by bot ID without an authenticated owner. The Bot schema has no team ownership. Model settings,
budget, timezone, watched mailbox and notice destination are deployment-wide. Mail events fan out
to all subscribed bot routines. Restricting the mailbox connector to a bot ID is useful, but is
not customer isolation.

**Recommendation:** decide between isolated team deployments and a shared multi-tenant service.
For shared hosting, a tenant is a customer team whose data and credentials must remain separate.
Authorization must cover HTTP, event subscriptions, artifacts, screenshots, connector credentials,
approvals and interactive screen access. Background triggers need the same ownership scope.
Do not expose this server publicly by changing its bind address alone.

EU hosting also needs a complete data-flow inventory: application storage, models, computers,
connectors and optional classifiers. This review establishes that the current model adapter is
Anthropic-specific; it does not independently verify vendor residency. Reuse the approved
multi-provider spec and the recorded optional TypeSafe exception, then verify provider commitments
during implementation. Do not infer model residency from the sandbox's region.

References: `src/server/index.ts`, `src/server/http/app.ts:92`,
`src/server/store/types.ts:27`, `src/server/scheduler/scheduler.ts:277`,
[provider spec](../../specs/2026-09-23-multi-provider-models-design.md),
[TypeSafe decision](../../decisions.md#typesafes-jev-is-an-exception-to-eu-hosting-for-now).

### 5. The model boundary exposes provider details; computer startup is mandatory

**Current coupling worth changing for already-approved product work.**

`ModelPort` accepts and returns Anthropic SDK types. The loop builds provider messages, manages
cache markers and signed response blocks, handles provider stop reasons, and controls execution.
This is adequate for one provider. It makes a second provider a loop change rather than just a
transport replacement. The approved multi-provider spec already identifies a better boundary:
a model session owns provider-native history and returns neutral actions and results.

The runner also calls `ensureRunning` before entering the loop, even when a job will use only
connectors. Creating a bot starts its computer too. Consequently a connector-only job still
depends on computer availability and can incur computer cost. The existing live connector record
demonstrates zero computer steps, not zero sandbox usage.

**Recommendation:** implement the existing session boundary incrementally, beginning with the
current provider and preserving behaviour. Separately make the computer an acquired capability:
start it on the first operation that requires it, while retaining visible live work when used.
Opening the preview or requesting takeover must have a defined startup path. Preserve lifecycle
serialization and screen-safety checks. Do not add generic provider abstractions beyond what the
approved adapters need.

References: `src/server/agent/model.ts:12`, `src/server/agent/run.ts:124`,
`src/server/agent/runner.ts:525`, `src/server/http/app.ts:146`,
[connector evidence](../2026-09-24-connectors-m1/README.md).

### 6. Cost and completion records are weaker than product-level guarantees

**Known limits confirmed by inspection; no new performance measurement.**

The daily budget is an admission check before each run. Different bots can pass that check
concurrently, and an admitted run does not recheck it before each paid call. It counts model
cost events, not sandbox or connector costs. `spentToday` scans all historical run logs and then
filters by the run's start date, so cross-midnight usage belongs to the starting day. The cost
scan grows with history, but this review has not measured it as a latency bottleneck.

The loop's `done` result means the model ended its turn. It is not an independent proof that the
requested artifact or external outcome exists. Recent chat is bounded and the model conversation
lives in memory; saved notes are not structured task progress.

**Recommendation:** define the promise before implementing a spending limit: model-only or total
cost, per team or per bot, and what bounded overshoot is acceptable. Reserve allowances atomically
before paid work and reconcile measured usage afterwards if a stronger cap is required. Index
usage by timestamp as part of that work. Track sandbox usage as well as model tokens.

For completion, store the goal's acceptance conditions, partial progress, output references and
verification evidence. Use deterministic checks where available, such as a service receipt or
required artifact fields. Keep execution completion separate from verified job completion. This
does not require introducing a second model as a universal judge.

References: `src/server/agent/runner.ts:475`, `src/server/agent/budget.ts:18`,
`src/server/store/runs.ts:91`, `src/server/agent/run.ts:555`,
`src/server/agent/context.ts:7`.

## Recommended order

1. Fix the reproduced uncertain-write outcome and memory-save defects. Preserve fresh approval
   for every write. Prove the fixes through the real orchestration path, not only gate unit tests.
2. Close the recorded restart and stream-control safety gaps before external customer access.
3. Design durable operation and run state, including trigger receipts and retry policy. Start
   with recovery at safe boundaries; do not attempt blind replay of an interrupted browser session.
4. Select the team deployment boundary, then design authentication, ownership, credentials,
   storage and backups together. This design can proceed alongside recovery work.
5. Reuse the approved model-session design for provider choice and regional policy. Add lazy
   computer startup as a separate, measurable change. EU model routing may need to precede a
   hosted pilot; a second provider is not a prerequisite for fixing current reliability defects.
6. Strengthen cost accounting and explicit completion evidence against representative jobs.

These are implementation candidates, not authorization to change the application in this review.
Each change needs a state table covering success, failure, timeout, Stop, retry, partial result
and restart, plus tests and relevant live verification. A new language is not on the critical path.

## Changes not justified by this review

- A language rewrite: no measured language constraint.
- Microservices: the run, approvals and screen ownership share state that needs close coordination.
  Separating processes now would add communication failures before establishing durable ownership.
- A generic repository layer or interface for every class: existing ports cover useful boundaries.
- A workflow framework chosen before defining recovery semantics: it cannot determine whether a
  remote write happened, and must not take execution around the approval gate.
- Rewriting all files into smaller files: `Runner` is large because it owns related lifetimes.
  First define explicit lifecycle state and ownership; then extract coherent responsibilities.
- A fresh frontend or removal of the Python companion: neither addresses a finding above.

## Acceptance evidence for follow-up work

| Change | Required proof |
| --- | --- |
| Unknown outcomes | Write applied remotely but response lost; no automatic write replay and no verified-success claim until reconciliation. |
| Memory edits | Append interleaved with edit; note retained or edit rejected, including two concurrent editors. |
| Screen ownership | Restart and sleep during takeover; no model screenshot before safety check; old interactive access cannot drive the resumed agent's screen. |
| Durable work | Crash before dispatch, after remote success, before receipt, and during human wait; defined result for each without silent loss or blind replay. |
| Hosted boundary | One team's requests, streams and triggers cannot access another team's resources or credentials. |
| Model boundary | Existing provider behaviour remains; the same approval and Stop checks run for each new adapter. |
| Lazy computer | Connector-only run makes no sandbox creation or resume call; later computer use still gives a visible live session and safe takeover. |
| Budget and completion | Concurrent calls obey the stated allowance; usage crosses midnight correctly; incomplete outputs remain distinguishable from verified results. |

## Outcome, 25 September 2026

The two reproduced defects are fixed. The other findings were checked against the code and match
it; they need design work first, as the review says.

| Finding | Status |
| --- | --- |
| 1. Unknown external outcomes | **Fixed.** An approved connector write that times out or is stopped now throws `OutcomeUnknownError`, and the loop records it in the same `unanswered` state as an unanswered approved click. A run that then fails or ends its turn ends as `unknown` with `final: true`, so the scheduler does not start the goal again, and no run log says `done` for an unconfirmed write. The same rule now covers the computer path, which had the same retry gap. A Stop line names the approved write too. |
| 3. Memory save race | **Fixed**, with the skill and routine saves. The base comparison and the write are one store operation inside the file's write chain (`withFileLock`), which the bot's memory appends also use. A note that arrives during a save survives, or the save gets HTTP 409. Of two saves from the same base, one gets 200 and one 409. |
| 2. Screen safety across restart; old interactive URLs | Confirmed in code (`runner.ts`: the takeover maps are in memory; `safeWithoutRun` allows a goal when the manager has no session). Not fixed: it changes the computer's lifecycle and needs a state table first. |
| 3 (later). Durable execution records | Confirmed. Design work. |
| 4. One operator, not one team | Confirmed. Needs the deployment-boundary decision. |
| 5. Provider types in `ModelPort`; computer started for every run | Confirmed (`runner.ts` calls `ensureRunning` before the loop; `POST /api/bots` calls `setUp`). Design work, already in the product backlog. |
| 6. Budget admission and completion evidence | Confirmed (`budget.ts` sums by start date, checked once per run). Design work. |

`probes.mts` records the defects at `d015da4`. After the fix it stops at its first assertion
(`unknown` where it expected `failed`), which is the intended change. The regression tests that
replace it are in `src/server/agent/run.test.ts` ("when an approved write does not answer" and the
updated unanswered-click tests), `src/server/http/app.test.ts` and `src/server/store/store.test.ts`.
The new store and route tests failed three times out of three against the old code.
