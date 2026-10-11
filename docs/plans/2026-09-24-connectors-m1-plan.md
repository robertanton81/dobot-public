> **STATUS: SHIPPED 2026-09-24.** Landed as 23 commits on branch `connectors` (`2e18ca2`..`5d0c77d`),
> merged into `main` as `f5642a8`, plus `38438ed` on `main`. The unchecked `- [ ]` boxes below are
> historical — work is done. **Do not re-execute this plan.** If you are modifying connectors, work
> directly in `src/server/connectors/`, `src/server/agent/connector-gate.ts`, `request_connection` in
> `src/server/agent/tools.ts`, and `CHANNEL_RULE` in `src/server/agent/prompt.ts`.
>
> **Plan-vs-reality corrections discovered during execution:**
>
> **Library/version drift:** none. No package was added; `imapflow` 1.7.8 and `nodemailer` 9.1.1
> were already pinned. The Cal.com API versions are dates, so `scripts/preflight.sh`'s date check now
> allows exactly one form in `src/server/connectors/builtin/`: `const <NAME>_VERSION = '<date>'`.
>
> **Plan code prescriptions that needed adjustment:**
> - `Approvals.forget()` (decision P3) was replaced by an `action: false` flag on the approval record,
>   and the record is consumed after the answer: a second click then gets 409, not 404, and a
>   Not now still never counts in `deniedFor`.
> - `connectors` is optional in `RunnerDeps`, with `NO_CONNECTORS` in `run-context.ts`, so the ten
>   `new Runner(...)` calls in the tests stayed as they were.
> - `CONNECTOR_PAGE = 'connector:'` lives in `gate.ts` (not `''`): both connector approvals and connect
>   cards use it, so no page control can match them; placing it in `connector-gate.ts` would have
>   made an import cycle with `tools.ts`.
> - The test helper is `src/server/connectors/builtin/fakes.ts`, the name preflight already treats as
>   test code.
> - `mapy__route` returns "about X km (Y m), about Z minutes by <mode>".
> - A `failed` status was added to the connect card, for a grant that cannot be saved after Connect.
> - The boot log line lists the usable built-ins and says why the others are off.
>
> **Corrections applied during review:**
> - Task 2: the secret test now checks the real written log line (`12d80f6`); approvals scoped to
>   `connector:` and named by their sentence after a restart (`cb5eded`).
> - Task 3: the Stop test now races a Connect that arrives with the Stop (`a3cbc3a`); a failed grant
>   closes its card, and a second click gets 409 (`86c5c9a`).
> - Tasks 4–5: every service answer is read through a schema; a booking the service accepted is
>   reported as booked whatever its answer holds (`9c7e3a2`); branch tests added (`7f0533e`).
> - Task 6: outgoing mail uses the notifier's `smtpOptions()` (TLS required except on 465), and the
>   gate refuses a write whose arguments would be cut on the card; mail bodies are limited to 15,000
>   characters; the MIME walk stops at depth 20 (`0aa1c49`); the abort test proves the command ends
>   and no logout happens (`9f7729e`).
>
> **Deferrals worth tracking:**
> - A bot's own skill beats the channel rule: both bots used the computer or asked for it until the
>   user corrected the skill in the chat. Next: when a bot gains a connector, it offers to rewrite the
>   skills that name the same service.
> - A grant in the middle of a run rewrites the whole prompt cache; the mail run with two grants cost
>   $0.44 against a $0.26 baseline. Next: grant before the run that needs it. With the connections
>   already granted the mail run cost $0.34, most of it thinking about a duplicate invitation: for a
>   short booking job the connectors remove computer steps and the sign-in, not model cost.
> - The computer still starts on every run, even one with no computer step (decision P9).
> - The mailbox's own-address check does not match `+` aliases; `send` is offered without an
>   outgoing server and fails after its card; a connect card's notice mail says "(other)".
> - `calcom-public__book` and `bot-mailbox__send` have never run live.
>
> **Plan history below is preserved as-written for context. Treat the live code as authoritative.**

# Connectors, milestone 1: built-in connectors Implementation Plan

