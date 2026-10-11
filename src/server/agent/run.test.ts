import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { log } from '../log'
import { createStore, type Store } from '../store'
import { SandboxActionError, type ElementInfo } from '../sandbox/port'
import { computerUse, ELEMENT_TEXT_INPUT, FakeModel, FakeSandbox, makeContext, message, setPixel, solidPng, textBlock, toolUse, type TestContext } from './fakes'
import { decode } from './images'
import type { ModelPort } from './model'
import { STEP_BUDGET, STEPS_LEFT_NOTICE } from './run'
import { NO_PROGRESS_NOTICE_AT, NO_PROGRESS_STUCK_AT, NO_PROGRESS_STUCK_TEXT, noProgressText } from './progress'
import { HUMAN_STEP_TEXT, runLoop, type RunInput } from './run'
import { budgetEndText, CONTEXT_FULL_TEXT, CUT_OFF_TEXT, noAnswerText, providerRefusal, REFUSED_TEXT, stepsLeftText, STOPPED_TEXT, UNKNOWN_OUTCOME_SUMMARY } from './run-text'
import { basePlatformTools, defineTool, DENIED_TEXT, readArtifact, runPlatformTool } from './tools'
import type { ConnectorSnapshot, ConnectorsPort } from './run-context'
import { ConnectorRegistry } from '../connectors/registry'
import { runConnectorTool } from './connector-gate'
import type { BuiltinConnector } from '../connectors/types'
import { z } from 'zod'

let dataDir: string
let store: Store
let botId: string

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dobot-run-'))
  store = createStore(dataDir)
  botId = (await store.createBot({ name: 'Tester', persona: 'Runs tests.' })).id
  // The run starter (HTTP layer) creates the run record before the loop; the tests do the same.
  await store.startRun(botId, 'run-1')
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

const goal: RunInput = { goal: 'do the thing', activeSkill: null, source: 'message' }

function lastUserContent(model: FakeModel, call: number): unknown[] {
  const params = model.calls[call]
  const last = params?.messages.at(-1)
  if (!last || last.role !== 'user' || !Array.isArray(last.content)) throw new Error('no user content in call ' + call)
  return last.content
}

/** Every tool result in the messages of one captured model request, in conversation order. */
function resultsAt(model: FakeModel, call: number): Anthropic.Messages.ToolResultBlockParam[] {
  const request = model.calls[call]
  if (!request) throw new Error(`missing model request ${call}`)
  return request.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((b): b is Anthropic.Messages.ToolResultBlockParam => b.type === 'tool_result')
}

/** The tool result that answers one tool call, as one captured request held it. */
function resultFor(model: FakeModel, call: number, toolUseId: string): Anthropic.Messages.ToolResultBlockParam {
  const found = resultsAt(model, call).find((r) => r.tool_use_id === toolUseId)
  if (!found) throw new Error(`no result for ${toolUseId} in request ${call}`)
  return found
}

/** A tool result without its content and without the moving cache marker: the fields that removing an image must leave alone. */
function outerFields(result: Anthropic.Messages.ToolResultBlockParam): Omit<Anthropic.Messages.ToolResultBlockParam, 'content' | 'cache_control'> {
  const { content: _content, cache_control: _marker, ...outer } = result
  return outer
}

/** Screens ten grey levels apart: each one is a new screen for the stuck detector and for the progress guard. */
function greys(count: number): Uint8Array[] {
  if (count > 26) throw new Error('grey levels ten apart end at 250')
  return Array.from({ length: count }, (_, n) => solidPng(32, 32, [n * 10, n * 10, n * 10]))
}

/** The images one captured request held, as base64, in conversation order. */
function imagesAt(model: FakeModel, call: number): string[] {
  return resultsAt(model, call).flatMap((result) =>
    Array.isArray(result.content)
      ? result.content.flatMap((b) => (b.type === 'image' && b.source.type === 'base64' ? [b.source.data] : []))
      : [],
  )
}

/** The notes that stand where an image was removed, in one captured request, in conversation order. */
function notesAt(model: FakeModel, call: number): string[] {
  return resultsAt(model, call).flatMap((result) =>
    Array.isArray(result.content)
      ? result.content.flatMap((b) => (b.type === 'text' && b.text.endsWith('(removed to save context)') ? [b.text] : []))
      : [],
  )
}

/** A copy without the moving cache marker, the one thing the loop changes in earlier messages on every call. */
function withoutCacheMarkers<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, item) => (key === 'cache_control' ? undefined : item))) as T
}

const base64 = (png: Uint8Array): string => Buffer.from(png).toString('base64')

