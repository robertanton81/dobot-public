# Connectors: APIs and MCP servers before the browser Design Spec

**Date:** 2026-09-24
**Status:** Approved 2026-09-24 (milestone 1 planned first; milestone 2 after the Notion check)
**TODO items:** section "4. Product: hosted Grok Bot alternative for EU teams", new item "Connectors: API or MCP before the browser" (added by this spec)
**Scope:** `src/server/agent/` (a connector registry, the connector tools, the approval gate for connector writes, the prompt rule), `src/server/connectors/` (new: MCP client, OAuth, token store, built-in connectors), `src/server/store/` (per-bot connections), `src/server/http/app.ts` (OAuth callback, connection routes), `src/web/` (connect and tool-sorting cards), `src/server/config.ts`

## Problem

Invariant 8, as extended by the author on 2026-09-24: a run uses a service's API or MCP server
before its web page, text before the screen, and the computer only when neither covers the step.
Today the bot has one text channel (`fetch_url`, public pages only) and otherwise drives the
browser. Of 175 finished runs, the 119 that used the computer carried 91% of the model cost
($71.01 of $77.76), and after the screenshot batching one computer step costs about $0.019.

Two kinds of work sit behind that cost:

- **Today's example jobs** use services with public APIs: Hunter reads its own mailbox in webmail
  and books on a Cal.com page; Homer reads Wikipedia and checks road distances on Mapy.com.
- **A team's own tools** (Slack, Notion, HubSpot, Stripe, GitHub, Atlassian, Cal.com, Calendly,
  Salesforce) now publish official remote MCP servers with OAuth (Research). A bot that can use
  them does a team's work without a browser.

## Decisions Log

| # | Question | Decision | Reasoning |
| --- | --- | --- | --- |
| 1 | Whose accounts may a connector use? | The bot's own accounts, and the user's own accounts through OAuth. Invariant 5 is amended in `CLAUDE.md` (author, 2026-09-24): an OAuth token granted on the provider's page may be held, scoped, revocable, encrypted, never shown to the model or logged; writes still stop at the gate. | Connectors are useful to a team only with its own accounts; OAuth never gives the platform a password. |
| 2 | First cut | A generic MCP client, plus four built-in connectors: Wikipedia, Cal.com public booking, Mapy.com routing, and the bot's own mailbox over IMAP/SMTP. | The MCP client covers a team's tools; the built-ins cut the measured cost of today's bots and need no user sign-in. |
| 3 | Per bot or account-wide? | Per bot. A bot uses only the connections granted to it. | Matches one computer per bot; a prompt injection in one bot reaches fewer accounts. Grok Bot shares connectors across the account ("not isolated to one Bot"); this is a deliberate difference. |
| 4 | Which calls stop for approval? | Reads are decided once at connect time; writes always ask. The connect card lists the server's tools pre-sorted from its hints; the user confirms or moves tools. Confirmed reads run freely; every write, and every tool not confirmed as a read (including one the server adds later), stops at an approval card each time. Built-in connectors ship with a fixed, reviewed list. | The MCP spec says hints from an untrusted server must not decide; asking on every read makes connectors unusable; the in-run "Always allow" stays parked. |
| 5 | Where does the MCP client run? | In Dobot's own server, calling tools itself. Not Anthropic's MCP connector, not OpenAI's hosted `mcp` tool. | Anthropic's connector executes tools on Anthropic's side, so the gate cannot intercept; OpenAI's approval stops a call but its servers still run it and hold the token. |
| 6 | How does a user connect? | The bot asks in chat with a connect card (for a built-in, or an MCP server URL the user names); the user clicks Connect and signs in on the provider's page; a second card lists the tools to confirm. The user can also ask the bot in chat to connect or disconnect. | Invariant 7: configured in chat; signing in on a provider's page is like signing in on the bot's screen. |
| 7 | Gmail and Outlook | Not in the first cut. | Google's Gmail MCP server is a preview with drafts only, and restricted Gmail scopes need a yearly CASA assessment; Microsoft's needs a Copilot licence. The bot's own mailbox over IMAP covers today's mail work. |
| 8 | Reading the bot's mail off screen | `bot-mailbox` reads mail bodies over IMAP instead of in webmail on the computer. This supersedes the rationale in `src/server/mail/watcher.ts` ("reading the mail is work", done on screen); that comment is updated in milestone 1. | Trade-off, written down: the user no longer watches the bot read mail on its screen (less visible work, invariant 1 still holds for everything else), in exchange for the largest cost cut on Hunter's routine (invariant 8). The Runs tab and the chat show each `read`. |
| 9 | A server that lies about a tool's class | Accepted as a residual risk, narrowed: a confirmed read loses its confirmation whenever its description or input schema changes (a hash is stored at confirmation and compared at every tool-list refresh), and it is then treated as a write until the user confirms it again. A tool that keeps its name, description and schema but changes behaviour on the server cannot be detected by a client. | Reads of an untrusted server are the user's trust decision at connect time, as for Claude's and ChatGPT's connectors; the exposure is limited to one bot (decision 3), and writes through any other tool still stop at the gate. A read tool can still leak what the bot puts in its arguments; the prompt rule tells the bot to send a connector only what the step needs. |
| 10 | Which built-ins need a connect card? (author, 2026-09-24, at `/plan`) | `wikipedia` is on for every bot, with no card. `mapy`, `calcom-public` and `bot-mailbox` each need one Connect click per bot. | Wikipedia touches no account and makes no write, so a grant protects nothing; the others use a platform key, make a write, or reach the bot's mailbox. Matches demo rows 1 and 2. |
| 11 | When do a new connection's tools appear? (author, 2026-09-24, at `/plan`) | In the same run: after Connect, the loop rebuilds the tool list before the next model call. | The tool list sits at the front of the prompt cache, so this rewrites the cache once: about 31,000 tokens, $0.08 to $0.12 (the first call of recent runs). One Mapy route on the computer costs $0.19 to $0.38, so one use repays it. Waiting for the next run would make the user send the goal again. |

