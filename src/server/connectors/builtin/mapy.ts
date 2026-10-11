import { z } from 'zod'
import { ConnectorError, type BuiltinConnector, type ConnectorEnv, type ConnectorTool } from '../types'
import { readAnswer } from './answer'

// Mapy.com: places to coordinates, and road distance and travel time between two points. The
// platform's key goes in a header, never in the address, so no log of an address can carry it.

const BASE = 'https://api.mapy.com/v1'

async function call(path: string, params: Record<string, string>, env: ConnectorEnv, signal: AbortSignal): Promise<Response> {
  if (env.mapyApiKey === null) throw new ConnectorError('the map connector has no key on this server')
  const url = new URL(`${BASE}${path}`)
  url.search = new URLSearchParams(params).toString()
  const res = await env.fetch(url, { signal, headers: { 'x-mapy-api-key': env.mapyApiKey, accept: 'application/json' } })
  if (res.status === 401 || res.status === 403) throw new ConnectorError('the map service refused the platform key')
  if (res.status === 429) throw new ConnectorError('the map service quota is used up for now')
  if (!res.ok) throw new ConnectorError(`the map service answered http ${res.status}`)
  return res
}

const geocodeSchema = z.object({
  query: z.string().min(1).max(150).describe('a place name or an address'),
  lang: z.string().regex(/^[a-z]{2}$/).optional().describe('the language of the names, e.g. en or cs; cs when left out'),
})

const Places = z.object({
  items: z
    .array(
      z.object({
        name: z.string().optional(),
        label: z.string().optional(),
        location: z.string().optional(),
        position: z.object({ lon: z.number(), lat: z.number() }).optional(),
      }),
    )
    .default([]),
})
// Both fields are optional here, so a body without them is "no route", not a shape error.
const Route = z.object({ length: z.number().optional(), duration: z.number().optional() })

const geocode: ConnectorTool = {
  name: 'geocode',
  class: 'read',
  description: 'Find a place by name or address and get its coordinates (at most five matches). Use the coordinates with mapy__route.',
  schema: geocodeSchema,
  run: async ({ query, lang }: z.infer<typeof geocodeSchema>, env: ConnectorEnv, signal: AbortSignal) => {
    const body = await readAnswer(await call('/geocode', { query, lang: lang ?? 'cs', limit: '5' }, env, signal), Places, 'the map service')
    const lines = body.items
      .filter((p) => p.position !== undefined)
      .map((p) => [p.name, p.label, p.location].filter(Boolean).join(' — ') + ` — lon ${p.position?.lon}, lat ${p.position?.lat}`)
    if (lines.length === 0) throw new ConnectorError(`no place matches "${query}"`)
    return lines.join('\n')
  },
}

const point = z.object({ lon: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) })
const MODES = ['car_fast', 'foot_fast', 'bike_road'] as const
const routeSchema = z.object({
  from: point.describe('the start, as coordinates'),
  to: point.describe('the end, as coordinates'),
  mode: z.enum(MODES).describe('car_fast by car, foot_fast on foot, bike_road by bicycle'),
})

const route: ConnectorTool = {
  name: 'route',
  class: 'read',
  description: 'The road distance and the travel time between two points given as coordinates. Get coordinates with mapy__geocode or from an encyclopedia article.',
  schema: routeSchema,
  run: async ({ from, to, mode }: z.infer<typeof routeSchema>, env: ConnectorEnv, signal: AbortSignal) => {
    const res = await call('/routing/route', { start: `${from.lon},${from.lat}`, end: `${to.lon},${to.lat}`, routeType: mode, format: 'geojson' }, env, signal)
    const body = await readAnswer(res, Route, 'the map service')
    if (body.length === undefined || body.duration === undefined) throw new ConnectorError('the map service found no route between these points')
    return `about ${(body.length / 1000).toFixed(1)} km (${body.length} m), about ${Math.round(body.duration / 60)} minutes by ${mode}`
  },
}

export const mapy: BuiltinConnector = {
  id: 'mapy',
  title: 'Mapy.com',
  what: 'place coordinates, road distances and travel times, without the browser',
  onByDefault: false,
  unavailable: (_botId, env) => (env.mapyApiKey === null ? 'MAPY_API_KEY is not set' : null),
  tools: [geocode, route],
}
