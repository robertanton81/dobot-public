import { describe, expect, it } from 'vitest'
import { ConnectorError } from '../types'
import { mapy } from './mapy'
import { envWith, header, json, recordingFetch } from './fakes'

const KEY = 'test-key-not-real'
const geocode = mapy.tools.find((t) => t.name === 'geocode')!
const route = mapy.tools.find((t) => t.name === 'route')!
const signal = new AbortController().signal

const PLACES = {
  items: [
    { name: 'Beroun', label: 'Město', position: { lon: 14.0719, lat: 49.9638 }, type: 'regional.municipality', location: 'Středočeský kraj, Česko' },
    { name: 'Beroun', label: 'Železniční stanice', position: { lon: 14.0795, lat: 49.9594 }, type: 'poi', location: 'Beroun, Česko' },
  ],
}

describe('the map connector', () => {
  it('is offered only when the operator set its key, and asks for a grant', () => {
    expect(mapy.onByDefault).toBe(false)
    expect(mapy.unavailable('bot', envWith(fetch))).toBe('MAPY_API_KEY is not set')
    expect(mapy.unavailable('bot', envWith(fetch, { mapyApiKey: KEY }))).toBeNull()
    expect(mapy.tools.map((t) => [t.name, t.class])).toEqual([['geocode', 'read'], ['route', 'read']])
  })

  it('finds places and gives their coordinates, with the key in a header only', async () => {
    const { fetchFn, requests } = recordingFetch([json(PLACES)])
    const text = await geocode.run({ query: 'Beroun' } as never, envWith(fetchFn, { mapyApiKey: KEY }), signal)
    expect(text).toBe('Beroun — Město — Středočeský kraj, Česko — lon 14.0719, lat 49.9638\nBeroun — Železniční stanice — Beroun, Česko — lon 14.0795, lat 49.9594')
    const [req] = requests
    expect(req?.url.origin + req!.url.pathname).toBe('https://api.mapy.com/v1/geocode')
    expect(Object.fromEntries(req!.url.searchParams)).toEqual({ query: 'Beroun', lang: 'cs', limit: '5' })
    expect(header(req!.init, 'x-mapy-api-key')).toBe(KEY)
    expect(req!.url.toString()).not.toContain(KEY)
  })

  it('gives the road distance in kilometres and the time in minutes', async () => {
    const { fetchFn, requests } = recordingFetch([json({ length: 32412, duration: 2040, parts: [] })])
    const text = await route.run({ from: { lon: 14.4213, lat: 50.0875 }, to: { lon: 14.0719, lat: 49.9638 }, mode: 'car_fast' } as never, envWith(fetchFn, { mapyApiKey: KEY }), signal)
    expect(text).toBe('about 32.4 km (32412 m), about 34 minutes by car_fast')
    const [req] = requests
    expect(req?.url.origin + req!.url.pathname).toBe('https://api.mapy.com/v1/routing/route')
    expect(Object.fromEntries(req!.url.searchParams)).toEqual({ start: '14.4213,50.0875', end: '14.0719,49.9638', routeType: 'car_fast', format: 'geojson' })
    expect(header(req!.init, 'x-mapy-api-key')).toBe(KEY)
    expect(req!.url.toString()).not.toContain(KEY)
  })

  it('refuses a mode the service has no name for, and coordinates off the globe', () => {
    expect(route.schema.safeParse({ from: { lon: 1, lat: 2 }, to: { lon: 1, lat: 2 }, mode: 'teleport' }).success).toBe(false)
    expect(route.schema.safeParse({ from: { lon: 200, lat: 2 }, to: { lon: 1, lat: 2 }, mode: 'car_fast' }).success).toBe(false)
  })

  it('sends no request when the server has no key, even if called', async () => {
    const { fetchFn, requests } = recordingFetch([json(PLACES)])
    await expect(geocode.run({ query: 'Beroun' } as never, envWith(fetchFn), signal)).rejects.toThrow(new ConnectorError('the map connector has no key on this server'))
    expect(requests).toHaveLength(0)
  })

  it('says so when no place matches or no route is found, and joins a place with a missing field without an empty part', async () => {
    const none = recordingFetch([json({ items: [] })])
    await expect(geocode.run({ query: 'Nowhere' } as never, envWith(none.fetchFn, { mapyApiKey: KEY }), signal)).rejects.toThrow(new ConnectorError('no place matches "Nowhere"'))
    const noRoute = recordingFetch([json({})])
    const between = { from: { lon: 14, lat: 50 }, to: { lon: 15, lat: 50 }, mode: 'car_fast' }
    await expect(route.run(between as never, envWith(noRoute.fetchFn, { mapyApiKey: KEY }), signal)).rejects.toThrow(new ConnectorError('the map service found no route between these points'))
    const partial = recordingFetch([json({ items: [{ name: 'Beroun', position: { lon: 14.07, lat: 49.96 } }] })])
    expect(await geocode.run({ query: 'Beroun' } as never, envWith(partial.fetchFn, { mapyApiKey: KEY }), signal)).toBe('Beroun — lon 14.07, lat 49.96')
  })

  it('names an answer of an unknown shape instead of failing on it', async () => {
    const odd = recordingFetch([json({ items: 'none' })])
    await expect(geocode.run({ query: 'x' } as never, envWith(odd.fetchFn, { mapyApiKey: KEY }), signal)).rejects.toThrow(new ConnectorError('the map service answered in a shape this connector does not know'))
    const text = recordingFetch([json({ length: '32 km', duration: 2040 })])
    await expect(route.run({ from: { lon: 14, lat: 50 }, to: { lon: 15, lat: 50 }, mode: 'car_fast' } as never, envWith(text.fetchFn, { mapyApiKey: KEY }), signal)).rejects.toThrow(
      new ConnectorError('the map service answered in a shape this connector does not know'),
    )
  })

  it('names a refused key and a used-up quota without the key in any text', async () => {
    for (const [status, text] of [
      [401, 'the map service refused the platform key'],
      [403, 'the map service refused the platform key'],
      [429, 'the map service quota is used up for now'],
      [500, 'the map service answered http 500'],
    ] as const) {
      const { fetchFn } = recordingFetch([json({ detail: [{ msg: `bad key ${KEY}` }] }, status)])
      const error = await geocode.run({ query: 'x' } as never, envWith(fetchFn, { mapyApiKey: KEY }), signal).catch((e: unknown) => e)
      expect(error).toEqual(new ConnectorError(text))
      expect(String((error as Error).message)).not.toContain(KEY)
    }
  })
})
