import { errorFields, log } from '../log'
import type { Card, RunEvent, Store } from '../store'

export const RESTARTED_SUMMARY = 'the server restarted during this run'
export const RESTARTED_TEXT = 'The server restarted while I was working, so I stopped. Send the goal again to retry.'
export const NOT_STARTED_SUMMARY = 'the server restarted before this run started'
export const UNKNOWN_SUMMARY = 'the server restarted after an approved action; whether it happened is unknown'
/** Replaces the text of a takeover card the previous process left active: nobody is waiting behind it any more. */
export const RESTARTED_TAKEOVER_REASON = 'The server restarted, so I am no longer waiting for you on my screen. Send me the next goal.'

const GOAL_PREVIEW = 120

type Queued = Extract<RunEvent, { type: 'queued' }>

/** The chat line for a goal the previous process accepted but never started. */
export function notStartedText(queued: Pick<Queued, 'goal' | 'source' | 'routineName'>): string {
  if (queued.source === 'routine') return `The server restarted before my routine ${queued.routineName ?? ''} started, so it did not run this time.`
  const goal = queued.goal.replace(/\s+/g, ' ').trim()
  const preview = goal.length > GOAL_PREVIEW ? goal.slice(0, GOAL_PREVIEW - 1) + '…' : goal
  return `The server restarted before I started on "${preview}", so nothing was done. Send it again if you still want it.`
}

/** The chat line for a run cut after the user approved an action: the platform cannot know whether it happened. */
export function unknownText(target: string | null): string {
  const what = target === null ? 'the action you approved' : `"${target}"`
  return `The server restarted while I was working, after you approved ${what}. I cannot tell whether it went through: check before you send the goal again.`
}

/**
 * Closes every run the previous process left open, puts every bot back to idle, and ends the cards
 * only that process could have answered: a takeover it was waiting on, an approval its in-memory
 * registry held. What the closing line says depends on how far the run got: never started (a
 * `queued` event and nothing after it), interrupted, or interrupted after an approved action, whose
 * outcome is unknown. One bot folder that fails is logged and the others still recover. Sandboxes
 * are not touched: they are paused, or will be resumed on demand.
 */
export async function recoverAtBoot(store: Store): Promise<{ closedRuns: number; endedCards: number }> {
  let closedRuns = 0
  let endedCards = 0
  for (const bot of await store.listBots()) {
    try {
      for (const runId of await store.listOpenRuns(bot.id)) {
        const closing = await closingFor(store, bot.id, runId, await store.readRunEvents(bot.id, runId))
        await store.appendRunEvent({ t: new Date().toISOString(), runId, botId: bot.id, type: 'end', outcome: closing.outcome, summary: closing.summary })
        await store.appendChat(bot.id, { role: 'bot', text: closing.text })
        closedRuns += 1
        log.warn('closed a run interrupted by the restart', { botId: bot.id, runId, outcome: closing.outcome })
      }
      if (bot.state !== 'idle') await store.updateBot(bot.id, { state: 'idle', statusLine: 'restarted' })
      endedCards += await endOpenCards(store, bot.id)
    } catch (e) {
      log.error('recovery failed for one bot; the others continue', { botId: bot.id, ...errorFields(e) })
    }
  }
  return { closedRuns, endedCards }
}

type Closing = { outcome: 'failed' | 'unknown'; summary: string; text: string }

async function closingFor(store: Store, botId: string, runId: string, events: RunEvent[]): Promise<Closing> {
  const queued = events.find((e): e is Queued => e.type === 'queued')
  const started = events.some((e) => e.type === 'status')
  if (queued && !started) return { outcome: 'failed', summary: NOT_STARTED_SUMMARY, text: notStartedText(queued) }
  const approved = events.some((e) => (e.type === 'approval' && e.status === 'allowed') || (e.type === 'gate' && e.decision === 'consume'))
  if (!approved) return { outcome: 'failed', summary: RESTARTED_SUMMARY, text: RESTARTED_TEXT }
  const chat = await store.readChat(botId, { limit: Number.MAX_SAFE_INTEGER })
  const allowed = [...chat].reverse().find((m) => m.card?.card === 'approval' && m.card.runId === runId && m.card.status === 'allowed')
  // A connector call names no control; the card's sentence says what was approved.
  const target = allowed?.card?.card === 'approval' ? (allowed.card.connectorTool ? allowed.card.summary : allowed.card.target) : null
  return { outcome: 'unknown', summary: UNKNOWN_SUMMARY, text: unknownText(target) }
}

/**
 * A card left open by the previous process has nothing behind it: the takeover controller and the
 * approval registry live in memory. Left as it is, the page would ask for a Take over button that
 * is not there, or answer Allow with "unknown approval" forever.
 */
async function endOpenCards(store: Store, botId: string): Promise<number> {
  let ended = 0
  for (const message of await store.readChat(botId, { limit: Number.MAX_SAFE_INTEGER })) {
    const closed = closedCard(message.card)
    if (closed === null) continue
    await store.updateChatCard(botId, message.id, closed)
    log.warn('ended a card left open by the restart', { botId, messageId: message.id, card: closed.card })
    ended += 1
  }
  return ended
}

function closedCard(card: Card | undefined): Card | null {
  if (!card) return null
  if (card.card === 'takeover' && card.status === 'active') return { ...card, status: 'ended', reason: RESTARTED_TAKEOVER_REASON }
  if (card.card === 'approval' && card.status === 'pending') return { ...card, status: 'expired' }
  if (card.card === 'connect' && card.status === 'pending') return { ...card, status: 'expired' }
  return null
}