**Goal:** A bot can use four built-in connectors (Wikipedia, Mapy.com routing, Cal.com public booking, the bot's own mailbox) instead of its computer, with every write stopped at an approval card and every connection granted by one click in the chat.
**Approach:** A connector is a fixed list of tools in `src/server/connectors/builtin/`, each tool marked `read` or `write` in code. A registry turns a bot's connections (`connections.json` in the bot folder) into ordinary platform tools named `<connection>__<tool>`; every call goes through one gate that runs reads and posts an approval card for writes. The run loop reads the bot's connections before every model call and rebuilds the tool list and the prompt's connector section only when they changed, so a connection granted mid-run is usable in the same run at the price of one cache rewrite.
**Design spec:** [docs/specs/2026-09-24-connectors-design.md](../specs/2026-09-24-connectors-design.md) (approved 2026-09-24; decisions 10 and 11 were added at planning)
**TODO items:** section "4. Product: hosted Grok Bot alternative for EU teams", item "Connectors: API or MCP before the browser", milestone 1 of the spec's slicing
**Branch:** `connectors`, in the worktree `.claude/worktrees/connectors`; merged into `main` after Task 9 (the author pushes)
**Scope:** `src/server/connectors/` (new), `src/server/agent/` (`connector-gate.ts` new, `run.ts`, `run-context.ts`, `runner.ts`, `gate.ts`, `tools.ts`, `prompt.ts`, `recovery.ts`, `fakes.ts`), `src/server/store/` (`connections.ts` new, `types.ts`, `paths.ts`, `chat.ts`, `index.ts`), `src/server/config.ts`, `src/server/index.ts`, `src/server/mail/watcher.ts` (comment), `src/web/components/Cards.tsx`, `src/web/styles.css`, `scripts/preflight.sh`, `CLAUDE.md`, `.env.example`, `docs/`
**Build estimate:** The author's hours: register a Mapy.com API key and put it into `.env.local` of the worktree (about 15 minutes); say the word for each live run that sends a test mail from the author's Gmail (as in the earlier act-two runs), about 10 minutes. Live-run cycles: two, as the spec names them for milestone 1: Homer with `wikipedia` and `mapy`; Hunter with `bot-mailbox` and `calcom-public`, booking card denied.

Out of this plan (spec milestone 2): the MCP client, OAuth, `CONNECTOR_SECRET_KEY`, the tools card, `disconnect` and the header list of connections. Milestone 1 stores no token of any kind.

## Research (source links)

Reused from the spec's Research section: Cal.com v2 slots and bookings, Mapy.com REST API and pricing, MediaWiki API etiquette, `imapflow` 1.7.8 and `nodemailer` 9.1.1 (already pinned). No new package is installed in this milestone.

Checked again at planning, 2026-09-24:

- **Cal.com slots:** `GET https://api.cal.com/v2/slots`, header `cal-api-version: 2024-09-04`; query `username`, `eventTypeSlug`, `start`, `end` (ISO 8601, UTC), optional `timeZone`; answer `{ status: 'success', data: { '<date>': [{ start: '<ISO with offset>' }] } }` ([slots](https://cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type)).
- **Cal.com booking:** `POST https://api.cal.com/v2/bookings`, header `cal-api-version: 2026-02-25`, `Authorization` not required; body `start` (ISO UTC), `eventTypeSlug`, `username`, `attendee: { name, email, timeZone, language? }`; answer `{ status: 'success', data: { uid, start, status } }` ([bookings](https://cal.com/docs/api-reference/v2/bookings/create-a-booking)).
- **Mapy.com routing:** `GET https://api.mapy.com/v1/routing/route`; `start` and `end` as `lon,lat` (unexploded form accepted); `routeType` one of `car_fast`, `car_fast_traffic`, `car_short`, `foot_fast`, `foot_hiking`, `bike_road`, `bike_mountain`; answer `length`, `duration`; key in header `X-Mapy-Api-Key` (the query form `apikey` exists and is not used, so the key never sits in a URL) ([routing OpenAPI](https://api.mapy.com/v1/docs/routing/openapi.json), read 2026-09-24). Units: metres and seconds ([REST API](https://developer.mapy.com/rest-api-mapy-cz/)).
- **Mapy.com geocoding:** `GET https://api.mapy.com/v1/geocode`, `query` (at most 150 characters), `lang`, `limit` (at most 15); answer `items[]` with `name`, `label`, `position: { lon, lat }`, `type`, `location`; without a key the API answers 401 (live request, 2026-09-24) ([geocode OpenAPI](https://api.mapy.com/v1/docs/geocode/openapi.json)).
- **Wikipedia:** `GET https://<lang>.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=coordinates|extracts&explaintext=1&redirects=1&titles=<title>` answers `query.pages[0]` with `title`, `coordinates[0].lat/lon`, `extract`, with no key (live request for "Beroun" on cs.wikipedia.org, 2026-09-24); one request at a time, descriptive User-Agent ([etiquette](https://www.mediawiki.org/wiki/API:Etiquette)).
- **imapflow 1.7.8** (`node_modules/imapflow/lib/imap-flow.d.ts` and `imap-flow.js`, read 2026-09-24): `getMailboxLock(path, { readOnly: true })` opens the folder with EXAMINE, so no flag changes; `search({ since }, { uid: true })`; `fetchAll(uids, { envelope: true, internalDate: true }, { uid: true })`; `fetchOne(uid, { bodyStructure: true, envelope: true }, { uid: true })`; `download(uid, part, { uid: true, maxBytes })` decodes transfer encoding, `format=flowed` and the charset to UTF-8 for text parts. `close()` (`imap-flow.js` lines 2567–2660) is synchronous: it rejects the command in progress and every queued command with a `NoConnection` error, so an aborted call settles at once instead of waiting for the socket timeout.
- **Tool names:** a custom tool name must match `^[a-zA-Z0-9_-]{1,128}$` ([define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)), so `calcom-public__slots` is valid.
- **Prompt cache:** the tool list comes first in the cached prefix; the first call of recent runs wrote 15,584 to 31,687 cache tokens at $0.04 to $0.12 (`data/bots/*/runs/*/events.jsonl`, `cost` events, read 2026-09-24). This is the price of one rebuild (spec decision 11).

## Decisions made in this plan

These fill gaps the spec leaves. Each is small and follows the spec's intent; the reviewer and the author can object before `/implement`.

| # | Decision | Reason |
| - | -------- | ------ |
| P1 | A connector write asks every time; `approval-rules.json` is not consulted for it. | Spec decision 4 ("writes always ask"); fail closed. `alwaysAllow` can never switch a connector write off. |
| P2 | The write card is the existing `approval` card with two optional fields, `connectorTool` and `connectorArgs`. The connect card is a new card type `connect`. | Reusing the approval card keeps the decide route, the restart handling (`expired`) and the unknown-outcome recovery unchanged. |
| P3 | The connect card uses the `Approvals` registry for its wait (same route, same 30-minute timeout, same Stop handling). After the decision the record is removed with a new `Approvals.forget(id)`. | No second waiting mechanism. `forget` keeps a "Not now" from counting as a denied action in `deniedFor`, which would relabel a later failure of the run as `denied`. |
| P4 | An allowed connector approval is consumed before the call runs. | An approval with no page must never be left usable for a DOM control. |
| P5 | Built-in connections store only `id`, `builtin`, `grantedAt` and `status`. The spec's per-tool list is for MCP and arrives with milestone 2. | Built-in tools and their classes are fixed in code (spec section 2); storing them would store a second copy that can drift. |
| P6 | The store keeps the built-in's id as a slug, not as an enum of service names. The registry checks it against the built-ins it knows; an unknown id is ignored and logged. | `src/server/store/` stays free of service names (Platform code rule, with the folder exception below). |
| P7 | Platform-boundary exception (author, 2026-09-24, at planning): `src/server/connectors/builtin/` may name its service and use that service's own terms. `scripts/preflight.sh` excludes that folder from the site-name and work-word greps; `CLAUDE.md` states the exception. Everything else keeps the rule. | A built-in connector is a service adapter like the E2B module: it serves every bot. |
| P8 | Only connectors a bot can use are listed in its prompt: `mapy` only when `MAPY_API_KEY` is set, `bot-mailbox` only for the bot named in `MAILBOX_BOT_ID` while the mailbox is configured. | The bot never asks for a connection the operator has not set up. |
| P9 | The run still wakes the bot's computer at its start, as today. | Starting the computer lazily is a runner change with its own state table; sandbox hours are unchanged by this milestone and the cost statement says so. |
| P10 | `fetch_url` stays the reader for public JSON APIs that need no key; the channel rule says so. | It already accepts `application/json`. A bot can record such an endpoint in its skill with no new code. |

## Cost (invariant 8 statement)

Model cost per typical run goes down; the numbers are the spec's section 7 estimates from the measured step cost of $0.019 after the screenshot batching.

| Work | Today | With a connector |
| ---- | ----- | ---------------- |
| Road distance | 10–20 computer steps, $0.19–0.38 | one `mapy__route` call, about 1,000 tokens |
| Free times and one booking card | 15–25 steps, $0.29–0.48 | `calcom-public__slots` plus `calcom-public__book` at the gate |
| Reading one mail | 5–10 steps, $0.10–0.19 | one `bot-mailbox__read` call, text only |
| Encyclopedia page | one `fetch_url`, up to 20,000 characters | one extract, usually a few thousand characters |

Added cost: one cache rewrite of $0.04–0.12 per run in which a connection is granted (decision 11), and the connector section of the prompt (about 150 tokens, cached). Sandbox hours: unchanged (P9). The cheaper path considered: no connect card at all for keyless built-ins; rejected for `mapy`, `calcom-public` and `bot-mailbox` by decision 10. Task 9 measures one Homer run and one Hunter run against the baseline in their run logs.

## File Changes

| Action | Path | Purpose |
| ------ | ---- | ------- |
| Create | `src/server/store/connections.ts` | Read and write `connections.json` |
| Modify | `src/server/store/types.ts` | `Connection` schema; `connect` card; optional connector fields on the `approval` card |
| Modify | `src/server/store/paths.ts` | `connectionsFile()` |
| Modify | `src/server/store/index.ts` | Store methods `readConnections`, `writeConnection` |
| Modify | `src/server/store/chat.ts` | `connectorArgs` is a long field in `fitCard` |
| Modify | `src/server/store/store.test.ts` | Persistence tests |
| Create | `src/server/connectors/types.ts` | `BuiltinConnector`, `ConnectorTool`, `ConnectorEnv`, `ConnectorError` |
| Create | `src/server/connectors/registry.ts` | Builds the bot's connector tools and catalog; offers and grants built-ins |
| Create | `src/server/connectors/registry.test.ts` | Registry tests with a neutral test connector |
| Create | `src/server/agent/connector-gate.ts` | The gate for every connector call |
| Create | `src/server/agent/connector-gate.test.ts` | Gate tests (invariant 4) |
| Modify | `src/server/agent/run-context.ts` | `connectors: ConnectorsPort` on `RunContext` |
| Modify | `src/server/agent/gate.ts` | `Approvals.forget()` |
| Modify | `src/server/agent/run.ts` | Tool list and prompt from the bot's connections, rebuilt when they change |
| Modify | `src/server/agent/runner.ts` | `connectors` in deps and in the context |
| Modify | `src/server/agent/fakes.ts` | `makeContext` takes `connectors`; default has none |
| Modify | `src/server/agent/tools.ts` | `request_connection` tool; in `basePlatformTools` |
| Modify | `src/server/agent/prompt.ts` | Channel rule, capability rule, connector section |
| Modify | `src/server/agent/recovery.ts` | A pending `connect` card becomes `expired` at boot |
| Create | `src/server/connectors/builtin/wikipedia.ts` (+ `.test.ts`) | `page` |
| Create | `src/server/connectors/builtin/mapy.ts` (+ `.test.ts`) | `geocode`, `route` |
| Create | `src/server/connectors/builtin/calcom-public.ts` (+ `.test.ts`) | `slots`, `book` |
| Create | `src/server/connectors/builtin/bot-mailbox.ts` (+ `.test.ts`) | `list`, `read`, `send` |
| Create | `src/server/connectors/builtin/index.ts` | The list of built-ins |
| Modify | `src/server/config.ts` (+ `config.test.ts`) | `MAPY_API_KEY`, `MAILBOX_BOT_ID` |
| Modify | `src/server/index.ts` | Build the registry; hide the Mapy key in logs |
| Modify | `src/server/mail/watcher.ts` | Header comment per spec decision 8 |
| Modify | `src/web/components/Cards.tsx`, `src/web/api.ts`, `src/web/styles.css` | Connect card; connector fields on the approval card |
| Modify | `scripts/preflight.sh`, `CLAUDE.md` | Folder exception P7 |
| Modify | `.env.example` | `MAPY_API_KEY=`, `MAILBOX_BOT_ID=` with comments |
| Modify | `docs/decisions.md`, `docs/operating-guide.md`, `docs/verification.md`, `docs/build-history.md`, the private backlog | Task 9 |
| Create | `docs/evidence/<date>-connectors-m1/README.md` | Live-run record |

## Before Task 1

```bash
cd <repository root>
git status -sb
git worktree add .claude/worktrees/connectors -b connectors
cd .claude/worktrees/connectors
pnpm install
cp ../../../.env.local .env.local
pnpm typecheck && pnpm test
```

## Tasks

### Task 1: Connection store [mechanical] [support]

**Files:** Create `src/server/store/connections.ts`; modify `src/server/store/types.ts`, `paths.ts`, `index.ts`; test in `src/server/store/store.test.ts`
**Invariant:** 6 — a connection granted before a restart is there after it; proven by a test that writes with one store and reads with a new one.
**Demo step:** Rows 1 and 6 need a grant that lasts beyond the run. Support: without it every run would ask again.
**Verify:** `pnpm vitest run src/server/store` and `pnpm preflight`

In `types.ts`, after `ApprovalRules`:

```ts
/** One connector granted to a bot. `builtin` names a built-in the registry knows; the store does not check which. */
export const Connection = z.object({
  id: z.string().regex(SLUG),
  kind: z.literal('builtin'),
  builtin: z.string().regex(SLUG),
  grantedAt: z.string(),
  status: z.enum(['connected', 'disconnected']),
})
export type Connection = z.infer<typeof Connection>
export const Connections = z.array(Connection)
```

In `paths.ts`: `export function connectionsFile(dataDir: string, botId: string): string { return botFile(dataDir, botId, 'connections.json') }`.

`connections.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { connectionsFile, isNotFound, withFileLock, writeFileAtomic } from './paths'
import { Connections, type Connection } from './types'

// The bot's connectors. A missing file is a bot with no connections; a file that does not parse
// throws, and the caller decides (the registry treats it as no connections and logs the bot id).

export async function readConnections(dataDir: string, botId: string): Promise<Connection[]> {
  try {
    return Connections.parse(JSON.parse(await readFile(connectionsFile(dataDir, botId), 'utf8')))
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
}

/** Adds the connection, or replaces the one with the same id. */
export async function writeConnection(dataDir: string, botId: string, connection: Connection): Promise<void> {
  const path = connectionsFile(dataDir, botId)
  await withFileLock(path, async () => {
    const others = (await readConnections(dataDir, botId)).filter((c) => c.id !== connection.id)
    await writeFileAtomic(path, `${JSON.stringify([...others, connection], null, 2)}\n`)
  })
}
```

Add `readConnections` and `writeConnection` to `createStore` with `.bind(null, dataDir)`.

- [ ] Write failing tests: a missing file reads as `[]`; a written connection is read back by a second `createStore` on the same directory; writing the same id twice keeps one entry with the later values; a file holding `{` makes `readConnections` reject; the file's mode is `0o600`
- [ ] Verify the tests fail
- [ ] Implement
- [ ] Verify the tests pass; `pnpm typecheck`; `pnpm preflight`
- [ ] Commit: `Store a bot's connections in its folder`

### Task 2: Connector gate, registry and the run's tool list [integration] [demo-path]

**Files:** Create `src/server/connectors/types.ts`, `src/server/connectors/registry.ts`, `src/server/connectors/registry.test.ts`, `src/server/agent/connector-gate.ts`, `src/server/agent/connector-gate.test.ts`; modify `src/server/agent/run-context.ts`, `gate.ts`, `run.ts`, `runner.ts`, `fakes.ts`, `src/server/store/types.ts`, `src/server/store/chat.ts`; tests in `run.test.ts`
**Invariant:** 4 — a write tool stops at an approval card and Deny means the call is never made; proven by gate tests that count calls on the connector. Invariant 3 — a connector failure is a tool result, never a crashed run.
**Demo step:** Rows 2, 5 and 6: reads run without a card; the booking stops at a card.
**Verify:** `pnpm vitest run src/server/agent src/server/connectors` and `pnpm preflight`

`src/server/connectors/types.ts`:

```ts
import type { z } from 'zod'
import type { ActionKind } from '../store'

// A built-in connector: a fixed list of tools, each marked read or write in code. The registry
// turns them into platform tools; the gate decides from the mark, never from what a tool says.

export type ToolClass = 'read' | 'write'

/** What a connector call may use: the network, the operator's keys it needs, and the bot's mailbox when it is granted. */
export type ConnectorEnv = {
  fetch: typeof fetch
  mapyApiKey: string | null
  mailbox: MailboxClient | null
  /** The one bot that may use the mailbox (`MAILBOX_BOT_ID`). */
  mailboxBotId: string | null
}

export type ConnectorTool = {
  name: string
  class: ToolClass
  description: string
  schema: z.ZodObject
  /** For a write: the kind on the approval card and the one sentence the user reads there. */
  kind?: ActionKind
  consequence?(input: never): string
  run(input: never, env: ConnectorEnv, signal: AbortSignal): Promise<string>
}

export type BuiltinConnector = {
  id: string
  title: string
  /** One line for the prompt's connector section and the connect card. */
  what: string
  /** True for a connector every bot has without a card (spec decision 10). */
  onByDefault: boolean
  /** Null when this bot may use it; otherwise why not, for the operator log. */
  unavailable(botId: string, env: ConnectorEnv): string | null
  tools: ConnectorTool[]
}

/** A failure whose message is written for the model: no key, no internal detail. */
export class ConnectorError extends Error {
  override name = 'ConnectorError'
}
```

`MailboxClient` is implemented in Task 6; its type is declared in `types.ts` in this task:

```ts
export type MailHeader = { uid: number; from: string; subject: string; date: string }
export type MailboxClient = {
  address: string
  list(folder: string, since: Date, signal: AbortSignal): Promise<MailHeader[]>
  read(uid: number, signal: AbortSignal): Promise<{ header: MailHeader; text: string }>
  send(mail: { to: string; subject: string; body: string }, signal: AbortSignal): Promise<void>
}
```

`run-context.ts` gains:

```ts
/** The bot's connector tools and the prompt's connector lines. `key` changes exactly when the tool list does. */
export type ConnectorSnapshot = { tools: ToolDef[]; catalog: string[]; key: string }
export type ConnectorOffer = { id: string; title: string; what: string }
export type ConnectorsPort = {
  snapshot(botId: string): Promise<ConnectorSnapshot>
  /** A built-in this bot may be offered, or the refusal written for the model. */
  offer(botId: string, builtin: string): Promise<ConnectorOffer | { refused: string }>
  /** Grants the built-in and returns the tool names the bot now has. */
  grant(botId: string, builtin: string): Promise<string[]>
}
```

and `connectors: ConnectorsPort` on `RunContext`. `fakes.ts` exports `NO_CONNECTORS: ConnectorsPort` (snapshot `{ tools: [], catalog: [], key: '' }`, `offer` refuses with "no connectors in this test", `grant` rejects) and `makeContext` takes `connectors?: ConnectorsPort`, default `NO_CONNECTORS`, so every existing run test keeps today's tool list.

`gate.ts`, in `Approvals`:

```ts
/** Removes a decided record that is not an action: a connect card's answer must not count in deniedFor. */
forget(id: string): void {
  this.byId.delete(id)
}
```

`types.ts`, the `approval` card gains `connectorTool: SHORT.optional()` and `connectorArgs: LONG.optional()`; `chat.ts` adds `connectorArgs` to `LONG_FIELDS`.

`src/server/agent/connector-gate.ts`:

```ts
import type { ConnectorEnv, ConnectorTool } from '../connectors/types'
import { ConnectorError } from '../connectors/types'
import { errorFields, log } from '../log'
import type { Card } from '../store'
import type { RunContext } from './run-context'
import { DENIED_TEXT, ToolError } from './tools'

// The gate for connector calls. A tool marked read in code runs. A tool marked write stops at an
// approval card every time, whatever approval-rules.json says, and runs only after Allow once. The
// approval is consumed before the call, so it can never cover a control on a page. Deny, Stop and a
// card nobody answers all mean the call is never made.

export const CONNECTOR_TIMEOUT_MS = 20_000
export const CONNECTOR_MAX_CHARS = 20_000
export const STOPPED_CALL_TEXT = 'not run: the user stopped this run'

export function unknownWriteText(tool: string): string {
  return `${tool} did not answer in time; whether it happened is unknown. Do not call it again: tell the user what you tried and let them check.`
}

function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

function cut(text: string): string {
  if (text.length <= CONNECTOR_MAX_CHARS) return text
  return `${text.slice(0, CONNECTOR_MAX_CHARS)}\n\n[truncated: the result has ${text.length} characters; only the first ${CONNECTOR_MAX_CHARS} are shown]`
}

/** `timeoutMs` is a parameter so a test can use a short limit; the registry always passes the default. */
export async function runConnectorTool(toolName: string, tool: ConnectorTool, input: never, env: ConnectorEnv, ctx: RunContext, timeoutMs = CONNECTOR_TIMEOUT_MS): Promise<string> {
  if (tool.class === 'write') {
    const kind = tool.kind ?? 'other'
    const summary = tool.consequence?.(input) ?? `${toolName} changes something outside`
    const approval = ctx.approvals.propose(ctx.botId, ctx.runId, ctx.progress.step, { kind, target: toolName, page: '' })
    const card: Card = {
      card: 'approval', approvalId: approval.id, runId: ctx.runId, actionKind: kind, summary,
      consequences: [], warnings: [], target: toolName, url: '', shot: null, status: 'pending', announced: true,
      connectorTool: toolName, connectorArgs: JSON.stringify(input, null, 2),
    }
    const posted = await ctx.postChat({ role: 'card', card })
    await ctx.emit({ type: 'approval', approvalId: approval.id, status: 'pending' })
    await ctx.setBotState('waiting', `waiting for your approval: ${toolName}`)
    const decision = await ctx.waitForApproval(approval.id)
    ctx.approvals.consume(approval.id)
    await ctx.setBotState('working', 'working')
    await ctx.updateChat(posted.id, { ...card, status: decision })
    await ctx.emit({ type: 'approval', approvalId: approval.id, status: decision })
    if (decision === 'denied') return DENIED_TEXT
    if (ctx.cancelRequested()) return STOPPED_CALL_TEXT
  }
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ctx.cancelSignal])
  try {
    // The gate stops waiting when the signal fires, even if a connector ignores it: a run never
    // hangs on a service. The connector's own abort handling then only frees its connection.
    return cut(await Promise.race([tool.run(input, env, signal), untilAborted(signal)]))
  } catch (e) {
    if (e instanceof ConnectorError) throw new ToolError(e.message)
    if (ctx.cancelRequested()) throw new ToolError(tool.class === 'write' ? `${STOPPED_CALL_TEXT}; ${unknownWriteText(toolName)}` : STOPPED_CALL_TEXT)
    if (signal.aborted) throw new ToolError(tool.class === 'write' ? unknownWriteText(toolName) : `${toolName} did not answer in time`)
    // Anything else may carry a path, an address with a key or a server's detail: the model gets the error's name.
    log.warn('connector call failed', { botId: ctx.botId, runId: ctx.runId, tool: toolName, ...errorFields(e) })
    throw new ToolError(`${toolName} failed (${errorFields(e).errorName})`)
  }
}
```

State table for one call (the KISS rule in `CLAUDE.md`):

| State | Read | Write |
| ----- | ---- | ----- |
| Success | text, cut to 20,000 characters | same, after Allow once |
| Failure the connector explains (`ConnectorError`) | its message | its message |
| Other failure | `<tool> failed (<error name>)`, log line by name | same |
| Timeout (20 s) | "did not answer in time" | "whether it happened is unknown; do not call it again" |
| Stop before or during the card | — | Stop denies the pending card through `waitForApproval`: `DENIED_TEXT`, call not made |
| Stop between Allow and the call | — | `STOPPED_CALL_TEXT`, call not made |
| Stop during the call | "not run: the user stopped this run" | the same plus the unknown-outcome text |
| Card unanswered for 30 minutes | — | denied by the runner's timer: `DENIED_TEXT` |
| Restart during the card | — | the card becomes `expired` at boot (`recovery.ts`, unchanged) |
| Restart after Allow, before the result | — | the run's `approval allowed` event makes recovery end it as `unknown` (unchanged) |
| Retry | no automatic retry | none; the unknown-outcome text forbids it |
| Partial result | not possible for these connectors: one request per call | same |

`src/server/connectors/registry.ts`:

```ts
import { z } from 'zod'
import { runConnectorTool } from '../agent/connector-gate'
import type { ConnectorOffer, ConnectorSnapshot, ConnectorsPort, ToolDef } from '../agent/run-context'
import { defineTool } from '../agent/tools'
import { errorFields, log } from '../log'
import type { Connection, Store } from '../store'
import type { BuiltinConnector, ConnectorEnv } from './types'

// Turns a bot's connections into platform tools named <connection>__<tool>. Only connectors this bot
// may use are listed; a connection the registry does not know, or one it may no longer use, gives
// no tools.

export class ConnectorRegistry implements ConnectorsPort {
  constructor(
    private readonly store: Pick<Store, 'readConnections' | 'writeConnection'>,
    private readonly builtins: BuiltinConnector[],
    private readonly env: ConnectorEnv,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async snapshot(botId: string): Promise<ConnectorSnapshot> {
    const granted = await this.connected(botId)
    const tools: ToolDef[] = []
    const catalog: string[] = []
    for (const c of this.usable(botId)) {
      const on = c.onByDefault || granted.has(c.id)
      catalog.push(`${c.id} — ${c.what} (${on ? `connected: ${c.tools.map((t) => `${c.id}__${t.name}`).join(', ')}` : 'not connected; ask with request_connection'})`)
      if (on) for (const t of c.tools) tools.push(this.toolDef(c, t))
    }
    return { tools, catalog, key: tools.map((t) => t.name).join(',') }
  }

  async offer(botId: string, builtin: string): Promise<ConnectorOffer | { refused: string }> {
    const c = this.usable(botId).find((b) => b.id === builtin)
    if (!c) return { refused: `there is no connector named ${builtin} you can use; the ones you can ask for are: ${this.usable(botId).filter((b) => !b.onByDefault).map((b) => b.id).join(', ') || 'none'}` }
    if (c.onByDefault || (await this.connected(botId)).has(c.id)) return { refused: `${c.id} is already connected` }
    return { id: c.id, title: c.title, what: c.what }
  }

  async grant(botId: string, builtin: string): Promise<string[]> {
    const c = this.usable(botId).find((b) => b.id === builtin)
    if (!c) throw new Error('not a usable connector')
    const connection: Connection = { id: c.id, kind: 'builtin', builtin: c.id, grantedAt: this.now().toISOString(), status: 'connected' }
    await this.store.writeConnection(botId, connection)
    return c.tools.map((t) => `${c.id}__${t.name}`)
  }

  private usable(botId: string): BuiltinConnector[] {
    return this.builtins.filter((c) => c.unavailable(botId, this.env) === null)
  }

  private async connected(botId: string): Promise<Set<string>> {
    try {
      const stored = (await this.store.readConnections(botId)).filter((c) => c.status === 'connected')
      const known = new Set(this.builtins.map((b) => b.id))
      for (const c of stored) if (!known.has(c.builtin)) log.warn('a stored connection names a connector this server does not have; it gives no tools', { botId, connection: c.id })
      return new Set(stored.map((c) => c.builtin))
    } catch (e) {
      // Fail closed: a file that cannot be read grants nothing. The run goes on with fewer tools.
      log.error('the bot connections could not be read; the run has only the connectors on by default', { botId, ...errorFields(e) })
      return new Set()
    }
  }

  private toolDef(c: BuiltinConnector, t: BuiltinConnector['tools'][number]): ToolDef {
    const name = `${c.id}__${t.name}`
    return defineTool({
      name,
      description: `${t.description}${t.class === 'write' ? ' The user approves every call on a card first.' : ''}`,
      schema: t.schema as z.ZodObject,
      run: (input, ctx) => runConnectorTool(name, t, input as never, this.env, ctx),
    })
  }
}
```

`run.ts`: replace the fixed tool list with one read from the bot's connections. Before the loop:

```ts
let connectors = await ctx.connectors.snapshot(ctx.botId)
const promptFor = (catalog: string[]): string => buildSystemPrompt({ bot, memory, skills, activeSkill: input.activeSkill, connectors: catalog, ...routinePart })
const system: Anthropic.Messages.TextBlockParam[] = [{ type: 'text', text: promptFor(connectors.catalog), cache_control: { type: 'ephemeral' } }]
let runTools: ToolDef[] = [...ctx.tools, ...connectors.tools]
let tools: Anthropic.Messages.ToolUnion[] = [{ type: 'computer_toolset_20260801' }, ...toolDefinitions(runTools)]
```

(`routinePart` is the existing routine spread, pulled into a constant.) Just before `setCacheBreakpoint(messages)` in the loop:

```ts
// A connection granted during the run: the new tools and the prompt's connector lines take effect
// before the next call. The cached prefix is written again once; nothing changes when the key is the same.
const current = await ctx.connectors.snapshot(ctx.botId)
if (current.key !== connectors.key) {
  connectors = current
  runTools = [...ctx.tools, ...connectors.tools]
  tools = [{ type: 'computer_toolset_20260801' }, ...toolDefinitions(runTools)]
  system[0] = { type: 'text', text: promptFor(connectors.catalog), cache_control: { type: 'ephemeral' } }
}
```

`handlePlatform` looks the tool up in `runTools` instead of `ctx.tools`. `buildSystemPrompt` takes `connectors: string[]` in this task and ignores it until Task 7 (default `[]`, so `prompt.test.ts` is untouched here).

`runner.ts`: `connectors: ConnectorsPort` in `RunnerDeps`, passed into the context. `runner.test.ts` and every other builder of `RunnerDeps` pass `NO_CONNECTORS`.

- [ ] Write failing gate tests in `connector-gate.test.ts` with a neutral test tool `echo` (read) and `note` (write, kind `publish`) that count their calls:
  - a read runs, posts no card, and returns its text
  - a write posts one `approval` card with `connectorTool` and the arguments as JSON, and does not call the tool before the decision
  - Deny returns `DENIED_TEXT` and the write was called zero times
  - Allow runs the write once and the approval is consumed (`approvals.findMatch` for a control named `note` on page `''` returns null)
  - `rules` with `alwaysAllow: ['*']` and `requireApproval: []` still posts the card (P1)
  - Stop while the card waits: the write is called zero times
  - a tool whose promise never settles and ignores its signal, called with `timeoutMs = 50`: the gate returns "whether it happened is unknown" for a write and "did not answer in time" for a read (a real 50 ms wait on an observable result, no fake timers)
  - a tool that throws `new Error('https://x/?key=SECRET')` gives `note failed (Error)` and the text `SECRET` is in no result and no chat line
  - a result of 25,000 characters is cut to 20,000 with the truncation line
- [ ] Write failing registry tests in `registry.test.ts` with two neutral test connectors (`alpha` on by default with one read; `beta` needing a grant, one read and one write, and a third `gamma` whose `unavailable` returns a reason):
  - `snapshot` for a new bot lists `alpha__*` tools only; the catalog has `alpha` connected, `beta` not connected, no `gamma`
  - after `grant('beta')` the snapshot has `beta__*` tools and a different `key`
  - `offer('gamma')` and `offer('nope')` refuse and name only `beta`; `offer('alpha')` says already connected
  - a `connections.json` that does not parse gives the default tools only and one error log line naming the bot
  - a stored connection whose builtin the registry does not know gives no tool and one warning naming the bot and the connection id
- [ ] Write a failing run test in `run.test.ts`: a fake `ConnectorsPort` whose snapshot changes after the first model call; the second model request carries the new tool name and a system prompt that differs from the first; with an unchanged snapshot the `tools` array of every request is deep-equal (the cache holds)
- [ ] Verify the tests fail
- [ ] Implement
- [ ] Verify: `pnpm vitest run src/server/agent src/server/connectors`, `pnpm typecheck` and `pnpm preflight`
- [ ] Commit: `Gate every connector call and build the tool list from the bot's connections`

### Task 3: `request_connection`, the connect card and its restart rule [integration] [demo-path]

**Files:** Modify `src/server/agent/tools.ts`, `src/server/store/types.ts`, `src/server/agent/recovery.ts`, `src/web/components/Cards.tsx`, `src/web/styles.css`; tests in `tools.test.ts`, `recovery.test.ts`
**Invariant:** 7 — the user connects in the chat with one click, no file and no setting; 4 — the connect card grants reads and writes only as the gate allows them, never a call.
**Demo step:** Row 1 (Homer asks for Mapy.com, the user clicks Connect).
**Verify:** `pnpm vitest run src/server/agent/tools.test.ts src/server/agent/recovery.test.ts` and `pnpm preflight`

`types.ts`, in the `Card` union:

```ts
z.object({
  card: z.literal('connect'),
  approvalId: z.string().max(100),
  runId: z.string().max(100),
  connector: SHORT,
  title: SHORT,
  what: SHORT,
  reason: SHORT,
  // `expired`: the server restarted before the user answered.
  status: z.enum(['pending', 'connected', 'declined', 'expired']),
}),
```

`tools.ts`:

```ts
/**
 * Asks the user to connect a connector, and waits. Connect grants it and its tools are there from the
 * next step; Not now leaves everything as it was. The answer is not an action: its record is removed,
 * so a Not now never reads as a denied action.
 */
export const requestConnection = defineTool({
  name: 'request_connection',
  description:
    'Ask the user to connect one of the connectors your prompt lists as not connected, and wait for the answer. Say in reason what it saves the job. Ask once per connector and job; after Not now, use fetch_url or your computer instead.',
  schema: z.object({
    connector: NAME.describe('the connector id, as the prompt lists it'),
    reason: z.string().min(1).max(300).describe('one sentence: what it lets you do without the computer'),
  }),
  run: async ({ connector, reason }, ctx) => {
    const offer = await ctx.connectors.offer(ctx.botId, connector)
    if ('refused' in offer) throw new ToolError(offer.refused)
    const approval = ctx.approvals.propose(ctx.botId, ctx.runId, ctx.progress.step, { kind: 'other', target: `connect ${offer.id}`, page: '' })
    const card: Card = { card: 'connect', approvalId: approval.id, runId: ctx.runId, connector: offer.id, title: offer.title, what: offer.what, reason, status: 'pending' }
    const posted = await ctx.postChat({ role: 'card', card })
    await ctx.setBotState('waiting', `waiting for your answer: connect ${offer.title}`)
    const decision = await ctx.waitForApproval(approval.id)
    ctx.approvals.forget(approval.id)
    await ctx.setBotState('working', 'working')
    if (decision === 'denied' || ctx.cancelRequested()) {
      await ctx.updateChat(posted.id, { ...card, status: 'declined' })
      return `the user did not connect ${offer.id}; do this job with fetch_url or your computer`
    }
    const names = await ctx.connectors.grant(ctx.botId, offer.id)
    await ctx.updateChat(posted.id, { ...card, status: 'connected' })
    return `connected ${offer.id}; from your next step you have: ${names.join(', ')}`
  },
})
```

Add `requestConnection` to `basePlatformTools`. `recovery.ts`, `closedCard`: `if (card.card === 'connect' && card.status === 'pending') return { ...card, status: 'expired' }`.

The connect wait deliberately emits no `approval` run event: `recovery.ts` reads an `allowed` approval event as "an action was approved" and would end a run cut by a restart as `unknown`, although granting a connection is no outside action. The Runs tab still shows it: the `tool_call` and `tool_result` of `request_connection` and the bot-state `status` events that `setBotState` writes. Note: `waitForApproval` calls the human with need `approval`; the notice text says "waiting for your approval", which fits a connect card. The notifier stays unchanged.

`Cards.tsx`, a new case:

```tsx
case 'connect':
  return (
    <div className={`card connect decided-${card.status}`}>
      <h4>
        Connect {card.title} <span className="tag">connector</span>
        {card.status !== 'pending' && <span className="tag">{card.status}</span>}
      </h4>
      <div>{card.reason}</div>
      <div className="meta">{card.what}</div>
      {card.status === 'expired' && <div className="meta">The server restarted before you answered.</div>}
      {card.status === 'pending' && (
        <div className="actions">
          <button className="primary" onClick={() => onDecide(card.approvalId, 'allow')}>Connect</button>
          <button onClick={() => onDecide(card.approvalId, 'deny')}>Not now</button>
        </div>
      )}
    </div>
  )
```

In the `approval` case, when `card.connectorTool` is set, the meta line reads `Connector: <strong>{card.connectorTool}</strong>` instead of the control and page line, and `card.connectorArgs` is shown in a `<pre>`. `styles.css`: `.card.connect` takes the `.card.approval` colours.

- [ ] Write failing tests in `tools.test.ts` with a fake `ConnectorsPort`: Connect calls `grant` once and the result names the tools; Not now calls `grant` zero times, the card ends `declined`, and `approvals.deniedFor(runId)` is false; a refused offer posts no card and returns the refusal as an error result; Stop during the wait ends `declined` with no grant
- [ ] Write a failing test in `recovery.test.ts`: a pending `connect` card becomes `expired` at boot
- [ ] Verify the tests fail
- [ ] Implement
- [ ] Verify the tests pass; `pnpm typecheck`; `pnpm build` (the page compiles); `pnpm preflight`
- [ ] Commit: `Let a bot ask for a connector in the chat`

### Task 4: `wikipedia` and `mapy` built-ins [mechanical] [demo-path]

**Files:** Create `src/server/connectors/builtin/wikipedia.ts`, `wikipedia.test.ts`, `mapy.ts`, `mapy.test.ts`, `index.ts`; modify `scripts/preflight.sh`, `CLAUDE.md`
**Invariant:** 2 — the real services, called with the parameters their documentation names; 5 — the Mapy key is never in a URL, a result, an error text or a log line.
**Demo step:** Rows 1 and 2.
**Verify:** `pnpm vitest run src/server/connectors/builtin` and `pnpm preflight`

The folder exception (P7) lands in this task, because this is the first file under `src/server/connectors/builtin/` and Task 5 needs it for its own words:

- `preflight.sh`: the site-name grep and the work-word grep pipe their hits through `grep -v '^src/server/connectors/builtin/'` before deciding (`--exclude-dir=builtin` is not used: it would exempt any folder of that name anywhere under `src/`). A comment states the exception. The project-history grep and the date grep keep covering the folder.
- `CLAUDE.md`, "Platform code (`src/`)": one bullet: "Exception (author, 2026-09-24): a built-in connector in `src/server/connectors/builtin/` names its service and uses that service's terms. It serves every bot that uses the service. Nothing outside that folder may."

`wikipedia.ts` (`onByDefault: true`, `unavailable: () => null`):

```ts
const USER_AGENT = 'Dobot/1.0 (+https://github.com/robertanton81/dobot-public)'
// MediaWiki asks for one request at a time from one client.
let queue: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.catch(() => undefined)
  return next
}

const page: ConnectorTool = {
  name: 'page',
  class: 'read',
  description: 'Read an encyclopedia article as plain text, with its coordinates when it has them. Cheaper than fetch_url on the same page.',
  schema: z.object({
    lang: z.string().regex(/^[a-z]{2,3}$/).describe('language edition, e.g. en or cs'),
    title: z.string().min(1).max(250).describe('the article title'),
  }),
  run: ({ lang, title }: { lang: string; title: string }, env, signal) =>
    oneAtATime(async () => {
      const url = new URL(`https://${lang}.wikipedia.org/w/api.php`)
      url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', prop: 'coordinates|extracts', explaintext: '1', redirects: '1', titles: title }).toString()
      const res = await env.fetch(url, { signal, headers: { 'user-agent': USER_AGENT } })
      if (!res.ok) throw new ConnectorError(`the encyclopedia answered http ${res.status}`)
      const body = (await res.json()) as { query?: { pages?: { title: string; missing?: boolean; extract?: string; coordinates?: { lat: number; lon: number }[] }[] } }
      const p = body.query?.pages?.[0]
      if (!p || p.missing) throw new ConnectorError(`there is no article titled "${title}" in the ${lang} edition`)
      const where = p.coordinates?.[0] ? `\ncoordinates: lat ${p.coordinates[0].lat}, lon ${p.coordinates[0].lon}` : ''
      return `${p.title}${where}\n\n${p.extract ?? ''}`.trim()
    }),
}
```

`mapy.ts` (`onByDefault: false`, `unavailable: (_, env) => env.mapyApiKey === null ? 'MAPY_API_KEY is not set' : null`): `geocode({ query, lang })` → up to 5 lines `name — label — lon, lat`; `route({ from, to, mode })` with `from`/`to` as `{ lon, lat }` and `mode` one of `car_fast`, `foot_fast`, `bike_road` → `about <km> km (<m> m), about <min> minutes by <mode>`. Both send the key only in `X-Mapy-Api-Key`, use `start=${lon},${lat}` and `end=...`, and map 401 or 403 to `ConnectorError('the map service refused the platform key')`, 429 to `ConnectorError('the map service quota is used up for now')`, anything else to `the map service answered http <status>`.

`builtin/index.ts`: `export const BUILTINS: BuiltinConnector[] = [wikipedia, mapy, calcomPublic, botMailbox]` (the last two are added by Tasks 5 and 6; in this task the array has two entries).

- [ ] Write failing tests with a fake `fetch` that records the request and answers recorded bodies (the Beroun answer from Research; a Mapy route body `{ length: 32412, duration: 2040 }`; a geocode body with two items): exact host, path and query parameters; the User-Agent; the key in the header and nowhere in the URL; a missing article; 401 and 429 texts; the key string appears in no result and no thrown message; two `page` calls started together reach `fetch` one after the other
- [ ] Verify the tests fail
- [ ] Implement
- [ ] Verify the tests pass; `pnpm preflight` passes
- [ ] Commit: `Add the encyclopedia and map connectors`

### Task 5: `calcom-public` built-in [mechanical] [demo-path]

**Files:** Create `src/server/connectors/builtin/calcom-public.ts`, `calcom-public.test.ts`; modify `builtin/index.ts`
**Invariant:** 4 — `book` is a write with kind `book`, so it always stops at the card; 2 — real public booking API.
**Demo step:** Row 6.
**Verify:** `pnpm vitest run src/server/connectors/builtin/calcom-public.test.ts` and `pnpm preflight`

`onByDefault: false`, `unavailable: () => null`. A page address is parsed by one function:

```ts
/** `https://cal.com/<username>/<event>` → its two parts. Only the hosted service's own host is accepted. */
export function parsePage(pageUrl: string): { username: string; eventTypeSlug: string } {
  let url: URL
  try { url = new URL(pageUrl) } catch { throw new ConnectorError('that is not a valid address') }
  const parts = url.pathname.split('/').filter(Boolean)
  if (url.protocol !== 'https:' || !['cal.com', 'app.cal.com'].includes(url.hostname) || parts.length !== 2)
    throw new ConnectorError('only a public page of the form https://cal.com/<name>/<event> can be used')
  return { username: decodeURIComponent(parts[0] ?? ''), eventTypeSlug: decodeURIComponent(parts[1] ?? '') }
}
```

- `slots({ pageUrl, from, to, timeZone })`, read: `GET https://api.cal.com/v2/slots?username&eventTypeSlug&start&end&timeZone`, header `cal-api-version: 2024-09-04`; `from` and `to` are dates `YYYY-MM-DD`; the result lists one line per day with the start times, at most 14 days.
- `book({ pageUrl, start, name, email, timeZone })`, write, kind `book`: `POST https://api.cal.com/v2/bookings`, header `cal-api-version: 2026-02-25`, JSON body `{ start, eventTypeSlug, username, attendee: { name, email, timeZone } }`; result `booked: <start> (<status>), reference <uid>`. `consequence`: `books <start> on <pageUrl> for <name> <<email>>`.
- An answer that is not 2xx: `ConnectorError` with the service's `error.message` cut to 300 characters when the body has one, else `http <status>`.
- `start` is validated as an ISO date-time with `z.iso.datetime({ offset: true })`; `email` with `z.email()`.

- [ ] Write failing tests: `parsePage` accepts `https://cal.com/a/b` and refuses `http://cal.com/a/b`, `https://evil.example/a/b`, `https://cal.com/a` and `https://cal.com/a/b/c`; `slots` sends the exact query and version header and formats a recorded two-day answer; `book` sends the exact body and version header; a 400 with `{ error: { message: 'no available users' } }` gives that message; the tool's class is `write` and its kind is `book`
- [ ] Verify the tests fail
- [ ] Implement
- [ ] Verify the tests pass; `pnpm typecheck`; `pnpm preflight`
- [ ] Commit: `Add the public booking-page connector`

### Task 6: `bot-mailbox` built-in [integration] [demo-path]

**Files:** Create `src/server/connectors/builtin/bot-mailbox.ts`, `bot-mailbox.test.ts`; modify `builtin/index.ts`, `src/server/mail/watcher.ts` (comment only)
**Invariant:** 5 — the mailbox password stays in the platform (it is already platform-held, `MAILBOX_PASSWORD`); the model gets headers and text, never the login. 4 — `send` always stops at the card, and the card shows recipient, subject and the full body.
**Demo step:** Row 6.
**Verify:** `pnpm vitest run src/server/connectors/builtin/bot-mailbox.test.ts` and `pnpm preflight`

The connector (`onByDefault: false`) uses `env.mailbox`. `unavailable(botId, env)` returns a reason unless `env.mailbox !== null` and `botId === env.mailboxBotId` (the field exists since Task 2).

- `list({ folder = 'INBOX', sinceDays = 7 })`, read: at most 50 newest headers, one line each: `uid <n> · <date> · <from> · <subject>`.
- `read({ uid })`, read: header lines, then the text body.
- `send({ to, subject, body })`, write, kind `send`: refuses `to` equal to the mailbox's own address (a mail to itself would start its own mail routine); `consequence`: `sends a mail to <to> with the subject "<subject>"`. The card shows the body in `connectorArgs`.

The IMAP and SMTP side, in the same file, behind `MailboxClient`:

```ts
/** The real mailbox. One short connection per call: calls are rare, and nothing is held open between runs. */
export function imapMailboxClient(imap: ImapSettings, smtp: { host: string; port: number } | null): MailboxClient
```

- `list`: `new ImapFlow(imapOptions(imap))` (the watcher's options, with its short time limits and no logger), `connect`, `getMailboxLock(folder, { readOnly: true })`, `search({ since }, { uid: true })`, the last 50 uids, `fetchAll(uids, { envelope: true, internalDate: true }, { uid: true })`, release, `logout`.
- `read`: the same lock; `fetchOne(String(uid), { envelope: true, bodyStructure: true }, { uid: true })`; the first `text/plain` part in the structure, else the first `text/html` part (then `htmlToText`); `download(String(uid), part, { uid: true, maxBytes: 200_000 })`; the stream read to a string; attachments are named (`[attachment: <filename>]`), never read.
- `address` is `imap.user` (the full address, as the notice mail already requires).
- `send`: `nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: imap.user, pass: imap.password }, logger: false })`, `sendMail({ from: imap.user, to, subject, text: body })`. With no SMTP host, `send` throws `ConnectorError('this mailbox cannot send mail: the operator has not set its outgoing server')`.
- The stop signal: each call registers `signal.addEventListener('abort', () => client.close(), { once: true })` after `connect` and removes it in `finally`; `close()` rejects the command in progress (Research). In `read`, the download stream is also destroyed on abort. The SMTP transport is closed with `transport.close()` on abort.

`watcher.ts` header comment, last sentence becomes: "Reading the mail is the bot's work. A bot with the `bot-mailbox` connector reads it through the platform over IMAP; the model gets the text, never the login."

- [ ] Write failing tests with a fake `MailboxClient`: `list` and `read` output formats; `send` to the mailbox's own address is refused and never reaches the client; the `send` tool is `write` with kind `send`; `unavailable` for another bot and for a bot with no mailbox
- [ ] Write failing tests for `imapMailboxClient` with an injected fake `ImapClientPort`-style client (the same pattern as `watcher.connection.test.ts`): the lock is taken `readOnly: true`; `read` picks `text/plain` over `text/html`; a message with only an HTML part is turned into text; `logout` runs after a failure too
- [ ] Verify the tests fail
- [ ] Implement
- [ ] Verify the tests pass; `pnpm typecheck`; `pnpm preflight`
- [ ] Commit: `Add the bot mailbox connector`

### Task 7: The channel rule and the connector section of the prompt [mechanical] [demo-path]

**Files:** Modify `src/server/agent/prompt.ts`, `prompt.test.ts`
**Invariant:** 8 — the prompt orders the channels: connector, then `fetch_url`, then the computer.
**Demo step:** Rows 1, 2 and 6: the bot chooses the connector on its own.
**Verify:** `pnpm vitest run src/server/agent/prompt.test.ts` and `pnpm preflight`

```ts
export const CHANNEL_RULE =
  'Channels: use a connected connector before fetch_url, and fetch_url before your computer. fetch_url also reads a public JSON API that needs no key. When a step needs a service whose connector your Connectors section lists as not connected, call request_connection once and wait; use your computer for that step only when the user says not now or no connector covers it. Send a connector only what the step needs. When you save a skill, name the channel each step used.'
```

- The rule `'Cheap path first: …'` becomes `'On the computer, take a screenshot before you act …'` (its first sentence moves into `CHANNEL_RULE`); `CHANNEL_RULE` is pushed right before it.
- `CAPABILITY_RULE`: "no API beyond the public pages fetch_url reads" becomes "no API beyond the public pages fetch_url reads and the connectors your Connectors section lists as connected"; `request_connection` is named in its first sentence.
- `buildSystemPrompt` adds, after `## Skills`, `## Connectors` with one line per catalog entry, or `(none)`.
- `prompt.test.ts`, "the platform boundary": the words check runs on the prompt with `connectors: []` and on the tool list without connector tools, as today; one new test checks that `CHANNEL_RULE` and `CAPABILITY_RULE` name no connector id.

- [ ] Write failing tests: the prompt holds `CHANNEL_RULE` for message and routine runs; the `## Connectors` section lists the given lines and `(none)` for none; every tool named in `CAPABILITY_RULE` exists in `basePlatformTools` (the existing test, now with `request_connection`); the boundary test above
- [ ] Verify the tests fail
- [ ] Implement
- [ ] Verify the tests pass; `pnpm typecheck`; `pnpm preflight`
- [ ] Commit: `Tell every bot to use a connector before the browser`

### Task 8: Configuration and boot wiring [mechanical] [support]

**Files:** Modify `src/server/config.ts`, `config.test.ts`, `src/server/index.ts`, `.env.example`
**Invariant:** 5 — the Mapy key is hidden in logs by value; 7 — `MAPY_API_KEY` and `MAILBOX_BOT_ID` are operator setup, named as such.
**Demo step:** Support: without the wiring no connector reaches a run.
**Verify:** `pnpm preflight`

- `config.ts`: `MAPY_API_KEY: OPTIONAL_TEXT`, `MAILBOX_BOT_ID: OPTIONAL_TEXT`; `mailboxBotId(config)` returns the id when it is a slug and warns by name otherwise.
- `index.ts`: `hideInLogs([..., config.MAPY_API_KEY])`; builds `env: ConnectorEnv = { fetch, mapyApiKey: config.MAPY_API_KEY ?? null, mailbox: mail ? imapMailboxClient(mail, smtpFor(config)) : null, mailboxBotId: mailboxBotId(config) }`, where `smtpFor(config)` in `config.ts` returns `{ host: MAILBOX_SMTP_HOST, port: MAILBOX_SMTP_PORT or 465 }` when the host is set and the port is a whole number from 1 to 65535, else null (the same port check as `noticeSettings`, moved into one helper both call; `NOTIFY_EMAIL` is not needed for it); `new ConnectorRegistry(store, BUILTINS, env)` into `RunnerDeps.connectors`; one boot log line lists the usable built-ins by id, never a key.
- `.env.example`: `MAPY_API_KEY=` ("road distances without the browser; free tier at developer.mapy.com") and `MAILBOX_BOT_ID=` ("the one bot that may read and send from the mailbox above").
- [ ] Write failing tests in `config.test.ts`: both keys optional; an empty value means unset; `MAILBOX_BOT_ID=Not A Slug` gives null and a warning with the name only
- [ ] Verify the tests fail
- [ ] Implement
- [ ] Verify: `pnpm preflight` passes
- [ ] Commit: `Wire the built-in connectors into the server`

### Task 9: Live cycles, evidence and documents [integration] [demo-path]

**Files:** Create `docs/evidence/<date>-connectors-m1/README.md`; modify `docs/decisions.md`, `docs/operating-guide.md`, `docs/verification.md`, `docs/build-history.md`, the private backlog
**Invariant:** 1 — the computer stays visible; 2 — real services; 4 — the booking card is denied; 8 — cost measured against the baseline.
**Demo step:** Rows 1, 2 and 6.
**Verify:** the criteria below, with the run logs as evidence

Human-only steps (one at a time, each on the author's word): the author puts `MAPY_API_KEY` into `.claude/worktrees/connectors/.env.local`; Claude appends `MAILBOX_BOT_ID=job-hunt-bot` to the same file without reading it; for cycle 2, Claude sends one test invitation from the author's Gmail through Claude in Chrome, as in the earlier act-two runs.

- [ ] Cycle 1, Homer (`homer-0f7d`): through the chat, "research the town Beroun: population, distance by car from Prague centre". Expected: `wikipedia__page` without a card, one connect card for `mapy`, Connect, then `mapy__geocode` and `mapy__route` in the same run. If Homer's skill `house-search-prague` sends it to the computer, correct it through the chat (invariant 7) and record the correction.
- [ ] Cycle 2, Hunter (`job-hunt-bot`): the test invitation arrives; Hunter asks for `bot-mailbox` and `calcom-public` by cards, reads the mail with `bot-mailbox__read`, lists times with `calcom-public__slots`, and posts one booking card. Deny it. Expected: no Cal.com page opened on the computer for these steps; the run ends `done` or `denied` with the card `denied`.
- [ ] Record for each run: tool calls, cards, model USD from the `cost` events, computer steps; compare with the baseline runs named in the spec's section 7; write `docs/evidence/<date>-connectors-m1/README.md`
- [ ] `docs/decisions.md`: entries for P7 (boundary exception), spec decision 8 (mail read off screen, what the user no longer sees), decisions 10 and 11, and P9 (computer still starts every run)
- [ ] `docs/operating-guide.md`: `MAPY_API_KEY`, `MAILBOX_BOT_ID`, where connections live, how to remove one by hand until milestone 2 brings `disconnect` (named as an operator shortcut per invariant 7)
- [ ] `docs/verification.md`, `docs/build-history.md`, the private backlog (milestone 1 ticked; milestone 2 next)
- [ ] Wait for "sandbox paused" on both bots, stop the server
- [ ] `pnpm preflight`; merge `connectors` into `main` with `--no-ff`; the author pushes
- [ ] Commit: `Record the first live runs of the built-in connectors`

## Verification Criteria

| # | Criterion | How to verify |
| - | --------- | ------------- |
| 1 | Homer asks for Mapy.com with a connect card; after Connect it calls `mapy__route` in the same run and the Runs tab shows the call with no screen steps for it | Cycle 1: watch the page; `data/trace.mjs` on the run |
| 2 | `wikipedia__page` runs for any bot with no card | Cycle 1 run log: `tool_call` without an `approval` event before it |
| 3 | A connector write never runs before Allow once; Deny means zero calls | Gate tests (Task 2); cycle 2: booking card denied, no booking on the Cal.com host's calendar |
| 4 | A connection survives a restart | Store test (Task 1); restart the server after cycle 1 and check that the next Homer run lists `mapy` as connected |
| 5 | The Mapy key appears in no log line, run event, chat line or model request | Task 4 tests; `grep -rF` for the key's first 8 characters over `data/bots/homer-0f7d/runs/<run>/` and the server log, run through a shell variable so the value never prints |
| 6 | Hunter reads the invitation without opening webmail on its computer | Cycle 2 run log: `bot-mailbox__read`, no `open_url` to the webmail host |
| 7 | Model cost per run is lower than the baseline for the same work | Evidence page: USD from `cost` events of cycles 1 and 2 against the spec's baseline |
| 8 | A clean clone still boots with the documented keys only (both new keys optional) | `pnpm build && pnpm start` in `data/fresh-clone` after the merge, on the author's word, with `MAPY_API_KEY` empty: the boot log lists `wikipedia` only |

## Test Plan

- Offline, per task: the scoped `pnpm vitest run ...` commands above. Every connector test uses a fake `fetch` or a fake mailbox client with recorded answers; no test calls a real service.
- Needs keys and a live sandbox: Task 9 only (E2B, Anthropic, Mapy.com key, the bot mailbox).
- Tests not written on purpose: no test that mocks a service and asserts the mock's call count alone; each connector test checks the request the real service would get and the text the model gets back.
- Full pre-flight at the end of every task that touches `src/`: `pnpm preflight`.

## Checkpoint Recovery

If interrupted mid-implementation, resume by:

1. Read this plan
2. `cd .claude/worktrees/connectors && git log --oneline main..connectors` for completed tasks
3. Pick up from the first uncompleted task
