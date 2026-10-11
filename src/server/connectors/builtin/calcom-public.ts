import { z } from 'zod'
import { ConnectorError, type BuiltinConnector, type ConnectorEnv, type ConnectorTool } from '../types'
import { readAnswer } from './answer'

// Cal.com public booking pages through the Cal.com v2 API, with no key: the free times of a public
// page, and a booking on it as its guest. Each endpoint names its own API version in a header.

const API = 'https://api.cal.com/v2'
const SLOTS_VERSION = '2024-09-04'
const BOOKINGS_VERSION = '2026-02-25'
const HOSTS = new Set(['cal.com', 'app.cal.com'])
const MAX_DAYS = 14
const REASON_CHARS = 300

/** `https://cal.com/<username>/<event>` → its two parts. Only the hosted service's own hosts are accepted. */
export function parsePage(pageUrl: string): { username: string; eventTypeSlug: string } {
  let url: URL
  try {
    url = new URL(pageUrl)
  } catch {
    throw new ConnectorError('that is not a valid address')
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || parts.length !== 2) {
    throw new ConnectorError('only a public page of the form https://cal.com/<name>/<event> can be used')
  }
  return { username: decodeURIComponent(parts[0] ?? ''), eventTypeSlug: decodeURIComponent(parts[1] ?? '') }
}

function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return true
  } catch {
    return false
  }
}

const timeZone = z.string().max(64).refine(isTimeZone, 'an IANA time zone, e.g. Europe/Prague').describe('an IANA time zone, e.g. Europe/Prague')
const pageUrl = z.string().max(300).describe('the public page, e.g. https://cal.com/<name>/<event>')

/** The service's own reason for a refusal, when its answer has one. */
async function refusal(res: Response): Promise<ConnectorError> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null
  const message = typeof body?.error?.message === 'string' ? body.error.message.slice(0, REASON_CHARS) : `http ${res.status}`
  return new ConnectorError(`the booking page refused: ${message}`)
}

const Slots = z.object({ data: z.record(z.string(), z.array(z.object({ start: z.string() }))) })
// Read after a booking that the service accepted: a field it leaves out is reported as unknown,
// never as a failure, so the model is not led to book a second time.
const Booked = z.object({ data: z.object({ uid: z.string().optional(), start: z.string().optional(), status: z.string().optional() }).optional() })

const slotsSchema = z.object({
  pageUrl,
  from: z.iso.date().describe('the first day, YYYY-MM-DD'),
  to: z.iso.date().describe('the last day, YYYY-MM-DD'),
  timeZone,
})

const slots: ConnectorTool = {
  name: 'slots',
  class: 'read',
  description: 'List the free start times of a public Cal.com page, day by day, for at most 14 days. Use it instead of opening the page on your computer.',
  schema: slotsSchema,
  run: async (input: z.infer<typeof slotsSchema>, env: ConnectorEnv, signal: AbortSignal) => {
    const { username, eventTypeSlug } = parsePage(input.pageUrl)
    const days = (Date.parse(input.to) - Date.parse(input.from)) / 86_400_000
    if (days < 0) throw new ConnectorError('the last day is before the first')
    if (days > MAX_DAYS) throw new ConnectorError(`ask for at most ${MAX_DAYS} days at a time`)
    const url = new URL(`${API}/slots`)
    url.search = new URLSearchParams({ username, eventTypeSlug, start: input.from, end: input.to, timeZone: input.timeZone }).toString()
    const res = await env.fetch(url, { signal, headers: { 'cal-api-version': SLOTS_VERSION, accept: 'application/json' } })
    if (!res.ok) throw await refusal(res)
    const body = await readAnswer(res, Slots, 'the booking page')
    const lines = Object.entries(body.data)
      .filter(([, times]) => times.length > 0)
      .map(([day, times]) => `${day}: ${times.map((t) => t.start).join(', ')}`)
    return lines.length === 0 ? `no free time between ${input.from} and ${input.to}` : lines.join('\n')
  },
}

const bookSchema = z.object({
  pageUrl,
  start: z.iso.datetime({ offset: true }).describe('the start time exactly as slots gave it, with its offset'),
  name: z.string().min(1).max(100).describe('the guest name to book under'),
  email: z.email().describe('the guest mail address the confirmation goes to'),
  timeZone,
})
type BookInput = z.infer<typeof bookSchema>

const book: ConnectorTool = {
  name: 'book',
  class: 'write',
  kind: 'book',
  description: 'Book one start time on a public Cal.com page as its guest. Take the time from slots. The booking is real: the host gets it and the guest gets a confirmation mail.',
  schema: bookSchema,
  consequence: (input: BookInput) => `books ${input.start} on ${input.pageUrl} for ${input.name} <${input.email}>`,
  run: async (input: BookInput, env: ConnectorEnv, signal: AbortSignal) => {
    const { username, eventTypeSlug } = parsePage(input.pageUrl)
    const body = { start: new Date(input.start).toISOString(), eventTypeSlug, username, attendee: { name: input.name, email: input.email, timeZone: input.timeZone } }
    const res = await env.fetch(`${API}/bookings`, {
      method: 'POST',
      signal,
      headers: { 'cal-api-version': BOOKINGS_VERSION, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw await refusal(res)
    const answer = Booked.safeParse(await res.json().catch(() => null))
    const data = answer.success ? answer.data.data : undefined
    return `booked: ${data?.start ?? body.start} (${data?.status ?? 'status unknown'}), reference ${data?.uid ?? 'unknown'}`
  },
}

export const calcomPublic: BuiltinConnector = {
  id: 'calcom-public',
  title: 'Cal.com public pages',
  what: 'free times on a public Cal.com page, and a booking on it after your approval, without the browser',
  onByDefault: false,
  unavailable: () => null,
  tools: [slots, book],
}
