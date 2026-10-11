import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import Anthropic from '@anthropic-ai/sdk'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest'
import { errorFields } from '../log'
import { AnthropicModel, ModelStalledError, ModelStreamParseError } from './model'
import { providerRefusal } from './run-text'

// A stream that carries only `ping` events must not keep the run busy for ever. The SDK drops ping
// events before the consumer sees them, and undici's idle body timeout counts them as traffic, so
// without the stall timer nothing ends such a call. Stop must reach a pending stream too. These
// tests speak to the real SDK over a local SSE server: no mocks.
// The SDK's stream parser prints a malformed event's raw data and chunk through its default logger,
// past the application's log filtering. So the client is built with SDK logging off, and the last
// two tests prove that nothing raw reaches the console.

const STALL_MS = 100
const EVENT_EVERY_MS = 20

let server: Server
let responses: ServerResponse[] = []
const savedEnv = { baseUrl: process.env.ANTHROPIC_BASE_URL, apiKey: process.env.ANTHROPIC_API_KEY }
// What the next request gets after message_start. 'error answer' gets no stream at all: an HTTP
// error status with the body as JSON.
let behaviour: 'pings only' | 'events for longer than the stall' | 'hang' | 'malformed event' | 'error event' | 'error answer' = 'hang'
// The data of the `error` event that the 'error event' behaviour sends: a body, or text that is not JSON.
let errorEvent: Record<string, unknown> | string = {}
let errorAnswer: { status: number; body: Record<string, unknown> } = { status: 400, body: {} }
// Stands in for a signature or a redacted payload: never a real one. V8's parse error quotes about
// ten characters around the failure, so a fragment of the marker is what a leak would look like.
const OPAQUE_MARKER = 'LOCAL_OPAQUE_DATA_MARKER'
const OPAQUE_FRAGMENT = OPAQUE_MARKER.slice(0, 8)
// Installed before any client exists: the SDK binds the console method when it first builds its
// filtered logger and caches it, so a spy installed later would not see the calls.
let consoleError: MockInstance

const write = (res: ServerResponse, data: Record<string, unknown>): void => {
  res.write(`event: ${String(data.type)}\ndata: ${JSON.stringify(data)}\n\n`)
}

const start = (res: ServerResponse): void => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  write(res, {
    type: 'message_start',
    message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } },
  })
}

const finish = (res: ServerResponse): void => {
  write(res, { type: 'content_block_stop', index: 0 })
  write(res, { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
  write(res, { type: 'message_stop' })
  res.end()
}

/** Resolves when the client has closed the connection of the given response. */
const closed = (res: ServerResponse): Promise<void> =>
  new Promise((resolve) => {
    if (res.destroyed) resolve()
    else res.on('close', () => resolve())
  })

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      responses.push(res)
      if (behaviour === 'error answer') {
        // `x-should-retry: false` only keeps the SDK from sending the request again, so the test
        // does not wait out its retry delays; the error the SDK builds from the answer is the same.
        res.writeHead(errorAnswer.status, { 'content-type': 'application/json', 'x-should-retry': 'false' })
        res.end(JSON.stringify(errorAnswer.body))
        return
      }
      start(res)
      if (behaviour === 'pings only') {
        const pings = setInterval(() => write(res, { type: 'ping' }), EVENT_EVERY_MS)
        res.on('close', () => clearInterval(pings))
      } else if (behaviour === 'events for longer than the stall') {
        write(res, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
        let sent = 0
        const deltas = setInterval(() => {
          write(res, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } })
          sent += 1
          if (sent * EVENT_EVERY_MS >= 3 * STALL_MS) {
            clearInterval(deltas)
            finish(res)
          }
        }, EVENT_EVERY_MS)
        res.on('close', () => clearInterval(deltas))
      } else if (behaviour === 'malformed event') {
        // An unquoted value: the parse fails inside the data, where V8 quotes the surrounding text.
        res.write(`event: content_block_delta\ndata: {"signature":${OPAQUE_MARKER}}\n\n`)
        res.end()
      } else if (behaviour === 'error event') {
        if (typeof errorEvent === 'string') res.write(`event: error\ndata: ${errorEvent}\n\n`)
        else write(res, errorEvent)
        res.end()
      }
    })
  })
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
  process.env.ANTHROPIC_API_KEY = 'test-placeholder-not-a-credential'
})

afterEach(() => {
  for (const res of responses) if (!res.destroyed) res.destroy()
  responses = []
  consoleError.mockClear()
})

