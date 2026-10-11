import { describe, expect, it } from 'vitest'
import { ConnectorError } from '../types'
import { calcomPublic, parsePage } from './calcom-public'
import { envWith, header, json, recordingFetch } from './fakes'

const slots = calcomPublic.tools.find((t) => t.name === 'slots')!
const book = calcomPublic.tools.find((t) => t.name === 'book')!
const signal = new AbortController().signal
const PAGE = 'https://cal.com/interviewer-xy/30min'

describe('the public booking-page connector', () => {
  it('needs a grant, needs no key, and has one read and one write of kind book', () => {
    expect(calcomPublic.onByDefault).toBe(false)
    expect(calcomPublic.unavailable('bot', envWith(fetch))).toBeNull()
    expect(slots.class).toBe('read')
    expect(book.class).toBe('write')
    expect(book.kind).toBe('book')
  })

  it('reads a public page address into its user and event, and nothing else', () => {
    expect(parsePage(PAGE)).toEqual({ username: 'interviewer-xy', eventTypeSlug: '30min' })
    expect(parsePage('https://app.cal.com/a/b')).toEqual({ username: 'a', eventTypeSlug: 'b' })
    for (const bad of ['http://cal.com/a/b', 'https://evil.example/a/b', 'https://cal.com.evil.example/a/b', 'https://cal.com/a', 'https://cal.com/a/b/c', 'not a url']) {
      expect(() => parsePage(bad), bad).toThrow(ConnectorError)
    }
  })

  it('lists the free start times per day, asking with the documented version header', async () => {
    const { fetchFn, requests } = recordingFetch([
      json({ status: 'success', data: { '2026-09-28': [{ start: '2026-09-28T09:00:00.000+02:00' }, { start: '2026-09-28T10:00:00.000+02:00' }], '2026-09-29': [{ start: '2026-09-29T14:30:00.000+02:00' }] } }),
    ])
    const text = await slots.run({ pageUrl: PAGE, from: '2026-09-28', to: '2026-09-29', timeZone: 'Europe/Prague' } as never, envWith(fetchFn), signal)
    expect(text).toBe('2026-09-28: 2026-09-28T09:00:00.000+02:00, 2026-09-28T10:00:00.000+02:00\n2026-09-29: 2026-09-29T14:30:00.000+02:00')
    const [req] = requests
    expect(req?.url.origin + req!.url.pathname).toBe('https://api.cal.com/v2/slots')
    expect(Object.fromEntries(req!.url.searchParams)).toEqual({ username: 'interviewer-xy', eventTypeSlug: '30min', start: '2026-09-28', end: '2026-09-29', timeZone: 'Europe/Prague' })
    expect(header(req!.init, 'cal-api-version')).toBe('2024-09-04')
  })

  it('says so when no time is free, and refuses a range longer than two weeks', async () => {
    const { fetchFn } = recordingFetch([json({ status: 'success', data: {} })])
    expect(await slots.run({ pageUrl: PAGE, from: '2026-09-28', to: '2026-09-29', timeZone: 'Europe/Prague' } as never, envWith(fetchFn), signal)).toBe('no free time between 2026-09-28 and 2026-09-29')
    await expect(slots.run({ pageUrl: PAGE, from: '2026-09-01', to: '2026-09-30', timeZone: 'Europe/Prague' } as never, envWith(fetchFn), signal)).rejects.toThrow(new ConnectorError('ask for at most 14 days at a time'))
  })

  it('accepts exactly 14 days and refuses a last day before the first', async () => {
    const { fetchFn, requests } = recordingFetch([json({ status: 'success', data: {} })])
    await expect(slots.run({ pageUrl: PAGE, from: '2026-09-01', to: '2026-09-15', timeZone: 'Europe/Prague' } as never, envWith(fetchFn), signal)).resolves.toBe('no free time between 2026-09-01 and 2026-09-15')
    await expect(slots.run({ pageUrl: PAGE, from: '2026-09-15', to: '2026-09-01', timeZone: 'Europe/Prague' } as never, envWith(fetchFn), signal)).rejects.toThrow(new ConnectorError('the last day is before the first'))
    expect(requests).toHaveLength(1)
  })

  it('books with the documented body and version header, and names the reference', async () => {
    const { fetchFn, requests } = recordingFetch([json({ status: 'success', data: { uid: 'bk_123', start: '2026-09-28T07:00:00.000Z', status: 'accepted' } }, 201)])
    const input = { pageUrl: PAGE, start: '2026-09-28T09:00:00+02:00', name: 'Hunter', email: 'hunter@example.com', timeZone: 'Europe/Prague' }
    expect(await book.run(input as never, envWith(fetchFn), signal)).toBe('booked: 2026-09-28T07:00:00.000Z (accepted), reference bk_123')
    const [req] = requests
    expect(req?.url.toString()).toBe('https://api.cal.com/v2/bookings')
    expect(req?.init.method).toBe('POST')
    expect(header(req!.init, 'cal-api-version')).toBe('2026-02-25')
    expect(header(req!.init, 'content-type')).toBe('application/json')
    expect(JSON.parse(String(req?.init.body))).toEqual({ start: '2026-09-28T07:00:00.000Z', eventTypeSlug: '30min', username: 'interviewer-xy', attendee: { name: 'Hunter', email: 'hunter@example.com', timeZone: 'Europe/Prague' } })
    expect(book.consequence?.(input as never)).toBe(`books 2026-09-28T09:00:00+02:00 on ${PAGE} for Hunter <hunter@example.com>`)
  })

  it('names a list of times of an unknown shape, but reports an accepted booking as booked whatever its answer holds', async () => {
    const odd = recordingFetch([json({ status: 'success', data: [] })])
    await expect(slots.run({ pageUrl: PAGE, from: '2026-09-28', to: '2026-09-29', timeZone: 'Europe/Prague' } as never, envWith(odd.fetchFn), signal)).rejects.toThrow(
      new ConnectorError('the booking page answered in a shape this connector does not know'),
    )
    const input = { pageUrl: PAGE, start: '2026-09-28T09:00:00+02:00', name: 'H', email: 'h@example.com', timeZone: 'Europe/Prague' }
    const accepted = recordingFetch([() => new Response('<html>ok</html>', { status: 201 })])
    expect(await book.run(input as never, envWith(accepted.fetchFn), signal)).toBe('booked: 2026-09-28T07:00:00.000Z (status unknown), reference unknown')
  })

  it("passes the service's own reason for a refused booking, cut short", async () => {
    const { fetchFn } = recordingFetch([json({ status: 'error', error: { message: 'no available users found' } }, 400)])
    const input = { pageUrl: PAGE, start: '2026-09-28T09:00:00+02:00', name: 'H', email: 'h@example.com', timeZone: 'Europe/Prague' }
    await expect(book.run(input as never, envWith(fetchFn), signal)).rejects.toThrow(new ConnectorError('the booking page refused: no available users found'))
    const long = recordingFetch([json({ error: { message: 'x'.repeat(1000) } }, 400)])
    const error = (await book.run(input as never, envWith(long.fetchFn), signal).catch((e: unknown) => e)) as Error
    expect(error.message.length).toBeLessThanOrEqual(330)
    const odd = recordingFetch([json({ error: { message: { nested: true } } }, 400)])
    await expect(book.run(input as never, envWith(odd.fetchFn), signal)).rejects.toThrow(new ConnectorError('the booking page refused: http 400'))
    const bare = recordingFetch([() => new Response('gateway down', { status: 502 })])
    await expect(book.run(input as never, envWith(bare.fetchFn), signal)).rejects.toThrow(new ConnectorError('the booking page refused: http 502'))
  })

  it('refuses a start time without an offset and an address that is not one', () => {
    expect(book.schema.safeParse({ pageUrl: PAGE, start: '2026-09-28 09:00', name: 'H', email: 'h@example.com', timeZone: 'Europe/Prague' }).success).toBe(false)
    expect(book.schema.safeParse({ pageUrl: PAGE, start: '2026-09-28T09:00:00+02:00', name: 'H', email: 'nope', timeZone: 'Europe/Prague' }).success).toBe(false)
  })
})