## Chosen Approach

A **connector** is a named set of tools a bot can call without the computer. Each bot has a list of
**connections** (connectors granted to it). A connector is either **built in** (code in
`src/server/connectors/builtin/`, with its tool list and each tool's read or write class fixed in
code) or **MCP** (a remote MCP server the user named, reached through the official TypeScript
client, with OAuth). The model sees connector tools as ordinary platform tools named
`<connection>__<tool>`. Every call passes through the gate: a confirmed read runs, anything else
posts an approval card and waits, exactly like a gated computer action. A prompt rule and the
bot's skills make the order of channels explicit: connector, then `fetch_url`, then the computer.

**Why this over alternatives:** see "Alternatives Considered".

## Research (source links)

- **MCP TypeScript client:** `@modelcontextprotocol/client` 2.1.0 (published 2026-09-23; v2 is the
  stable line and implements spec 2026-07-28); `new Client({name, version})`,
  `client.connect(new StreamableHTTPClientTransport(new URL(url)))`, `listTools()`,
  `callTool({ name, arguments })`; per-request `timeout` (default 60,000 ms) and `signal`
  ([connect guide](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect),
  [repository](https://github.com/modelcontextprotocol/typescript-sdk)). Default version
  negotiation is `'legacy'`; `versionNegotiation: { mode: 'auto' }` also speaks 2026-07-28
  (v2 type definitions, read 2026-09-24).
- **MCP authorization (2026-07-28):** the client is an OAuth 2.1 client; discovery through
  Protected Resource Metadata (RFC 9728); client registration preference: pre-registered, then a
  Client ID Metadata Document (an HTTPS URL), then Dynamic Client Registration (deprecated, kept for
  older servers); PKCE; the `resource` parameter (RFC 8707) in both requests; check `iss`
  (RFC 9207); bearer token in the header on every request; a refresh token is not guaranteed
  ([authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)).
  The SDK's `OAuthClientProvider` leaves to the host: redirect URL, client metadata, saving client
  information, tokens (keyed by issuer), the PKCE verifier, and the redirect itself (v2 type
  definitions).
- **Tool annotations:** `readOnlyHint` (default false), `destructiveHint` (default true),
  `idempotentHint`, `openWorldHint`; "Clients should never make tool use decisions based on
  ToolAnnotations received from untrusted servers"; a human in the loop SHOULD be able to deny a
  call ([schema](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).
- **Security:** no token passthrough; SSRF during OAuth discovery (HTTPS only, block private and
  link-local ranges, check each redirect); authorization URLs only `https`
  ([security best practices](https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices)).
- **Hosted MCP runs tools remotely:** Anthropic's MCP connector returns `mcp_tool_use` and
  `mcp_tool_result` in one response, beta header `mcp-client-2025-11-20`, not covered by zero data
  retention ([MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)).
- **Official remote MCP servers:** Slack ([help](https://slack.com/help/articles/48855576908307-Guide-to-Model-Context-Protocol-in-Slack)),
  Notion ([docs](https://developers.notion.com/guides/mcp/overview)), HubSpot
  ([GA 2026-04-13](https://developers.hubspot.com/changelog/remote-hubspot-mcp-server-is-now-generally-available)),
  Stripe ([docs](https://docs.stripe.com/mcp)), GitHub
  ([GA](https://github.blog/changelog/2025-09-04-remote-github-mcp-server-is-now-generally-available/)),
  Atlassian ([repo](https://github.com/atlassian/atlassian-mcp-server)), Cal.com
  ([docs](https://cal.com/docs/mcp-server)), Calendly
  ([page](https://developer.calendly.com/calendly-mcp-server)), Salesforce
  ([GA](https://developer.salesforce.com/blogs/2026/04/salesforce-hosted-mcp-servers-are-now-generally-available)).
- **Gmail:** Google's Gmail MCP server is a developer preview with drafts and no send
  ([Gmail MCP](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server));
  `gmail.readonly` is a restricted scope, and apps storing restricted data need a CASA assessment
  repeated every 12 months ([scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
  [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)).
- **Notion's MCP OAuth metadata** (`https://mcp.notion.com/.well-known/oauth-authorization-server`,
  fetched 2026-09-24): `registration_endpoint` `https://mcp.notion.com/register` (Dynamic Client
  Registration), `code_challenge_methods_supported` includes `S256`,
  `token_endpoint_auth_methods_supported` includes `none` (public clients),
  `client_id_metadata_document_supported: true`. Whether it accepts an `http://localhost` redirect is
  not published; it is checked before milestone 2 (Scope budget).
- **Grok Bot connectors** are account-wide ("not isolated to one Bot") and use approval rules where
  "Ask first" wins ([docs](https://docs.x.ai/grok-bot/computer-and-apps),
  [approvals](https://docs.x.ai/grok-bot/approvals-security-and-privacy)).
- **Cal.com public booking:** `GET https://api.cal.com/v2/slots?username=…&eventTypeSlug=…&start=…&end=…`
  answered 200 with real free slots and no key (live request, 2026-09-24); `POST /v2/bookings`
  marks `Authorization` as not required, with `start`, `eventTypeSlug`, `username`, `attendee`
  ([slots](https://cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type),
  [bookings](https://cal.com/docs/api-reference/v2/bookings/create-a-booking)); header
  `cal-api-version` ([v2 intro](https://cal.com/docs/api-reference/v2/introduction)).
- **Mapy.com:** `GET https://api.mapy.com/v1/routing/route` (`start`, `end`, `routeType`) returns
  `length` in metres and `duration` in seconds; key in `X-Mapy-Api-Key`; 250,000 free credits a
  month, a route costs 4 ([REST API](https://developer.mapy.com/rest-api-mapy-cz/),
  [pricing](https://developer.mapy.com/pricing/), [routing spec](https://api.mapy.com/v1/docs/routing/)).
- **Wikipedia:** MediaWiki `action=query&prop=coordinates|extracts` returns coordinates and text
  with no key; send requests one after another with a descriptive User-Agent
  ([etiquette](https://www.mediawiki.org/wiki/API:Etiquette)).
- **Bot mailbox:** Seznam mail over IMAP `imap.example.test:993` and SMTP `smtp.example.test:465`
  (Seznam Email help, page "Poštovní programy a aplikace" (mail programs));
  Dobot already uses `imapflow` 1.7.8 for mailbox metadata and `nodemailer` 9.1.1 for SMTP
  (`package.json`).

## Design

### 1. Connections (per bot, persisted)

`data/bots/<id>/connections.json`, validated by a zod schema in `store/types.ts`:

```ts
Connection = {
  id: string            // slug the model sees as prefix, e.g. 'notion', 'mapy', 'mail'
  kind: 'builtin' | 'mcp'
  builtin?: 'wikipedia' | 'calcom-public' | 'mapy' | 'bot-mailbox'
  url?: string          // MCP server URL, https only
  grantedAt: string
  tools: { name: string; class: 'read' | 'write'; confirmed: boolean; description: string }[]
  status: 'connected' | 'needs-sign-in' | 'disconnected'
}
```

Tokens are not in this file. They live in `data/bots/<id>/secrets/connections.enc`: one JSON
object per connection and issuer (access token, refresh token, expiry, client information),
encrypted with AES-256-GCM from `node:crypto` under `CONNECTOR_SECRET_KEY` (operator setup, 32
bytes, base64). The key follows the mailbox's soft pattern in `config.ts`, not the hard-fail one:

- **Missing or malformed key at boot:** the server boots; the boot log names the missing setting
  (never a value); built-ins that hold no token (`wikipedia`, `calcom-public`, `mapy`,
  `bot-mailbox`) work; MCP connectors are not offered, and `request_connection` for an MCP URL
  answers that the operator must set the key.
- **Key changed or file damaged:** decryption fails for a connection; that connection becomes
  `needs-sign-in` and the bot asks the user to reconnect. A decryption failure never throws inside a
  run; it is caught where the secret is read and logged by connection id only. No log line, run event, chat line or model context ever holds a token. Disconnect
deletes the connection's secrets and marks it `disconnected`.

### 2. Built-in connectors

Each is a module in `src/server/connectors/builtin/` with a fixed tool list, a fixed class per
tool, a timeout of 20 seconds, and input validated by zod.

| Connector | Tools (class) | Auth | Replaces |
| --- | --- | --- | --- |
| `wikipedia` | `page(lang, title)` → text extract and coordinates (read) | none; User-Agent `Dobot/1.0 (+repository URL)`; one request at a time | `fetch_url` of a whole page |
| `calcom-public` | `slots(pageUrl, from, to)` (read); `book(pageUrl, start, name, email, timezone)` (write) | none; `cal-api-version` header | Driving a Cal.com booking page on the computer |
| `mapy` | `geocode(query)` (read); `route(from, to, mode)` → metres and minutes (read) | platform key `MAPY_API_KEY` (operator setup) | Mapy.com on the computer |
| `bot-mailbox` | `list(folder, since)` → headers (read); `read(uid)` → text body, no attachments (read); `send(to, subject, body)` (write) | the bot's own mailbox (`MAILBOX_*`, already platform-held) | Webmail on the computer |

`bot-mailbox` can be granted only to the one bot the operator set as the mailbox's owner
(`MAILBOX_BOT_ID`), because the process has one mailbox (decisions.md, "The bot has its own
mailbox"). Its `send` card shows the recipient, the subject and the full body. The existing notice
mails to the operator stay as they are.

### 3. MCP connectors

`src/server/connectors/mcp.ts`, on `@modelcontextprotocol/client` (version and advisories checked
at install, per `CLAUDE.md`):

- **Connect:** `https` URLs only. The server URL and every OAuth discovery request and redirect hop
  go through the existing public-host check in `src/server/agent/public-host.ts` (the one
  `fetch_url` uses), not a second copy of it. `versionNegotiation: { mode: 'auto' }`.
- **OAuth:** an `OAuthClientProvider` per bot and connection. Client registration: a
  pre-registered client when the operator configured one for that host, else Dynamic Client
  Registration. (A Client ID Metadata Document needs a public HTTPS URL; it comes with the hosted
  deployment.) The redirect URL is `http://localhost:<PORT>/api/oauth/callback` while the server
  binds to loopback. The PKCE verifier, `state` and the expected issuer are kept in memory for ten
  minutes, keyed by `state`; the callback checks `state` and `iss`.
- **OAuth flow, every state:**

  | State | What happens |
  | --- | --- |
  | Success | The callback checks `state` and `iss`, exchanges the code, stores the tokens encrypted, lists the tools and posts the tools card; the connection becomes `connected` only after the user confirms the tools |
  | The user cancels on the provider's page | The provider redirects with an error; the callback page says "Not connected" in plain words; the connection stays `needs-sign-in`; the chat card offers Connect again |
  | The callback never comes (tab closed) | After ten minutes the pending flow is dropped; the connection stays `needs-sign-in`; nothing else changes |
  | Unknown or expired `state`, or `iss` mismatch | The callback answers a plain page "This sign-in expired or does not match; start again from the chat", with no detail of the request; nothing is stored |
  | Server restart during the flow | The in-memory flow is lost; the callback finds no `state` and answers as above; the user clicks Connect again |
  | The provider is down or the token request fails | The callback page says the provider did not answer; the connection stays `needs-sign-in` |
  | Refresh fails later | See "Refresh and failure" below |

- **Tool list:** read on connect and again at the start of every run that has the connection. A
  tool the saved list does not know, or a confirmed tool whose description or input-schema hash
  changed (decision 9), is saved as `write`, `confirmed: false`, and the bot's next
  card asks the user to sort it. Tool descriptions are cut to 1,000 characters.
- **Call:** `callTool` with a timeout of 60 seconds and the run's stop signal. A result is passed to
  the model as text, cut to 20,000 characters like `fetch_url`; images and resources in a result are
  named, not passed, in this cut.
- **Refresh and failure:** a 401 tries one refresh; if that fails, the connection becomes
  `needs-sign-in` and the tool result tells the model to ask the user to reconnect.

### 4. The gate for connector calls

`src/server/agent/connector-gate.ts`, called by the platform-tool path in `run.ts` for every tool
named `<connection>__<tool>`:

| Tool state | What happens |
| --- | --- |
| class `read`, confirmed | Runs; logged as a `tool_call` and `tool_result` |
| class `write`, or not confirmed | An approval card through the existing `ctx.approvals` (`Approvals` in `gate.ts`) and `ctx.waitForApproval`, the same timeout and Stop handling as a gated computer action: connection, tool, the full arguments as the user will see them, the consequence line from the connector ("sends a mail to …", "books … on …"); Allow once or Deny; the run waits like any card |
| connection not `connected` | Not run; the result tells the model the connection needs the user |

Deny returns the existing `DENIED_TEXT`. A Stop during the wait ends the run as today.

### 5. Connecting through the chat

- New platform tool `request_connection({ builtin?, url?, reason })`: posts a **connect card**
  (connector name, what it can do, why the bot asks) with Connect and Not now. For a built-in
  without sign-in, Connect grants it at once. For MCP, Connect opens the provider's sign-in in a new
  tab; after the callback, a **tools card** lists every tool, pre-sorted by the server's hints
  (a tool is proposed as `read` only when `readOnlyHint` is true and `destructiveHint` is false),
  and the user confirms or moves tools before the connection becomes `connected`.
- New platform tool `disconnect({ connection })`: deletes the tokens and marks the connection
  `disconnected`; the chat shows a short card.
- The bot's header on the page lists its connections, each with a Disconnect button.
- The tools of a connection appear in the model's tool list only while it is `connected`.

### 6. The order of channels

- New prompt rule (platform, neutral wording): "Channels: use a connected connector before
  fetch_url, and fetch_url before the computer. When a job needs a service that has a connector you
  do not have, call request_connection once and wait; use the computer only when the user says not
  now or no connector exists. When you save a skill, name the channel each step used."
- The connector catalog the prompt lists: the four built-ins, and every connection of this bot.
  Discovering unknown MCP servers on the web is out of this cut.

### 7. Cost (invariant 8 statement)

| Work | Today | With a connector | Basis |
| --- | --- | --- | --- |
| Road distance on Mapy.com | About 10–20 computer steps at about $0.019 each, $0.19–0.38 | One call, about 1,000 tokens of result | Run logs; step cost after batching |
| Booking on a Cal.com page | About 15–25 computer steps, $0.29–0.48 | Two calls (slots, book) plus one card | Act-two evidence (step 23 of the booking run) |
| Reading one mail in webmail | About 5–10 steps with screenshots, $0.10–0.19 | One `read` call, the text only | Run logs |
| Wikipedia page | One `fetch_url` of up to 20,000 characters | One extract, usually a few thousand characters | Research |

These are estimates from the measured step cost; the live check in "Demo path" measures one
Homer and one Hunter run before and after. The cheaper path considered and rejected for
Gmail is noted in decision 7.

## Demo path

| # | What the viewer sees | What happens underneath |
| - | -------------------- | ----------------------- |
| 1 | The user asks Homer to research a town. Homer posts a connect card for Mapy.com: "I can get road distances without the browser." The user clicks Connect. | `request_connection({ builtin: 'mapy' })`; Connect grants it at once (platform key). |
| 2 | Homer answers with the town facts; the Runs tab shows `wikipedia__page` and `mapy__route` calls and no screen steps for them. | Built-in reads run without cards. |
| 3 | The user asks Hunter to connect Notion (a team's tool; or Cal.com's or GitHub's MCP server if the check before milestone 2 finds that Notion refuses the loopback redirect). A connect card appears; Connect opens Notion's sign-in in a new tab; the user signs in there. | MCP connect, OAuth with Dynamic Client Registration, callback checks `state` and `iss`; the token is stored encrypted. |
| 4 | A tools card lists Notion's tools, reads and writes pre-sorted; the user moves one tool and confirms. | `connections.json` saves classes and `confirmed: true`. |
| 5 | Hunter reads a Notion page without a card, then proposes adding a line to it: an approval card shows the page and the exact text. The user clicks Allow once. | Confirmed read runs; the write stops at the connector gate, runs after Allow. |
| 6 | An interview invitation arrives; Hunter reads it from its mailbox without opening webmail, lists free Cal.com slots, and posts one booking card with the slot. | `bot-mailbox__read`, `calcom-public__slots`, then `calcom-public__book` at the gate. |
| 7 | The user clicks Disconnect on Notion in the bot's header; the next run has no Notion tools. | Tokens deleted; connection `disconnected`. |

The approval moments are rows 5 and 6. The computer is still visible in every run; rows 2 and 6
show runs that did not need it for those steps. The artifact at the end is the town research file
and the booking (denied or allowed as the operator chooses).

## Invariant coverage

| # | Invariant | Mechanism, or "not touched" |
| - | --------- | --------------------------- |
| 1 | Visible remote computer | Not touched: the computer and its stream stay; connector calls are shown in the Runs tab and in the chat's cards. |
| 2 | Real work, not simulation | Connectors call the real services (Cal.com, Mapy.com, Wikipedia, the bot's mailbox, the user's MCP servers); no mock on the demo path. |
| 3 | One job, finished | A connector that fails leaves the bot its other channels; a `needs-sign-in` connection tells the bot to ask the user. |
| 4 | Approval before irreversible side effects | Every write tool and every unconfirmed tool stops at an approval card with its full arguments; server hints only pre-sort, the user confirms; new tools default to write. |
| 5 | Takeover without secrets in the transcript | Amended exception: OAuth tokens are stored encrypted, never logged or shown to the model; sign-in happens on the provider's page; passwords and codes still go through takeover. |
| 6 | Persistence across sessions | `connections.json` and the encrypted secrets file live in the bot folder and survive a restart; a refresh keeps the connection alive. |
| 7 | Configured in plain language | The bot asks for a connection in chat; the user clicks Connect and signs in on the provider's page; disconnect by chat or one button. `CONNECTOR_SECRET_KEY`, `MAPY_API_KEY` and `MAILBOX_BOT_ID` are operator setup. |
| 8 | Cost efficiency | The prompt rule orders the channels; the built-ins replace the measured computer work of today's bots; section 7 states the expected cost. |

## Failure modes on the day

| Failure | Detection | What the operator does |
| --- | --- | --- |
| OAuth sign-in fails or the provider refuses Dynamic Client Registration | Callback error card; connection stays `needs-sign-in` | Configure a pre-registered client for that host, or connect later |
| Token expired and refresh fails | 401 after one refresh; the tool result asks the bot to request a reconnect | The user reconnects from the card |
| An MCP server is slow or down | 60-second timeout; error result to the model | None; the bot falls back to `fetch_url` or the computer |
| A server adds or renames tools | New tools default to write, unconfirmed | The user sorts them on the next tools card |
| Cal.com rejects a keyless booking | Error result; the bot falls back to the booking page on the computer, where the gate still holds the Confirm button | None |
| Mapy.com key missing or quota spent | 401 or 429; error result | Set or raise the key; the bot uses the computer meanwhile |
| A prompt injection in a mail or page asks the bot to write through a connector | The write stops at the approval card with its full arguments | The user denies it |
| The sandbox will not start, a login expired, a CAPTCHA | As today | As today |

## Scope budget

**In:** the connection store and encrypted secrets; the four built-ins; the MCP client with OAuth
(Dynamic Client Registration or a pre-registered client), SSRF checks, tool-list refresh; the
connector gate and its card; `request_connection` and `disconnect`; the tools card and the header
list; the channel prompt rule; tests for the gate (read runs, write asks, unconfirmed asks, a new
server tool defaults to write, Deny, Stop during the wait), for token secrecy (no token in logs,
events, chat or the model request), for the SSRF checks, and for each built-in against recorded
responses.

Also in: a `docs/decisions.md` entry that states decision 9's residual risk in the same words, since it is a trust boundary a reviewer will ask about.

**Parked, with reasons:**
- Gmail and Outlook connectors: CASA assessment or a Copilot licence (decision 7).
- Client ID Metadata Documents: need a public HTTPS URL, which comes with the hosted deployment.
- Discovering unknown MCP servers on the web: a curated catalog is safer for a first cut.
- Passing images and resources from MCP results to the model: text covers the first connectors.
- Account-wide connections: rejected (decision 3).

**Estimate:** the author's hours: register a Mapy.com key with a Seznam account (about 15
minutes); create one test account in an MCP service (Notion) and sign in during the live check
(about 15 minutes). Live-run cycles: three — Homer with `wikipedia` and `mapy`, Hunter with
`bot-mailbox` and `calcom-public` (booking card denied), and one MCP connect-read-write-disconnect
cycle.

**Check before milestone 2:** one Dynamic Client Registration request to Notion with the loopback
redirect URL, on the author's word (it creates a client registration at Notion). If Notion refuses
the loopback redirect, the demo's MCP server becomes Cal.com's (`mcp.cal.com`) or GitHub's, checked
the same way, and the spec's demo row 3 changes accordingly.

**Slicing for `/plan`:** milestone 1: connections store, built-ins, connector gate, channel rule,
`request_connection` for built-ins; milestone 2: the MCP client with OAuth, tools card,
disconnect.

## Alternatives Considered

### Anthropic's MCP connector or OpenAI's hosted MCP tool

Less code: the provider calls the server. Rejected: Anthropic executes the call before Dobot sees
it, so the gate cannot stop a write; OpenAI can pause for approval but its servers run the call and
hold the token; neither works for the other providers in the multi-provider design.

### A generic HTTP tool instead of built-ins

One `http_request` tool the bot could point at any API. Rejected: the bot would need API keys in
its context or a way to name them, every POST would need a generic card that the user cannot judge,
and SSRF becomes a general problem. Named built-ins with fixed classes are narrow and reviewable.

### Account-wide connections

Grok Bot's model. Rejected by decision 3.
