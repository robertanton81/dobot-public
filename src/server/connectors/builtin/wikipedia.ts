import { z } from 'zod'
import { ConnectorError, type BuiltinConnector, type ConnectorEnv, type ConnectorTool } from '../types'
import { readAnswer } from './answer'

// Wikipedia through the MediaWiki API: an article's plain text and its coordinates, with no key.
// The API asks clients to send one request at a time and to say who they are.

const USER_AGENT = 'Dobot/1.0 (+https://github.com/robertanton81/dobot-public)'

let queue: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.catch(() => undefined)
  return next
}

const Answer = z.object({
  query: z
    .object({
      pages: z.array(
        z.object({
          title: z.string(),
          missing: z.boolean().optional(),
          extract: z.string().optional(),
          coordinates: z.array(z.object({ lat: z.number(), lon: z.number() })).optional(),
        }),
      ),
    })
    .optional(),
})

const schema = z.object({
  // A plain language code: the model chooses the edition, never the host.
  lang: z.string().regex(/^[a-z]{2,3}$/).describe('the language edition, e.g. en or cs'),
  title: z.string().min(1).max(250).describe('the article title'),
})

const page: ConnectorTool = {
  name: 'page',
  class: 'read',
  description: 'Read a Wikipedia article as plain text, with its coordinates when it has them. Cheaper than fetch_url on the same page.',
  schema,
  run: ({ lang, title }: z.infer<typeof schema>, env: ConnectorEnv, signal: AbortSignal) =>
    oneAtATime(async () => {
      const url = new URL(`https://${lang}.wikipedia.org/w/api.php`)
      url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', prop: 'coordinates|extracts', explaintext: '1', redirects: '1', titles: title }).toString()
      const res = await env.fetch(url, { signal, headers: { 'user-agent': USER_AGENT } })
      if (!res.ok) throw new ConnectorError(`the encyclopedia answered http ${res.status}`)
      const body = await readAnswer(res, Answer, 'the encyclopedia')
      const found = body.query?.pages[0]
      if (!found || found.missing) throw new ConnectorError(`there is no article titled "${title}" in the ${lang} edition`)
      const point = found.coordinates?.[0]
      const where = point ? `\ncoordinates: lat ${point.lat}, lon ${point.lon}` : ''
      return `${found.title}${where}\n\n${found.extract ?? ''}`.trim()
    }),
}

export const wikipedia: BuiltinConnector = {
  id: 'wikipedia',
  title: 'Wikipedia',
  what: 'the text and coordinates of Wikipedia articles',
  onByDefault: true,
  unavailable: () => null,
  tools: [page],
}
