/** The longest status line bot.json holds: one line under the bot's name in the roster. */
export const STATUS_LINE_MAX = 200

/**
 * Display text never blocks a state change. A takeover reason or a run summary longer than the
 * line is folded to one line and cut with an ellipsis before it reaches the schema. Without the
 * cut, a valid 300-character takeover reason fails the write, the tool error goes back to the
 * model, and the run goes on without handing the screen over.
 */
export function clipStatus(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= STATUS_LINE_MAX) return oneLine
  return oneLine.slice(0, STATUS_LINE_MAX - 1) + '…'
}
