import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { FakeModel, message, textBlock } from './fakes'

// The fake model stands where the real API stands in every loop test, so it must refuse what the API
// refuses and nothing more. The API answers HTTP 400 to a tool result with `is_error: true` that
// holds a screenshot, and that answer ends the run. A fake that accepts that shape hides such a
// request from every test. The loop tests in run.test.ts ('an action the computer does not answer')
// are the ones that pin the loop's side; these pin the fake's rule itself.
describe('FakeModel', () => {
  const image = { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'AAAA' } }
  const failed = { type: 'text' as const, text: 'failed' }
  const request = (isError: boolean, content: Anthropic.Messages.ToolResultBlockParam['content']): Anthropic.Messages.MessageCreateParamsNonStreaming => ({
    model: 'claude-sonnet-5',
    max_tokens: 100,
    messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x', ...(isError ? { is_error: true } : {}), content }] }],
  })
  const answering = () => new FakeModel([message([textBlock('ok')], 'end_turn')])

  it('refuses an error result that holds a screenshot, with the status and the words of the API, and still records the request', async () => {
    const model = answering()

    await expect(model.create(request(true, [failed, image]))).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('messages.0.content.0.tool_result: all content must be type `text` if `is_error` is true'),
    })

    expect(model.calls).toHaveLength(1)
  })

  it.each([
    ['an error result whose blocks are all text', true, [failed]],
    ['an error result held as a plain string', true, 'failed'],
    ['a result with a screenshot and no error flag', false, [failed, image]],
  ] as const)('accepts %s', async (_name, isError, content) => {
    await expect(answering().create(request(isError, typeof content === 'string' ? content : [...content]))).resolves.toMatchObject({ stop_reason: 'end_turn' })
  })
})
