# What the chat says when the model provider refuses a call — 20 September 2026

Result: **fixed in code and proven by tests through the real SDK; not seen live.** A live proof
needs the provider to refuse a call, which means an account with no credit or a reached limit.

**Merged into `main` the same day.** The record below names the code as it stood on the branch
`claude/inspiring-boyd-0fc217`. On `main`, `providerRefusal()` lives in
`src/server/agent/run-text.ts`, and `errorFields()` in `src/server/log.ts` also keeps only the
start of a long message. After the merge both probes ran again and gave the recorded "after"
output, apart from timings and port numbers, and `pnpm preflight` passed with 760 tests.

This closes finding H10 of `docs/evidence/2026-09-20-house-bot/README.md` (record omitted from this snapshot). The state table that
the fix was written against showed two more wrong rows of the same function, both named in the
provider's documentation, and they are fixed too, one commit each:

| Commit | What it changes |
| --- | --- |
| `c18c88f` | A refusal that arrives as an `error` event inside an open stream is reported as a refusal (H10). |
| `d630b44` | The provider's monthly spend cap, which answers 429 like a rate limit, is reported as a refusal. |
| `f0d5a43` | A conversation that outgrew the context window, which answers 400, keeps the advice to send the goal again. |
| `94f1e9a` | Not about the chat: the server log names why a connection failed (the last section of this record). |

The commits are on the branch `claude/inspiring-boyd-0fc217`. The second, the third and the fourth
can each be left out. The fourth cannot be taken without the first two as it stands: its change to
`src/server/log.ts` and its `log.test.ts` stand alone, but its two other tests use test helpers that
the first two commits added. One thing to know before taking the first without the third: the first
makes "prompt is too long" a refusal when it comes as an `error` event inside a stream, where it was
"not a refusal" by accident before. Its HTTP form was always read as a refusal. The third commit
fixes both forms.

## The defect

Run `0c8d65e5-3c9b-4802-b000-0c024db77339` of the house-search bot, 20 September, 07:02 UTC. The
Anthropic account ran out of credit in the middle of the run. The server log had the provider's
real sentence:

```
level error, msg "run failed", phase "model", errorName "Error",
errorMessage {"type":"error","error":{"details":null,"type":"invalid_request_error",
  "message":"Your credit balance is too low to access the Anthropic API. ..."},"request_id":"..."}
```

The chat said: "I was doing screenshot; the model stopped answering, so I stopped. Send the goal
again to retry." A retry could not work. `providerRefusal()` in `src/server/agent/run.ts` has fixed
words for this case ("the account behind this API key has too little credit"), and it did not use
them.

## The root cause, verified

`providerRefusal(e)` answered "not a refusal" for every error without a numeric `status`.

This refusal did not come as an HTTP 400. It came as an `error` event inside a stream that was
already open, so the HTTP status of the response was 200. The provider documents this:

- API errors: "an error can occur after the API returns a 200 response. In that case, error
  handling doesn't follow these standard mechanisms."
  <https://platform.claude.com/docs/en/api/errors>
- Streaming messages, "Error events": the event is `event: error` with the usual error body.
  <https://platform.claude.com/docs/en/build-with-claude/streaming#error-events>

The pinned SDK (`@anthropic-ai/sdk` 0.125.0) turns that event into an error with no status. Read in
the installed source:

