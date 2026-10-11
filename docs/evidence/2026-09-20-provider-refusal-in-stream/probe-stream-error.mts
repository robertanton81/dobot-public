// Probe: what the pinned SDK rejects with when the provider refuses or fails a call, as an `error`
// event inside an open stream and as a plain HTTP error, and what providerRefusal() says about each.
// It goes through the real adapter and the real SDK, over a local server.
// Placeholder key, loopback server: no request leaves this machine.
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '')
const { AnthropicModel } = await import(`${ROOT}/src/server/agent/model.ts`)
const { providerRefusal } = await import(`${ROOT}/src/server/agent/run-text.ts`)
const { errorFields } = await import(`${ROOT}/src/server/log.ts`)

const body = (type: string, message: string): Record<string, unknown> => ({ type: 'error', error: { details: null, type, message }, request_id: 'req_local_probe' })
const CREDIT = body('invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')
const LIMIT = body('invalid_request_error', 'You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC.')
const OVERLOADED = body('overloaded_error', 'Overloaded')
// The body the provider documents for its monthly spend cap (Rate limits docs, "Reaching your spend cap").
const SPEND_CAP = {
  type: 'error',
  error: {
    type: 'rate_limit_error',
    message: "You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization's API tier. You will regain access on 2026-10-01 at 00:00 UTC.",
    details: { error_code: 'enforced_spend_limit_reached' },
  },
  request_id: 'req_local_probe',
}
// The provider answers 400 with these words when the input alone exceeds the context window
// (Context windows docs, "Context window overflow behavior"); the numbers are made up.
const TOO_LONG = body('invalid_request_error', 'prompt is too long: 1000212 tokens > 1000000 maximum')
const RATE_LIMIT = body('rate_limit_error', 'This request would exceed the rate limit of your organization for input tokens per minute. See the response headers for current usage, and try again later.')

type Mode = { how: 'stream-after-start' | 'stream-first-event' | 'http'; status?: number; payload: Record<string, unknown> }
let mode: Mode = { how: 'http', status: 400, payload: CREDIT }
let requests = 0

const sse = (res: ServerResponse, event: string, data: unknown): void => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

const server = createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    requests += 1
    if (mode.how === 'http') {
      res.writeHead(mode.status ?? 400, { 'content-type': 'application/json', 'request-id': 'req_local_probe' })
      res.end(JSON.stringify(mode.payload))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_local_probe' })
    if (mode.how === 'stream-after-start') {
      sse(res, 'message_start', {
        type: 'message_start',
        message: { id: 'msg_probe', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } },
      })
    }
    sse(res, 'error', mode.payload)
    res.end()
  })
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
process.env.ANTHROPIC_API_KEY = 'test-placeholder-not-a-credential'

const params = { model: 'claude-sonnet-5', max_tokens: 100, messages: [{ role: 'user' as const, content: 'probe' }] }

const show = async (label: string, m: Mode): Promise<void> => {
  mode = m
  requests = 0
  const model = new AnthropicModel({ stallTimeoutMs: 2000 })
  const e: any = await model.create(params).then(() => null, (err: unknown) => err)
  console.log(`\n=== ${label} ===`)
  console.log({
    requestsSeenByServer: requests,
    constructorName: e?.constructor?.name,
    name: e?.name,
    hasStatusKey: e !== null && typeof e === 'object' && 'status' in e,
    status: e?.status,
    typeofStatus: typeof e?.status,
    type: e?.type,
    requestID: e?.requestID,
    errorBodyKeys: e?.error && typeof e.error === 'object' ? Object.keys(e.error) : typeof e?.error,
    innerType: e?.error?.error?.type,
    logged: errorFields(e),
    providerRefusal: providerRefusal(e),
  })
}

await show('A. credit refusal as an error event after message_start (HTTP 200)', { how: 'stream-after-start', payload: CREDIT })
await show('B. credit refusal as the first event of the stream (HTTP 200)', { how: 'stream-first-event', payload: CREDIT })
await show('C. usage limit as an error event (HTTP 200)', { how: 'stream-after-start', payload: LIMIT })
await show('D. overloaded_error as an error event (HTTP 200), the documented example', { how: 'stream-after-start', payload: OVERLOADED })
await show('E. the same credit refusal as a plain HTTP 400', { how: 'http', status: 400, payload: CREDIT })
// The SDK retries a 429 twice before it gives up, so the server sees three requests for F and G.
await show('F. the monthly spend cap as HTTP 429, with no retry-after header', { how: 'http', status: 429, payload: SPEND_CAP })
await show('G. a plain rate limit as HTTP 429', { how: 'http', status: 429, payload: RATE_LIMIT })
await show('H. the monthly spend cap as an error event (HTTP 200)', { how: 'stream-after-start', payload: SPEND_CAP })
await show('I. "prompt is too long" as a plain HTTP 400', { how: 'http', status: 400, payload: TOO_LONG })
await show('J. "prompt is too long" as an error event (HTTP 200)', { how: 'stream-after-start', payload: TOO_LONG })

server.closeAllConnections()
await new Promise<void>((resolve) => server.close(() => resolve()))
