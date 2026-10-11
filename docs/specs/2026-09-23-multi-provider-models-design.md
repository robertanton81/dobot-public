# Multi-provider models Design Spec

**Date:** 2026-09-23
**Status:** Approved (2026-09-23)
**TODO items:** new section "4. Product: hosted Grok Bot alternative for EU teams", item "Models from more than one provider, EU by default" (added by this spec)
**Scope:** `src/server/agent/` (model port, loop, tools, prompt, errors), `src/server/config.ts`, `src/server/index.ts`, `src/server/store/types.ts` (routine and run events), the chat route, `src/web/` (composer picker, Runs tab label, routine card), tests

## Problem

Dobot runs every bot on one Anthropic model, set once by the operator (`MODEL_ID`), through
Anthropic's first-party API. On 2026-09-23 the author chose a new direction: a hosted Grok Bot
alternative for EU teams that need EU hosting (a hosted service for EU teams). Two things follow.

1. **EU processing.** Every screenshot of the user's work goes to the model. Anthropic's
   first-party API offers no EU processing: `inference_geo` accepts only `global` and `us`
   ([data residency](https://platform.claude.com/docs/en/manage-claude/data-residency)). An
   "EU-hosted" product that sends screenshots to a US endpoint is not EU-hosted.
2. **Choice of model and cost.** Grok Bot offers no model choice, and its users complain about
   cost. Running a cheap routine on a cheap model, and a hard goal on a strong one, is a defensible
   difference. The author also wants a path to open or local models to cut cost, measured before
   it is trusted.

## Decisions Log

| # | Question | Decision | Reasoning |
| --- | --- | --- | --- |
| 1 | Must every model call be processed in the EU? | EU by default. Every catalog entry is EU unless marked otherwise; a non-EU entry is refused at boot unless the operator sets `ALLOW_NON_EU_MODELS=true`, and every run on it is labelled "data leaves the EU" on the page and in the run log. | Keeps the promise honest and still allows development against direct APIs, and OpenAI until its EU project is approved. |
| 2 | Where is the model chosen? | Per run and per routine. | Author's choice. It is the finest control over cost. |
| 3 | Which model runs when none is named? | The operator's default (`DEFAULT_MODEL`). Two layers only: default and override. | Simplest to explain and test; one place to look when a run used an unexpected model. |
| 4 | DeepSeek | Parked. | No EU host serves a DeepSeek model that reads images (Nebius, Scaleway and Microsoft Foundry list DeepSeek V4 Flash as text only); DeepSeek's own API stores data in China. The author: DeepSeek is not a hard requirement. |
| 5 | Approach | Own provider layer: neutral types in the loop, one adapter per provider family. | No maintained TypeScript library normalises desktop computer use across providers; the approval gate must stay between the model's tool call and execution. |
| 6 | Providers in this cut | Anthropic first-party API, Claude on Google Vertex `eu`, OpenAI Responses (first-party, and its EU project when approved), and a generic OpenAI-compatible adapter for open or local models, marked experimental. | Vertex `eu` is the only verified EU route with today's computer toolset; the generic adapter is the cheap way to measure open models without a redesign. |
| 7 | How a chat goal names its model | A model picker in the chat composer, listing the catalog's labels, set to "Default" each time. Plain-language requests such as "use GPT for this" are not parsed. | A picker is a visible choice, not engineering (invariant 7). Parsing model names out of goals is fragile and would silently run the wrong model. |
| 8 | How a routine names its model | `save_routine` gains an optional `model` field; the user asks in chat and the bot sets it. The routine card shows it. | The bot configures its own routines (invariant 7); the tool refuses an id not in the catalog and lists the valid ones. The bot reading a model from the user's words is acceptable here and not for a chat goal (decision 7), because the routine card shows the choice before the routine ever runs unattended, and the user can correct it; a chat goal would start at once. |
| 9 | Can the model change during a run? | No. A run keeps the model it started with. | Each provider's history carries provider-only state (signed thinking blocks, encrypted reasoning, cache prefixes) that another provider cannot read. |

## Chosen Approach

The loop stops building Anthropic requests. It talks to a **model session** through neutral
types: text, a tool call (computer or platform), a tool result (text and optional screenshot), a
stop reason, and usage. Each provider family has an adapter that owns its native history for the
run, including everything that must be sent back unchanged. Model choice comes from an operator
**catalog**; a run's model is fixed when the run is queued, from the composer picker or the
routine, else the default.

**Why this over alternatives:** the Vercel AI SDK moves transport code out, but gives no common
computer action format either, and moves control over signed thinking blocks, cache breakpoints and
error classes into a large dependency. "Anthropic only, EU first" is smaller but leaves no path to
OpenAI or cheaper open models without a second redesign.

## Research (source links)

- **Anthropic, no EU on the first-party API:** `inference_geo` is `global` or `us`
  ([data residency](https://platform.claude.com/docs/en/manage-claude/data-residency)).
- **Anthropic computer toolset platforms:** `computer_toolset_20260801` is GA on the Claude API and
  Google Cloud only; other platforms offer only earlier beta tools
  ([computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)).
- **Claude on Vertex `eu`:** multi-region endpoint `aiplatform.eu.rep.googleapis.com`, 10% premium;
  single regions such as `europe-west1` serve only Sonnet 4.6 and older
  ([Claude on Google Cloud](https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai)).
  Sonnet 5 is GA with model id `claude-sonnet-5`, available in the Europe multi-region, with
  computer use, prompt caching and function calling supported
  ([Google, Sonnet 5, updated 2026-09-22](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/sonnet-5)).
- **`@anthropic-ai/vertex-sdk` 0.19.11:** `new AnthropicVertex({ region: 'eu', projectId })`;
  authentication through Google Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`;
  `messages.stream` is sent to `streamRawPredict`; peer dependency `@anthropic-ai/sdk >=0.115.1 <1`,
  so the pinned 0.125.0 fits (package README and `client.js`, read 2026-09-23). Not supported on
  Vertex: Files API, URL image sources, batches, server tools; 30 MB request limit
  ([Claude on Google Cloud](https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai)).
- **Bedrock is not an EU route for this design:** `computer_toolset_20260801` is not available on
  Amazon Bedrock, only the beta `computer_20251124`
  ([Claude in Amazon Bedrock](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock)).
- **OpenAI computer tool:** `tools: [{ type: "computer" }]` in the Responses API; a
  `computer_call` holds a batched `actions` array (click, double_click, drag with a `path`, move,
  scroll, keypress with `keys[]`, type, wait, screenshot); the answer is a `computer_call_output`
  with `{ type: "computer_screenshot", image_url: "data:image/png;base64,…", detail: "original" }`;
  recommended screens 1440x900 or 1600x900, and a downscaled screenshot needs coordinates mapped back
  ([computer use guide](https://developers.openai.com/api/docs/guides/tools-computer-use)). Model
  `gpt-5.6-sol` lists `computer_use`; $4 input, $0.40 cached input, $20 output per 1M tokens,
  promotional through at least 2026-11-21
  ([model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol)).
- **`openai@7.23.0` types** (package downloaded and read 2026-09-23,
  `resources/responses/responses.d.ts`): `ResponseComputerToolCall` has `call_id`,
  `pending_safety_checks` (required), `action?` and `actions?`; `Click.button` is
  `left | right | wheel | back | forward`; `Drag.path` is a list of `{x, y}`; `Scroll` has
  `scroll_x`, `scroll_y`; `Response.IncompleteDetails.reason` is
  `max_output_tokens | max_messages | content_filter | steered`; `ResponseUsage` has
  `input_tokens_details.cached_tokens`, `input_tokens_details.cache_write_tokens` and
  `output_tokens_details.reasoning_tokens`; `lib/responses/ResponseStream` offers
  `finalResponse()`.
- **Stateless OpenAI history:** with `store: false`, reasoning items carry `encrypted_content`;
  replay every output item as input on the next call
  ([reasoning guide](https://developers.openai.com/api/docs/guides/reasoning),
  [migrate to Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses)).
- **OpenAI EU data residency:** region Europe (EEA and Switzerland), host `eu.api.openai.com`,
  set per new project, access through sales, requires zero data retention or modified abuse
  monitoring, 10% extra for models released on or after 2026-03-05; `/v1/responses` covered; the
  computer tool has no row of its own
  ([your data](https://developers.openai.com/api/docs/guides/your-data)).
- **DeepSeek (parked):** vision only in `deepseek-flash`; built-in `computer_use` is ignored
  ([models and pricing](https://api-docs.deepseek.com/quick_start/pricing/),
  [Responses guide](https://api-docs.deepseek.com/guides/responses_api)); data stored in the
  People's Republic of China
  ([privacy policy, 2026-02-10](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html));
  Nebius serves `DeepSeek-V4-Flash-0731` under text models
  ([Nebius deprecation notice](https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice.md)),
  Scaleway lists it as "Text, Code"
  ([Scaleway supported models](https://www.scaleway.com/en/docs/generative-apis/reference-content/supported-models/)).
- **Open models in the EU (generic adapter):** Scaleway serves open vision models (Qwen, Gemma,
  Mistral) ([Scaleway supported models](https://www.scaleway.com/en/docs/generative-apis/reference-content/supported-models/));
  a self-hosted model on a Scaleway L4 GPU (24 GB) costs €0.79 an hour
  ([Scaleway GPU pricing](https://www.scaleway.com/en/pricing/gpu/)); E2B sandboxes are CPU only,
  1–8 vCPU and 1–8 GiB, so the model never runs inside a bot's computer
  ([E2B pricing](https://e2b.dev/pricing)).
- **No common library:** the Vercel AI SDK ships separate provider-defined computer tools for
  Anthropic and OpenAI with different input schemas and does not normalise them (`@ai-sdk/anthropic`
  4.0.61, `@ai-sdk/openai` 4.0.73, research of 2026-09-23); LiteLLM documents only Anthropic-type
  computer tools ([LiteLLM computer use](https://docs.litellm.ai/docs/completion/computer_use)).

## Design

### 1. The catalog (operator setup)

A JSON file, `models.json` at the repository root (path overridable by `MODELS_FILE`), with a
committed `models.example.json`. Each entry:

| Field | Meaning |
| --- | --- |
| `id` | The platform's name for the entry, e.g. `claude-sonnet-eu`. Stored in routines and run events. |
| `label` | What the user sees, e.g. "Claude Sonnet 5 (EU)". |
| `provider` | `anthropic`, `anthropic-vertex`, `openai`, or `openai-compatible`. |
| `model` | The provider's model id, e.g. `claude-sonnet-5`, `gpt-5.6-sol`. |
| `region` | `eu` or `non-eu`. |
| `baseUrl` | Optional: `https://eu.api.openai.com/v1` for OpenAI's EU project, or the endpoint of an open model. |
| `price` | USD per 1M tokens: `in`, `out`, `cacheRead`, `cacheWrite`. Explicit per entry; no factor rules. |
| `experimental` | Optional `true`: the entry is listed with "(experimental)" in its label. Required for `openai-compatible`. |

Keys stay in the environment: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_COMPATIBLE_API_KEY`,
and Google credentials through `GOOGLE_APPLICATION_CREDENTIALS` plus `VERTEX_PROJECT_ID`.

**Which setting wins.** There are exactly two modes, and the platform logs which one it booted in:
- **Catalog mode:** the catalog file exists. `DEFAULT_MODEL` is required and names the default
  entry. `MODEL_ID` is ignored; if it is set, the boot logs a warning that it has no effect.
- **Single-model mode:** no catalog file exists. The platform builds a one-entry catalog from
  `MODEL_ID` (default `claude-sonnet-5`) on the first-party Anthropic API, `region: non-eu`.
  `DEFAULT_MODEL` is ignored; if it is set, the boot logs a warning that it has no effect without
  a catalog.

**Boot checks** (a failed check stops the boot with a message naming the entry; they apply in both
modes, with no exception):
- the file parses and every entry passes its schema; ids are unique;
- `DEFAULT_MODEL` exists in the catalog (catalog mode);
- each entry's provider has its key or credentials;
- a `non-eu` entry exists only when `ALLOW_NON_EU_MODELS=true`. This includes the single-model
  entry.

**Clean clone.** `.env.example` sets `ALLOW_NON_EU_MODELS=true`, with a comment that says model
calls then leave the EU and that an EU deployment removes the line and adds a catalog. The README's
setup steps keep working, the choice is written in the operator's own file, the boot log says EU
processing is off, and the page labels every run "data leaves the EU". An EU deployment that
removes the line and forgets the catalog does not boot, which is the intended failure.

### 2. Neutral types (`agent/conversation.ts`)

```ts
type ToolCall =
  | { kind: 'computer'; id: string; actions: Action[] }        // Action from actions.ts
  | { kind: 'platform'; id: string; name: string; input: unknown }
type ToolResult = { callId: string; text?: string; png?: Uint8Array; isError?: boolean; step: number }
type Stop = 'end' | 'tool_calls' | 'length' | 'refusal' | 'context_full'
type Usage = { inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; reasoningTokens: number | null }
type Turn = { text: string; calls: ToolCall[]; stop: Stop; usage: Usage; cutInsideCall: boolean; log: TurnLog }
```

`TurnLog` is what the `cost` event already records (`blockTypes`, `toolNames`, a thinking or
reasoning summary, `textChars`), filled by each adapter from its own response. A computer call
carries a list of actions: Anthropic's toolset sends one action per call, OpenAI may send several.

### 3. The session port (`agent/model.ts`)

```ts
interface ModelSession {
  send(input: SessionInput, opts: { signal: AbortSignal; maxTokens: number }): Promise<Turn>
  pruneScreenshots(keepFromStep: number): void
}
interface ModelPort { open(spec: { system: string; tools: ToolDef[] }): ModelSession }
type SessionInput = { kind: 'user'; text: string } | { kind: 'results'; results: ToolResult[]; note?: string }
```

- `open` is called once per run. The session holds the provider-native history and appends the
  model's full answer itself, so signed thinking blocks (Anthropic) and encrypted reasoning items
  (OpenAI) are sent back unchanged without the loop seeing them.
- A turn cut inside a tool call (`cutInsideCall`) is not appended; the loop's retry with
  `MAX_TOKENS_RAISED` stays as today.
- `pruneScreenshots` keeps today's batching rule (`IMAGE_PRUNE_LIMIT = 13`, `IMAGES_KEPT = 3`):
  the loop decides which step to keep from, the session replaces the older images in its own
  history with the existing placeholder text.
- Every adapter streams, with the same two timers `AnthropicModel` uses today (first byte 120 s,
  stall 120 s between events, 2 SDK retries), and turns stall and parse failures into the existing
  `ModelStalledError` and `ModelStreamParseError`.

### 4. Adapters

**`anthropic` and `anthropic-vertex`** (`agent/providers/anthropic.ts`): today's request, moved
behind the session: `computer_toolset_20260801`, `cache_control` on the system text, the last tool
and the moving breakpoint, adaptive thinking. The two differ only in the client:
`new Anthropic(...)` or `new AnthropicVertex({ region: 'eu', projectId })`. Stop reasons map
`tool_use → tool_calls`, `end_turn → end`, `max_tokens → length`, `refusal → refusal`,
`model_context_window_exceeded → context_full`; `pause_turn` is continued inside the adapter.

**`openai`** (`agent/providers/openai.ts`): Responses API, `tools: [{ type: 'computer' }, ...function tools]`,
`store: false`, full history replayed each call with the SDK's
`toResponseInputItems(response.output)`; streamed with `responses.stream(...).finalResponse()`.
- Computer actions map to `Action`: `click` with `left/right/wheel` → `left_click / right_click /
  middle_click`; `back` and `forward` are refused with a text result; `double_click`; `move →
  mouse_move`; `type`; `keypress keys[] → key` joined with `+` after mapping OpenAI key names to
  xdotool names (a table in the adapter, tested); `scroll → scroll` with direction and amount
  from `scroll_x`/`scroll_y` (one wheel tick per 100 px, at least one); `drag` with two points →
  `left_click_drag`, with more points → mouse down, moves, mouse up; `wait`; `screenshot`. A click,
  move or drag that carries modifier `keys` is refused with a text result in this cut, because the
  action set has no separate key-down and key-up; the model can press the combination with
  `keypress` instead.
- The actions of one batch run one by one through the same gate and stuck detector as today. The
  gate waits inside a batch exactly as it waits today (`run.ts`, `gate()`): an action that needs
  approval posts a card and blocks until Allow or Deny. The batch ends after the first action that
  was refused, failed, or needed a card, even when the card was allowed: the actions after it were
  planned against a screen from before a human decided, so they are not run. (Corrected on
  2026-09-23 during `/plan`: the first version said the gate refuses and the model proposes again,
  which is not how `gate()` works.) The adapter answers the call with one `computer_call_output`
  holding the latest screenshot; a user message follows with the text: the refusal, failure or
  approval outcome, the actions that were not run, named in order, and any notices and the
  steps-left note.
- `pending_safety_checks` are logged in the run log and acknowledged only for a batch our gate let
  through; the gate stays the authority (invariant 4).
- Screen stays 1280x800, `detail: 'original'`; no coordinate scaling because the image is sent
  at its real size. OpenAI's guide recommends 1440x900 or 1600x900; whether 1280x800 costs click
  accuracy is not verified and is judged in milestone 3's live run. If that run misses clicks, the
  fix is a larger sandbox resolution, which changes every provider's screenshots and is its own
  decision.
- Stops: output with a `computer_call` or `function_call` → `tool_calls`; `incomplete` with
  `max_output_tokens` → `length`; `content_filter` or a refusal content item → `refusal`; an API
  error whose code says the context is too long → `context_full`; otherwise `end`.
- Usage: `cached_tokens → cacheRead`, `cache_write_tokens → cacheWrite`, `reasoning_tokens`.

**`openai-compatible`** (`agent/providers/open-model.ts`, experimental): Chat Completions with one
function tool `computer` whose JSON schema is built from `actions.ts` (an `action` enum plus
`coordinate`, `start_coordinate`, `text`, `scroll_direction`, `scroll_amount`, `duration`), and the
platform tools as function tools. The screenshot goes back as an image in a user message after the
tool message, because a tool message carries text only: `ChatCompletionToolMessageParam.content`
is `string | Array<ChatCompletionContentPartText>` (`openai@7.23.0`,
`resources/chat/completions/completions.d.ts`, read 2026-09-23). It serves self-hosted vLLM or Ollama servers and
hosted open models such as Scaleway's. No caching assumptions; `cacheRead` stays 0 unless the
server reports it.

**Errors:** `providerRefusal()` splits into one classifier per adapter
(`classifyError(e) → { refusal: string } | null`). The Anthropic classifier is today's code. The
OpenAI one maps 401/403, 429 with `insufficient_quota`, and 400 context errors. The open-model one
treats 401/403/404 as refusals.

### 5. Choosing the model per run

- **Queue:** `RunInput` gains `modelId`. The `queued` run event records `model` (catalog id) and
  `region`. The runner resolves it once: the input's id, else the routine's `model`, else
  `DEFAULT_MODEL`. An id that is no longer in the catalog (a routine saved before an entry was
  removed) falls back to the default with a warning line in the chat and the log.
- **Chat:** `POST /api/bots/:id/chat` accepts optional `model`; unknown ids are refused with 400.
  `GET /api/models` returns `{ id, label, region, experimental }` for the picker. Keys and prices
  never leave the server.
- **Composer:** a small select next to the send button: "Default (label)" plus each entry's label;
  non-EU entries carry "· data leaves the EU". It resets to Default after each send.
- **Routines:** `Routine` gains `model: string | null` (absent in old files reads as `null`).
  `save_routine` gains optional `model`, whose description lists the catalog ids and labels at
  tool-build time; the tool refuses an unknown id with the list. The routine card shows the label.
- **Runs tab:** each run's line shows the model label, and "data leaves the EU" for a non-EU run (the chat has no run header; corrected during `/plan`).

### 6. Prompt and tools

- The system prompt's computer paragraph states the screen size and the tool per family; the
  platform rules stay shared. The line "only the last three stay" is corrected to match the
  batching rule (up to 13 screenshots stay; the oldest are removed in batches).
- `toolDefinitions` moves into the adapters: Anthropic uses `input_schema` with the last tool's
  `cache_control`; OpenAI and open models use function tools from the same Zod schemas.

### 7. Cost and budget

`costUsd(entry, usage)` reads the catalog entry's four prices. The unknown-price fallback goes
away because every entry must carry prices. The daily budget code is unchanged; it sums `cost`
events whatever the provider. The page still shows no cost (decision of 2026-09-20).

### 8. State table for the model call (per adapter)

| State | Anthropic, Vertex | OpenAI | Open model |
| --- | --- | --- | --- |
| Success | Turn from the final message; full content appended | Turn from `finalResponse()`; output items appended | Turn from the completion; assistant message appended |
| Failure (HTTP error) | Classifier: refusal ends the run with the refusal text, else "the model stopped answering" | Same, OpenAI classifier | Same, open-model classifier |
| Timeout | First-byte timeout and stall timer, SDK retries 2 | Same timers around the stream | Same timers around the stream |
| Stop | `cancelSignal` aborts the stream; the loop's `stoppedEnd()` as today | Same | Same |
| Retry | SDK retries only before the first byte; the loop retries a cut tool call once with a higher cap | Same rule: a response cut by `max_output_tokens` while it holds a `computer_call` or `function_call` is not appended and none of its actions run; the loop retries once with the higher cap | Same rule for a cut tool call |
| Partial result | Cut text is posted, then "continue" | Same, incomplete text posted, then "continue" | Same |
| Restart | The session lives in memory; a run interrupted by a restart ends as today (no durable execution); the next run opens a new session | Same | Same |

## Demo path

The take-home video is filmed. This demo is for the product direction: a short clip for the
author's tests and future users.

| # | What the viewer sees | What happens underneath |
| - | -------------------- | ----------------------- |
| 1 | The composer's model select lists "Claude Sonnet 5 (EU)" as Default, "GPT-5.6 Sol (EU)" and "Qwen (experimental)". | `GET /api/models` returns the catalog without keys or prices. |
| 2 | The user picks "GPT-5.6 Sol (EU)" and sends a goal; the Runs tab line shows the label. | The run is queued with `modelId`; the `queued` event records model and region. |
| 3 | The live screen shows the bot working; the Runs tab lists each step. | The OpenAI session maps `computer_call` actions to `Action`s; each passes the gate and runs on the E2B computer. |
| 4 | The bot reaches a send button and an approval card appears. | The gate refuses the activation until Allow; the batch ends; the card is posted as today. |
| 5 | The user clicks Allow; the bot finishes and posts the artifact. | The approved action runs; the run ends `done`; `cost` events carry OpenAI usage priced from the catalog. |
| 6 | The user asks in chat: "run the morning check on the cheap model". The routine card shows "Qwen (experimental)". | The bot calls `save_routine` with `model`; the routine file stores the catalog id. |
| 7 | The next morning's routine run shows "Qwen (experimental)" on its Runs tab line. | The runner reads the routine's model; the open-model session drives the computer through the function tool. |

The takeover moment is unchanged: a password field hands the screen to the human for any provider,
because the secret-field check runs on the action before execution.

## Invariant coverage

| # | Invariant | Mechanism, or "not touched" |
| - | --------- | --------------------------- |
| 1 | Visible remote computer | Not touched: the E2B computer and its stream are the same for every provider. |
| 2 | Real work, not simulation | Each adapter drives the same real computer; no provider gets a mocked path. The experimental adapter ships off by default and is labelled until a live run passes. |
| 3 | One job, finished | The loop's end states and caps are shared by all adapters; a provider that cannot finish a job is measured in a live run before it leaves experimental. |
| 4 | Approval before irreversible side effects | Every action of every provider, including each action inside an OpenAI batch, passes the existing gate before execution. OpenAI's safety checks are logged, never a replacement for the gate. |
| 5 | Takeover without secrets in the transcript | The secret-field check and takeover run on the neutral `Action` before execution, so they hold for every provider; model keys stay server-side and `GET /api/models` returns none. |
| 6 | Persistence across sessions | The routine's `model` is stored in its file; the run's model is in its `queued` event; model sessions are per run and in memory, as the history is today. |
| 7 | Configured in plain language, never by engineering | Users pick a model from labels in the composer or ask the bot in chat; the catalog and keys are operator setup, named as such in the operating guide. |

## Failure modes on the day

| Failure | Detection | What the operator does |
| --- | --- | --- |
| The sandbox will not start or resume | As today: the runner's sandbox error | As today |
| Vertex credentials missing or expired | Boot check for credentials; a 401/403 at run time is classified as a refusal | Renew the service-account key or run `gcloud auth application-default login` |
| OpenAI EU project not yet approved | The `eu` OpenAI entry has no key at boot | Use the first-party OpenAI entry marked `non-eu` with `ALLOW_NON_EU_MODELS=true`; runs are labelled |
| An OpenAI action the platform cannot run (`back`, `forward`, an unknown key name) | The adapter returns a text result naming it | None; the model chooses another action; the run log shows it |
| The open model clicks the wrong places and loops | Stuck detector and no-progress guard end the run as `blocked` | Keep the entry experimental; run the goal on the default model |
| A routine names a model that was removed | Runner falls back to the default with a warning line | Ask the bot to update the routine, or restore the entry |
| The model loops or stalls | As today: stall timer, turn and step caps | As today |

## Scope budget

**In:** the catalog with boot checks and the clean-clone fallback; neutral types and the session
port; the Anthropic adapter (first-party and Vertex `eu`); the OpenAI adapter; the open-model
adapter marked experimental; per-run and per-routine choice; the composer select, run-header and
routine-card labels; per-adapter error classifiers; the prompt line fix; tests for each adapter
against recorded response fixtures and for the batch-through-gate rule.

**Parked, with reasons:**
- DeepSeek: no EU host with image input (decision 4).
- A per-bot default model: the author chose two layers (decision 3).
- Bedrock EU: no current computer toolset there.
- Automatic fallback to another provider on failure: it would silently change a run's data
  location and cost.
- A cost view per model on the page: the page shows no cost (2026-09-20 decision); the run log
  records it.
- Self-hosting an open model server: the adapter makes it possible; running a GPU server is a
  separate decision after a measured live run.

**Estimate:** the author's hours on human-only steps: about 1 hour to create the Google Cloud
project, enable Claude on Vertex, and create the service account; about 15 minutes for an OpenAI
key; a sales request for the OpenAI EU project, whose answer is an external wait. Live-run cycles:
four, one per adapter on the same short goal (first-party Anthropic as the regression check,
Vertex `eu`, OpenAI, one open model on Scaleway or a rented GPU), each with one approval card.
`run.test.ts` and the fakes need a wide rewrite to the neutral types; the tests keep their
scenarios.

**Slicing for `/plan`:** one milestone per step, each ending in its live run: (1) the neutral types,
session port and catalog with the Anthropic adapter, first-party and Vertex `eu`, proven by a
regression run with no change in behaviour; (2) per-run and per-routine choice with the composer
select and labels; (3) the OpenAI adapter; (4) the open-model adapter.

## Alternatives Considered

### Vercel AI SDK as the layer

`ai` 7.0.112 with `@ai-sdk/anthropic` and `@ai-sdk/openai`. Rejected: its computer tools are
provider-specific with different schemas, so the mapping work stays ours, and the control over
signed thinking blocks, the moving cache breakpoint and error classes moves into a large dependency
at the exact point the approval gate needs to sit.

### Anthropic only, EU first

Add the Vertex client and per-run choice among Claude models. Rejected: it gives EU hosting now but
no OpenAI and no path to cheaper open models without a second redesign of the loop.

### One model per deployment

Rejected by decision 2: no cost control per job, and no visible choice for users.

## Amendment (2026-09-23): after the cost-efficiency spec

`docs/specs/2026-09-23-cost-efficiency-design.md` lands before this spec's plan resumes. It changes
three things here, and the plan must include them:

- **Pruning covers page text too.** `ModelSession.pruneScreenshots(keepFromStep)` becomes
  `ModelSession.prune(keep: { imagesFromStep: number | null; textsFromStep: number | null })`.
  The loop keeps deciding when a pass runs and what stays (screenshots and long `fetch_url` and
  `read_artifact` results in one pass); each adapter replaces the content in its own history. For
  OpenAI, a `computer_call_output` holds only a screenshot (`openai@7.23.0` types), so a pruned
  OpenAI screenshot is replaced by a small solid-grey placeholder PNG and the note goes in the
  following user message.
- **Screen scaling is neutral.** `toScreen` and `MODEL_SCREEN` stay in `run.ts` before the gate,
  so every provider sees the scaled screenshots and returns model-screen coordinates. The
  "screen stays 1280x800" line in section 4 (OpenAI) is superseded; a per-model screen size, if
  OpenAI's live run needs one, becomes a catalog field decided in milestone 3.
- **Effort and grouping.** Effort (`output_config.effort`) is set inside the Anthropic adapter.
  The group-ending rule with `carded` already exists in the loop when this plan starts, so the
  OpenAI batch rule reuses it.

Scope budget addition: moving the two pruning lists and the effort setting into the session port
is part of milestone 1.
