import type { Store } from '../store'

// The platform's own spend limit, under the organisation limit set in the Anthropic console. Before
// a run takes its computer, the cost events of every run of every bot that started today are added
// up. Today ends at midnight on the routines' clock.

/** The calendar date of `date` in `timezone`, as YYYY-MM-DD. */
export function dayIn(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: 'year' | 'month' | 'day'): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** What the runs of every bot that started on `now`'s date in `timezone` have cost, in USD. A run is dated by its first event. */
export async function spentToday(store: Store, now: Date, timezone: string): Promise<number> {
  const today = dayIn(now, timezone)
  let total = 0
  for (const bot of await store.listBots()) {
    for (const run of await store.listRunCosts(bot.id)) {
      if (run.startedAt === null) continue
      const started = new Date(run.startedAt)
      if (Number.isNaN(started.getTime())) continue
      if (dayIn(started, timezone) === today) total += run.usd
    }
  }
  return total
}

/**
 * The words for a run the budget refused: the chat card for the user, and the one-line summary for
 * the run log and a routine's last result. Neither names a setting (invariant 7).
 */
export function budgetText(budgetUsd: number, spentUsd: number): { card: string; summary: string } {
  const spent = `$${spentUsd.toFixed(2)}`
  return {
    card: `Today's budget of $${budgetUsd} is used up (${spent} spent), so I did not start. Runs start again tomorrow.`,
    summary: `today's budget of $${budgetUsd} is used up (${spent} spent)`,
  }
}