| File | What it does |
| --- | --- |
| `core/streaming.js`, the `sse.event === 'error'` branch | `throw new APIError(undefined, body, undefined, response.headers, body?.error?.type)` |
| `core/error.js`, `APIError` | keeps `status` (here `undefined`), `error` (the parsed body) and `type` (the body's `error.type`, or `null`); with no status, the message is the JSON text of the body; no class sets `name`, so the log says "Error" |
| `lib/MessageStream.js`, the error handler | passes an `APIError` on unchanged, so `finalMessage()` rejects with it |
| `core/error.d.ts` | documents the field: "The `error.type` from the API response body" |
| `client.js`, `shouldRetry` | retries 408, 409, 429 and 5xx, and obeys an `x-should-retry` header; an error event comes after the HTTP exchange succeeded, so it is never retried |

`probe-stream-error.mts` sends the logged body through the real adapter (`AnthropicModel`) and the
real SDK over a local server (a placeholder key and a loopback address: nothing leaves the machine).
`probe-before-the-fix.txt` shows the defect: `status: undefined`, `type: 'invalid_request_error'`,
the same log line as above, and `providerRefusal: null`. The same body sent as a plain HTTP 400
gives `status: 400` and the credit sentence.

## The state table

How one model call can end, and what the chat must say. "Refusal words" means: "the model provider
refused my request: *fixed words*. Sending the goal again will not help until that is fixed."
"Retry words" means: "the model stopped answering, so I stopped. Send the goal again to retry."

| # | How the call ends | What reaches the loop | Can a retry help? | The chat says | Before these changes |
| --- | --- | --- | --- | --- | --- |
| 1 | Success | a message | | nothing about the call | right |
| 2 | HTTP 4xx, except 408, 409, 413 and 429 (the SDK does not retry these) | an error with an HTTP error `status` | no | refusal words: by the message (usage limit, credit), then by the status (401, 403, 404), else "it answered with HTTP *status*" | right, except row 3 |
| 3 | **HTTP 400 "prompt is too long"**: the conversation of this run outgrew the model's context window | an error with `status` 400 | yes: a new run starts with a short conversation, as after a 413 | retry words | **wrong: refusal words, "it answered with HTTP 400 … will not help"** |
| 4 | HTTP 408, 409, 429 or 5xx after the SDK's two retries; HTTP 413 | an error with an HTTP error `status` | yes | retry words | right, except row 5 |
| 5 | **HTTP 429 that is the monthly spend cap**, not a rate limit (type `rate_limit_error`, `details.error_code` `enforced_spend_limit_reached`, no `retry-after` header) | an error with `status` 429 | no: "Retrying, including the SDKs' automatic retries, fails until access resumes" | refusal words, usage limit | **wrong: retry words** |
| 6 | No answer at all: a connection error, or no first byte in time, after the SDK's retries | an error with `status` undefined and `type` null | yes | retry words | right |
| 7 | **An `error` event inside an open stream, with a type that stands for a refusal** (`invalid_request_error`, `authentication_error`, `billing_error`, `permission_error`, `not_found_error`) | an error with `status` undefined and the `type` | no | refusal words, the same as row 2; with no known sentence: "it answered with an error of the type *type*" | **wrong: retry words (H10)** |
| 8 | An `error` event inside an open stream, with a type a later try may not meet (`overloaded_error`, `api_error`, `rate_limit_error`, `timeout_error`) | the same shape | yes | retry words | right, by accident: every error without a status was "not a refusal" |
| 9 | An `error` event with a type the platform does not know, or with data that is not JSON (`type` null) | the same shape | unknown | retry words; the provider's sentence is in the server log | right |
| 10 | A stall: no event for the stall timeout | `ModelStalledError` | yes | retry words | right |
| 11 | An event the SDK cannot parse | `ModelStreamParseError` | yes | retry words | right |
| 12 | Stop while the call is pending | the SDK's abort error, and the run's stop flag is set | | "Stopped at your request…"; `providerRefusal` is not asked | right |
| 13 | Any failure in the moment after Stop | any error, and the stop flag is set | | the same as row 12; the error goes to the log at level info | right |
| 14 | An SDK retry | nothing: the loop sees row 1, 4 or 6 | | nothing | right |
| 15 | A partial answer, then an `error` event | the same as rows 7 to 9: the SDK drops the partial message, nothing was added to the conversation, no tool ran | by type | by type | the same as rows 7 to 9 |
| 16 | The server restarts during the call | boot recovery closes the run | | boot recovery's own words | right |
| 17 | Any failing row, after an approved action whose outcome is unknown | the same error | | the same words, then "You had approved …, and I cannot tell whether it went through…" | right; holds for the fixed rows too, because the wording code after the verdict is shared |
| 18 | A failure of the bot's computer that carries a status or a type | the run's phase is `sandbox` | | "my computer stopped answering…"; `providerRefusal` is not asked | right |

Rows 3, 5 and 7 were wrong. Row 8 was right only because of the defect in row 7, so the fix had to
keep it right on purpose: "no status" alone must never mean "refusal". Rows 5 and 7 also meet: a
spend cap sent as an `error` event has the type of a rate limit and no status, and it is a refusal.

## The fixes

All three are in `providerRefusal()`.

1. **Row 7** (`c18c88f`). Only an HTTP error status counts as a status. Without one, the function
   reads the error's `type` and takes the HTTP status that type stands for, from the provider's
   own table (`STATUS_OF_ERROR_TYPE`). The decision table that follows is unchanged. A type that is
   not in the table gives "not a refusal". The last line names the type instead of an HTTP status
   the provider never sent; the type is printed only when it is one of the table's own keys, so
   the rule "only fixed words leave this function" holds. A status below 400 is treated as no
   status: a later SDK that put the stream's real 200 on the error would otherwise bring the defect
   back.
2. **Row 5** (`d630b44`). A usage limit is read from the message before the status is judged, so
   the spend cap's 429 is a refusal. The check also accepts the provider's documented code
   `enforced_spend_limit_reached`, so a reworded sentence does not bring the defect back.
   <https://platform.claude.com/docs/en/api/rate-limits#reaching-your-spend-cap>
3. **Row 3** (`f0d5a43`). "prompt is too long" joins the answers after which a later try may pass,
   next to 413, for the reason the code already gives for 413: it is this run that grew too large.
   "If the input alone already exceeds the model's context window, the API returns a 400
   `invalid_request_error` ("prompt is too long") on every model."
   <https://platform.claude.com/docs/en/build-with-claude/context-windows#context-window-overflow-behavior>

Decisions, and what each gives up:

- **The type comes from the SDK's `type` field, not from parsing the message.** The field is
  documented in the SDK's own declaration. Given up: if a later SDK stops setting `type`, the
  function falls back to retry words. The tests through the real SDK fail on that day, so the
  change cannot pass unseen.
- **An unknown type is not a refusal.** The provider says its list of types may grow. A new type
  says nothing about whether a retry can help, and printing it would let the provider's text into
  the chat. Given up: a new kind of refusal reads as "retry" until the table learns it.
- **Sentences and the spend cap's code are matched in the SDK's message, one mechanism.** A review
  suggested reading `error.details.error_code` from the structured body instead. The function's
  older checks ("credit balance", "usage limit") already depend on the SDK putting the body's text
  into the message, and the tests through the real SDK now pin that for an HTTP error and for an
  error event. Given up: a rate-limit message that happened to contain "usage limit" would read as
  a refusal, and the user would be told that a retry cannot help when it could. The documentation
  quotes no rate-limit message, so this is not proven either way; the three usage-limit messages it
  does quote all contain the words.
- **The error is recognised by its fields, not by its class**, as it was before for `status`. Any
  object thrown while the run's phase is `model` that carried such a `type` would be read the same
  way. A review checked the throwers that exist (the sandbox SDK, the schema library, Node's system
  errors, the project's own error classes): none carries a `type` or a `status`.

Found by the reviews and **not changed**, so that nobody reads it as covered:

- The words for row 3 are only the generic retry words. Better words exist ("I ran out of room to
  think about this run."), but the loop posts them from another place, for the stop reason
  `model_context_window_exceeded`; using them here needs a third kind of answer in the loop's
  failure path.
- An `error` event inside a stream gets no SDK retry (row 8), so a busy provider ends the run where
  an HTTP 529 would have been retried twice. Sending the goal again is the retry.
- The server log dropped the cause of a connection error: it said "Connection error." and not
  whether the name did not resolve or the connection was refused (`errorFields` in
  `src/server/log.ts`). The chat's words are right for that case. **This one was changed
  afterwards**, in its own commit: see the last section of this record.

## The tests

Each change had its failing tests first, run on the code without the change:

| Change | Failed first | Because |
| --- | --- | --- |
| Row 7 | six | `providerRefusal` answered `null`; at the run-loop level the summary was `Error`, the H10 symptom |
| Row 5 | five | the same, for the spend cap |
| Row 3 | three | the function answered "it answered with HTTP 400" where no refusal was expected |

| File | What it proves |
| --- | --- |
| `src/server/agent/model.stream.test.ts`, "an error event inside an open stream" | Through the real SDK and the real adapter, over a local stream: the error has the type and no status, the server saw one request (no retry), and the loop's classifier gives the credit, the usage-limit and the spend-cap words; an `overloaded_error` and data that is not JSON (a `null` type) stay "not a refusal". |
| `src/server/agent/model.stream.test.ts`, "an HTTP error answer" | The same through a plain HTTP error: the SDK's message holds the body's text, so the credit words (400) and the spend-cap words (429) are found; a plain rate limit and "prompt is too long" stay "not a refusal". The answers carry `x-should-retry: false`, which only keeps the SDK from sending the request again. |
| `src/server/agent/run.test.ts`, "a request the model provider refuses" | At the run-loop level: the chat line, the run's summary and the bot's status line for a refusal inside a stream; none of the provider's text in the chat; retry words for the types a later try may not meet, for a rate limit and for "prompt is too long", each as HTTP and inside a stream; the spend cap in both forms. |
| `src/server/agent/run.test.ts`, "providerRefusal" | The function alone: the same words for a type as for the status it stands for; only the type's name for another refusal; no refusal for an unknown type (`constructor`, `toString` and the empty string included), for no type, and for the SDK's shapes of "no answer" and "data that is not JSON"; an HTTP error status decides before the type does, and a status below 400 does not; the spend cap by its code alone. |

`pnpm preflight` after the last change: 661 TypeScript tests and 16 Python tests pass (617 and 16 before the first change, on `4552678`).

## The probe

```bash
pnpm exec tsx docs/evidence/2026-09-20-provider-refusal-in-stream/probe-stream-error.mts
```

"Before" is `run.ts` of commit `4552678`, "after" is `run.ts` of commit `f0d5a43`. The column
"requests" is how many requests the local server saw: three means the SDK retried twice.

| Case | Requests | Before | After |
| --- | --- | --- | --- |
| A. credit refusal as an `error` event after `message_start` | 1 | `null` | "the account behind this API key has too little credit" |
| B. the same as the first event of the stream | 1 | `null` | the same sentence |
| C. a usage limit as an `error` event | 1 | `null` | "the organisation that owns this API key has reached its usage limit" |
| D. `overloaded_error` as an `error` event (the documented example) | 1 | `null` | `null` |
| E. the credit refusal as a plain HTTP 400 | 1 | the credit sentence | the credit sentence |
| F. the monthly spend cap as HTTP 429, no `retry-after` | 3 | `null` | the usage-limit sentence |
| G. a plain rate limit as HTTP 429 | 3 | `null` | `null` |
| H. the monthly spend cap as an `error` event | 1 | `null` | the usage-limit sentence |
| I. "prompt is too long" as HTTP 400 | 1 | "it answered with HTTP 400" | `null` |
| J. "prompt is too long" as an `error` event | 1 | `null` | `null` |

The two text files hold the full output of both runs.

## The reviews

Three reviewers read the first change: code, test quality and silent failures. None found a
blocking point in the code. Two of them stopped at the same point in the documents: an early draft
of this record described the spend-cap fix before it existed. The fix was then written, tests first,
and this record was committed after the code. From the reviews came: one test split into cases, the
status below 400, the missing `conflict_error` row of the type table, the test with data that is not
JSON, the pointer from the type table's comment to this folder, row 3 of the state table, and the
three points listed above as not changed.

The review of the second and the third change was lost once, when the session restarted, and was
run again. It found nothing blocking. It checked this record's two main claims against the SDK's
source again: how the SDK builds an error's message, and which answers it retries. It agrees with
matching the spend cap's code in the message text, and it names what that leaves open: if the
provider reworded its sentence and a later SDK also stopped putting the whole body into the
message, both at once, no test would notice. One idea of it was not taken: to accept "prompt is too
long" only together with status 400. Nothing shows that the provider puts that phrase into another
error, so the extra condition would guard against a case with no known cause.

## What this does not prove

- That the fixed words appear in a live chat. No refusal has come since the fix.
- That the provider sends the spend cap or "prompt is too long" inside a stream. The documentation
  shows them as HTTP 429 and HTTP 400; the fixes cover both forms, and only the HTTP forms are
  documented. The credit refusal inside a stream is the one form that was seen live.
- Anything about the README's two known limits of the model call (Stop during an SDK retry delay,
  an error body that never finishes). They are unchanged.

## Afterwards: the log names why a connection failed

One of the three points above that were "not changed" was changed the same day, in its own commit
(`94f1e9a`), because it is the other half of the same subject: the chat's words for a provider that
cannot be reached were right, and the server log could not say why it could not be reached.

**The claim, verified.** After its retries the SDK throws `new APIConnectionError({ cause: response })`
(`client.js`), where `response` is what `fetch` rejected with, and `core/error.js` keeps it as
`cause`. A timeout is the exception: `APIConnectionTimeoutError` is built with no cause. On Node
24.21 the real reason is **two** causes deep, so the first cause alone would say nothing.
`probe-connection-cause.mts` shows it through the real adapter and the real SDK:

| Case | The chain the adapter rejects with | The log before | The log now adds `errorCauses` |
| --- | --- | --- | --- |
| A. a closed port on 127.0.0.1 | `APIConnectionError` "Connection error." → `TypeError` "fetch failed" → `Error`, code `ECONNREFUSED` | `"Error"`, "Connection error." | `["TypeError", "Error ECONNREFUSED"]` |
| B. a closed port on `localhost` | … → `AggregateError`, code `ECONNREFUSED`, one inner error for each address tried | the same | `["TypeError", "AggregateError ECONNREFUSED"]` |
| C. a name that does not resolve | … → `Error`, code `ENOTFOUND` | the same | `["TypeError", "Error ENOTFOUND"]` |
| D. TLS spoken to a plain HTTP port | … → `Error`, code `ERR_SSL_PACKET_LENGTH_TOO_LONG` | the same | `["TypeError", "Error ERR_SSL_PACKET_LENGTH_TOO_LONG"]` |
| E. the stream is cut in the middle | `AnthropicError` "terminated" → `TypeError` "terminated" → `SocketError`, code `UND_ERR_SOCKET` | `"Error"`, "terminated" | `["TypeError", "SocketError UND_ERR_SOCKET"]` |

Cases A to D take about 1.3 s each: the SDK really tries three times. Case C sends one DNS question
for a name under the reserved `.invalid` domain; nothing else leaves the machine.

**The change.** `errorFields()` in `src/server/log.ts` adds `errorCauses`: the chain of causes,
outermost first, each as its name, plus its code when it has one. What it does with each input:

| The error | What the log holds |
| --- | --- |
| no cause | exactly what it held before: `errorName`, `errorMessage`, no new key |
| a cause that is an error with a code | `"Name CODE"` |
| a cause that is an error without a code | `"Name"` |
| causes under causes | each in turn, outermost first, five at most |
| a cause it has already named (a cycle) | the chain ends there |
| a name or a code that is not a short identifier (at most 64 letters, digits, `_`, `.`, `-`) | the name becomes `"unknown"`, the code is left out |
| a code that is a finite number | the number |
| a name that is not text at run time (a symbol, an object) | `"unknown"`, and the chain goes on |
| a name or a code that is a getter | it is read once, so what passed the check is what is logged |
| a cause that is not an error (a string, an object) | its type in brackets, for example `"(string)"`, and the chain ends there |
| a cause that cannot be read (a getter that throws) | what was read so far; the function never throws, because it runs inside catch blocks |
| the message of any cause | never logged |

**The decision, and what it gives up.** Two questions were open: what to log about a cause, and
where.

- *What:* the name and the code, never the message. A cause's text comes from a library the
  project cannot vouch for (the model SDK, the sandbox SDK, the mail libraries, Node), and it can
  quote a request, an address with a token in it, or a model's answer. The project already logs
  this way where it matters most: the notifier logs "the error's kind, never its text", the mail
  watcher logs the name alone, and `ModelStreamParseError` is built without a cause on purpose.
  Given up: the host and the port of a refused connection, the name that did not resolve, and
  OpenSSL's sentence. For the model provider these are known from the configuration, and the code
  already tells the cases apart. It would start to matter with a proxy between the server and the
  provider, where the failing host is not obvious. The upgrade path is an allow-list of the
  structured fields of Node's own system errors (`syscall`, `hostname`, `address`, `port`), not the
  message.
- *Where:* in `errorFields()` itself, so every log line that goes through it gains the field (about
  sixty call sites), not only the run loop's "run failed". A name and a code are safe to log at
  every one of them, so keeping the benefit to one line would buy no safety, and a sandbox or a
  mailbox that cannot be reached is the same question for the operator. Checked: every caller
  either spreads the result into a `log` call or reads `errorName` alone, so the new field reaches
  the server log and nothing else: no chat line, no run event, no file under `data/`.

**The tests.** Nine of the first eleven tests in the new `src/server/log.test.ts` failed on the old
code, and so did the run-loop test; the two that passed are guards (no cause: the old two fields
exactly; an unreadable cause must not make the function throw). The test review then named three
guards in the code that no test reached: a code that is a number but not a finite one, a cause that
is `null` (its `typeof` is "object"), and the accept side of the 64-character limit. Five tests
were added for them, and each was proven by breaking its guard: with the guard removed the test
fails, with the real code it passes.

| File | What it proves |
| --- | --- |
| `src/server/log.test.ts` | Every row of the input table above. The refused connection is a real one: `fetch` to a closed loopback port, inside the SDK's own `APIConnectionError`. The "never the text" test plants a marker in two causes' messages, one shaped like an address with a token and one like a quoted answer, and finds none of it in the fields. |
| `src/server/agent/run.test.ts`, "a model call that cannot connect logs its causes by name and code, and the chat keeps the advice to retry" | The run loop's "run failed" line carries the chain, no part of the cause's text is in any logged call, and the chat still says "the model stopped answering, so I stopped. Send the goal again to retry." |
| `src/server/agent/model.stream.test.ts`, "a provider that cannot be reached" | Through the real adapter and the real SDK against a closed loopback port: the rejected error is an `APIConnectionError`, the log fields are exactly `["TypeError", "Error ECONNREFUSED"]`, and the loop's classifier still reads it as "not a refusal". It takes about 1.3 s, because the SDK's retries are real. |

`pnpm preflight` after the change, the added guard tests and the read-once fix: 680 TypeScript tests
and 16 Python tests pass. The three test files that use a real port passed five runs in a row, and so did the whole suite.

**The reviews of this change.** The test review found nothing blocking; the guard tests above came
from it. The code review had one blocking point: the name of a cause was used without a check of
its type, so an object could pass the pattern through its text form, and a symbol would end the
chain. That review had read the change as it stood before its last hardening: the committed code
already had the type check and its test. One part of the point was still true and was fixed after
it, test first: the name was read three times, so a name that is a getter could pass the check and
then give another text. The code review also checked every caller by itself and came to the same
result: the new field reaches the server log and nothing else. Its remark on a test's clean-up of
`ANTHROPIC_BASE_URL` was taken.

Its last remark was about the limit of 64 characters, which is also the length of a SHA-256 value
in hex: about 40 would do. Measured in this machine's Node 24.21 binary, the runtime's own codes
reach 49 characters (`ERR_SINGLE_EXECUTABLE_APPLICATION_ASSET_NOT_FOUND`), and the TLS codes, which
are the ones an operator needs here, reach 44 (`ERR_SSL_FUNCTION_SHOULD_NOT_HAVE_BEEN_CALLED`). So a
limit near 40 would drop real codes, and the limit stays. What stops a sentence is the pattern, at
any length: a space, a slash, a colon or an equals sign fails it. What the pattern cannot stop is a
value that looks like an identifier and is a secret, for example a key of 44 characters in an
error's `code`. No library in use puts one there.

**What this does not prove.** That every library puts a useful code on its errors: a cause without
one is named by its class alone. And nothing was seen live: the provider was reachable all day.
