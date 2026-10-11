import Anthropic from '@anthropic-ai/sdk'
import { log } from '../log'

// The only module that talks to the Messages API. The fakes in fakes.ts implement the same port
// for tests; no runtime module imports them.

export type ModelCallOptions = {
  /** Aborted when the user presses Stop: the pending call is cancelled and rejects at once. */
  signal?: AbortSignal
}

export interface ModelPort {
  create(params: Anthropic.Messages.MessageCreateParamsNonStreaming, options?: ModelCallOptions): Promise<Anthropic.Messages.Message>
}

/** The model stream carried no event for the stall timeout after its last one, so it was ended. */
export class ModelStalledError extends Error {
  override name = 'ModelStalledError'
}

/** The stream carried an event the SDK could not parse. The message never quotes the event's data. */
export class ModelStreamParseError extends Error {
  override name = 'ModelStreamParseError'
}

/**
 * The SDK wraps the stream parser's SyntaxError in its own error and keeps the original as the
 * cause. This covers the stream and the tool-input parsing only: the structured-output path
 * (`output_config` with a parser) folds the message into its own error without a cause, and this
 * platform does not use it.
 */
function isParseFailure(e: unknown): boolean {
  return e instanceof SyntaxError || (e instanceof Error && e.cause instanceof SyntaxError)
}

// The call is streamed and the final message assembled by the SDK, because a long answer cannot
// reach the loop any other way. A response that is not streamed sends its headers only when the
// whole answer is ready, and Node's fetch (undici) waits at most 300 s for them whatever timeout the
// SDK is given (undici, Dispatcher docs: `headersTimeout` defaults to 300 seconds): a longer SDK
// timeout is never reached, the transport gives up first. The SDK's own guidance says the same: use
// streaming for long requests, because networks drop idle connections. With a stream the headers
// arrive at once and the body flows token by token, so no transport limit depends on the answer's
// length, and the SDK's ten-minute rule for calls that are not streamed does not apply.
//
// Two timers bound the call, one before the first byte and one after it. `timeout` bounds only the
// wait for the headers: the SDK arms it around fetch, not around reading the body, and its two
// retries repeat only that wait. After the headers, the stall timer below bounds the wait between
// two events, because nothing else does: the API may send any number of `ping` events (Streaming
// messages docs, "Ping events"), the SDK drops them before the consumer sees an event
// (core/streaming.js), and undici's idle body timeout counts them as traffic. A stream that carries
// only pings would otherwise keep the run busy for ever. The timer is re-armed by every event the
// SDK passes on (message start, block starts, deltas, stops). A delay between events while the
// model works on a tool input is documented, and a call normally takes seconds, so two minutes
// without an event is a dead stream, and the run reports that the model stopped answering. The
// loop's turn and token caps bound the total. One case is outside both timers: an error response
// whose body never finishes. The SDK reads that body after the headers and before `connect`, so
// only Stop ends it (README, "Known limits").
const MODEL_FIRST_BYTE_TIMEOUT_MS = 120_000
const MODEL_STALL_TIMEOUT_MS = 120_000
const MODEL_MAX_RETRIES = 2

export class AnthropicModel implements ModelPort {
  // The key comes from ANTHROPIC_API_KEY in the environment, which loadConfig() has filled.
  // SDK logging is off: its stream parser prints a malformed event's raw data and chunk through its
  // own logger, past the application's filtering, and a model payload must never reach a log.
  // The client option wins over ANTHROPIC_LOG in the environment.
  // What the application logs on a failure stays: the error's name, status and request id.
  private readonly client = new Anthropic({ logLevel: 'off' })
  private readonly stallTimeoutMs: number

  constructor(options: { stallTimeoutMs?: number } = {}) {
    this.stallTimeoutMs = options.stallTimeoutMs ?? MODEL_STALL_TIMEOUT_MS
  }

  async create(params: Anthropic.Messages.MessageCreateParamsNonStreaming, options: ModelCallOptions = {}): Promise<Anthropic.Messages.Message> {
    const stream = this.client.messages.stream(params, {
      timeout: MODEL_FIRST_BYTE_TIMEOUT_MS,
      maxRetries: MODEL_MAX_RETRIES,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    let timer: ReturnType<typeof setTimeout> | null = null
    let stalled = false
    const rearm = (): void => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        stalled = true
        stream.abort()
      }, this.stallTimeoutMs)
    }
    // Armed once the headers are in, and again on every event; the abort rejects finalMessage().
    stream.on('connect', rearm)
    stream.on('streamEvent', rearm)
    try {
      return await stream.finalMessage()
    } catch (e) {
      if (stalled) throw new ModelStalledError(`no event from the model for ${Math.round(this.stallTimeoutMs / 1000)} s (request ${stream.request_id ?? 'unknown'})`)
      // The parser's message quotes the text around the failure, which is model output; the error
      // the application logs names the failure and the request instead.
      if (isParseFailure(e)) throw new ModelStreamParseError(`the model's stream sent an event that could not be parsed (request ${stream.request_id ?? 'unknown'})`)
      throw e
    } finally {
      if (timer !== null) clearTimeout(timer)
      stream.off('connect', rearm)
      stream.off('streamEvent', rearm)
    }
  }
}

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number }

/** USD per million tokens. Cache reads cost 0.1x and cache writes 1.25x of the input price. */
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-opus-5': { in: 5, out: 25 },
}
const CACHE_READ_FACTOR = 0.1
const CACHE_WRITE_FACTOR = 1.25
const warnedModels = new Set<string>()

/**
 * The price of a model id: its own entry, or the entry it is a dated or suffixed form of
 * (`claude-sonnet-5-20260915`). An id that matches nothing is priced as the dearest known model:
 * the daily budget counts these numbers, and a price of 0 would mean a budget that never ends a day.
 */
function priceOf(model: string): { in: number; out: number } {
  const known = Object.keys(PRICES).find((id) => model === id || model.startsWith(`${id}-`))
  if (known !== undefined) return PRICES[known] as { in: number; out: number }
  if (!warnedModels.has(model)) {
    warnedModels.add(model)
    log.warn('no price known for this model; its cost is counted at the dearest known price, so the daily budget still works', { model })
  }
  return Object.values(PRICES).reduce((a, b) => (b.in > a.in ? b : a))
}

export function costUsd(model: string, usage: TokenUsage): number {
  const price = priceOf(model)
  const perToken = 1 / 1_000_000
  return (
    usage.inputTokens * price.in * perToken +
    usage.outputTokens * price.out * perToken +
    usage.cacheRead * price.in * CACHE_READ_FACTOR * perToken +
    usage.cacheWrite * price.in * CACHE_WRITE_FACTOR * perToken
  )
}

export function usageOf(usage: Anthropic.Messages.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  }
}