describe('runLoop', () => {
  it('executes a click and a screenshot on the sandbox, logs the events and posts the final message', async () => {
    const model = new FakeModel([
      message([computerUse('left_click', { coordinate: [10, 20] })]),
      message([computerUse('screenshot')]),
      message([textBlock('All done.')], 'end_turn'),
    ])
    const sandbox = new FakeSandbox()
    const t = makeContext({ store, botId, model, sandbox, tools: basePlatformTools })

    const result = await runLoop(t.ctx, goal)

    expect(result).toEqual({ outcome: 'done', summary: 'All done.' })
    // the click is gated (no rule hit → allow); the screenshot is not
    expect(t.events.map((e) => e.type)).toEqual(['cost', 'step', 'gate', 'tool_result', 'cost', 'step', 'tool_result', 'cost', 'text', 'end'])
    expect(t.events.find((e) => e.type === 'gate')).toMatchObject({ decision: 'allow', rule: null })
    const shotEvent = t.events.find((e) => e.type === 'tool_result' && e.shot !== null)
    expect(shotEvent && shotEvent.type === 'tool_result' ? shotEvent.shot : null).toMatch(/^[a-f0-9]{64}$/)
    expect(sandbox.calls).toEqual([
      { method: 'leftClick', args: [[10, 20]] },
      { method: 'screenshot', args: [] },
    ])
    expect(t.chat.map((m) => m.text)).toEqual(['All done.'])
    expect((await store.readRunEvents(botId, 'run-1')).map((e) => e.type)).toEqual(t.events.map((e) => e.type))
    expect(lastUserContent(model, 1)[0]).toMatchObject({ type: 'tool_result', toolset_name: 'computer', content: 'OK' })
    expect(lastUserContent(model, 2)[0]).toMatchObject({
      type: 'tool_result',
      toolset_name: 'computer',
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png' } }],
    })
    expect(model.calls[0]?.tools?.[0]).toEqual({ type: 'computer_toolset_20260801' })
  })

  it('answers an unparseable action with an error result and continues', async () => {
    const model = new FakeModel([
      message([computerUse('left_click', { coordinate: [10] })]),
      message([textBlock('Recovered.')], 'end_turn'),
    ])
    const sandbox = new FakeSandbox()
    const t = makeContext({ store, botId, model, sandbox })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')

    expect(sandbox.calls).toEqual([])
    expect(lastUserContent(model, 1)[0]).toMatchObject({ type: 'tool_result', is_error: true, toolset_name: 'computer' })
    expect(t.events.filter((e) => e.type === 'tool_result').map((e) => e.type === 'tool_result' && e.ok)).toEqual([false])
    expect(t.events.filter((e) => e.type === 'step')).toHaveLength(0)
  })

  it('ends with stuck after three identical screenshots, blocks the bot and posts a takeover card', async () => {
    const model = new FakeModel([
      message([computerUse('screenshot')]),
      message([computerUse('screenshot')]),
      message([computerUse('screenshot')]),
      message([textBlock('never reached')], 'end_turn'),
    ])
    const sandbox = new FakeSandbox([solidPng(64, 64, [0, 0, 0])])
    // Twenty seconds pass with every screenshot: the third comes forty seconds after the first.
    const clock = { now: 0 }
    sandbox.clock = clock
    sandbox.screenshotMs = 20_000
    const t = makeContext({ store, botId, model, sandbox, now: () => clock.now })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('stuck')

    expect(model.calls).toHaveLength(3)
    expect((await store.readBot(botId)).state).toBe('blocked')
    expect(t.chat.at(-1)?.card).toMatchObject({ card: 'takeover', status: 'active' })
    expect(t.events.at(-1)).toMatchObject({ type: 'end', outcome: 'stuck' })
  })

  // The time a human takes to decide on a card is not a screen that stands still. Here the gate
  // stops an unannounced click, the user presses Deny after forty seconds, and the bot looks at the
  // unchanged screen twice. If the detector kept the screenshot from before the card, the human's
  // thinking time would be inside its "unchanged for 30 seconds", and the run would end stuck. A
  // Deny leaves the screen unchanged by design. Every refusal of the gate returns through the same
  // line, so the Deny here stands for the others too (a changed control, the secret guard's
  // takeover, a file input).
  it('does not count the time a human took to decide on a card as a screen that did not change', async () => {
    const submit: ElementInfo = { ...ELEMENT_TEXT_INPUT, tag: 'button', type: 'submit', name: 'Odeslat zájem', isSubmit: true, inForm: true }
    const model = new FakeModel([
      message([computerUse('screenshot')]),
      message([computerUse('left_click', { coordinate: [300, 400] })]),
      message([computerUse('screenshot')]),
      message([computerUse('screenshot')]),
      message([textBlock('You denied it, so I stopped.')], 'end_turn'),
    ])
    const sandbox = new FakeSandbox([solidPng(64, 64, [0, 0, 0])])
    sandbox.companion.elements = [submit]
    const clock = { now: 0 }
    sandbox.clock = clock
    sandbox.screenshotMs = 1_000
    const t = makeContext({ store, botId, model, sandbox, tools: basePlatformTools, now: () => clock.now })
    // The user thinks for forty seconds, then presses Deny.
    const decide = t.ctx.waitForApproval
    t.ctx.waitForApproval = async (approvalId) => {
      clock.now += 40_000
      return decide(approvalId)
    }
    t.decisions.push('denied')

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')

    expect(model.calls).toHaveLength(5)
    expect(sandbox.methods()).not.toContain('leftClick')
    expect(t.chat.filter((m) => m.card?.card === 'takeover')).toHaveLength(0)
  })

  it('does not count the time a human held the screen in a takeover as a screen that did not change', async () => {
    const model = new FakeModel([
      message([computerUse('screenshot')]),
      message([computerUse('screenshot')]),
      message([computerUse('screenshot')]),
      message([textBlock('Nothing changed, so I stopped.')], 'end_turn'),
    ])
    const sandbox = new FakeSandbox([solidPng(64, 64, [0, 0, 0])])
    const clock = { now: 0 }
    sandbox.clock = clock
    sandbox.screenshotMs = 1_000
    const t = makeContext({ store, botId, model, sandbox, now: () => clock.now })
    // A manual takeover needs no changed page, so one press of Hand back ends it.
    t.handbackAttempts.planned = 1
    // The user presses Take over after the first screenshot, holds the screen for a minute and changes nothing.
    const emit = t.ctx.emit
    t.ctx.emit = async (event) => {
      if (event.type === 'tool_result' && t.takeovers.length === 0) t.manualTakeover.requested = true
      return emit(event)
    }
    const takeover = t.ctx.takeover
    t.ctx.takeover = async (trigger, reason) => {
      clock.now += 60_000
      return takeover(trigger, reason)
    }

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')

    expect(t.takeovers).toEqual([{ trigger: 'manual', reason: expect.stringContaining('You asked to take over') }])
    expect(model.calls).toHaveLength(4)
  })

  // A zoom is not "one more screenshot of a screen that did not change", so the detector does not
  // count it. Without this, a bot that reads a long page would end stuck: it zooms into one
  // screenshot for more than 30 s.
  it('does not end stuck while the model zooms into one screenshot for a long time', async () => {
    const zoom = () => message([computerUse('zoom', { region: [0, 0, 16, 16] })])
    const model = new FakeModel([message([computerUse('screenshot')]), ...Array.from({ length: 5 }, zoom), message([textBlock('Read it.')], 'end_turn')])
    // Twenty seconds pass on every reading of the clock: three unchanged screenshots would span forty.
    let clock = 0
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), now: () => (clock += 20_000) })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')

    expect(model.calls).toHaveLength(7)
    expect(t.chat.filter((m) => m.card?.card === 'takeover')).toHaveLength(0)
  })

  it('ends with failed, sets the bot idle and says what it was doing when the sandbox throws', async () => {
    const model = new FakeModel([message([computerUse('left_click', { coordinate: [1, 1] })]), message([computerUse('screenshot')])])
    const sandbox = new FakeSandbox()
    sandbox.screenshotError = new Error('socket hang up')
    const t = makeContext({ store, botId, model, sandbox })

    const result = await runLoop(t.ctx, goal)

    expect(result).toEqual({ outcome: 'failed', summary: 'Error' })
    expect(t.chat.at(-1)?.text).toMatch(/^I was doing screenshot; my computer stopped answering, so I stopped\./)
    expect((await store.readBot(botId)).state).toBe('idle')
    expect(t.events.at(-1)).toMatchObject({ type: 'end', outcome: 'failed' })
  })

  it('runs a platform tool and hands its result back to the model', async () => {
    const model = new FakeModel([message([toolUse('remember', { note: 'the sky is blue' })]), message([textBlock('noted')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: basePlatformTools })

    await runLoop(t.ctx, goal)

    expect(await store.readMemory(botId)).toMatch(/: the sky is blue\n$/)
    expect(t.events.map((e) => e.type)).toEqual(['cost', 'tool_call', 'tool_result', 'cost', 'text', 'end'])
    expect(lastUserContent(model, 1)[0]).toMatchObject({ type: 'tool_result', content: 'remembered' })
  })

  it('answers an unknown tool with an error result and goes on', async () => {
    const model = new FakeModel([message([toolUse('teleport', {})]), message([textBlock('fine')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: basePlatformTools })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')
    expect(lastUserContent(model, 1)[0]).toMatchObject({ type: 'tool_result', is_error: true, content: 'unknown tool: teleport' })
  })

  it('ask_user posts the question, waits for the answer and returns it to the model', async () => {
    const model = new FakeModel([message([toolUse('ask_user', { question: 'Which city?' })]), message([textBlock('Thanks.')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: basePlatformTools })
    t.userAnswers.push('Prague')

    await runLoop(t.ctx, goal)

    expect(t.chat.map((m) => m.text)).toEqual(['Which city?', 'Thanks.'])
    expect(t.states).toEqual(['waiting', 'working'])
    expect(lastUserContent(model, 1)[0]).toMatchObject({ type: 'tool_result', content: 'the user answered: Prague' })
  })

  describe('propose_action (signal A)', () => {
    const proposal = { kind: 'send', summary: 'Send the reply', consequences: ['the mail leaves'], warnings: [], target: 'Send' }

    it('denied: the tool result starts with denied and no sandbox action ran', async () => {
      const model = new FakeModel([message([toolUse('propose_action', proposal)]), message([textBlock('Understood.')], 'end_turn')])
      const sandbox = new FakeSandbox()
      const t = makeContext({ store, botId, model, sandbox, tools: basePlatformTools })
      t.decisions.push('denied')

      await runLoop(t.ctx, goal)

      expect(lastUserContent(model, 1)[0]).toMatchObject({ type: 'tool_result', content: expect.stringMatching(/^denied/) })
      // A denied result can also come from an expired approval or Stop.
      expect(lastUserContent(model, 1)[0]).toMatchObject({ content: expect.stringContaining('not approved') })
      expect(lastUserContent(model, 1)[0]).not.toMatchObject({ content: expect.stringContaining('the user refused') })
      expect(sandbox.methods().filter((m) => m !== 'screenshot')).toEqual([])
      expect(t.chat.filter((m) => m.card?.card === 'approval').map((m) => m.card)).toEqual([expect.objectContaining({ status: 'denied', announced: true })])
      expect(t.states).toEqual(['waiting', 'working'])
    })

    it('allowed: the tool result starts with approved, the card is allowed and the events go pending then allowed', async () => {
      const model = new FakeModel([message([toolUse('propose_action', proposal)]), message([textBlock('Sending.')], 'end_turn')])
      const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: basePlatformTools })
      t.decisions.push('allowed')

      await runLoop(t.ctx, goal)

      expect(lastUserContent(model, 1)[0]).toMatchObject({ type: 'tool_result', content: expect.stringMatching(/^approved: you may activate "Send"/) })
      const cards = (await store.readChat(botId, { limit: 10 })).filter((m) => m.card?.card === 'approval')
      expect(cards).toHaveLength(1)
      expect(cards[0]?.card).toMatchObject({ status: 'allowed', target: 'Send', url: 'https://example.com/form', shot: expect.stringMatching(/^[a-f0-9]{64}$/) })
      const approvalEvents = t.events.filter((e) => e.type === 'approval').map((e) => (e.type === 'approval' ? e.status : ''))
      expect(approvalEvents).toEqual(['pending', 'allowed'])
      expect(t.ctx.approvals.findMatch('run-1', 1, { name: 'send', url: 'https://example.com/form' })).not.toBeNull()
    })

    it('a kind the rules always allow is approved at once without waiting', async () => {
      const model = new FakeModel([message([toolUse('propose_action', proposal)]), message([textBlock('ok')], 'end_turn')])
      const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: basePlatformTools, rules: { requireApproval: [], alwaysAllow: ['send'] } })

      await runLoop(t.ctx, goal)

      expect(lastUserContent(model, 1)[0]).toMatchObject({ content: expect.stringMatching(/^approved/) })
      expect(t.states).toEqual([])
      expect(t.chat.map((m) => m.card?.card ?? m.text)).toEqual(['approval', 'status', 'ok'])
    })
  })

  describe('signal B and the secret guard', () => {
    const submit: ElementInfo = { ...ELEMENT_TEXT_INPUT, tag: 'button', type: 'submit', name: 'Odeslat zájem', isSubmit: true, inForm: true }
    const password: ElementInfo = { ...ELEMENT_TEXT_INPUT, type: 'password', name: 'Heslo' }
    const click = computerUse('left_click', { coordinate: [300, 400] })

    it('an unannounced click on a submit control is stopped by a card; deny leaves the page untouched', async () => {
      const model = new FakeModel([message([click]), message([textBlock('Stopped.')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [submit]
      const t = makeContext({ store, botId, model, sandbox, tools: basePlatformTools })
      t.decisions.push('denied')

      await runLoop(t.ctx, goal)

      expect(sandbox.methods()).not.toContain('leftClick')
      expect(sandbox.companion.calls).toEqual([{ method: 'elementAt', args: [[300, 400]] }])
      const cards = t.chat.filter((m) => m.card?.card === 'approval').map((m) => m.card)
      expect(cards).toEqual([expect.objectContaining({ announced: false, status: 'denied', target: 'Odeslat zájem', summary: expect.stringContaining('without announcing it') })])
      expect(lastUserContent(model, 1)[0]).toMatchObject({ type: 'tool_result', is_error: true, content: expect.stringMatching(/^denied/) })
      expect(t.events.filter((e) => e.type === 'gate')).toEqual([expect.objectContaining({ decision: 'block', rule: 'submit-control', announced: false })])
    })

    it('a click that matches an allowed approval runs and consumes it', async () => {
      const model = new FakeModel([message([click]), message([textBlock('Sent.')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [submit]
      const t = makeContext({ store, botId, model, sandbox })
      const approval = t.ctx.approvals.propose(botId, 'run-1', 0, { kind: 'submit', target: 'odeslat zájem', page: 'https://example.com/form' })
      t.ctx.approvals.resolve(approval.id, 'allowed')

      await runLoop(t.ctx, goal)

      expect(sandbox.calls).toEqual([{ method: 'leftClick', args: [[300, 400]] }])
      expect(t.events.filter((e) => e.type === 'gate')).toEqual([expect.objectContaining({ decision: 'consume', rule: 'submit-control', approvalId: approval.id })])
      expect(t.ctx.approvals.get(approval.id)?.consumed).toBe(true)
      expect(t.chat.filter((m) => m.card?.card === 'approval')).toHaveLength(0)
    })

    it('a second click after the approval was consumed is blocked again', async () => {
      const model = new FakeModel([message([click]), message([computerUse('left_click', { coordinate: [300, 400] })]), message([textBlock('done')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [submit]
      const t = makeContext({ store, botId, model, sandbox })
      const approval = t.ctx.approvals.propose(botId, 'run-1', 0, { kind: 'submit', target: 'Odeslat zájem', page: 'https://example.com/form' })
      t.ctx.approvals.resolve(approval.id, 'allowed')
      t.decisions.push('denied')

      await runLoop(t.ctx, goal)

      expect(sandbox.methods().filter((m) => m === 'leftClick')).toHaveLength(1)
      expect(t.events.filter((e) => e.type === 'gate').map((e) => (e.type === 'gate' ? e.decision : ''))).toEqual(['consume', 'block'])
    })

    it('allowing a blocked click once runs exactly that click', async () => {
      const model = new FakeModel([message([click]), message([textBlock('done')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [submit]
      const t = makeContext({ store, botId, model, sandbox })
      t.decisions.push('allowed')

      await runLoop(t.ctx, goal)

      expect(sandbox.calls.filter((c) => c.method === 'leftClick')).toEqual([{ method: 'leftClick', args: [[300, 400]] }])
      expect(t.events.filter((e) => e.type === 'gate').map((e) => (e.type === 'gate' ? e.decision : ''))).toEqual(['block', 'consume'])
      expect(t.chat.filter((m) => m.card?.card === 'approval').map((m) => m.card)).toEqual([expect.objectContaining({ status: 'allowed', announced: false })])
    })

    // The gate reads the control, waits for the user, and reads the point again before it clicks.
    // Without the second read, a page that changes while the user decides can turn an Allow for
    // "Send" into a click on something else.
    it('Allow once activates only the control the user saw: a control that changed under the point is not clicked, and the approval waits for the right one', async () => {
      const model = new FakeModel([message([click]), message([click]), message([textBlock('done')], 'end_turn')])
      const sandbox = new FakeSandbox()
      // Read before the card: the submit; read again after Allow: another control; the model's next click finds the submit again.
      sandbox.companion.elements = [submit, { ...submit, name: 'Delete account' }, submit]
      const t = makeContext({ store, botId, model, sandbox })
      t.decisions.push('allowed')

      await runLoop(t.ctx, goal)

      expect(sandbox.calls.filter((c) => c.method === 'leftClick')).toEqual([{ method: 'leftClick', args: [[300, 400]] }])
      expect(sandbox.companion.calls.map((c) => c.method)).toEqual(['elementAt', 'elementAt', 'elementAt'])
      expect(lastUserContent(model, 1)[0]).toMatchObject({ type: 'tool_result', is_error: true, content: expect.stringMatching(/^not done: the page changed while the user decided, and that point now holds "Delete account" instead of "Odeslat zájem"/) })
      expect(t.events.filter((e) => e.type === 'gate').map((e) => (e.type === 'gate' ? [e.decision, e.reason] : []))).toEqual([
        ['block', expect.stringContaining('without announcing it')],
        ['block', 'the control at that point changed while the user decided'],
        ['consume', 'matches the approved action'],
      ])
      expect(t.chat.filter((m) => m.card?.card === 'approval')).toHaveLength(1)
    })

    it('Allow once does not click when the page moved to another site with the same label, and still clicks an unreadable control that is still there', async () => {
      const elsewhere = { ...submit, url: 'https://other.example/form' }
      const unknown: ElementInfo = { target: 'unknown', reason: 'cross-origin frame', url: 'https://example.com/form', title: 'Form' }
      const model = new FakeModel([message([click]), message([click]), message([textBlock('done')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [submit, elsewhere, unknown, unknown]
      const t = makeContext({ store, botId, model, sandbox })
      t.decisions.push('allowed', 'allowed')

      await runLoop(t.ctx, goal)

      // The first click: allowed, the page moved to another site, nothing ran. The second: an unreadable
      // control, allowed, still unreadable on the same page, clicked once.
      expect(sandbox.calls.filter((c) => c.method === 'leftClick')).toEqual([{ method: 'leftClick', args: [[300, 400]] }])
      expect(t.events.filter((e) => e.type === 'gate').map((e) => (e.type === 'gate' ? [e.decision, e.rule] : []))).toEqual([
        ['block', 'submit-control'],
        ['block', 'submit-control'],
        ['block', 'unknown-target'],
        ['consume', 'unknown-target'],
      ])
    })

    it('a type into a password field is blocked by the secret guard and starts takeover', async () => {
      const model = new FakeModel([message([computerUse('type', { text: 'hunter2' })]), message([textBlock('Waiting.')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.active = [password]
      // the human signs in and moves past the login page before handing back
      const login = { url: 'https://example.com/login', fingerprint: 'login|2', unsafe: false }
      sandbox.companion.states = [login, { url: 'https://example.com/inbox', fingerprint: 'inbox|0', unsafe: false }]
      const t = makeContext({ store, botId, model, sandbox })

      await runLoop(t.ctx, goal)

      expect(sandbox.methods()).not.toContain('type')
      expect(t.events.filter((e) => e.type === 'gate')).toEqual([expect.objectContaining({ decision: 'block', reason: 'secret-field' })])
      expect(t.takeovers).toEqual([{ trigger: 'secret-field', reason: expect.stringContaining('password') }])
      expect(t.states).toEqual(['blocked', 'working'])
      expect(t.handbackAttempts.results).toEqual([{ ok: true }])
      expect(lastUserContent(model, 1)[0]).toMatchObject({ type: 'tool_result', content: expect.stringContaining(HUMAN_STEP_TEXT) })
      // the typed text never reached the chat or the event log
      const everything = JSON.stringify(t.events) + JSON.stringify(t.chat)
      expect(everything).not.toContain('hunter2')
    })

    it('a type into a plain text field passes the secret guard', async () => {
      const model = new FakeModel([message([computerUse('type', { text: 'jane@example.com' })]), message([textBlock('ok')], 'end_turn')])
      const sandbox = new FakeSandbox()
      const t = makeContext({ store, botId, model, sandbox })

      await runLoop(t.ctx, goal)

      expect(sandbox.calls).toEqual([{ method: 'type', args: ['jane@example.com'] }])
      expect(sandbox.companion.calls).toEqual([{ method: 'activeElement', args: [] }])
    })

    it('a typed text with a space is refused while the focus sits on a button, without a card', async () => {
      const model = new FakeModel([message([computerUse('type', { text: 'Dear team, thank you' })]), message([textBlock('ok')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.active = [submit]
      const t = makeContext({ store, botId, model, sandbox })

      await runLoop(t.ctx, goal)

      expect(sandbox.methods()).not.toContain('type')
      expect(t.events.filter((e) => e.type === 'gate')).toEqual([expect.objectContaining({ decision: 'block', reason: 'focus-on-control' })])
      expect(lastUserContent(model, 1)[0]).toMatchObject({ is_error: true, content: expect.stringContaining('click the text field') })
      expect(t.chat.filter((m) => m.card?.card === 'approval')).toHaveLength(0)
    })

    it('a typed text that holds a Tab is refused before it reaches the computer', async () => {
      const model = new FakeModel([message([computerUse('type', { text: 'Jane\tDoe' })]), message([textBlock('ok')], 'end_turn')])
      const sandbox = new FakeSandbox()
      const t = makeContext({ store, botId, model, sandbox })

      await runLoop(t.ctx, goal)

      expect(sandbox.methods()).not.toContain('type')
      expect(lastUserContent(model, 1)[0]).toMatchObject({ is_error: true, content: expect.stringContaining('Tab') })
    })

    it('a click on a file input is refused with a pointer to attach_file, without a card', async () => {
      const model = new FakeModel([message([click]), message([textBlock('ok')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [{ ...ELEMENT_TEXT_INPUT, type: 'file', name: 'CV' }]
      const t = makeContext({ store, botId, model, sandbox })

      await runLoop(t.ctx, goal)

      expect(sandbox.methods()).not.toContain('leftClick')
      expect(lastUserContent(model, 1)[0]).toMatchObject({ is_error: true, content: expect.stringContaining('attach_file') })
      expect(t.chat.filter((m) => m.card?.card === 'approval')).toHaveLength(0)
    })

    it('a drag is gated by the element at its end point, not its start point', async () => {
      const drag = computerUse('left_click_drag', { start_coordinate: [10, 10], coordinate: [300, 400] })
      const model = new FakeModel([message([drag]), message([textBlock('done')], 'end_turn')])
      const sandbox = new FakeSandbox()
      const t = makeContext({ store, botId, model, sandbox })

      await runLoop(t.ctx, goal)

      expect(sandbox.companion.calls).toEqual([{ method: 'elementAt', args: [[300, 400]] }])
      expect(sandbox.calls).toEqual([{ method: 'drag', args: [[10, 10], [300, 400]] }])
    })

    it('a click with no coordinate is gated by the element under the current cursor position', async () => {
      const model = new FakeModel([message([computerUse('double_click', {})]), message([textBlock('done')], 'end_turn')])
      const sandbox = new FakeSandbox() // cursorPosition() answers [5, 6]
      const t = makeContext({ store, botId, model, sandbox })

      await runLoop(t.ctx, goal)

      expect(sandbox.methods()).toContain('cursorPosition')
      expect(sandbox.companion.calls).toEqual([{ method: 'elementAt', args: [[5, 6]] }])
    })

    it('a submit control matched only by alwaysAllow runs without a card', async () => {
      const model = new FakeModel([message([click]), message([textBlock('done')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [submit]
      const t = makeContext({ store, botId, model, sandbox, rules: { requireApproval: [], alwaysAllow: ['submit-control'] } })

      await runLoop(t.ctx, goal)

      expect(sandbox.calls).toEqual([{ method: 'leftClick', args: [[300, 400]] }])
      expect(t.chat.filter((m) => m.card?.card === 'approval')).toHaveLength(0)
      expect(t.events.filter((e) => e.type === 'gate')).toEqual([expect.objectContaining({ decision: 'allow', rule: 'submit-control' })])
    })

    it('logs the label and page of a control that ran without a card, and no control for the browser frame', async () => {
      const button: ElementInfo = { ...ELEMENT_TEXT_INPUT, tag: 'button', type: null, name: 'Place order', url: 'https://shop.example/cart?token=abc#pay' }
      const frame: ElementInfo = { target: 'browser-ui', reason: 'above the page', url: 'https://shop.example/cart', title: 'Cart' }
      const model = new FakeModel([message([click]), message([click]), message([textBlock('done')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [button, frame]
      const t = makeContext({ store, botId, model, sandbox })

      await runLoop(t.ctx, goal)

      const gates = t.events.filter((e) => e.type === 'gate')
      expect(gates).toEqual([
        expect.objectContaining({ decision: 'allow', rule: null, control: { kind: 'click', tag: 'button', role: null, name: 'Place order', page: 'https://shop.example/cart' } }),
        expect.objectContaining({ decision: 'allow', rule: null }),
      ])
      expect(gates[1]?.type === 'gate' ? gates[1].control : 'missing').toBeUndefined()
    })

    it('requireApproval wins over alwaysAllow when both match, through the loop', async () => {
      const model = new FakeModel([message([click]), message([textBlock('done')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [submit]
      const t = makeContext({ store, botId, model, sandbox, rules: { requireApproval: ['submit*'], alwaysAllow: ['*'] } })
      t.decisions.push('denied')

      await runLoop(t.ctx, goal)

      expect(sandbox.methods()).not.toContain('leftClick')
      expect(t.events.filter((e) => e.type === 'gate')).toEqual([expect.objectContaining({ decision: 'block', rule: 'submit-control' })])
    })

    it('a single printable key into a password field is blocked by the secret guard', async () => {
      const model = new FakeModel([message([computerUse('key', { text: 'a' })]), message([textBlock('ok')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.active = [password]
      const login = { url: 'https://example.com/login', fingerprint: 'login|2', unsafe: false }
      sandbox.companion.states = [login, { url: 'https://example.com/inbox', fingerprint: 'inbox|0', unsafe: false }]
      const t = makeContext({ store, botId, model, sandbox })

      await runLoop(t.ctx, goal)

      expect(sandbox.methods()).not.toContain('press')
      expect(t.events.filter((e) => e.type === 'gate')).toEqual([expect.objectContaining({ decision: 'block', reason: 'secret-field' })])
      expect(JSON.stringify(t.events)).not.toContain('"text":"a"')
    })

    it('after Allow once on a blocked click, a different gated click is blocked again', async () => {
      const other = computerUse('left_click', { coordinate: [500, 600] })
      const model = new FakeModel([message([click]), message([other]), message([textBlock('done')], 'end_turn')])
      const sandbox = new FakeSandbox()
      // The submit is read before the card and again after Allow; the second click finds another control.
      sandbox.companion.elements = [submit, submit, { ...submit, name: 'Delete account' }]
      const t = makeContext({ store, botId, model, sandbox })
      t.decisions.push('allowed', 'denied')

      await runLoop(t.ctx, goal)

      expect(sandbox.calls.filter((c) => c.method === 'leftClick')).toEqual([{ method: 'leftClick', args: [[300, 400]] }])
      expect(t.events.filter((e) => e.type === 'gate').map((e) => (e.type === 'gate' ? e.decision : ''))).toEqual(['block', 'consume', 'block'])
    })

    it('names the approved action on a mismatch card and says so for an unknown target', async () => {
      const model = new FakeModel([message([click]), message([click]), message([textBlock('done')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [submit, { target: 'unknown', reason: 'cross-origin frame', url: 'https://example.com/form', title: 'Form' }]
      const t = makeContext({ store, botId, model, sandbox })
      const approval = t.ctx.approvals.propose(botId, 'run-1', 0, { kind: 'book', target: 'Schedule Event', page: 'https://example.com/form' })
      t.ctx.approvals.resolve(approval.id, 'allowed')
      t.decisions.push('denied', 'denied')

      await runLoop(t.ctx, goal)

      const summaries = t.chat.filter((m) => m.card?.card === 'approval').map((m) => (m.card?.card === 'approval' ? m.card.summary : ''))
      expect(summaries[0]).toContain('This is not the action you approved ("Schedule Event" on https://example.com/form)')
      expect(summaries[1]).toContain('I cannot see what this click does')
      expect(sandbox.methods()).not.toContain('leftClick')
    })

    it('keeps the approval when the approved click fails on the computer, so the retry needs no new card', async () => {
      const model = new FakeModel([message([click]), message([click]), message([textBlock('done')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [submit]
      sandbox.clickError = new SandboxActionError('xdotool failed')
      const t = makeContext({ store, botId, model, sandbox })
      const approval = t.ctx.approvals.propose(botId, 'run-1', 0, { kind: 'submit', target: 'Odeslat zájem', page: 'https://example.com/form' })
      t.ctx.approvals.resolve(approval.id, 'allowed')

      await runLoop(t.ctx, goal)

      expect(sandbox.calls.filter((c) => c.method === 'leftClick')).toHaveLength(2)
      expect(lastUserContent(model, 1)[0]).toMatchObject({ is_error: true, content: expect.stringContaining('failed on the computer') })
      expect(t.events.filter((e) => e.type === 'gate').map((e) => (e.type === 'gate' ? e.decision : ''))).toEqual(['consume'])
      expect(t.ctx.approvals.get(approval.id)?.consumed).toBe(true)
      expect(t.chat.filter((m) => m.card?.card === 'approval')).toHaveLength(0)
    })

    it('a mouse-up on a submit control is gated like a click, and a held Return like Enter', async () => {
      const model = new FakeModel([message([computerUse('left_mouse_up', { coordinate: [300, 400] })]), message([computerUse('hold_key', { text: 'Return', duration: 1 })]), message([textBlock('done')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [submit]
      sandbox.companion.active = [ELEMENT_TEXT_INPUT]
      const t = makeContext({ store, botId, model, sandbox })
      t.decisions.push('denied', 'denied')

      await runLoop(t.ctx, goal)

      expect(sandbox.methods()).not.toContain('mouseUp')
      expect(sandbox.methods()).not.toContain('holdKey')
      expect(t.events.filter((e) => e.type === 'gate').map((e) => (e.type === 'gate' ? e.rule : ''))).toEqual(['submit-control', 'enter-in-form'])
    })

    // One approval is one activation. Without this, one Allow would cover `key Return` with a
    // repeat count, and every other way to activate a gated control more than once with one action.
    describe('one approval is one activation', () => {
      const enterInForm = { ...ELEMENT_TEXT_INPUT, name: 'Message' }

      function allowedEnter(model: FakeModel, sandbox: FakeSandbox): { t: TestContext; approvalId: string } {
        const t = makeContext({ store, botId, model, sandbox })
        const approval = t.ctx.approvals.propose(botId, 'run-1', 0, { kind: 'send', target: 'Message', page: 'https://example.com/form' })
        t.ctx.approvals.resolve(approval.id, 'allowed')
        return { t, approvalId: approval.id }
      }

      it('a repeated Return on a gated input is refused before the approval is spent, and a single Return then goes through once', async () => {
        const model = new FakeModel([message([computerUse('key', { text: 'Return', repeat: 3 })]), message([computerUse('key', { text: 'Return' })]), message([textBlock('sent')], 'end_turn')])
        const sandbox = new FakeSandbox()
        sandbox.companion.active = [enterInForm]
        const { t, approvalId } = allowedEnter(model, sandbox)

        await runLoop(t.ctx, goal)

        expect(sandbox.calls.filter((c) => c.method === 'press')).toEqual([{ method: 'press', args: [['Return']] }])
        const gates = t.events.filter((e) => e.type === 'gate')
        expect(gates.map((e) => (e.type === 'gate' ? [e.decision, e.reason] : []))).toEqual([['block', 'multi-activation'], ['consume', 'matches the approved action']])
        expect(gates[0]).toMatchObject({ rule: 'enter-in-form', approvalId: null })
        expect(lastUserContent(model, 1)[0]).toMatchObject({ is_error: true, content: expect.stringContaining('would activate "Message" 3 times') })
        expect(t.ctx.approvals.get(approvalId)?.consumed).toBe(true)
        expect(t.chat.filter((m) => m.card?.card === 'approval')).toHaveLength(0)
      })

      it('a held Return, a typed double newline and a double click on a gated control are refused without a card', async () => {
        const submitButton: ElementInfo = { ...ELEMENT_TEXT_INPUT, tag: 'button', type: 'submit', name: 'Send', isSubmit: true }
        const model = new FakeModel([
          message([computerUse('hold_key', { text: 'Return', duration: 2 })]),
          message([computerUse('type', { text: 'hello\n\n' })]),
          message([computerUse('double_click', { coordinate: [300, 400] })]),
          message([textBlock('ok')], 'end_turn'),
        ])
        const sandbox = new FakeSandbox()
        sandbox.companion.active = [enterInForm]
        sandbox.companion.elements = [submitButton]
        const t = makeContext({ store, botId, model, sandbox })

        await runLoop(t.ctx, goal)

        expect(sandbox.methods()).not.toContain('holdKey')
        expect(sandbox.methods()).not.toContain('type')
        expect(sandbox.methods()).not.toContain('doubleClick')
        expect(t.events.filter((e) => e.type === 'gate').map((e) => (e.type === 'gate' ? e.reason : ''))).toEqual(['multi-activation', 'multi-activation', 'multi-activation'])
        expect(lastUserContent(model, 1)[0]).toMatchObject({ content: expect.stringContaining('over and over while the key is held') })
        expect(lastUserContent(model, 2)[0]).toMatchObject({ content: expect.stringContaining('2 times') })
        expect(t.chat.filter((m) => m.card?.card === 'approval')).toHaveLength(0)
      })

      it('a repeated Return on a target the companion cannot read keeps the unknown-target wording and does not press', async () => {
        const model = new FakeModel([message([computerUse('key', { text: 'Return', repeat: 2 })]), message([textBlock('ok')], 'end_turn')])
        const sandbox = new FakeSandbox()
        sandbox.companion.active = [{ target: 'unknown', reason: 'cross-origin frame', url: 'https://example.com/form', title: 'Form' }]
        const t = makeContext({ store, botId, model, sandbox })

        await runLoop(t.ctx, goal)

        expect(sandbox.methods()).not.toContain('press')
        expect(t.events.filter((e) => e.type === 'gate')).toEqual([expect.objectContaining({ decision: 'block', rule: 'unknown-target', reason: 'multi-activation' })])
        expect(lastUserContent(model, 1)[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/^I cannot see what this would activate .* 2 times; do it once/) })
        expect(t.chat.filter((m) => m.card?.card === 'approval')).toHaveLength(0)
      })

      it('a repeated key on a control no rule covers is not gated and runs every time', async () => {
        const model = new FakeModel([message([computerUse('key', { text: 'Return', repeat: 2 })]), message([textBlock('ok')], 'end_turn')])
        const sandbox = new FakeSandbox()
        // A textarea outside a form: Enter is a newline there, no rule matches.
        sandbox.companion.active = [{ ...ELEMENT_TEXT_INPUT, tag: 'textarea', type: null, inForm: false, name: 'Notes' }]
        const t = makeContext({ store, botId, model, sandbox })

        await runLoop(t.ctx, goal)

        expect(sandbox.calls.filter((c) => c.method === 'press')).toHaveLength(2)
        expect(t.events.filter((e) => e.type === 'gate')).toEqual([expect.objectContaining({ decision: 'allow', rule: null })])
      })

      it('a repeated key that fails after some presses tells the model how many were sent', async () => {
        const model = new FakeModel([message([computerUse('key', { text: 'Down', repeat: 4 })]), message([textBlock('ok')], 'end_turn')])
        const sandbox = new FakeSandbox()
        let presses = 0
        sandbox.press = async (keys) => {
          sandbox.calls.push({ method: 'press', args: [keys] })
          presses += 1
          if (presses === 3) throw new SandboxActionError('the command failed on the computer (exit 1): X error')
        }
        const t = makeContext({ store, botId, model, sandbox })

        await runLoop(t.ctx, goal)

        expect(sandbox.calls.filter((c) => c.method === 'press')).toHaveLength(3)
        expect(lastUserContent(model, 1)[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/^key failed on the computer: .* \(2 of 4 presses were sent before this\)$/) })
        expect(t.events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: false, summary: expect.stringContaining('2 of 4 presses were sent before this') })
      })
    })

    it('Enter on a focused input inside a form is gated like a click', async () => {
      const model = new FakeModel([message([computerUse('key', { text: 'Return' })]), message([textBlock('ok')], 'end_turn')])
      const sandbox = new FakeSandbox()
      const t = makeContext({ store, botId, model, sandbox })
      t.decisions.push('denied')

      await runLoop(t.ctx, goal)

      expect(sandbox.methods()).not.toContain('press')
      expect(t.events.filter((e) => e.type === 'gate')).toEqual([expect.objectContaining({ decision: 'block', rule: 'enter-in-form' })])
    })
  })

  describe('takeover', () => {
    it('request_takeover pauses the loop until the hand-back check passes; nothing but takeover events in between', async () => {
      const model = new FakeModel([
        message([toolUse('request_takeover', { reason: 'the mailbox asks for a password' })]),
        message([textBlock('Signed in.')], 'end_turn'),
      ])
      const sandbox = new FakeSandbox()
      const login = { url: 'https://example.com/login', fingerprint: 'login|2', unsafe: false }
      sandbox.companion.states = [login, { ...login, unsafe: true }, { ...login, unsafe: true }, { url: 'https://example.com/inbox', fingerprint: 'inbox|0', unsafe: false }]
      const t = makeContext({ store, botId, model, sandbox, tools: basePlatformTools })
      t.handbackAttempts.planned = 3

      await runLoop(t.ctx, goal)

      expect(t.handbackAttempts.results).toEqual([
        { ok: false, reason: expect.stringContaining('password or code field') },
        { ok: false, reason: expect.stringContaining('password or code field') },
        { ok: true },
      ])
      const types = t.events.map((e) => e.type)
      const started = types.indexOf('takeover')
      const ended = t.events.findIndex((e) => e.type === 'takeover' && e.status === 'ended')
      expect(started).toBeGreaterThan(-1)
      expect(ended).toBeGreaterThan(started)
      const between = t.events.slice(started, ended + 1)
      expect(between.map((e) => e.type)).toEqual(['takeover', 'takeover', 'takeover', 'takeover'])
      expect(between.map((e) => (e.type === 'takeover' ? e.status : ''))).toEqual(['started', 'handback-refused', 'handback-refused', 'ended'])
      expect(model.calls).toHaveLength(2)
      expect(sandbox.methods()).not.toContain('type')
      // no page content in the takeover events, only reasons
      for (const e of between) if (e.type === 'takeover') expect(e.reason).not.toContain('example.com')
      expect(t.chat.filter((m) => m.card?.card === 'takeover').map((m) => m.card)).toEqual([expect.objectContaining({ status: 'ended' })])
      expect(t.states).toEqual(['blocked', 'working'])
      expect(t.takeovers).toEqual([{ trigger: 'requested', reason: expect.stringContaining('the mailbox asks for a password') }])
      expect(sandbox.methods().filter((m) => m === 'screenshot')).toHaveLength(1) // the fresh screenshot after hand-back
      expect(lastUserContent(model, 1)[0]).toMatchObject({ type: 'tool_result', content: expect.stringContaining(HUMAN_STEP_TEXT) })
    })

    it('a hand-back is refused while the page is unchanged after a secret-field takeover', async () => {
      const model = new FakeModel([message([computerUse('type', { text: 'secret' })]), message([textBlock('ok')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.active = [{ ...ELEMENT_TEXT_INPUT, type: 'password', name: 'Heslo' }]
      const login = { url: 'https://example.com/login', fingerprint: 'login|2', unsafe: false }
      sandbox.companion.states = [login, login, { ...login, fingerprint: 'inbox|0' }]
      const t = makeContext({ store, botId, model, sandbox })
      t.handbackAttempts.planned = 2

      await runLoop(t.ctx, goal)

      expect(t.handbackAttempts.results).toEqual([{ ok: false, reason: expect.stringContaining('has not changed') }, { ok: true }])
      expect(sandbox.methods()).not.toContain('type')
    })

    it("the user's Take over is honoured before the next model call", async () => {
      const model = new FakeModel([message([computerUse('screenshot')]), message([textBlock('ok')], 'end_turn')])
      const sandbox = new FakeSandbox()
      const t = makeContext({ store, botId, model, sandbox })
      t.manualTakeover.requested = true

      await runLoop(t.ctx, goal)

      expect(t.takeovers).toEqual([{ trigger: 'manual', reason: expect.stringContaining('You asked to take over') }])
      expect(t.events[0]).toMatchObject({ type: 'takeover', status: 'started', reason: 'manual' })
      const last = model.calls[0]?.messages.at(-1)
      expect(last?.role).toBe('user')
      expect(Array.isArray(last?.content) && last.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('took over') })
    })
  })

  it('no platform tool writes approval-rules.json, whatever it is called with', async () => {
    const rulesPath = join(dataDir, botId, 'approval-rules.json')
    const before = await readFile(rulesPath, 'utf8')
    const sandbox = new FakeSandbox()
    const t = makeContext({ store, botId, model: new FakeModel([]), sandbox, tools: basePlatformTools })
    t.userAnswers.push('an answer')
    t.decisions.push('denied')
    const minimal: Record<string, unknown> = {
      fetch_url: { url: 'file:///etc/passwd' },
      open_url: { url: 'javascript:alert(1)' },
      write_artifact: { name: 'approval-rules.md', content: '{"requireApproval":[]}' },
      read_artifact: { name: 'approval-rules.md' },
      remember: { note: 'x' },
      ask_user: { question: 'q?' },
      attach_file: { coordinate: [1, 1], filename: 'cv.pdf' },
      propose_action: { kind: 'send', summary: 's', consequences: [], warnings: [], target: 't' },
      request_takeover: { reason: 'r' },
      request_connection: { connector: 'approval-rules', reason: 'r' },
      save_skill: { name: 'approval-rules', description: 'd', body: 'b' },
      // A schedule the density check accepts, so the routine write itself runs with the hostile name.
      save_routine: { name: 'approval-rules', skill: 'approval-rules', schedule: '0 7 * * *', instruction: 'i' },
      set_routine_enabled: { name: 'approval-rules', enabled: false },
    }
    expect(Object.keys(minimal).sort()).toEqual(basePlatformTools.map((tool) => tool.name).sort())
    for (const tool of basePlatformTools) await runPlatformTool(tool, minimal[tool.name], t.ctx)
    expect(await readFile(rulesPath, 'utf8')).toBe(before)
    expect(await store.readRules(botId)).toEqual({ requireApproval: ['*'], alwaysAllow: [] })
  })

  it('puts the cache breakpoint on the last block of the last user message only', async () => {
    const model = new FakeModel([
      message([computerUse('left_click', { coordinate: [1, 1] })]),
      message([computerUse('left_click', { coordinate: [2, 2] })]),
      message([textBlock('done')], 'end_turn'),
    ])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })

    await runLoop(t.ctx, goal)

    const third = model.calls[2]?.messages ?? []
    const marked: number[] = []
    third.forEach((m, i) => {
      if (Array.isArray(m.content) && m.content.some((b) => 'cache_control' in b && b.cache_control)) marked.push(i)
    })
    expect(marked).toEqual([third.length - 1])
    expect(model.calls[2]?.system).toEqual([expect.objectContaining({ cache_control: { type: 'ephemeral' } })])
  })
})

// Removing an old screenshot removes the image only; the text next to it and the result's own
// fields stay. If the removal replaced the whole content of the tool result, a warning that came
// with the screenshot would leave the model's context with it. The worst case is invariant 4: "the
// action you approved may have happened" would go when its screenshot goes.
//
// Old screenshots leave the conversation in batches, because the prompt cache matches whole
// prefixes. One screenshot removed on every turn would change an early message on every turn, so
// the cache would write the conversation again each time, and those writes would be the largest
// part of a run's cost. Up to thirteen screenshots stay, and the fourteenth drops the oldest down
// to three in one pass. Between two passes the earlier messages go out unchanged, which is what a
// cache read needs. In these tests request k is the one sent after k model turns, counted from 0.
describe('removing old screenshots from the conversation', () => {
  const looks = (count: number) => Array.from({ length: count }, () => message([computerUse('screenshot')]))
  const note = (step: number) => `screenshot after step ${step} (removed to save context)`
  /** The messages of one captured request, without the moving cache marker. */
  const sentMessages = (model: FakeModel, call: number): Anthropic.Messages.MessageParam[] => {
    const request = model.calls[call]
    if (!request) throw new Error(`missing model request ${call}`)
    return withoutCacheMarkers(request.messages)
  }

  it('holds up to thirteen screenshots, then drops to the newest three in one pass, and does it again later', async () => {
    const screens = greys(25)
    const sent = screens.map(base64)
    const model = new FakeModel([...looks(25), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox([...screens]), now: () => 0 })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')

    expect([0, 3, 4, 13, 14, 24, 25].map((call) => imagesAt(model, call).length)).toEqual([0, 3, 4, 13, 3, 13, 3])
    expect(imagesAt(model, 13)).toEqual(sent.slice(0, 13))
    expect(imagesAt(model, 14)).toEqual([sent[11], sent[12], sent[13]])
    expect(imagesAt(model, 24)).toEqual(sent.slice(11, 24))
    expect(imagesAt(model, 25)).toEqual([sent[22], sent[23], sent[24]])
    expect(notesAt(model, 13)).toEqual([])
    expect(notesAt(model, 14)).toEqual(Array.from({ length: 11 }, (_, k) => note(k + 1)))
    expect(notesAt(model, 24)).toEqual(Array.from({ length: 11 }, (_, k) => note(k + 1)))
    expect(notesAt(model, 25)).toEqual(Array.from({ length: 22 }, (_, k) => note(k + 1)))
  })

  it('sends the earlier messages unchanged between two removals, and changes only image positions in a removal', async () => {
    const model = new FakeModel([...looks(25), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(greys(25)), now: () => 0 })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')

    // Requests 1 to 13 and 15 to 24 each begin with the whole request before them.
    const growing = [...Array.from({ length: 13 }, (_, k) => k), ...Array.from({ length: 10 }, (_, k) => k + 14)]
    for (const call of growing) {
      const older = sentMessages(model, call)
      expect(sentMessages(model, call + 1).slice(0, older.length), `request ${call + 1} begins with request ${call}`).toEqual(older)
    }
    // The two removals, before requests 14 and 25, are the only places where an earlier message changes.
    for (const call of [13, 24]) {
      const older = sentMessages(model, call)
      expect(sentMessages(model, call + 1).slice(0, older.length), `request ${call + 1} follows a removal`).not.toEqual(older)
    }

    // The removal before request 14: eleven images became notes; nothing else moved or changed.
    const before = resultsAt(model, 13)
    const after = resultsAt(model, 14)
    expect(after.slice(0, 11).map((result) => result.content)).toEqual(Array.from({ length: 11 }, (_, k) => [{ type: 'text', text: note(k + 1) }]))
    expect(withoutCacheMarkers(after.slice(11, 13))).toEqual(withoutCacheMarkers(before.slice(11, 13)))
    expect(after.slice(0, 13).map(outerFields)).toEqual(before.map(outerFields))
    const assistants = (call: number) => sentMessages(model, call).filter((m) => m.role === 'assistant')
    expect(assistants(14).slice(0, 13)).toEqual(assistants(13))
    const toolUseIds = assistants(14).flatMap((m) => (Array.isArray(m.content) ? m.content.flatMap((b) => (b.type === 'tool_use' ? [b.id] : [])) : []))
    expect(after.map((result) => result.tool_use_id)).toEqual(toolUseIds)
    expect(new Set(toolUseIds).size).toBe(14)
    // Request 13 was captured before the removal and still holds what was sent then.
    expect(imagesAt(model, 13)).toHaveLength(13)
  })

  it('counts the screenshots of one model turn together, after all of its tools ran', async () => {
    const screens = greys(17)
    const sent = screens.map(base64)
    const batch = Array.from({ length: 4 }, () => computerUse('screenshot'))
    const model = new FakeModel([...looks(13), message(batch), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox([...screens]), now: () => 0 })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')

    // Thirteen single turns, the turn with four tools, the last answer: no request went out inside the batch.
    expect(model.calls).toHaveLength(15)
    expect(imagesAt(model, 13)).toEqual(sent.slice(0, 13))
    expect(imagesAt(model, 14)).toEqual([sent[14], sent[15], sent[16]])
    expect(notesAt(model, 14)).toEqual(Array.from({ length: 14 }, (_, k) => note(k + 1)))
    expect(resultsAt(model, 14).slice(-4).map((result) => result.tool_use_id)).toEqual(batch.map((use) => use.id))
  })

  // The error path adds its screenshot at its own place in the loop, so a turn that mixes it with
  // looks and crosses the limit needs its own check.
  it('counts an error screenshot and the looks of the same turn together, and the error text outlives its image', async () => {
    const screens = greys(16)
    const sent = screens.map(base64)
    const click = computerUse('left_click', { coordinate: [10, 20] })
    const batch = [click, ...Array.from({ length: 3 }, () => computerUse('screenshot'))]
    const model = new FakeModel([...looks(12), message(batch), message([textBlock('done')], 'end_turn')])
    const sandbox = new FakeSandbox([...screens])
    // The twelve looks do not click, so the error waits for the click that opens the batch.
    sandbox.clickError = new Error('deadline exceeded')
    const t = makeContext({ store, botId, model, sandbox, now: () => 0 })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')

    // Twelve looks, then the turn with four tools, then the last answer: one request for the whole turn.
    expect(model.calls).toHaveLength(14)
    expect(imagesAt(model, 12)).toEqual(sent.slice(0, 12))
    // The error's fresh screenshot is the thirteenth image and the first look after it the fourteenth,
    // in the middle of the turn. Counted after the whole turn, sixteen drop to the three looks.
    expect(imagesAt(model, 13)).toEqual([sent[13], sent[14], sent[15]])
    expect(notesAt(model, 13)).toEqual(Array.from({ length: 13 }, (_, k) => note(k + 1)))
    expect(resultFor(model, 13, click.id).content).toEqual([{ type: 'text', text: noAnswerText('left_click') }, { type: 'text', text: note(13) }])
    expect(outerFields(resultFor(model, 13, click.id))).toEqual({ type: 'tool_result', tool_use_id: click.id, toolset_name: 'computer' })
    expect(resultsAt(model, 13).slice(-4).map((result) => result.tool_use_id)).toEqual(batch.map((use) => use.id))
  })

  it('counts error screenshots, full screenshots and zooms together, and a zoom still reads the last full screenshot', async () => {
    const submit: ElementInfo = { ...ELEMENT_TEXT_INPUT, tag: 'button', type: 'submit', name: 'Schedule Event', isSubmit: true, inForm: true }
    const green = solidPng(2, 2, [0, 255, 0])
    // Two pixels wide: the left column red, the right column blue.
    const redAndBlue = setPixel(setPixel(solidPng(2, 2, [255, 0, 0]), 1, 0, [0, 0, 255]), 1, 1, [0, 0, 255])
    const zoomLeft = () => message([computerUse('zoom', { region: [0, 0, 1, 2] })])
    const zoomRight = message([computerUse('zoom', { region: [1, 0, 2, 2] })])
    const model = new FakeModel([message([computerUse('left_click', { coordinate: [300, 400] })]), ...looks(1), ...Array.from({ length: 12 }, zoomLeft), zoomRight, message([textBlock('done')], 'end_turn')])
    // The approved click gets no answer, so its error result carries the green screen; the look after it gets the two-column one.
    const sandbox = new FakeSandbox([green, redAndBlue])
    sandbox.companion.elements = [submit]
    sandbox.clickError = new Error('deadline exceeded')
    const t = makeContext({ store, botId, model, sandbox, now: () => 0 })
    const approval = t.ctx.approvals.propose(botId, 'run-1', 0, { kind: 'book', target: 'Schedule Event', page: 'https://example.com/form' })
    t.ctx.approvals.resolve(approval.id, 'allowed')

    expect((await runLoop(t.ctx, goal)).outcome).toBe('unknown')

    // One error screenshot, one full screenshot and eleven zooms make thirteen; the twelfth zoom is the fourteenth image.
    expect(imagesAt(model, 13)).toHaveLength(13)
    expect(imagesAt(model, 13).slice(0, 2)).toEqual([base64(green), base64(redAndBlue)])
    expect(imagesAt(model, 14)).toHaveLength(3)
    expect(imagesAt(model, 14)).not.toContain(base64(redAndBlue))
    // The full screenshot has left the conversation, and the next zoom still crops it: its right
    // column is blue. A crop of the zoom before it, which is all red, would be red.
    const zoomed = decode(Buffer.from(imagesAt(model, 15).at(-1) ?? '', 'base64'))
    expect([zoomed.width, zoomed.height]).toEqual([400, 800])
    let notBlue = 0
    for (let i = 0; i < zoomed.data.length; i += 4) {
      if (zoomed.data[i] !== 0 || zoomed.data[i + 1] !== 0 || zoomed.data[i + 2] !== 255) notBlue += 1
    }
    expect(notBlue).toBe(0)
    expect(sandbox.methods().filter((m) => m === 'screenshot')).toHaveLength(2)
  })

  it('leaves the file of every screenshot on disk, whether the conversation still holds it or not', async () => {
    const screens = greys(25)
    const model = new FakeModel([...looks(25), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox([...screens]), now: () => 0 })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')

    // By the last request 22 of the 25 screenshots have left the conversation (the first test pins that).
    const hashes = t.events.flatMap((e) => (e.type === 'tool_result' && e.shot !== null ? [e.shot] : []))
    const saved = await Promise.all(hashes.map((hash) => store.readShot(botId, 'run-1', hash)))
    expect(saved.map(base64)).toEqual(screens.map(base64))
  })

  it('keeps the warning that an approved action may have happened, and replays nothing on the way', async () => {
    const submit: ElementInfo = { ...ELEMENT_TEXT_INPUT, tag: 'button', type: 'submit', name: 'Schedule Event', isSubmit: true, inForm: true }
    const gated = computerUse('left_click', { coordinate: [300, 400] })
    const model = new FakeModel([message([gated]), ...looks(25), message([textBlock('done')], 'end_turn')])
    // The first screen is the fresh screenshot that comes with the error; the next 25 are the looks.
    const sandbox = new FakeSandbox(greys(26))
    sandbox.companion.elements = [submit]
    sandbox.clickError = new Error('deadline exceeded')
    const t = makeContext({ store, botId, model, sandbox, now: () => 0 })
    const approval = t.ctx.approvals.propose(botId, 'run-1', 0, { kind: 'book', target: 'Schedule Event', page: 'https://example.com/form' })
    t.ctx.approvals.resolve(approval.id, 'allowed')

    expect((await runLoop(t.ctx, goal)).outcome).toBe('unknown')

    const warning = { type: 'text', text: noAnswerText('left_click', 'Schedule Event') }
    const before = resultFor(model, 1, gated.id)
    expect(before.content).toEqual([warning, expect.objectContaining({ type: 'image' })])
    const after = resultFor(model, 26, gated.id)
    expect(after.content).toEqual([warning, { type: 'text', text: 'screenshot after step 1 (removed to save context)' }])
    expect(outerFields(after)).toEqual({ type: 'tool_result', tool_use_id: gated.id, toolset_name: 'computer' })
    expect(outerFields(after)).toEqual(outerFields(before))
    // The approved click ran once and its approval was spent once: nothing was replayed on the way.
    expect(sandbox.methods().filter((m) => m === 'leftClick')).toHaveLength(1)
    expect(t.events.filter((e) => e.type === 'gate' && e.decision === 'consume')).toHaveLength(1)
    expect(t.ctx.approvals.get(approval.id)?.consumed).toBe(true)
  })

  it('keeps the count of presses that were sent before a repeated key failed', async () => {
    const key = computerUse('key', { text: 'Down', repeat: 5 })
    const model = new FakeModel([message([key]), ...looks(25), message([textBlock('done')], 'end_turn')])
    const sandbox = new FakeSandbox(greys(26))
    let presses = 0
    sandbox.press = async (keys) => {
      sandbox.calls.push({ method: 'press', args: [keys] })
      presses += 1
      // Not a SandboxActionError: the computer did not answer, so the result carries a fresh screenshot.
      if (presses === 3) throw new Error('deadline exceeded')
    }
    const t = makeContext({ store, botId, model, sandbox, now: () => 0 })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')

    const warning = { type: 'text', text: `${noAnswerText('key')} (2 of 5 presses were sent before this)` }
    const before = resultFor(model, 1, key.id)
    expect(before.content).toEqual([warning, expect.objectContaining({ type: 'image' })])
    const after = resultFor(model, 26, key.id)
    expect(after.content).toEqual([warning, { type: 'text', text: 'screenshot after step 1 (removed to save context)' }])
    expect(outerFields(after)).toEqual({ type: 'tool_result', tool_use_id: key.id, toolset_name: 'computer' })
    expect(sandbox.calls.filter((c) => c.method === 'press')).toHaveLength(3)
    expect(t.events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: false, summary: warning.text, shot: expect.stringMatching(/^[a-f0-9]{64}$/) })
  })

  it('keeps a no-progress warning that came with a screenshot', async () => {
    // One look, then sixteen zooms into it: zooming is not progress, so the sixteenth zoom's result
    // carries the first warning of the progress guard next to its image. 25 new screens follow.
    const zoom = () => computerUse('zoom', { region: [0, 0, 16, 16] })
    const warned = zoom()
    const zooms = [...Array.from({ length: 15 }, zoom), warned]
    const model = new FakeModel([...looks(1), ...zooms.map((use) => message([use])), ...looks(25), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(greys(26)), now: () => 0 })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')

    const warning = { type: 'text', text: noProgressText(16) }
    // Request 17 is the first that holds the sixteenth zoom's result; 42 is the last of the run.
    const before = resultFor(model, 17, warned.id)
    expect(before.content).toEqual([expect.objectContaining({ type: 'image' }), warning])
    const removed = [{ type: 'text', text: 'screenshot after step 17 (removed to save context)' }, warning]
    expect(resultFor(model, 42, warned.id).content).toEqual(removed)
    // A later removal pass does not touch the result again: no second note, the same warning.
    expect(resultFor(model, 30, warned.id).content).toEqual(removed)
    expect(outerFields(resultFor(model, 42, warned.id))).toEqual({ type: 'tool_result', tool_use_id: warned.id, toolset_name: 'computer' })
    expect(outerFields(resultFor(model, 42, warned.id))).toEqual(outerFields(before))
    expect(model.calls).toHaveLength(43)
  })
})

// A single timeout on one input command is not a reason to end a run and make the user send the
// goal again. One unanswered action becomes a result that says so, with a fresh screenshot; the run
// ends on the second in a row, or when the helper is gone.
describe('an action the computer does not answer', () => {
  const click = computerUse('left_click', { coordinate: [10, 20] })

  function errorResult(model: FakeModel, call: number): { text: string; images: number } {
    const block = lastUserContent(model, call)[0]
    if (!block || typeof block !== 'object' || !('content' in block) || !Array.isArray(block.content)) throw new Error('no tool result content')
    const text = block.content.find((b: { type: string }) => b.type === 'text')
    return { text: text && 'text' in text ? String(text.text) : '', images: block.content.filter((b: { type: string }) => b.type === 'image').length }
  }

  // The result carries no `is_error` flag, because it holds a screenshot. The API answers 400 to an
  // error result that holds anything but text ("all content must be type `text` if `is_error` is
  // true"), and the run would end as "the model provider refused the request". The fake model
  // refuses that shape as the API does, so this run only goes on with a request the API takes.
  it('gets a result that says so, with a fresh screenshot and no error flag, and the run goes on', async () => {
    const model = new FakeModel([message([click]), message([textBlock('Went on.')], 'end_turn')])
    const sandbox = new FakeSandbox()
    sandbox.clickError = new Error('deadline exceeded')
    const t = makeContext({ store, botId, model, sandbox })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'done', summary: 'Went on.' })

    expect(sandbox.methods()).toEqual(['leftClick', 'screenshot'])
    expect(outerFields(resultFor(model, 1, click.id))).toEqual({ type: 'tool_result', tool_use_id: click.id, toolset_name: 'computer' })
    expect(errorResult(model, 1)).toEqual({ text: noAnswerText('left_click'), images: 1 })
    const logged = t.events.find((e) => e.type === 'tool_result')
    expect(logged).toMatchObject({ ok: false, summary: noAnswerText('left_click'), shot: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(t.states).toEqual([])
    expect(t.chat.map((m) => m.text)).toEqual(['Went on.'])
  })

  it('the second failure in a row ends the run as before', async () => {
    const model = new FakeModel([message([click]), message([textBlock('never')], 'end_turn')])
    const sandbox = new FakeSandbox()
    sandbox.clickError = new Error('deadline exceeded')
    sandbox.screenshotError = new Error('deadline exceeded')
    const t = makeContext({ store, botId, model, sandbox })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'failed', summary: 'Error' })

    expect(sandbox.methods()).toEqual(['leftClick', 'screenshot'])
    expect(t.chat.at(-1)?.text).toMatch(/^I was doing left_click at \[10, 20\]; my computer stopped answering, so I stopped\./)
    expect((await store.readBot(botId)).state).toBe('idle')
  })

  // The fresh screenshot answered, so only the count of failures in a row can end this run.
  it('a second unanswered action right after the first ends the run, without another fresh screenshot', async () => {
    const model = new FakeModel([message([click]), message([click]), message([textBlock('never')], 'end_turn')])
    const sandbox = new FakeSandbox()
    sandbox.clickError = new Error('deadline exceeded')
    const t = makeContext({ store, botId, model, sandbox })
    const emit = t.ctx.emit
    t.ctx.emit = async (body) => {
      // The computer fails the next click too; no answered action came in between.
      if (body.type === 'step' && body.step === 2) sandbox.clickError = new Error('deadline exceeded')
      await emit(body)
    }

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'failed', summary: 'Error' })

    expect(sandbox.methods()).toEqual(['leftClick', 'screenshot', 'leftClick'])
    expect(model.calls).toHaveLength(2)
    // No action was approved in this run, so the line invites a plain retry.
    expect(t.chat.at(-1)?.text).toBe('I was doing left_click at [10, 20]; my computer stopped answering, so I stopped. Send the goal again to retry.')
  })

  it('a helper that no longer answers ends the run at the first failure, without a screenshot', async () => {
    const model = new FakeModel([message([click]), message([textBlock('never')], 'end_turn')])
    const sandbox = new FakeSandbox()
    sandbox.clickError = new Error('socket hang up')
    sandbox.companion.health = async () => ({ ok: false, cdp: false })
    const t = makeContext({ store, botId, model, sandbox })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('failed')

    expect(sandbox.methods()).toEqual(['leftClick'])
    expect(t.events.at(-1)).toMatchObject({ type: 'end', outcome: 'failed' })
  })

  it('an approved action the computer does not answer spends its approval and asks the model to propose again', async () => {
    const submit: ElementInfo = { ...ELEMENT_TEXT_INPUT, tag: 'button', type: 'submit', name: 'Schedule Event', isSubmit: true, inForm: true }
    const gated = computerUse('left_click', { coordinate: [300, 400] })
    const model = new FakeModel([message([gated]), message([gated]), message([textBlock('done')], 'end_turn')])
    const sandbox = new FakeSandbox()
    sandbox.companion.elements = [submit]
    sandbox.clickError = new Error('deadline exceeded')
    const t = makeContext({ store, botId, model, sandbox })
    const approval = t.ctx.approvals.propose(botId, 'run-1', 0, { kind: 'book', target: 'Schedule Event', page: 'https://example.com/form' })
    t.ctx.approvals.resolve(approval.id, 'allowed')
    t.decisions.push('denied')

    await runLoop(t.ctx, goal)

    // The first click ran (and got no answer); the second hit the gate again, because the approval is spent.
    expect(sandbox.methods().filter((m) => m === 'leftClick')).toHaveLength(1)
    const gates = t.events.filter((e) => e.type === 'gate')
    expect(gates.map((e) => (e.type === 'gate' ? e.decision : ''))).toEqual(['consume', 'block'])
    expect(gates[0]).toMatchObject({ approvalId: approval.id, reason: expect.stringContaining('unknown') })
    expect(t.ctx.approvals.get(approval.id)?.consumed).toBe(true)
    expect(errorResult(model, 1).text).toBe(noAnswerText('left_click', 'Schedule Event'))
    expect(errorResult(model, 1).text).toContain('propose it again')
    // The shape the API takes: text and screenshot, and no error flag (see the first test of this block).
    expect(outerFields(resultFor(model, 1, gated.id))).toEqual({ type: 'tool_result', tool_use_id: gated.id, toolset_name: 'computer' })
  })

  // The tests around this one build the expected text by calling noAnswerText itself. This one pins
  // the exact words the model reads, so a change of the wording fails a test.
  it('hands the model these exact words, with and without an approved target', () => {
    expect(noAnswerText('left_click')).toBe('left_click got no answer from the computer in time; here is a fresh screenshot, check the page and go on')
    expect(noAnswerText('left_click', 'Schedule Event')).toBe(
      'left_click got no answer from the computer in time; here is a fresh screenshot, check the page and go on. It was the action you approved ("Schedule Event"): whether it happened is unknown, so that approval is spent; if the page shows it did not happen, propose it again',
    )
  })

  // The paths that end the run spend the approval too, and the chat says that its outcome is
  // unknown. Without this the approval stays unspent and the chat invites a plain retry, although
  // the approved click may have gone through.
  describe('when it was the approved action and the run ends', () => {
    const submit: ElementInfo = { ...ELEMENT_TEXT_INPUT, tag: 'button', type: 'submit', name: 'Schedule Event', isSubmit: true, inForm: true }
    const gated = computerUse('left_click', { coordinate: [300, 400] })
    const FAILED_LINE =
      'I was doing left_click at [300, 400]; my computer stopped answering, so I stopped. You had approved "Schedule Event", and I cannot tell whether it went through: check before you send the goal again.'

    function approvedContext(model: FakeModel, sandbox: FakeSandbox): { t: TestContext; approvalId: string } {
      const t = makeContext({ store, botId, model, sandbox })
      const approval = t.ctx.approvals.propose(botId, 'run-1', 0, { kind: 'book', target: 'Schedule Event', page: 'https://example.com/form' })
      t.ctx.approvals.resolve(approval.id, 'allowed')
      return { t, approvalId: approval.id }
    }

    function expectSpentAndNamed(t: TestContext, approvalId: string): void {
      expect(t.ctx.approvals.get(approvalId)?.consumed).toBe(true)
      const consumed = t.events.filter((e) => e.type === 'gate' && e.decision === 'consume')
      expect(consumed).toEqual([expect.objectContaining({ approvalId, reason: expect.stringContaining('unknown') })])
      expect(t.events.at(-1)).toMatchObject({ type: 'end', outcome: 'unknown' })
      expect(t.chat.at(-1)?.text).toBe(FAILED_LINE)
    }

    it('spends the approval and says its outcome is unknown when the helper is gone', async () => {
      const model = new FakeModel([message([gated]), message([textBlock('never')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [submit]
      sandbox.companion.health = async () => ({ ok: false, cdp: false })
      sandbox.clickError = new Error('socket hang up')
      const { t, approvalId } = approvedContext(model, sandbox)

      // Final: an event source must not start the same goal again while the click may have happened.
      expect(await runLoop(t.ctx, goal)).toMatchObject({ outcome: 'unknown', final: true })

      expect(sandbox.methods()).toEqual(['leftClick'])
      expectSpentAndNamed(t, approvalId)
    })

    it('spends the approval and says its outcome is unknown when it is the second failure in a row', async () => {
      const model = new FakeModel([message([computerUse('left_click', { coordinate: [10, 20] })]), message([gated]), message([textBlock('never')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [ELEMENT_TEXT_INPUT, submit]
      sandbox.clickError = new Error('deadline exceeded')
      const { t, approvalId } = approvedContext(model, sandbox)
      const emit = t.ctx.emit
      t.ctx.emit = async (body) => {
        // The approved click at step 2 gets no answer either.
        if (body.type === 'step' && body.step === 2) sandbox.clickError = new Error('deadline exceeded')
        await emit(body)
      }

      await runLoop(t.ctx, goal)

      expect(sandbox.methods()).toEqual(['leftClick', 'screenshot', 'leftClick'])
      expectSpentAndNamed(t, approvalId)
    })

    it('spends the approval and says its outcome is unknown when the fresh screenshot fails too', async () => {
      const model = new FakeModel([message([gated]), message([textBlock('never')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [submit]
      sandbox.clickError = new Error('deadline exceeded')
      sandbox.screenshotError = new Error('deadline exceeded')
      const { t, approvalId } = approvedContext(model, sandbox)

      await runLoop(t.ctx, goal)

      expect(sandbox.methods()).toEqual(['leftClick', 'screenshot'])
      expectSpentAndNamed(t, approvalId)
    })

    // A click the gate stopped on a control with no accessible name is allowed with an empty
    // target, and the line must not quote an empty name.
    it('says "an action" when the approved control had no name', async () => {
      const model = new FakeModel([message([gated]), message([textBlock('never')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [{ ...submit, name: '' }]
      sandbox.companion.health = async () => ({ ok: false, cdp: false })
      sandbox.clickError = new Error('socket hang up')
      const t = makeContext({ store, botId, model, sandbox })
      // No announced approval: the gate stops the click on a card, and the user allows it once.
      t.decisions.push('allowed')

      await runLoop(t.ctx, goal)

      expect(t.events.filter((e) => e.type === 'gate').map((e) => (e.type === 'gate' ? e.decision : ''))).toEqual(['block', 'consume'])
      expect(t.chat.at(-1)?.text).toBe(
        'I was doing left_click at [300, 400]; my computer stopped answering, so I stopped. You had approved an action, and I cannot tell whether it went through: check before you send the goal again.',
      )
    })

    // The exits that end a run by an explicit decision — the answer cut off twice, the context
    // window full, a refusal — carry the same warning after an approved action got no answer in
    // the same run. Without it the chat invites a plain retry, or says nothing, about an action
    // that may have gone through.
    describe('and the run later ends on an explicit failure exit', () => {
      const WARNING = 'You had approved "Schedule Event", and I cannot tell whether it went through: check before you send the goal again.'

      /** The approved click gets no answer, the fresh screenshot does, and the run goes on to `rest`. */
      function afterUnanswered(rest: ReturnType<typeof message>[]): { t: TestContext; sandbox: FakeSandbox } {
        const model = new FakeModel([message([gated]), ...rest])
        const sandbox = new FakeSandbox()
        sandbox.companion.elements = [submit]
        sandbox.clickError = new Error('deadline exceeded')
        return { t: approvedContext(model, sandbox).t, sandbox }
      }

      it('a context window that is full ends with the warning, not with a plain retry', async () => {
        const { t } = afterUnanswered([message([textBlock('too much')], 'model_context_window_exceeded')])
        expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'unknown', summary: `context window exceeded; ${UNKNOWN_OUTCOME_SUMMARY}`, final: true })
        expect(t.chat.at(-1)?.text).toBe(`${CONTEXT_FULL_TEXT} ${WARNING}`)
      })

      it('an answer cut off inside a tool call twice ends with the warning, not with a plain retry', async () => {
        const cut = message([toolUse('remember', { note: 'x' })], 'max_tokens')
        const { t } = afterUnanswered([cut, cut])
        expect(await runLoop(t.ctx, goal)).toMatchObject({ outcome: 'unknown', final: true })
        expect(t.chat.at(-1)?.text).toBe(`${CUT_OFF_TEXT} ${WARNING}`)
      })

      it('a refusal carries the warning too, and suggests no retry', async () => {
        const { t } = afterUnanswered([message([textBlock('no')], 'refusal')])
        expect(await runLoop(t.ctx, goal)).toMatchObject({ outcome: 'unknown', final: true })
        expect(t.chat.at(-1)?.text).toBe(`${REFUSED_TEXT} ${WARNING}`)
      })

      it('without an approved action in doubt, a full context window invites a plain retry', async () => {
        const model = new FakeModel([message([textBlock('too much')], 'model_context_window_exceeded')])
        const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })
        await runLoop(t.ctx, goal)
        expect(t.chat.at(-1)?.text).toBe(`${CONTEXT_FULL_TEXT} Send the goal again to retry.`)
      })

      it('without an approved action in doubt, a refusal adds nothing', async () => {
        const model = new FakeModel([message([textBlock('no')], 'refusal')])
        const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })
        await runLoop(t.ctx, goal)
        expect(t.chat.at(-1)?.text).toBe(REFUSED_TEXT)
      })
    })
  })

  it('an answered action in between resets the count, so a later single failure is handled again', async () => {
    const model = new FakeModel([message([click]), message([computerUse('screenshot')]), message([click]), message([textBlock('ok')], 'end_turn')])
    const sandbox = new FakeSandbox()
    sandbox.clickError = new Error('deadline exceeded')
    const t = makeContext({ store, botId, model, sandbox })
    const emit = t.ctx.emit
    t.ctx.emit = async (body) => {
      // The computer fails the third action too, after the screenshot in between was answered.
      if (body.type === 'step' && body.step === 3) sandbox.clickError = new Error('deadline exceeded')
      await emit(body)
    }

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')

    expect(sandbox.methods()).toEqual(['leftClick', 'screenshot', 'screenshot', 'leftClick', 'screenshot'])
    expect(t.events.filter((e) => e.type === 'tool_result').map((e) => e.type === 'tool_result' && e.ok)).toEqual([false, true, false])
  })
})

// The user needs a way to end a run. Without Stop, a correction typed in the chat becomes the next
// goal, behind the work it means to stop.
describe('Stop', () => {
  it('a stop request ends the run before its next action, with outcome cancelled and an honest chat line', async () => {
    const model = new FakeModel([message([computerUse('screenshot'), computerUse('left_click', { coordinate: [10, 20] })])])
    const sandbox = new FakeSandbox()
    const t = makeContext({ store, botId, model, sandbox })
    const emit = t.ctx.emit
    t.ctx.emit = async (body) => {
      // The user presses Stop while the screenshot is being logged: the click after it must not run.
      if (body.type === 'tool_result' && body.name === 'screenshot') t.stop.request()
      await emit(body)
    }

    const result = await runLoop(t.ctx, goal)

    expect(result).toEqual({ outcome: 'cancelled', summary: 'stopped by the user' })
    expect(sandbox.methods()).toEqual(['screenshot'])
    expect(model.calls).toHaveLength(1)
    expect(t.chat.map((m) => m.text)).toEqual([STOPPED_TEXT])
    expect(t.states.at(-1)).toBe('idle')
    expect(t.events.at(-1)).toMatchObject({ type: 'end', outcome: 'cancelled' })
  })

  it('a stop request before the first model call ends the run without calling the model', async () => {
    const model = new FakeModel([message([textBlock('never')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })
    t.stop.request()

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'cancelled', summary: 'stopped by the user' })

    expect(model.calls).toHaveLength(0)
    expect(t.chat.map((m) => m.text)).toEqual([STOPPED_TEXT])
  })

  // Stop cancels a pending model call through the loop's stop signal. Without the signal a Stop
  // does nothing until the call returns, and a stalled stream never returns.
  it('a stop request while the model call is pending cancels the call and ends the run as cancelled', async () => {
    let reachedModel: () => void = () => undefined
    const reached = new Promise<void>((resolve) => {
      reachedModel = resolve
    })
    // Answers only when the loop's stop signal aborts it; fails at once when the loop passed none.
    const model: ModelPort = {
      create: (_params, options) =>
        new Promise((_resolve, reject) => {
          reachedModel()
          if (!options?.signal) {
            reject(new Error('the loop passed no stop signal'))
            return
          }
          options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
    }
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })

    const running = runLoop(t.ctx, goal)
    await reached
    t.stop.request()

    expect(await running).toEqual({ outcome: 'cancelled', summary: 'stopped by the user' })
    expect(t.chat.map((m) => m.text)).toEqual([STOPPED_TEXT])
    expect(t.events.filter((e) => e.type === 'cost')).toHaveLength(0)
    expect(t.states.at(-1)).toBe('idle')
    expect(t.events.at(-1)).toMatchObject({ type: 'end', outcome: 'cancelled' })
  })

  // A usage limit is a refusal that a retry cannot fix: the provider answers 400 "You have reached
  // your specified API usage limits". Without this the chat says "the model stopped answering …
  // Send the goal again to retry", and the user retries something that cannot work. A new user
  // whose key has no credit would read the same line on the first goal. The chat gets fixed words
  // only, never the provider's own text (it can carry request details).
  describe('a request the model provider refuses', () => {
    const refused = (status: number, body: string): Error => Object.assign(new Error(`${status} ${body}`), { status })
    const refusedWith = (status: number, body: string): ModelPort => ({ create: () => Promise.reject(refused(status, body)) })
    const LIMIT = '{"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC."},"request_id":"req_011Cf"}'
    const CREDIT = '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'

    it('says the usage limit is reached and that sending the goal again will not help', async () => {
      const t = makeContext({ store, botId, model: refusedWith(400, LIMIT), sandbox: new FakeSandbox() })

      expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'failed', summary: 'the model provider refused the request', final: true })

      expect(t.chat.at(-1)?.text).toBe(
        'I was doing starting; the model provider refused my request: the organisation that owns this API key has reached its usage limit. Sending the goal again will not help until that is fixed.',
      )
      expect(t.chat.at(-1)?.text).not.toMatch(/regain access|req_|invalid_request/)
      expect(t.states.at(-1)).toBe('idle')
      expect((await store.readBot(botId)).statusLine).toBe('stopped: the model provider refused the request')
    })

    it('names an account with too little credit, and a key that was not accepted', async () => {
      const credit = makeContext({ store, botId, model: refusedWith(400, CREDIT), sandbox: new FakeSandbox() })
      await runLoop(credit.ctx, goal)
      expect(credit.chat.at(-1)?.text).toContain('the model provider refused my request: the account behind this API key has too little credit. Sending the goal again will not help')
      expect(credit.chat.at(-1)?.text).not.toContain('Plans & Billing')

      const key = makeContext({ store, botId, model: refusedWith(401, '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'), sandbox: new FakeSandbox() })
      await runLoop(key.ctx, goal)
      expect(key.chat.at(-1)?.text).toContain('the model provider refused my request: the API key was not accepted. Sending the goal again will not help')
      expect(key.chat.at(-1)?.text).not.toContain('invalid x-api-key')
    })

    it('says only the status for another refusal, never the detail the provider sent', async () => {
      const t = makeContext({ store, botId, model: refusedWith(400, '{"type":"error","error":{"type":"invalid_request_error","message":"messages.3: some detail of the request"}}'), sandbox: new FakeSandbox() })
      await runLoop(t.ctx, goal)
      expect(t.chat.at(-1)?.text).toContain('the model provider refused my request: it answered with HTTP 400. Sending the goal again will not help')
      expect(t.chat.at(-1)?.text).not.toContain('some detail')
    })

    // A refusal can also arrive as an `error` event inside an open stream. The response had begun
    // with 200, so the SDK's error has the provider's error type, the body as its message, and no
    // HTTP status (model.stream.test.ts proves this shape against the SDK itself).
    // Safe: test helper that builds an error object from a fixed fixture, not from user input.
    // nosemgrep: javascript.lang.security.insecure-object-assign.insecure-object-assign
    const inStream = (body: string): Error => Object.assign(new Error(body), { status: undefined, type: (JSON.parse(body) as { error: { type: string } }).error.type })
    const refusedInStream = (body: string): ModelPort => ({ create: () => Promise.reject(inStream(body)) })
    const CREDIT_IN_STREAM =
      '{"type":"error","error":{"details":null,"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011Cf"}'

    it('reads a refusal that arrives inside an open stream, with an error type and no HTTP status', async () => {
      const credit = makeContext({ store, botId, model: refusedInStream(CREDIT_IN_STREAM), sandbox: new FakeSandbox() })

      expect(await runLoop(credit.ctx, goal)).toEqual({ outcome: 'failed', summary: 'the model provider refused the request', final: true })

      expect(credit.chat.at(-1)?.text).toBe(
        'I was doing starting; the model provider refused my request: the account behind this API key has too little credit. Sending the goal again will not help until that is fixed.',
      )
      expect(credit.chat.at(-1)?.text).not.toMatch(/Plans & Billing|req_|invalid_request|details/)
      expect(credit.states.at(-1)).toBe('idle')
      expect((await store.readBot(botId)).statusLine).toBe('stopped: the model provider refused the request')

      const limit = makeContext({ store, botId, model: refusedInStream(LIMIT), sandbox: new FakeSandbox() })
      await runLoop(limit.ctx, goal)
      expect(limit.chat.at(-1)?.text).toBe(
        'I was doing starting; the model provider refused my request: the organisation that owns this API key has reached its usage limit. Sending the goal again will not help until that is fixed.',
      )
      expect(limit.chat.at(-1)?.text).not.toMatch(/regain access|req_|invalid_request/)
    })

    // Inside a stream the SDK retries nothing, and these are the types a later try may not meet.
    it.each(['overloaded_error', 'api_error', 'rate_limit_error', 'timeout_error'])('keeps the advice to send the goal again for an error event of the type %s', async (type) => {
      const t = makeContext({ store, botId, model: refusedInStream(`{"type":"error","error":{"type":"${type}","message":"Overloaded"}}`), sandbox: new FakeSandbox() })
      expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'failed', summary: 'Error' })
      expect(t.chat.at(-1)?.text).toBe('I was doing starting; the model stopped answering, so I stopped. Send the goal again to retry.')
    })

    // The SDK retries 408, 409, 429 and 5xx itself, and a 413 belongs to a run that grew too large.
    it.each([408, 413, 429, 500, 529])('keeps the advice to send the goal again when the provider answers %i', async (status) => {
      const t = makeContext({ store, botId, model: refusedWith(status, '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'), sandbox: new FakeSandbox() })
      expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'failed', summary: 'Error' })
      expect(t.chat.at(-1)?.text).toBe('I was doing starting; the model stopped answering, so I stopped. Send the goal again to retry.')
    })

    // The provider's monthly spend cap answers 429 with the error type of a rate limit, and no
    // later try passes until the cap is lifted (Rate limits docs, "Reaching your spend cap"). The
    // body's `details.error_code` tells it from a rate limit.
    const SPEND_CAP =
      '{"type":"error","error":{"type":"rate_limit_error","message":"You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization\'s API tier. You will regain access on 2026-10-01 at 00:00 UTC.","details":{"error_code":"enforced_spend_limit_reached"}},"request_id":"req_011Cf"}'
    const RATE_LIMIT =
      '{"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed the rate limit of your organization for input tokens per minute. See the response headers for current usage, and try again later."},"request_id":"req_011Cf"}'

    it.each([
      ['as HTTP 429', (): ModelPort => refusedWith(429, SPEND_CAP)],
      ['as an error event inside an open stream', (): ModelPort => refusedInStream(SPEND_CAP)],
    ])('reads the spend cap %s as a refusal, although its error type is that of a rate limit', async (_how, model) => {
      const t = makeContext({ store, botId, model: model(), sandbox: new FakeSandbox() })

      expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'failed', summary: 'the model provider refused the request', final: true })

      expect(t.chat.at(-1)?.text).toBe(
        'I was doing starting; the model provider refused my request: the organisation that owns this API key has reached its usage limit. Sending the goal again will not help until that is fixed.',
      )
      expect(t.chat.at(-1)?.text).not.toMatch(/regain access|req_|rate_limit|enforced_spend|monthly/)
    })

    it.each([
      ['as HTTP 429', (): ModelPort => refusedWith(429, RATE_LIMIT)],
      ['as an error event inside an open stream', (): ModelPort => refusedInStream(RATE_LIMIT)],
    ])('keeps the advice to send the goal again for a rate limit %s', async (_how, model) => {
      const t = makeContext({ store, botId, model: model(), sandbox: new FakeSandbox() })
      expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'failed', summary: 'Error' })
      expect(t.chat.at(-1)?.text).toBe('I was doing starting; the model stopped answering, so I stopped. Send the goal again to retry.')
    })

    // The provider answers 400 with "prompt is too long" when the input alone exceeds the model's
    // context window (Context windows docs, "Context window overflow behavior"). It is this run's
    // conversation that grew too long, and a new run starts with a short one, as after a 413.
    const TOO_LONG = '{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 1000212 tokens > 1000000 maximum"},"request_id":"req_011Cf"}'

    it.each([
      ['as HTTP 400', (): ModelPort => refusedWith(400, TOO_LONG)],
      ['as an error event inside an open stream', (): ModelPort => refusedInStream(TOO_LONG)],
    ])('keeps the advice to send the goal again for a conversation that outgrew the context window, %s', async (_how, model) => {
      const t = makeContext({ store, botId, model: model(), sandbox: new FakeSandbox() })
      expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'failed', summary: 'Error' })
      expect(t.chat.at(-1)?.text).toBe('I was doing starting; the model stopped answering, so I stopped. Send the goal again to retry.')
    })

    // The words are for the model provider only. A failure of the bot's computer that carries an HTTP
    // status must keep its own line: "the API key was not accepted" would point the user at the wrong key.
    it('does not read a failure of the computer with an HTTP status as a refusal by the model provider', async () => {
      const model = new FakeModel([message([computerUse('left_click', { coordinate: [10, 20] })]), message([textBlock('never')], 'end_turn')])
      const sandbox = new FakeSandbox()
      sandbox.clickError = Object.assign(new Error('the sandbox session expired'), { status: 401 })
      sandbox.companion.health = async () => ({ ok: false, cdp: false })
      const t = makeContext({ store, botId, model, sandbox })

      expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'failed', summary: 'Error' })

      expect(t.chat.at(-1)?.text).toMatch(/^I was doing left_click at \[10, 20\]; my computer stopped answering, so I stopped\./)
      expect(t.chat.at(-1)?.text).not.toContain('the model provider refused')
    })

    // An approved click that got no answer, then a refusal: the user still hears that the approved
    // action may have gone through (invariant 4), next to the reason a retry will not help.
    it('keeps the warning about an approved action whose outcome is unknown', async () => {
      const submit: ElementInfo = { ...ELEMENT_TEXT_INPUT, tag: 'button', type: 'submit', name: 'Schedule Event', isSubmit: true, inForm: true }
      let calls = 0
      const model: ModelPort = {
        create: () => {
          calls += 1
          return calls === 1 ? Promise.resolve(message([computerUse('left_click', { coordinate: [300, 400] })])) : Promise.reject(refused(400, LIMIT))
        },
      }
      const sandbox = new FakeSandbox()
      sandbox.companion.elements = [submit]
      sandbox.clickError = new Error('deadline exceeded')
      const t = makeContext({ store, botId, model, sandbox })
      const approval = t.ctx.approvals.propose(botId, 'run-1', 0, { kind: 'book', target: 'Schedule Event', page: 'https://example.com/form' })
      t.ctx.approvals.resolve(approval.id, 'allowed')

      await runLoop(t.ctx, goal)

      expect(t.ctx.approvals.get(approval.id)?.consumed).toBe(true)
      expect(t.chat.at(-1)?.text).toBe(
        'I was doing left_click at [300, 400]; the model provider refused my request: the organisation that owns this API key has reached its usage limit. Sending the goal again will not help until that is fixed. You had approved "Schedule Event", and I cannot tell whether it went through: check before you send the goal again.',
      )
    })
  })

  describe('providerRefusal', () => {
    // The last two are the SDK's shapes for a call that got no answer and for an error event whose
    // body was not JSON: a status that is undefined and a type that is null.
    it.each([undefined, null, 'oops', 42, {}, { status: '400' }, new Error('no status'), { type: 400 }, Object.assign(new Error('Connection error.'), { status: undefined, type: null }), Object.assign(new Error('"not json"'), { status: undefined, type: null })])(
      'is no refusal for an error with neither a numeric status nor an error type (%s)',
      (e) => {
        expect(providerRefusal(e)).toBeNull()
      },
    )

    it('names a key without permission, and a model id the key cannot use', () => {
      expect(providerRefusal(Object.assign(new Error('403 {"type":"error"}'), { status: 403 }))).toBe('the API key has no permission for this request')
      expect(providerRefusal(Object.assign(new Error('404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-typo"}}'), { status: 404 }))).toBe(
        'the configured MODEL_ID is not a model this API key can use',
      )
    })

    // An error event inside an open stream: the provider's error type, the body as the message, no status.
    const eventOf = (type: string, message: string): Error => Object.assign(new Error(JSON.stringify({ type: 'error', error: { details: null, type, message }, request_id: 'req_011Cf' })), { status: undefined, type })

    // Without a status, the error type is read as the status it stands for, so the words are the same.
    it.each([
      ['invalid_request_error', 'Your credit balance is too low to access the Anthropic API.', 'the account behind this API key has too little credit'],
      ['invalid_request_error', 'You have reached your specified API usage limits.', 'the organisation that owns this API key has reached its usage limit'],
      ['authentication_error', 'invalid x-api-key', 'the API key was not accepted'],
      ['permission_error', 'not allowed', 'the API key has no permission for this request'],
      ['not_found_error', 'model: claude-typo', 'the configured MODEL_ID is not a model this API key can use'],
    ])('without a status, an error event of the type %s that says "%s" reads as: %s', (type, message, words) => {
      expect(providerRefusal(eventOf(type, message))).toBe(words)
    })

    it.each([
      ['invalid_request_error', 'it answered with an error of the type invalid_request_error'],
      ['billing_error', 'it answered with an error of the type billing_error'],
    ])('without a status, says only the error type for another refusal (%s), never the detail the provider sent', (type, words) => {
      expect(providerRefusal(eventOf(type, 'messages.3: some detail of the request'))).toBe(words)
    })

    it.each(['overloaded_error', 'api_error', 'rate_limit_error', 'timeout_error', 'request_too_large', 'conflict_error'])('is no refusal for an error event of the type %s: a later try may pass', (type) => {
      expect(providerRefusal(eventOf(type, 'Overloaded'))).toBeNull()
    })

    // The provider's list of types may grow. A type this platform does not know says nothing about
    // whether a retry can help, and it is the provider's text, so it never reaches the chat.
    it.each(['some_new_error', 'constructor', 'toString', ''])('is no refusal for an error event of a type it does not know (%s)', (type) => {
      expect(providerRefusal(eventOf(type, 'Your credit balance is too low'))).toBeNull()
    })

    // The provider names the code as the way to tell its spend cap from a rate limit, so the code
    // is enough when the sentence next to it changes.
    it('reads the spend cap by its code alone, with a status of 429 and with no status', () => {
      const body = '{"type":"error","error":{"type":"rate_limit_error","message":"Access is paused until next month.","details":{"error_code":"enforced_spend_limit_reached"}}}'
      expect(providerRefusal(Object.assign(new Error(`429 ${body}`), { status: 429, type: 'rate_limit_error' }))).toBe('the organisation that owns this API key has reached its usage limit')
      expect(providerRefusal(Object.assign(new Error(body), { status: undefined, type: 'rate_limit_error' }))).toBe('the organisation that owns this API key has reached its usage limit')
    })

    it('a usage limit in the words of an error with neither an error status nor a known type is still no refusal', () => {
      expect(providerRefusal(new Error('You have reached your API usage limits'))).toBeNull()
      expect(providerRefusal(eventOf('some_new_error', 'You have reached your API usage limits'))).toBeNull()
    })

    it('an HTTP error status decides before the error type does', () => {
      expect(providerRefusal(Object.assign(new Error('529 {"type":"error"}'), { status: 529, type: 'invalid_request_error' }))).toBeNull()
      expect(providerRefusal(Object.assign(new Error('400 {"type":"error"}'), { status: 400, type: 'overloaded_error' }))).toBe('it answered with HTTP 400')
    })

    // The stream of an error event began with 200. A status that is not an error status says
    // nothing about the failure, so the type decides there too.
    it('a status below 400 does not stop the error type from being read', () => {
      expect(providerRefusal(Object.assign(eventOf('invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'), { status: 200 }))).toBe('the account behind this API key has too little credit')
      expect(providerRefusal(Object.assign(eventOf('overloaded_error', 'Overloaded'), { status: 200 }))).toBeNull()
      expect(providerRefusal(Object.assign(new Error('a redirect'), { status: 302 }))).toBeNull()
    })
  })

  // The shape of a call that could not reach the provider: the SDK's error, then fetch's, then the
  // system error with the code. The log names that chain by name and code, so the operator can tell
  // a refused connection from a name that does not resolve; the chat keeps its own words.
  it('a model call that cannot connect logs its causes by name and code, and the chat keeps the advice to retry', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 203.0.113.7:443'), { code: 'ECONNREFUSED' })
    const unreachable = Object.assign(new Error('Connection error.', { cause: new TypeError('fetch failed', { cause: refused }) }), { status: undefined, type: null })
    const logged = vi.spyOn(log, 'error').mockImplementation(() => undefined)
    const t = makeContext({ store, botId, model: { create: () => Promise.reject(unreachable) }, sandbox: new FakeSandbox() })

    try {
      expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'failed', summary: 'Error' })

      expect(logged).toHaveBeenCalledWith('run failed', expect.objectContaining({ phase: 'model', errorMessage: 'Connection error.', errorCauses: ['TypeError', 'Error ECONNREFUSED'] }))
      expect(JSON.stringify(logged.mock.calls)).not.toContain('203.0.113.7')
    } finally {
      logged.mockRestore()
    }
    expect(t.chat.at(-1)?.text).toBe('I was doing starting; the model stopped answering, so I stopped. Send the goal again to retry.')
  })

  it('a model call that fails with no stop pending ends the run as failed, not as a stop', async () => {
    const model: ModelPort = {
      create: () => Promise.reject(Object.assign(new Error('no event from the model for 120 s'), { name: 'ModelStalledError' })),
    }
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'failed', summary: 'ModelStalledError' })

    expect(t.chat.at(-1)?.text).toMatch(/^I was doing starting; the model stopped answering, so I stopped\./)
    expect(t.chat.map((m) => m.text)).not.toContain(STOPPED_TEXT)
    expect(t.states.at(-1)).toBe('idle')
  })

  it('a stop request between two platform tool calls of one turn refuses the second before it runs', async () => {
    const model = new FakeModel([message([toolUse('remember', { note: 'first' }), toolUse('remember', { note: 'second' })])])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: basePlatformTools })
    const emit = t.ctx.emit
    t.ctx.emit = async (body) => {
      // The user presses Stop while the first note is being logged: the second must not be written.
      if (body.type === 'tool_result' && body.name === 'remember' && body.ok) t.stop.request()
      await emit(body)
    }

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'cancelled', summary: 'stopped by the user' })

    expect(await store.readMemory(botId)).toMatch(/first/)
    expect(await store.readMemory(botId)).not.toMatch(/second/)
    expect(t.events.filter((e) => e.type === 'tool_result').map((e) => e.type === 'tool_result' && e.ok)).toEqual([true, false])
    expect(model.calls).toHaveLength(1)
  })

  it('Stop wins over the stuck detector when both land on the same turn', async () => {
    const model = new FakeModel([message([computerUse('screenshot')]), message([computerUse('screenshot')]), message([computerUse('screenshot')])])
    const sandbox = new FakeSandbox([solidPng(32, 32, [0, 0, 0])])
    const clock = { now: 0 }
    sandbox.clock = clock
    sandbox.screenshotMs = 20_000
    const t = makeContext({ store, botId, model, sandbox, now: () => clock.now })
    const emit = t.ctx.emit
    let shots = 0
    t.ctx.emit = async (body) => {
      // The third identical screenshot is what the stuck detector counts; Stop lands on the same turn.
      if (body.type === 'tool_result' && body.name === 'screenshot' && (shots += 1) === 3) t.stop.request()
      await emit(body)
    }

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'cancelled', summary: 'stopped by the user' })

    expect(t.states.at(-1)).toBe('idle')
    expect(t.chat.map((m) => m.card?.card ?? m.text)).toEqual([STOPPED_TEXT])
  })
})

describe('thinking continuity', () => {
  it('returns complete assistant blocks unchanged across tool results and screenshot pruning', async () => {
    const first = message([
      { type: 'thinking', thinking: 'Compare the records. '.repeat(300), signature: 'test-signature-visible' },
      { type: 'redacted_thinking', data: 'test-redacted-data' },
      textBlock('The first record is cancelled.'),
      computerUse('screenshot'),
    ])
    const second = message([
      { type: 'thinking', thinking: '', signature: 'test-signature-omitted' },
      computerUse('screenshot'),
    ])
    const original = structuredClone([first.content, second.content])
    // Fourteen screenshots in all: the fourteenth is the one that makes the loop remove images.
    const more = Array.from({ length: 12 }, () => message([computerUse('screenshot')]))
    const model = new FakeModel([first, second, ...more, message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(greys(14)), now: () => 0 })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')

    expect(model.calls[1]?.messages[1]?.content).toEqual(original[0])
    // The last request was built after the removal: three images are left and eleven notes stand in.
    expect(imagesAt(model, 14)).toHaveLength(3)
    expect(notesAt(model, 14)).toHaveLength(11)
    const finalAssistants = model.calls[14]?.messages.filter((m) => m.role === 'assistant')
    expect(finalAssistants?.slice(0, 2).map((m) => m.content)).toEqual(original)
    expect([first.content, second.content]).toEqual(original)
  })

  it('requests adaptive thinking summaries on each model call', async () => {
    const model = new FakeModel([message([computerUse('screenshot')]), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })

    await runLoop(t.ctx, goal)

    expect(model.calls.map((c) => c.thinking)).toEqual([{ type: 'adaptive', display: 'summarized' }, { type: 'adaptive', display: 'summarized' }])
  })

  it.each([4000, 4001])('bounds a %s-character thinking summary in the saved log', async (length) => {
    const res = message([{ type: 'thinking', thinking: 'x'.repeat(length), signature: 'test-signature' }, textBlock('done')], 'end_turn')
    const t = makeContext({ store, botId, model: new FakeModel([res]), sandbox: new FakeSandbox() })

    await runLoop(t.ctx, goal)

    const cost = (await store.readRunEvents(botId, 'run-1')).find((e) => e.type === 'cost')
    expect(cost?.response).toMatchObject({ call: 1, step: 0, maxTokens: 16000, blockTypes: ['thinking', 'text'], thinkingSummaryTruncated: length === 4001, textChars: 4 })
    expect(cost?.response?.thinkingSummary).toBe('x'.repeat(4000))
  })

  it('keeps signed data out of saved logs and thinking out of chat', async () => {
    const res = message([
      { type: 'thinking', thinking: 'Compare the records.', signature: 'test-signature-visible' },
      { type: 'redacted_thinking', data: 'test-redacted-data' },
      textBlock('done'),
    ], 'end_turn')
    const model = new FakeModel([res])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })

    await runLoop(t.ctx, goal)

    const saved = await store.readRunEvents(botId, 'run-1')
    expect(JSON.stringify(saved)).not.toContain('test-signature')
    expect(JSON.stringify(saved)).not.toContain('test-redacted-data')
    expect(t.chat.map((m) => m.text)).toEqual(['done'])
  })

  it.each([null, 0, 87])('records the API thinking-token count (%s), including absent and zero values', async (tokens) => {
    const res = message([textBlock('done')], 'end_turn')
    res.usage.output_tokens_details = tokens === null ? null : { thinking_tokens: tokens }
    const t = makeContext({ store, botId, model: new FakeModel([res]), sandbox: new FakeSandbox() })

    await runLoop(t.ctx, goal)

    const cost = (await store.readRunEvents(botId, 'run-1')).find((e) => e.type === 'cost')
    expect(cost?.response).toMatchObject({ thinkingTokens: tokens, stopReason: 'end_turn', discarded: false, thinkingSummary: '', thinkingSummaryTruncated: false, textChars: 4 })
  })
})

// A response cut inside a tool call is retried, never executed with incomplete arguments.
describe('max_tokens', () => {
  it('a cut inside a tool call is retried with a higher limit, and the cut call never runs', async () => {
    const model = new FakeModel([message([{ type: 'thinking', thinking: 'Record the cancellation.', signature: 'test-cut-signature' }, toolUse('remember', { note: 'half a no' })], 'max_tokens'), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: basePlatformTools })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'done', summary: 'done' })

    expect(model.calls.map((c) => c.max_tokens)).toEqual([16000, 32000])
    // The cut response was not added: the retry carries the goal alone, no tool call without a result.
    expect(model.calls[1]?.messages).toHaveLength(1)
    expect(await store.readMemory(botId)).toBe('')
    const costs = (await store.readRunEvents(botId, 'run-1')).filter((e) => e.type === 'cost')
    expect(costs[0]?.response).toMatchObject({ call: 1, maxTokens: 16000, stopReason: 'max_tokens', discarded: true, thinkingSummary: 'Record the cancellation.', toolNames: ['remember'] })
    expect(JSON.stringify(costs)).not.toContain('test-cut-signature')
  })

  it('a second cut inside a tool call ends the run honestly', async () => {
    const model = new FakeModel([message([toolUse('remember', { note: 'x' })], 'max_tokens'), message([toolUse('remember', { note: 'x' })], 'max_tokens')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: basePlatformTools })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'failed', summary: 'the model answer was cut off inside a tool call twice', final: true })

    expect(t.chat.map((m) => m.text)).toEqual([`${CUT_OFF_TEXT} Send the goal again to retry.`])
    expect(await store.readMemory(botId)).toBe('')
    const costs = (await store.readRunEvents(botId, 'run-1')).filter((e) => e.type === 'cost')
    expect(costs.map((e) => e.response?.discarded)).toEqual([true, true])
    expect(costs.map((e) => e.response?.stopReason)).toEqual(['max_tokens', 'max_tokens'])
  })

  // A text answer cut by the output cap must reach the user. Without the post, the cut part goes
  // into the model's context and only the final response's text reaches the chat, so the user sees
  // only the end of a long answer. Every part the user was going to read is posted when it arrives:
  // in order, once, and kept if the continuation fails.
  it('a cut in plain text is continued, and both parts reach the chat in order', async () => {
    const model = new FakeModel([message([textBlock('part one')], 'max_tokens'), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'done', summary: 'done' })

    expect(t.chat.map((m) => m.text)).toEqual(['part one', 'done'])
    expect((await store.readChat(botId, { limit: 10 })).filter((m) => m.role === 'bot').map((m) => m.text)).toEqual(['part one', 'done'])
    expect(model.calls[1]?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(model.calls.map((c) => c.max_tokens)).toEqual([16000, 16000])
    const cost = (await store.readRunEvents(botId, 'run-1')).find((e) => e.type === 'cost')
    expect(cost?.response).toMatchObject({ stopReason: 'max_tokens', discarded: false, textChars: 'part one'.length })
  })

  it('two cuts in a row deliver three parts, each once and in order', async () => {
    const model = new FakeModel([message([textBlock('one')], 'max_tokens'), message([textBlock('two')], 'max_tokens'), message([textBlock('three')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'done', summary: 'three' })

    expect(t.chat.map((m) => m.text)).toEqual(['one', 'two', 'three'])
    expect(model.calls[2]?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
  })

  it('a cut followed by a tool call keeps the first part in the chat, and the tool runs', async () => {
    const model = new FakeModel([message([textBlock('part one')], 'max_tokens'), message([toolUse('remember', { note: 'the note' })]), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: basePlatformTools })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'done', summary: 'done' })

    expect(t.chat.map((m) => m.text)).toEqual(['part one', 'done'])
    expect(await store.readMemory(botId)).toContain('the note')
  })

  it('a cut inside thinking, with no text yet, posts nothing and continues', async () => {
    const model = new FakeModel([message([{ type: 'thinking', thinking: 'Still sorting the mail.', signature: 'test-cut-signature' }], 'max_tokens'), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'done', summary: 'done' })

    expect(t.chat.map((m) => m.text)).toEqual(['done'])
    expect(JSON.stringify(t.chat)).not.toContain('test-cut-signature')
  })

  it('a cut response that carries thinking posts only its text', async () => {
    const model = new FakeModel([message([{ type: 'thinking', thinking: 'Half a thought.', signature: 'test-cut-signature' }, textBlock('part one')], 'max_tokens'), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'done', summary: 'done' })

    expect(t.chat.map((m) => m.text)).toEqual(['part one', 'done'])
    expect(JSON.stringify(t.chat)).not.toContain('Half a thought')
    expect(JSON.stringify(t.chat)).not.toContain('test-cut-signature')
  })

  it('a cut whose continuation fails keeps the first part in the chat, before the failure line', async () => {
    const model = new FakeModel([message([textBlock('part one')], 'max_tokens')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('failed')

    expect(t.chat).toHaveLength(2)
    expect(t.chat[0]?.text).toBe('part one')
  })
})

// Learning a job through conversation crosses the tools, the store and the system prompt. This
// test checks that those parts connect, with a scripted model: the interview answer lands in
// memory, the job runs, the skill is saved on the user's yes with no routine, a new store on the
// same folder (a restart) hands the skill to the next run, and a correction replaces it under the
// same name.
describe('learning a job through conversation', () => {
  const skill = { name: 'node-blog-note', description: 'A note on what is new on the Node.js blog', body: 'Read https://nodejs.org/en/blog with fetch_url. Write the three newest posts as an artifact named node-blog-note.md.\n' }

  function systemText(model: FakeModel, call: number): string {
    const system = model.calls[call]?.system
    return Array.isArray(system) ? system.map((b) => b.text).join('\n') : String(system ?? '')
  }

  it('saves the skill the conversation produced, gives it to the next run after a restart, and keeps a correction under the same name', async () => {
    const first = new FakeModel([
      message([toolUse('ask_user', { question: 'Where should the note go: in the chat, or as a document?' })]),
      message([toolUse('remember', { note: 'Deliverable: the note as an artifact named node-blog-note.md' })]),
      message([toolUse('write_artifact', { name: 'node-blog-note.md', content: 'Three posts.' })]),
      message([toolUse('ask_user', { question: 'Do you want me to save the way I did this, so you can ask for it again?' })]),
      message([toolUse('save_skill', skill)]),
      message([textBlock('Saved.')], 'end_turn'),
    ])
    const t = makeContext({ store, botId, model: first, sandbox: new FakeSandbox(), tools: basePlatformTools })
    t.userAnswers.push('as a document', 'yes')

    expect(await runLoop(t.ctx, { goal: 'Tell me what is new on the Node.js blog.', activeSkill: null, source: 'message' })).toEqual({ outcome: 'done', summary: 'Saved.' })

    expect(systemText(first, 0)).toContain('(none yet)')
    expect(await readFile(join(dataDir, botId, 'memory.md'), 'utf8')).toMatch(/Deliverable: the note as an artifact named node-blog-note.md\n$/)
    expect(await store.readSkill(botId, 'node-blog-note')).toEqual(skill)
    expect(await store.listRoutines(botId)).toEqual([])
    expect(t.chat.filter((m) => m.card?.card === 'skill')).toHaveLength(1)
    // The user's answers were answered in order: the deliverable question first, then the offer.
    expect(t.chat.filter((m) => m.role === 'bot').map((m) => m.text)).toEqual([
      'Where should the note go: in the chat, or as a document?',
      'Do you want me to save the way I did this, so you can ask for it again?',
      'Saved.',
    ])

    // A restart: a new store over the same folder, and nothing in memory carried over.
    const restarted = createStore(dataDir)
    await restarted.startRun(botId, 'run-2')
    const second = new FakeModel([message([toolUse('write_artifact', { name: 'node-blog-note.md', content: 'Three newer posts.' })]), message([textBlock('Done again.')], 'end_turn')])
    const again = makeContext({ store: restarted, botId, model: second, sandbox: new FakeSandbox(), tools: basePlatformTools, runId: 'run-2' })

    expect(await runLoop(again.ctx, { goal: 'Do the Node.js blog note again.', activeSkill: null, source: 'message' })).toEqual({ outcome: 'done', summary: 'Done again.' })

    const prompt = systemText(second, 0)
    expect(prompt).toContain('### node-blog-note\n')
    expect(prompt).toContain(skill.body.trim())
    expect(prompt).toContain('Deliverable: the note as an artifact named node-blog-note.md')
    expect(prompt).not.toContain('(none yet)')
    expect(await restarted.readArtifact(botId, 'node-blog-note.md')).toBe('Three newer posts.')

    // A correction: the same name, a changed body; the old body is gone from the next prompt.
    await restarted.startRun(botId, 'run-3')
    const corrected = { ...skill, body: skill.body.replace('three newest posts', 'three newest posts, each with its link,') }
    const third = new FakeModel([message([toolUse('save_skill', corrected)]), message([textBlock('Changed: each post now carries its link.')], 'end_turn')])
    const fix = makeContext({ store: restarted, botId, model: third, sandbox: new FakeSandbox(), tools: basePlatformTools, runId: 'run-3' })
    expect((await runLoop(fix.ctx, { goal: 'Next time include the link to each post.', activeSkill: null, source: 'message' })).outcome).toBe('done')
    expect(lastUserContent(third, 1)[0]).toMatchObject({ type: 'tool_result', content: 'updated skill node-blog-note' })
    expect(await restarted.readSkill(botId, 'node-blog-note')).toEqual(corrected)
    expect((await restarted.listSkills(botId)).map((s) => s.name)).toEqual(['node-blog-note'])

    await restarted.startRun(botId, 'run-4')
    const fourth = new FakeModel([message([textBlock('ok')], 'end_turn')])
    const after = makeContext({ store: restarted, botId, model: fourth, sandbox: new FakeSandbox(), tools: basePlatformTools, runId: 'run-4' })
    await runLoop(after.ctx, { goal: 'Do it again.', activeSkill: null, source: 'message' })
    expect(systemText(fourth, 0)).toContain('each with its link')
    expect(systemText(fourth, 0)).not.toContain(skill.body.trim())
  })
})

// A run starts with the last chat lines before the goal, not with the goal alone. Without them,
// "yes" after the skill offer and "make that letter shorter" reach the model without the lines they
// answer.
describe('continuity', () => {
  function firstUserText(model: FakeModel): string {
    const content = model.calls[0]?.messages[0]?.content
    if (typeof content === 'string') return content
    const block = Array.isArray(content) ? content[0] : undefined
    return block && block.type === 'text' ? block.text : ''
  }

  // 22:30 UTC on the 18th is 00:30 on the 19th on the routines' clock: the date the model is told
  // must be the local one.
  const startedAt = Date.parse('2026-09-18T22:30:00.000Z')
  const clockLine = 'Platform clock: this run started on Saturday, 19 September 2026 at 00:30 (Europe/Prague).'

  it('the last chat lines before the goal reach the model, cards left out, the goal sent once', async () => {
    await store.appendChat(botId, { role: 'user', text: 'Prepare a letter for Acme' })
    await store.appendChat(botId, { role: 'card', card: { card: 'artifact', name: 'letter-acme.md', preview: 'Dear', path: 'x' } })
    await store.appendChat(botId, { role: 'bot', text: 'I saved letter-acme.md. Do you want it shorter?' })
    await store.appendChat(botId, { role: 'user', text: 'make that letter shorter' })
    const model = new FakeModel([message([textBlock('Shortened.')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), now: () => startedAt })

    await runLoop(t.ctx, { goal: 'make that letter shorter', activeSkill: null, source: 'message' })

    expect(firstUserText(model)).toBe(
      `${clockLine}\n\nRecent conversation, newest last (context only):\nuser: Prepare a letter for Acme\nTester: I saved letter-acme.md. Do you want it shorter?\n\nGoal: make that letter shorter`,
    )
  })

  // The model has no clock of its own. Without the clock line no message carries a date, so a bot
  // whose newest memory note is a day old takes that day for today: it dates its questions and its
  // memory lines with it.
  it('a fresh chat sends the platform clock and the goal: the model is told the date of the run', async () => {
    const model = new FakeModel([message([textBlock('ok')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), now: () => startedAt })
    await runLoop(t.ctx, goal)
    expect(firstUserText(model)).toBe(`${clockLine}\n\nGoal: do the thing`)
  })

  it('the clock line is the same in every model call of a run, whatever the clock says later', async () => {
    // Every reading of this clock is 26 hours after the one before it, so a first message that was
    // built again for the second model call would name another day (and would miss the prompt cache).
    let reading = startedAt - 26 * 60 * 60_000
    const model = new FakeModel([message([toolUse('remember', { note: 'a fact worth keeping' })]), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: basePlatformTools, now: () => (reading += 26 * 60 * 60_000) })
    await runLoop(t.ctx, goal)

    expect(model.calls).toHaveLength(2)
    const texts = model.calls.map((call) => {
      const content = call.messages[0]?.content
      if (typeof content === 'string') return content
      const block = Array.isArray(content) ? content[0] : undefined
      return block && block.type === 'text' ? block.text : ''
    })
    expect(texts[0]).toBe(`${clockLine}\n\nGoal: do the thing`)
    expect(texts[1]).toBe(texts[0])
  })

  it('read_artifact returns a saved artifact and names the artifacts when the name is unknown', async () => {
    const t = makeContext({ store, botId, model: new FakeModel([]), sandbox: new FakeSandbox() })
    await store.writeArtifact(botId, 'letter-acme.md', 'Dear Acme,\n\nI write to you.')

    expect(await readArtifact.run({ name: 'letter-acme.md' }, t.ctx)).toBe('Dear Acme,\n\nI write to you.')
    expect(await runPlatformTool(readArtifact, { name: 'letter-nope.md' }, t.ctx)).toEqual({ text: 'there is no artifact named letter-nope.md; the artifacts are: letter-acme.md', isError: true })
    // Refused by the name rule, not merely missing on disk.
    expect(await runPlatformTool(readArtifact, { name: '../secret.md' }, t.ctx)).toEqual({ text: expect.stringContaining('invalid input for read_artifact: name:'), isError: true })
  })
})

// A run can end one step after an approved click, before the bot sees the result, so the bot writes
// no memory line and the next run finds a result it cannot explain. For that reason the model hears
// how many steps remain, and the budget card names the action.
describe('the step budget', () => {
  it('tells the model how many steps are left once few remain, and ends over budget at the cap', async () => {
    // Every click lands somewhere new, so the run makes progress right up to the cap.
    const model = new FakeModel(Array.from({ length: STEP_BUDGET + 2 }, (_, i) => message([computerUse('left_click', { coordinate: [10 + (i % 60) * 20, 10 + Math.floor(i / 60) * 20] })])))
    const sandbox = new FakeSandbox([solidPng(16, 16, [0, 0, 0])])
    const t = makeContext({ store, botId, model, sandbox })

    const result = await runLoop(t.ctx, goal)

    expect(result.outcome).toBe('budget')
    expect(result.summary).toBe(budgetEndText(`I used all ${STEP_BUDGET} computer steps without finishing, so I stopped.`, null, STEP_BUDGET))
    expect(model.calls).toHaveLength(STEP_BUDGET)
    const notice = (call: number): string[] => {
      const last = model.calls[call]?.messages.at(-1)?.content
      if (!Array.isArray(last)) return []
      return last.flatMap((b) => (typeof b !== 'string' && b.type === 'text' && b.text.includes('computer steps left') ? [b.text] : []))
    }
    // After step 135 of 150, the results carry the notice; one step earlier they do not.
    expect(notice(STEP_BUDGET - STEPS_LEFT_NOTICE - 1)).toEqual([])
    expect(notice(STEP_BUDGET - STEPS_LEFT_NOTICE)).toEqual([stepsLeftText(STEPS_LEFT_NOTICE)])
    expect(notice(STEP_BUDGET - 1)).toEqual([stepsLeftText(1)])
    expect(t.chat.at(-1)?.card).toMatchObject({ card: 'takeover', status: 'active' })
  })

  it('names on the budget card an approved action that the computer did at the last step', async () => {
    const confirm: ElementInfo = { ...ELEMENT_TEXT_INPUT, tag: 'button', type: 'submit', name: 'Confirm', isSubmit: true, inForm: true }
    const model = new FakeModel(Array.from({ length: STEP_BUDGET + 2 }, (_, i) => message([computerUse('left_click', { coordinate: [10 + (i % 60) * 20, 10 + Math.floor(i / 60) * 20] })])))
    const sandbox = new FakeSandbox([solidPng(16, 16, [0, 0, 0])])
    // Every click but the last lands on a plain field; the last one lands on a control the gate stops.
    sandbox.companion.elements = [...Array.from({ length: STEP_BUDGET - 1 }, () => ELEMENT_TEXT_INPUT), confirm]
    const t = makeContext({ store, botId, model, sandbox })
    t.decisions.push('allowed')

    const result = await runLoop(t.ctx, goal)

    expect(result.outcome).toBe('budget')
    expect(sandbox.methods().filter((m) => m === 'leftClick')).toHaveLength(STEP_BUDGET)
    expect(t.events.filter((e) => e.type === 'gate' && e.decision === 'consume')).toEqual([expect.objectContaining({ step: STEP_BUDGET, reason: 'allowed once by the user' })])
    expect(result.summary).toBe(budgetEndText(`I used all ${STEP_BUDGET} computer steps without finishing, so I stopped.`, { target: 'Confirm', step: STEP_BUDGET }, STEP_BUDGET))
    expect(t.chat.at(-1)?.card).toMatchObject({ card: 'takeover', status: 'active', reason: expect.stringContaining('My last action was the approved "Confirm", and I did not see its result') })
  })

  it('names an approved action done in the last two steps on the budget card, and nothing older', () => {
    const first = 'I used all 150 computer steps without finishing, so I stopped.'
    expect(budgetEndText(first, null, 150)).toBe(`${first} Take over to finish on my screen, then hand back and send me the next goal.`)
    expect(budgetEndText(first, { target: 'Confirm', step: 150 }, 150)).toContain('My last action was the approved "Confirm", and I did not see its result')
    expect(budgetEndText(first, { target: 'Confirm', step: 148 }, 150)).toContain('My last action was the approved "Confirm"')
    expect(budgetEndText(first, { target: 'Confirm', step: 147 }, 150)).not.toContain('My last action')
    expect(budgetEndText(first, { target: '', step: 150 }, 150)).toContain('My last action was the action you approved')
  })
})

// A loop the screenshot detector cannot see: the model goes back and forth between a list and its
// items for up to a hundred steps, and every click changes the screen, so that detector never
// fires. The guard measures the loop itself: steps with nothing new and nothing recorded.
describe('the progress guard', () => {
  it('warns the model after sixteen steps without progress and ends the run stuck at forty', async () => {
    // Two places, then the same two for ever: after the first two clicks nothing is new.
    const clicks = Array.from({ length: NO_PROGRESS_STUCK_AT + 4 }, (_, i) => message([computerUse('left_click', { coordinate: i % 2 === 0 ? [313, 202] : [700, 253] })]))
    const model = new FakeModel([...clicks, message([textBlock('never reached')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })

    const result = await runLoop(t.ctx, goal)

    expect(result).toEqual({ outcome: 'stuck', summary: NO_PROGRESS_STUCK_TEXT })
    expect(model.calls).toHaveLength(NO_PROGRESS_STUCK_AT + 2)
    const resultTexts = model.calls.flatMap((call) => {
      const content = call.messages.at(-1)?.content
      if (!Array.isArray(content)) return []
      return content.flatMap((b) => (typeof b !== 'string' && b.type === 'tool_result' && typeof b.content === 'string' ? [b.content] : []))
    })
    expect(resultTexts.filter((text) => text.includes(noProgressText(NO_PROGRESS_NOTICE_AT[0]!)))).toHaveLength(1)
    expect(resultTexts.filter((text) => text.includes(noProgressText(NO_PROGRESS_NOTICE_AT[1]!)))).toHaveLength(1)
    expect((await store.readBot(botId)).state).toBe('blocked')
    expect(t.chat.at(-1)?.card).toMatchObject({ card: 'takeover', status: 'active', reason: NO_PROGRESS_STUCK_TEXT })
  })

  // The other tests build the expected notice by calling noProgressText itself. This one pins the
  // exact words the model reads, so a change of the wording fails a test.
  it('hands the model these exact words after sixteen steps without progress', () => {
    expect(noProgressText(16)).toBe(
      'You have taken 16 steps without doing anything new or recording anything: no click at a new place, no new text, no new page, no memory line, no proposal, no document. If you are opening things you already read, stop and use your notes instead; if you have what you need, act on it now; if you cannot finish, say what is missing. At 40 such steps the run ends.',
    )
  })

  // A tool call that failed saves nothing, so it is not progress. If an invalid remember call reset
  // the count, a loop would run on past the forty steps that end it.
  it('a memory line that failed does not count as progress, so the same clicks still end the run', async () => {
    const clicks = (n: number) => Array.from({ length: n }, (_, i) => message([computerUse('left_click', { coordinate: i % 2 === 0 ? [313, 202] : [700, 253] })]))
    const model = new FakeModel([...clicks(30), message([toolUse('remember', {})]), ...clicks(30), message([textBlock('never reached')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: basePlatformTools })

    const result = await runLoop(t.ctx, goal)

    expect(result).toEqual({ outcome: 'stuck', summary: NO_PROGRESS_STUCK_TEXT })
    expect(lastUserContent(model, 31)[0]).toMatchObject({ type: 'tool_result', is_error: true })
  })

  // Paging through results is the same Next click at the same place. A screenshot of a screen this
  // run has not shown before is progress. Without that rule the guard would end a run that pages
  // through results, although every page is new.
  it('a repeated click does not end the run when each screenshot after it shows a screen not seen before', async () => {
    const pages = Array.from({ length: 30 }, (_, i) => solidPng(64, 64, [i * 8, i * 8, i * 8]))
    const next = message([computerUse('left_click', { coordinate: [600, 700] })])
    const look = message([computerUse('screenshot')])
    const turns = Array.from({ length: 30 }, () => [next, look]).flat()
    const model = new FakeModel([...turns, message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(pages) })

    const result = await runLoop(t.ctx, goal)

    expect(result.outcome).toBe('done')
    expect(model.calls).toHaveLength(61)
  })

  it('a memory line in the middle of the same clicks counts as progress and postpones the end', async () => {
    const clicks = (n: number) => Array.from({ length: n }, (_, i) => message([computerUse('left_click', { coordinate: i % 2 === 0 ? [313, 202] : [700, 253] })]))
    const model = new FakeModel([...clicks(30), message([toolUse('remember', { note: 'the 11:30 mail is the invitation I booked from' })]), ...clicks(30), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: basePlatformTools })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')
    expect(await store.readMemory(botId)).toContain('the 11:30 mail is the invitation I booked from')
  })

  it('writes what the model said in each turn to the run log', async () => {
    const model = new FakeModel([message([textBlock('I open the inbox first.'), computerUse('screenshot')]), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })

    await runLoop(t.ctx, goal)

    const said = t.events.filter((e) => e.type === 'text')
    expect(said).toEqual([expect.objectContaining({ type: 'text', step: 0, text: 'I open the inbox first.' }), expect.objectContaining({ type: 'text', step: 1, text: 'done' })])
  })
})

describe('the connector tools in a run', () => {
  const look = defineTool({ name: 'conn__look', description: 'look through the connector', schema: z.object({}), run: async () => 'the connector looked' })

  /** A port whose snapshot gains `conn__look` once `granted` is set; `flip` is the platform tool that sets it. */
  function grantingPort() {
    const state = { granted: false, snapshots: 0 }
    const port: ConnectorsPort = {
      snapshot: async (): Promise<ConnectorSnapshot> => {
        state.snapshots += 1
        return state.granted
          ? { tools: [look], catalog: ['conn — looks (connected: conn__look)'], key: 'conn__look' }
          : { tools: [], catalog: ['conn — looks (not connected; ask with request_connection)'], key: '' }
      },
      offer: async () => ({ refused: 'unused' }),
      grant: async () => [],
    }
    const flip = defineTool({ name: 'flip', description: 'grant the connector', schema: z.object({}), run: async () => { state.granted = true; return 'granted' } })
    return { port, flip, state }
  }

  it('sends a tool granted during the run with the next model call, with the prompt updated, and runs it', async () => {
    const { port, flip } = grantingPort()
    const model = new FakeModel([
      message([toolUse('flip', {})]),
      message([toolUse('conn__look', {})]),
      message([textBlock('Done.')], 'end_turn'),
    ])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: [flip], connectors: port })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'done', summary: 'Done.' })

    const names = (call: number) => (model.calls[call]?.tools ?? []).map((tool) => ('name' in tool ? tool.name : tool.type))
    expect(names(0)).toEqual(['computer_toolset_20260801', 'flip'])
    expect(names(1)).toEqual(['computer_toolset_20260801', 'flip', 'conn__look'])
    const systemText = (call: number) => JSON.stringify(model.calls[call]?.system)
    expect(systemText(1)).not.toBe(systemText(0))
    expect(systemText(0)).toContain('conn — looks (not connected; ask with request_connection)')
    expect(systemText(1)).toContain('conn — looks (connected: conn__look)')
    // The last tool carries the cache breakpoint, so the new list is cached from its first call.
    const lastTool = model.calls[1]?.tools?.at(-1)
    expect(lastTool && 'cache_control' in lastTool ? lastTool.cache_control : null).toEqual({ type: 'ephemeral' })
    expect(t.events.find((e) => e.type === 'tool_result' && e.name === 'conn__look')).toMatchObject({ ok: true, summary: 'the connector looked' })
  })

  it('sends the same tools and the same prompt on every call while the connections do not change', async () => {
    const { port } = grantingPort()
    const noop = defineTool({ name: 'noop', description: 'nothing', schema: z.object({}), run: async () => 'ok' })
    const model = new FakeModel([message([toolUse('noop', {})]), message([toolUse('noop', {})]), message([textBlock('Done.')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: [noop], connectors: port })

    await runLoop(t.ctx, goal)

    expect(model.calls).toHaveLength(3)
    for (const call of [1, 2]) {
      expect(model.calls[call]?.tools).toEqual(model.calls[0]?.tools)
      expect(model.calls[call]?.system).toEqual(model.calls[0]?.system)
    }
  })

  it('stops a granted write connector at an approval card inside a run, and runs it only after Allow once', async () => {
    const writes: string[] = []
    const notes: BuiltinConnector = {
      id: 'notes',
      title: 'Notes',
      what: 'writes notes',
      onByDefault: false,
      unavailable: () => null,
      tools: [{ name: 'add', class: 'write', kind: 'publish', description: 'add a note', schema: z.object({ text: z.string() }), consequence: (i: { text: string }) => `adds "${i.text}"`, run: async (i: { text: string }) => { writes.push(i.text); return 'added' } }],
    }
    const registry = new ConnectorRegistry(store, [notes], { fetch: globalThis.fetch, mapyApiKey: null, mailbox: null, mailboxBotId: null })
    await registry.grant(botId, 'notes')
    const model = new FakeModel([message([toolUse('notes__add', { text: 'first' })]), message([toolUse('notes__add', { text: 'second' })]), message([textBlock('Done.')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: [], connectors: registry })
    t.decisions.push('denied', 'allowed')

    await runLoop(t.ctx, goal)

    expect(writes).toEqual(['second'])
    const cards = t.chat.filter((m) => m.card?.card === 'approval').map((m) => m.card)
    expect(cards).toMatchObject([{ connectorTool: 'notes__add', summary: 'adds "first"', status: 'denied' }, { connectorTool: 'notes__add', summary: 'adds "second"', status: 'allowed' }])
    expect(t.events.filter((e) => e.type === 'tool_result' && e.name === 'notes__add').map((e) => e.type === 'tool_result' && e.summary)).toEqual([DENIED_TEXT, 'added'])
  })

  // An approved write that never answers may still have happened at the service. The run must end
  // `unknown` and final, so no event source starts the same goal again and no result says done.
  describe('when an approved write does not answer', () => {
    const WARNING = 'You had approved "adds a note", and I cannot tell whether it went through: check before you send the goal again.'

    /** The real gate with a short limit, around a write whose service never answers. */
    function hangingWrite(calls: { n: number }) {
      const connector = { name: 'add', class: 'write' as const, description: 'add a note', schema: z.object({}), consequence: () => 'adds a note', run: () => { calls.n += 1; return new Promise<string>(() => {}) } }
      return defineTool({ name: 'notes__add', description: 'add a note', schema: z.object({}), run: (input, ctx) => runConnectorTool('notes__add', connector, input as never, { fetch: globalThis.fetch, mapyApiKey: null, mailbox: null, mailboxBotId: null }, ctx, 10) })
    }

    it('ends unknown and final when the model fails afterwards, and says to check before a retry', async () => {
      const calls = { n: 0 }
      const t = makeContext({ store, botId, model: new FakeModel([message([toolUse('notes__add', {})])]), sandbox: new FakeSandbox(), tools: [hangingWrite(calls)] })
      t.decisions.push('allowed')

      expect(await runLoop(t.ctx, goal)).toMatchObject({ outcome: 'unknown', final: true })

      expect(calls.n).toBe(1)
      expect(t.events.at(-1)).toMatchObject({ type: 'end', outcome: 'unknown' })
      expect(t.chat.at(-1)?.text).toContain(WARNING)
      expect(t.chat.at(-1)?.text).not.toContain('Send the goal again to retry')
    })

    it('ends unknown and final when the model ends its turn afterwards, not done', async () => {
      const calls = { n: 0 }
      const model = new FakeModel([message([toolUse('notes__add', {})]), message([textBlock('Please check the note.')], 'end_turn')])
      const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: [hangingWrite(calls)] })
      t.decisions.push('allowed')

      expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'unknown', summary: `Please check the note.; ${UNKNOWN_OUTCOME_SUMMARY}`, final: true })

      expect(calls.n).toBe(1)
      expect(t.chat.at(-1)?.text).toBe('Please check the note.')
    })

    it('names the approved write in the stop line when the user stops while it runs', async () => {
      // The stop is requested from inside the write, so it always lands after the approval while
      // the write runs. A timer started before the gate could fire during the approval steps on a
      // slow machine, and then no write had started, so the stop line rightly names none.
      const t = makeContext({ store, botId, model: new FakeModel([message([toolUse('notes__add', {})])]), sandbox: new FakeSandbox(), tools: [] })
      const connector = { name: 'add', class: 'write' as const, description: 'add a note', schema: z.object({}), consequence: () => 'adds a note', run: () => { setTimeout(() => t.stop.request(), 0); return new Promise<string>(() => {}) } }
      const write = defineTool({ name: 'notes__add', description: 'add a note', schema: z.object({}), run: (input, ctx) => runConnectorTool('notes__add', connector, input as never, { fetch: globalThis.fetch, mapyApiKey: null, mailbox: null, mailboxBotId: null }, ctx) })
      t.ctx.tools.push(write)
      t.decisions.push('allowed')

      expect((await runLoop(t.ctx, goal)).outcome).toBe('cancelled')

      expect(t.chat.at(-1)?.text).toBe(`${STOPPED_TEXT} ${WARNING}`)
    })

    it('leaves a read that does not answer as an ordinary error', async () => {
      const connector = { name: 'look', class: 'read' as const, description: 'look', schema: z.object({}), run: () => new Promise<string>(() => {}) }
      const read = defineTool({ name: 'notes__look', description: 'look', schema: z.object({}), run: (input, ctx) => runConnectorTool('notes__look', connector, input as never, { fetch: globalThis.fetch, mapyApiKey: null, mailbox: null, mailboxBotId: null }, ctx, 10) })
      const model = new FakeModel([message([toolUse('notes__look', {})]), message([textBlock('Done.')], 'end_turn')])
      const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: [read] })

      expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'done', summary: 'Done.' })
    })
  })

  it('refuses a connector tool the bot does not have yet as an unknown tool', async () => {
    const { port } = grantingPort()
    const model = new FakeModel([message([toolUse('conn__look', {})]), message([textBlock('Done.')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: [], connectors: port })

    await runLoop(t.ctx, goal)

    expect(t.events.find((e) => e.type === 'tool_result' && e.name === 'conn__look')).toMatchObject({ ok: false, summary: 'unknown tool: conn__look' })
  })
})
