import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStore, type Store } from '../store'
import { NOT_STARTED_SUMMARY, notStartedText, recoverAtBoot, RESTARTED_SUMMARY, RESTARTED_TAKEOVER_REASON, RESTARTED_TEXT, UNKNOWN_SUMMARY, unknownText } from './recovery'

let dataDir: string
let store: Store

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dobot-recovery-'))
  store = createStore(dataDir)
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

describe('recoverAtBoot', () => {
  it('closes runs left open by the previous process and puts the bot back to idle', async () => {
    const bot = await store.createBot({ name: 'Worker', persona: 'Works.' })
    await store.startRun(bot.id, 'run-open')
    await store.appendRunEvent({ t: 'x', runId: 'run-open', botId: bot.id, type: 'step', step: 1, action: 'screenshot', input: {} })
    await store.startRun(bot.id, 'run-done')
    await store.appendRunEvent({ t: 'x', runId: 'run-done', botId: bot.id, type: 'end', outcome: 'done', summary: 'ok' })
    await store.updateBot(bot.id, { state: 'working', statusLine: 'working' })

    expect(await recoverAtBoot(store)).toEqual({ closedRuns: 1, endedCards: 0 })

    expect(await store.listOpenRuns(bot.id)).toEqual([])
    expect((await store.readRunEvents(bot.id, 'run-open')).at(-1)).toMatchObject({ type: 'end', outcome: 'failed', summary: RESTARTED_SUMMARY })
    expect((await store.readRunEvents(bot.id, 'run-done')).filter((e) => e.type === 'end')).toHaveLength(1)
    expect((await store.readChat(bot.id, { limit: 5 })).map((m) => m.text)).toEqual([RESTARTED_TEXT])
    expect((await store.readBot(bot.id)).state).toBe('idle')
    expect(await recoverAtBoot(store)).toEqual({ closedRuns: 0, endedCards: 0 })
  })

  it.each(['homer'])('boots on a copy of the shipped %s folder', async (id) => {
    // The example keeps its empty folders with .gitkeep files; a boot that trips over them breaks every clean clone.
    const example = fileURLToPath(new URL(`../../../examples/${id}`, import.meta.url))
    await cp(example, join(dataDir, id), { recursive: true })

    expect(await recoverAtBoot(store)).toEqual({ closedRuns: 0, endedCards: 0 })

    expect((await store.listBots()).map((b) => b.id)).toEqual([id])
    expect(await store.listOpenRuns(id)).toEqual([])
  })

  // A takeover card left active by the previous process has nothing behind it after a restart. Left
  // active, the page would tell the user to press a Take over button that is not there, and neither
  // the next goal nor Hand back would end the card, because the keep-alive map that guards that
  // cleanup lives in memory.
  it('ends a takeover card the previous process left active, whether the bot ended blocked or already went idle', async () => {
    const blocked = await store.createBot({ name: 'Blocked', persona: 'Works.' })
    await store.startRun(blocked.id, 'run-capped')
    await store.appendRunEvent({ t: 'x', runId: 'run-capped', botId: blocked.id, type: 'end', outcome: 'budget', summary: 'capped' })
    const held = await store.appendChat(blocked.id, { role: 'card', card: { card: 'takeover', reason: 'I used all 100 computer steps', status: 'active' } })
    await store.updateBot(blocked.id, { state: 'blocked', statusLine: 'I used all 100 computer steps' })
    // A card that outlived an earlier boot on a bot that is idle already; a card that is over stays as it is.
    const idle = await store.createBot({ name: 'Idle', persona: 'Works.' })
    const stale = await store.appendChat(idle.id, { role: 'card', card: { card: 'takeover', reason: 'stale', status: 'active' } })
    const over = await store.appendChat(idle.id, { role: 'card', card: { card: 'takeover', reason: 'handed back', status: 'ended' } })
    const note = await store.appendChat(idle.id, { role: 'card', card: { card: 'status', text: 'a note' } })
    await store.appendChat(idle.id, { role: 'bot', text: 'Hello!' })

    expect(await recoverAtBoot(store)).toEqual({ closedRuns: 0, endedCards: 2 })

    expect(await store.readBot(blocked.id)).toMatchObject({ state: 'idle', statusLine: 'restarted' })
    const cardOf = async (botId: string, id: string) => (await store.readChat(botId, { limit: 10 })).find((m) => m.id === id)?.card
    expect(await cardOf(blocked.id, held.id)).toEqual({ card: 'takeover', reason: RESTARTED_TAKEOVER_REASON, status: 'ended' })
    expect(await cardOf(idle.id, stale.id)).toEqual({ card: 'takeover', reason: RESTARTED_TAKEOVER_REASON, status: 'ended' })
    expect(await cardOf(idle.id, over.id)).toEqual({ card: 'takeover', reason: 'handed back', status: 'ended' })
    expect(await cardOf(idle.id, note.id)).toEqual({ card: 'status', text: 'a note' })
    expect((await store.readChat(idle.id, { limit: 10 })).at(-1)?.text).toBe('Hello!')
    // The next boot finds nothing to end: no card is rewritten twice.
    expect(await recoverAtBoot(store)).toEqual({ closedRuns: 0, endedCards: 0 })
  })

  // The same hole for approvals: the registry that could answer Allow lives in memory, so a card
  // left pending would answer "unknown approval" forever.
  it('expires an approval card the previous process left pending, and leaves decided ones alone', async () => {
    const bot = await store.createBot({ name: 'Asker', persona: 'Works.' })
    await store.startRun(bot.id, 'run-asking')
    const approval = {
      card: 'approval' as const,
      approvalId: 'a1',
      runId: 'run-asking',
      actionKind: 'submit' as const,
      summary: 'Submit the form',
      consequences: ['the employer receives it'],
      warnings: [],
      target: 'Send',
      url: 'https://example.com/form',
      shot: null,
      announced: true,
    }
    const pending = await store.appendChat(bot.id, { role: 'card', card: { ...approval, status: 'pending' } })
    const denied = await store.appendChat(bot.id, { role: 'card', card: { ...approval, approvalId: 'a0', status: 'denied' } })
    const allowed = await store.appendChat(bot.id, { role: 'card', card: { ...approval, approvalId: 'a2', status: 'allowed' } })
    await store.updateBot(bot.id, { state: 'waiting', statusLine: 'waiting for approval' })

    expect(await recoverAtBoot(store)).toEqual({ closedRuns: 1, endedCards: 1 })

    const chat = await store.readChat(bot.id, { limit: 10 })
    expect(chat.find((m) => m.id === pending.id)?.card).toEqual({ ...approval, status: 'expired' })
    expect(chat.find((m) => m.id === denied.id)?.card).toEqual({ ...approval, approvalId: 'a0', status: 'denied' })
    expect(chat.find((m) => m.id === allowed.id)?.card).toEqual({ ...approval, approvalId: 'a2', status: 'allowed' })
    expect((await store.readRunEvents(bot.id, 'run-asking')).at(-1)).toMatchObject({ type: 'end', outcome: 'failed', summary: RESTARTED_SUMMARY })
    expect((await store.readBot(bot.id)).state).toBe('idle')
  })

  // A goal accepted behind a long run must not live only in memory. Without its record on disk a
  // restart would lose it, with the user's message still in the chat and no answer ever.
  it('expires a connect card the previous process left pending, and leaves a decided one alone', async () => {
    const bot = await store.createBot({ name: 'Asker', persona: 'Works.' })
    await store.startRun(bot.id, 'run-asking')
    const connect = { card: 'connect' as const, approvalId: 'c1', runId: 'run-asking', connector: 'maps', title: 'Maps', what: 'road distances', reason: 'to measure the distance' }
    const pending = await store.appendChat(bot.id, { role: 'card', card: { ...connect, status: 'pending' } })
    const connected = await store.appendChat(bot.id, { role: 'card', card: { ...connect, approvalId: 'c0', status: 'connected' } })

    await recoverAtBoot(store)

    const chat = await store.readChat(bot.id, { limit: 10 })
    expect(chat.find((m) => m.id === pending.id)?.card).toEqual({ ...connect, status: 'expired' })
    expect(chat.find((m) => m.id === connected.id)?.card).toEqual({ ...connect, approvalId: 'c0', status: 'connected' })
  })

  it('closes a goal that was accepted but never started as not started, and names it in the chat', async () => {
    const bot = await store.createBot({ name: 'Worker', persona: 'Works.' })
    await store.startRun(bot.id, 'run-queued')
    await store.appendRunEvent({ t: 'x', runId: 'run-queued', botId: bot.id, type: 'queued', goal: 'Prepare an application for Acme', source: 'message' })
    await store.startRun(bot.id, 'run-routine')
    await store.appendRunEvent({ t: 'x', runId: 'run-routine', botId: bot.id, type: 'queued', goal: 'Check the board.', source: 'routine', routineName: 'morning-search' })

    expect(await recoverAtBoot(store)).toEqual({ closedRuns: 2, endedCards: 0 })

    expect((await store.readRunEvents(bot.id, 'run-queued')).at(-1)).toMatchObject({ type: 'end', outcome: 'failed', summary: NOT_STARTED_SUMMARY })
    expect((await store.readChat(bot.id, { limit: 5 })).map((m) => m.text)).toEqual([
      notStartedText({ goal: 'Prepare an application for Acme', source: 'message' }),
      notStartedText({ goal: 'Check the board.', source: 'routine', routineName: 'morning-search' }),
    ])
    expect(notStartedText({ goal: 'Prepare an application for Acme', source: 'message' })).toBe(
      'The server restarted before I started on "Prepare an application for Acme", so nothing was done. Send it again if you still want it.',
    )
    expect(notStartedText({ goal: 'Check the board.', source: 'routine', routineName: 'morning-search' })).toBe(
      'The server restarted before my routine morning-search started, so it did not run this time.',
    )
  })

  // A crash after an approved action but before the success line: the platform cannot know
  // whether the booking went through, and "send it again" would invite a second one.
  it('closes a run interrupted after an approved action as unknown, and names the approved control', async () => {
    const bot = await store.createBot({ name: 'Booker', persona: 'Books.' })
    await store.startRun(bot.id, 'run-booking')
    await store.appendRunEvent({ t: 'x', runId: 'run-booking', botId: bot.id, type: 'queued', goal: 'book it', source: 'message' })
    await store.appendRunEvent({ t: 'x', runId: 'run-booking', botId: bot.id, type: 'status', text: 'working', botState: 'working' })
    await store.appendRunEvent({ t: 'x', runId: 'run-booking', botId: bot.id, type: 'approval', approvalId: 'a1', status: 'pending' })
    await store.appendRunEvent({ t: 'x', runId: 'run-booking', botId: bot.id, type: 'approval', approvalId: 'a1', status: 'allowed' })
    await store.appendChat(bot.id, {
      role: 'card',
      card: { card: 'approval', approvalId: 'a1', runId: 'run-booking', actionKind: 'book', summary: 'Book Monday 9:00', consequences: [], warnings: [], target: 'Schedule Event', url: 'https://example.com/book', shot: null, status: 'allowed', announced: true },
    })
    await store.updateBot(bot.id, { state: 'working', statusLine: 'working' })

    expect(await recoverAtBoot(store)).toEqual({ closedRuns: 1, endedCards: 0 })

    expect((await store.readRunEvents(bot.id, 'run-booking')).at(-1)).toMatchObject({ type: 'end', outcome: 'unknown', summary: UNKNOWN_SUMMARY })
    expect((await store.readChat(bot.id, { limit: 5 })).at(-1)?.text).toBe(unknownText('Schedule Event'))
    expect(unknownText('Schedule Event')).toBe(
      'The server restarted while I was working, after you approved "Schedule Event". I cannot tell whether it went through: check before you send the goal again.',
    )
    expect((await store.readBot(bot.id)).state).toBe('idle')
  })

  // The second signal of an approved action: the click the approval allowed ran and consumed it.
  // Tested alone, without an approval event, so this branch cannot silently rot behind the first.
  it('names the approved connector call by its sentence when a restart cut the run after Allow', async () => {
    const bot = await store.createBot({ name: 'Writer', persona: 'Writes.' })
    await store.startRun(bot.id, 'run-writing')
    await store.appendRunEvent({ t: new Date().toISOString(), runId: 'run-writing', botId: bot.id, type: 'status', text: 'working', botState: 'working' })
    await store.appendRunEvent({ t: new Date().toISOString(), runId: 'run-writing', botId: bot.id, type: 'approval', approvalId: 'w1', status: 'allowed' })
    await store.appendChat(bot.id, { role: 'card', card: { card: 'approval', approvalId: 'w1', runId: 'run-writing', actionKind: 'send', summary: 'sends a mail to a@example.com', consequences: [], warnings: [], target: 'mail__send', url: '', shot: null, status: 'allowed', announced: true, connectorTool: 'mail__send', connectorArgs: '{}' } })

    await recoverAtBoot(store)

    expect((await store.readChat(bot.id, { limit: 10 })).at(-1)?.text).toBe(unknownText('sends a mail to a@example.com'))
  })

  it('closes a run interrupted after an approval was consumed as unknown, even without an approval event', async () => {
    const bot = await store.createBot({ name: 'Clicker', persona: 'Clicks.' })
    await store.startRun(bot.id, 'run-click')
    await store.appendRunEvent({ t: 'x', runId: 'run-click', botId: bot.id, type: 'queued', goal: 'send it', source: 'message' })
    await store.appendRunEvent({ t: 'x', runId: 'run-click', botId: bot.id, type: 'status', text: 'working', botState: 'working' })
    await store.appendRunEvent({ t: 'x', runId: 'run-click', botId: bot.id, type: 'gate', step: 1, decision: 'consume', rule: 'submit-control', announced: true, approvalId: 'a1', reason: 'matches the approved action' })
    await store.appendChat(bot.id, {
      role: 'card',
      card: { card: 'approval', approvalId: 'a1', runId: 'run-click', actionKind: 'submit', summary: 'Send the form', consequences: [], warnings: [], target: 'Send', url: 'https://example.com/form', shot: null, status: 'allowed', announced: true },
    })

    expect(await recoverAtBoot(store)).toEqual({ closedRuns: 1, endedCards: 0 })

    expect((await store.readRunEvents(bot.id, 'run-click')).at(-1)).toMatchObject({ type: 'end', outcome: 'unknown', summary: UNKNOWN_SUMMARY })
    expect((await store.readChat(bot.id, { limit: 5 })).at(-1)?.text).toBe(unknownText('Send'))
  })

  it('the closing lines name a generic action without a card, and fold and cut a long goal', () => {
    expect(unknownText(null)).toBe(
      'The server restarted while I was working, after you approved the action you approved. I cannot tell whether it went through: check before you send the goal again.',
    )
    expect(notStartedText({ goal: `  ${'x'.repeat(140)}\n\ttail`, source: 'message' })).toBe(
      `The server restarted before I started on "${'x'.repeat(119)}…", so nothing was done. Send it again if you still want it.`,
    )
    expect(notStartedText({ goal: 'a\n  b', source: 'message' })).toBe('The server restarted before I started on "a b", so nothing was done. Send it again if you still want it.')
  })

  it('one bot folder that cannot be read does not stop recovery for the others', async () => {
    const broken = await store.createBot({ name: 'Alpha', persona: 'Breaks.' })
    const fine = await store.createBot({ name: 'Zulu', persona: 'Works.' })
    await store.startRun(fine.id, 'run-open')
    await store.appendRunEvent({ t: 'x', runId: 'run-open', botId: fine.id, type: 'step', step: 1, action: 'screenshot', input: {} })
    // runs/ is a file, not a folder: listing it throws something that is not "not found".
    await rm(join(store.botDir(broken.id), 'runs'), { recursive: true, force: true })
    await writeFile(join(store.botDir(broken.id), 'runs'), 'not a folder')

    expect(await recoverAtBoot(store)).toEqual({ closedRuns: 1, endedCards: 0 })

    expect(await store.listOpenRuns(fine.id)).toEqual([])
  })
})
