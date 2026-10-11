import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { AnthropicModel, costUsd } from './model'

// The SDK is mocked only here, at the external boundary, to see what the class hands it. The
// stall timer and the abort are tested against the real SDK over a local stream in
// model.stream.test.ts.
const { sdkStream } = vi.hoisted(() => ({ sdkStream: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { stream: sdkStream } } }))

/** The shape of a MessageStream the class uses: events, abort, and the final message. */
const fakeStream = (finalMessage: () => Promise<unknown>) => ({ on: vi.fn(), off: vi.fn(), abort: vi.fn(), finalMessage: vi.fn(finalMessage) })

describe('costUsd', () => {
  it('prices input, output, cache reads at 0.1x and cache writes at 1.25x of the input price', () => {
    const usd = costUsd('claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 100_000, cacheRead: 500_000, cacheWrite: 200_000 })
    // 2 + 1 + 0.1 + 0.5
    expect(usd).toBeCloseTo(3.6, 6)
  })

  it('uses the Opus price table for claude-opus-5', () => {
    expect(costUsd('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 0, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(5, 6)
  })

  it('prices a dated form of a known model as that model', () => {
    expect(costUsd('claude-sonnet-5-20260915', { inputTokens: 1_000_000, outputTokens: 0, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(2, 6)
  })

  it('never prices a model at 0: an unknown id counts at the dearest known price, so the daily budget still ends a day', () => {
    expect(costUsd('claude-unknown-9', { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(30, 6)
  })
})

describe('AnthropicModel', () => {
  const params = { model: 'claude-sonnet-5', max_tokens: 32000, messages: [] } as Anthropic.Messages.MessageCreateParamsNonStreaming

  // A response that is not streamed sends its headers only when the whole answer is ready, and
  // Node's fetch gives up on the headers after 300 s whatever timeout the SDK is given. So the call
  // is streamed and the SDK assembles the message.
  it('streams the call and resolves with the assembled final message', async () => {
    const final = { id: 'msg', content: [{ type: 'text', text: 'hi' }] }
    sdkStream.mockReturnValueOnce(fakeStream(() => Promise.resolve(final)))

    await expect(new AnthropicModel().create(params)).resolves.toBe(final)

    expect(sdkStream).toHaveBeenCalledWith(params, { timeout: 120_000, maxRetries: 2 })
  })

  it('hands the stop signal to the SDK, so Stop aborts the pending request', async () => {
    const signal = new AbortController().signal
    sdkStream.mockReturnValueOnce(fakeStream(() => Promise.resolve({ id: 'msg', content: [] })))

    await new AnthropicModel().create(params, { signal })

    expect(sdkStream).toHaveBeenCalledWith(params, { timeout: 120_000, maxRetries: 2, signal })
  })

  it('rejects when the stream fails, so the loop reports the failure', async () => {
    sdkStream.mockReturnValueOnce(fakeStream(() => Promise.reject(new Error('stream ended'))))

    await expect(new AnthropicModel().create(params)).rejects.toThrow('stream ended')
  })
})
