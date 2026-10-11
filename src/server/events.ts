// The platform's event vocabulary: the names a routine may wait for instead of a schedule. Kept
// in a file with no other imports so the bot's tools can read it without loading a mail client.
// One entry per event source that exists; adding a source means adding its name here, and the
// bot learns it through save_routine's description on the next run.

export const MAIL_EVENT = 'mail-arrived'

export const KNOWN_EVENTS: Record<string, string> = {
  [MAIL_EVENT]: 'new mail arrived in your mailbox',
}

export function isKnownEvent(name: string): boolean {
  return Object.hasOwn(KNOWN_EVENTS, name)
}

/** For a tool description: `mail-arrived (new mail arrived in your mailbox)`. */
export function describeEvents(): string {
  return Object.entries(KNOWN_EVENTS)
    .map(([name, meaning]) => `${name} (${meaning})`)
    .join(', ')
}
