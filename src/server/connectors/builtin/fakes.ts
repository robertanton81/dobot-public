import type { ConnectorEnv } from '../types'

// A recording stand-in for the network: each request is kept, each answer is the next one given.

export type Recorded = { url: URL; init: RequestInit }

export function recordingFetch(answers: (() => Response)[]) {
  const requests: Recorded[] = []
  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    requests.push({ url: new URL(input instanceof Request ? input.url : input), init })
    const next = answers.shift()
    if (!next) throw new Error('no recorded answer left')
    return next()
  }) as typeof fetch
  return { fetchFn, requests }
}

export function json(body: unknown, status = 200): () => Response {
  return () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export function envWith(fetchFn: typeof fetch, extra: Partial<ConnectorEnv> = {}): ConnectorEnv {
  return { fetch: fetchFn, mapyApiKey: null, mailbox: null, mailboxBotId: null, ...extra }
}

export function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name)
}
