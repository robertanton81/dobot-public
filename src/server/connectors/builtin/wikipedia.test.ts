import { describe, expect, it } from 'vitest'
import { ConnectorError } from '../types'
import { envWith, header, json, recordingFetch } from './fakes'
import { wikipedia } from './wikipedia'

const page = wikipedia.tools.find((t) => t.name === 'page')!
const signal = new AbortController().signal

// The answer of cs.wikipedia.org for "Beroun", shortened; its shape as recorded on the day this was written.
const BEROUN = {
  batchcomplete: true,
  query: { pages: [{ pageid: 42309, ns: 0, title: 'Beroun', coordinates: [{ lat: 49.96390818, lon: 14.07206117, primary: true, globe: 'earth' }], extract: 'Beroun je město v okrese Beroun ve Středočeském kraji.' }] },
}

describe('the encyclopedia connector', () => {
  it('is on for every bot, has one read tool, and needs nothing from the operator', () => {
    expect(wikipedia.onByDefault).toBe(true)
    expect(wikipedia.unavailable('any-bot', envWith(fetch))).toBeNull()
    expect(wikipedia.tools.map((t) => [t.name, t.class])).toEqual([['page', 'read']])
  })

  it('asks the language edition for the text and coordinates of one article, and says who asks', async () => {
    const { fetchFn, requests } = recordingFetch([json(BEROUN)])
    const text = await page.run({ lang: 'cs', title: 'Beroun' } as never, envWith(fetchFn), signal)
    expect(text).toBe('Beroun\ncoordinates: lat 49.96390818, lon 14.07206117\n\nBeroun je město v okrese Beroun ve Středočeském kraji.')
    const [req] = requests
    expect(req?.url.origin + req!.url.pathname).toBe('https://cs.wikipedia.org/w/api.php')
    expect(Object.fromEntries(req!.url.searchParams)).toEqual({ action: 'query', format: 'json', formatversion: '2', prop: 'coordinates|extracts', explaintext: '1', redirects: '1', titles: 'Beroun' })
    expect(header(req!.init, 'user-agent')).toMatch(/^Dobot\/1\.0 \(\+https:\/\/github\.com\//)
  })

  it('refuses a language that is not a plain code, so the model cannot choose another host', () => {
    expect(page.schema.safeParse({ lang: 'evil.example/x', title: 'a' }).success).toBe(false)
    expect(page.schema.safeParse({ lang: 'en', title: 'a' }).success).toBe(true)
  })

  it('says plainly when the article does not exist or the service fails', async () => {
    const missing = recordingFetch([json({ query: { pages: [{ title: 'Nowhere', missing: true }] } })])
    await expect(page.run({ lang: 'en', title: 'Nowhere' } as never, envWith(missing.fetchFn), signal)).rejects.toThrow(new ConnectorError('there is no article titled "Nowhere" in the en edition'))
    const down = recordingFetch([json({}, 503)])
    await expect(page.run({ lang: 'en', title: 'X' } as never, envWith(down.fetchFn), signal)).rejects.toThrow(new ConnectorError('the encyclopedia answered http 503'))
  })

  it('names an answer that is not JSON, or not the known shape, instead of failing on it', async () => {
    const html = recordingFetch([() => new Response('<html>maintenance</html>', { status: 200, headers: { 'content-type': 'text/html' } })])
    await expect(page.run({ lang: 'en', title: 'X' } as never, envWith(html.fetchFn), signal)).rejects.toThrow(new ConnectorError('the encyclopedia answered something that is not JSON'))
    const odd = recordingFetch([json({ query: { pages: 'none' } })])
    await expect(page.run({ lang: 'en', title: 'X' } as never, envWith(odd.fetchFn), signal)).rejects.toThrow(new ConnectorError('the encyclopedia answered in a shape this connector does not know'))
  })

  it('sends one request at a time, even when two calls start together', async () => {
    let open = 0
    let most = 0
    const slow = (async () => {
      open += 1
      most = Math.max(most, open)
      await new Promise((resolve) => setImmediate(resolve))
      open -= 1
      return json(BEROUN)()
    }) as typeof fetch
    await Promise.all([page.run({ lang: 'cs', title: 'Beroun' } as never, envWith(slow), signal), page.run({ lang: 'cs', title: 'Beroun' } as never, envWith(slow), signal)])
    expect(most).toBe(1)
  })
})