afterAll(async () => {
  if (savedEnv.baseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = savedEnv.baseUrl
  if (savedEnv.apiKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = savedEnv.apiKey
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  consoleError.mockRestore()
})

const params = { model: 'claude-sonnet-5', max_tokens: 1000, messages: [{ role: 'user' as const, content: 'test' }] }

describe('AnthropicModel over a local stream', () => {
  it('ends a stream that carries only pings after the stall timeout, closes the connection and rejects as stalled', async () => {
    behaviour = 'pings only'
    const model = new AnthropicModel({ stallTimeoutMs: STALL_MS })
    const startedAt = Date.now()

    await expect(model.create(params)).rejects.toBeInstanceOf(ModelStalledError)

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(STALL_MS - 5)
    expect(responses).toHaveLength(1)
    await closed(responses[0]!)
  })

  it('keeps a stream alive while events keep coming, even past the stall timeout in total', async () => {
    behaviour = 'events for longer than the stall'
    const model = new AnthropicModel({ stallTimeoutMs: STALL_MS })

    const message = await model.create(params)

    expect(message.stop_reason).toBe('end_turn')
    expect(message.content).toMatchObject([{ type: 'text', text: 'a'.repeat((3 * STALL_MS) / EVENT_EVERY_MS) }])
  })

  it('a stop signal aborts a pending stream: the call rejects as aborted and the connection closes', async () => {
    behaviour = 'pings only'
    const model = new AnthropicModel({ stallTimeoutMs: 60_000 })
    const stop = new AbortController()
    const pending = model.create(params, { signal: stop.signal })
    while (responses.length === 0) await new Promise((resolve) => setTimeout(resolve, 5))

    stop.abort()

    await expect(pending).rejects.toBeInstanceOf(Anthropic.APIUserAbortError)
    await closed(responses[0]!)
  })

  it('a malformed event fails the call, and its raw data reaches no console output', async () => {
    behaviour = 'malformed event'
    const model = new AnthropicModel({ stallTimeoutMs: STALL_MS })

    const error = await model.create(params).then(() => null, (e: unknown) => e)

    // The error is what the application logs on this path: it names the parse failure, not the data.
    expect(error).toBeInstanceOf(ModelStreamParseError)
    expect(JSON.stringify(errorFields(error))).not.toContain(OPAQUE_FRAGMENT)
    expect(errorFields(error).errorMessage).toContain('could not be parsed')
    const printed = consoleError.mock.calls.flat().map(String).join('\n')
    expect(printed).not.toContain(OPAQUE_FRAGMENT)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('SDK logging asked for through the environment does not bring the raw data back', async () => {
    behaviour = 'malformed event'
    const saved = process.env.ANTHROPIC_LOG
    process.env.ANTHROPIC_LOG = 'debug'
    try {
      const model = new AnthropicModel({ stallTimeoutMs: STALL_MS })

      const error = await model.create(params).then(() => null, (e: unknown) => e)
      expect(error).toBeInstanceOf(ModelStreamParseError)
      expect(JSON.stringify(errorFields(error))).not.toContain(OPAQUE_FRAGMENT)
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_LOG
      else process.env.ANTHROPIC_LOG = saved
    }

    const printed = consoleError.mock.calls.flat().map(String).join('\n')
    expect(printed).not.toContain(OPAQUE_FRAGMENT)
    expect(consoleError).not.toHaveBeenCalled()
  })

  // What the loop's classifier says about the errors the SDK really builds from the provider's
  // refusals. The hand-built errors of run.test.ts copy the shapes that are proven here.
  const errorBody = (type: string, message: string): Record<string, unknown> => ({ type: 'error', error: { details: null, type, message }, request_id: 'req_local_test' })
  const CREDIT = errorBody('invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')
  const RATE_LIMIT = errorBody('rate_limit_error', 'This request would exceed the rate limit of your organization for input tokens per minute. See the response headers for current usage, and try again later.')
  // The body the provider documents for its monthly spend cap (Rate limits docs, "Reaching your
  // spend cap"): the error type of a rate limit, and a code that tells the two apart.
  const SPEND_CAP = {
    type: 'error',
    error: {
      type: 'rate_limit_error',
      message: "You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization's API tier. You will regain access on 2026-10-01 at 00:00 UTC.",
      details: { error_code: 'enforced_spend_limit_reached' },
    },
    request_id: 'req_local_test',
  }
  const rejection = (): Promise<unknown> => new AnthropicModel({ stallTimeoutMs: STALL_MS }).create(params).then(() => null, (e: unknown) => e)

  // The provider can refuse a call after its response has begun with 200: the refusal is then an
  // `error` event inside the stream (Streaming messages docs, "Error events"). The SDK's error for
  // it carries the provider's error type and no HTTP status, and the SDK does not send the request
  // again. The loop must still tell a refusal from a provider that is busy.
  describe('an error event inside an open stream', () => {
    const failure = async (body: Record<string, unknown> | string): Promise<unknown> => {
      behaviour = 'error event'
      errorEvent = body
      return rejection()
    }

    it('rejects with the error type and no status, and the loop reads too little credit as a refusal', async () => {
      const error = await failure(CREDIT)

      expect(error).toBeInstanceOf(Anthropic.APIError)
      expect((error as InstanceType<typeof Anthropic.APIError>).status).toBeUndefined()
      expect((error as InstanceType<typeof Anthropic.APIError>).type).toBe('invalid_request_error')
      expect(responses).toHaveLength(1)
      expect(providerRefusal(error)).toBe('the account behind this API key has too little credit')
    })

    it('the loop reads a usage limit as a refusal', async () => {
      const error = await failure(errorBody('invalid_request_error', 'You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC.'))

      expect(providerRefusal(error)).toBe('the organisation that owns this API key has reached its usage limit')
    })

    it('the loop reads the spend cap as a refusal, although its error type is that of a rate limit', async () => {
      const error = await failure(SPEND_CAP)

      expect((error as InstanceType<typeof Anthropic.APIError>).type).toBe('rate_limit_error')
      expect(providerRefusal(error)).toBe('the organisation that owns this API key has reached its usage limit')
    })

    it('the loop reads a busy provider as no refusal, so the advice to send the goal again stays', async () => {
      const error = await failure(errorBody('overloaded_error', 'Overloaded'))

      expect(error).toBeInstanceOf(Anthropic.APIError)
      expect((error as InstanceType<typeof Anthropic.APIError>).type).toBe('overloaded_error')
      expect(providerRefusal(error)).toBeNull()
    })

    // The provider's errors are always JSON, so this text comes from something in between. It names
    // no type, and nothing says whether a retry can help.
    it('an error event whose data is not JSON has no type, and the loop reads it as no refusal', async () => {
      const error = await failure('upstream connect error')

      expect(error).toBeInstanceOf(Anthropic.APIError)
      expect((error as InstanceType<typeof Anthropic.APIError>).status).toBeUndefined()
      expect((error as InstanceType<typeof Anthropic.APIError>).type).toBeNull()
      expect(providerRefusal(error)).toBeNull()
    })
  })

  // The same refusals as a plain HTTP error. The SDK's error then has the status, and its message
  // holds the text of the body: the loop reads the words of a refusal from that text.
  describe('an HTTP error answer', () => {
    const failure = async (status: number, body: Record<string, unknown>): Promise<unknown> => {
      behaviour = 'error answer'
      errorAnswer = { status, body }
      return rejection()
    }

    it('the loop reads too little credit as a refusal', async () => {
      const error = await failure(400, CREDIT)

      expect(error).toBeInstanceOf(Anthropic.BadRequestError)
      expect((error as InstanceType<typeof Anthropic.APIError>).status).toBe(400)
      expect(providerRefusal(error)).toBe('the account behind this API key has too little credit')
    })

    it('the loop reads the spend cap as a refusal, although it answers 429 as a rate limit does', async () => {
      const error = await failure(429, SPEND_CAP)

      expect(error).toBeInstanceOf(Anthropic.RateLimitError)
      expect((error as InstanceType<typeof Anthropic.APIError>).status).toBe(429)
      expect(providerRefusal(error)).toBe('the organisation that owns this API key has reached its usage limit')
    })

    it('the loop reads a rate limit as no refusal, so the advice to send the goal again stays', async () => {
      const error = await failure(429, RATE_LIMIT)

      expect(error).toBeInstanceOf(Anthropic.RateLimitError)
      expect(providerRefusal(error)).toBeNull()
    })

    // The provider's answer when the input alone exceeds the model's context window (Context
    // windows docs, "Context window overflow behavior"). A new run starts with a short conversation.
    it('the loop reads a conversation that outgrew the context window as no refusal', async () => {
      const error = await failure(400, errorBody('invalid_request_error', 'prompt is too long: 1000212 tokens > 1000000 maximum'))

      expect(error).toBeInstanceOf(Anthropic.BadRequestError)
      expect((error as InstanceType<typeof Anthropic.APIError>).status).toBe(400)
      expect(providerRefusal(error)).toBeNull()
    })
  })

  // Nothing answers on the port. The SDK tries three times and then rejects with its own error,
  // whose real reason lies two causes deep; the log names that chain by name and code.
  describe('a provider that cannot be reached', () => {
    it('rejects with a chain of causes that ends in the system error, and the log names it', async () => {
      const closedPort = await new Promise<number>((resolve) => {
        const probe = createServer()
        probe.listen(0, '127.0.0.1', () => {
          const { port } = probe.address() as AddressInfo
          probe.close(() => resolve(port))
        })
      })
      const reachable = process.env.ANTHROPIC_BASE_URL
      process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${closedPort}`
      let error: unknown
      try {
        error = await rejection()
      } finally {
        if (reachable === undefined) delete process.env.ANTHROPIC_BASE_URL
        else process.env.ANTHROPIC_BASE_URL = reachable
      }

      expect(error).toBeInstanceOf(Anthropic.APIConnectionError)
      expect(errorFields(error)).toStrictEqual({ errorName: 'Error', errorMessage: 'Connection error.', errorCauses: ['TypeError', 'Error ECONNREFUSED'] })
      expect(providerRefusal(error)).toBeNull()
    }, 15_000)
  })
})
