// Probe: what the real adapter and the pinned SDK reject with when the provider cannot be
// reached, how deep the `cause` chain goes on this Node, and what errorFields() logs for it.
// Placeholder key. Targets: a closed loopback port, a plain-HTTP loopback port spoken to with TLS,
// a loopback server that cuts the stream, and one name under the reserved `.invalid` domain
// (that case sends one DNS question; nothing else leaves this machine).
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '')
const { AnthropicModel } = await import(`${ROOT}/src/server/agent/model.ts`)
const { errorFields } = await import(`${ROOT}/src/server/log.ts`)

process.env.ANTHROPIC_API_KEY = 'test-placeholder-not-a-credential'
const params = { model: 'claude-sonnet-5', max_tokens: 100, messages: [{ role: 'user' as const, content: 'probe' }] }

const chain = (e: unknown): unknown[] => {
  const out: unknown[] = []
  let cur: any = e
  for (let depth = 0; depth < 6 && cur !== undefined && cur !== null; depth += 1) {
    out.push(
      typeof cur === 'object'
        ? {
            depth,
            ctor: cur.constructor?.name,
            name: cur.name,
            code: cur.code,
            message: typeof cur.message === 'string' ? cur.message.slice(0, 160) : cur.message,
            ownKeys: Object.keys(cur),
            errorsInside: Array.isArray(cur.errors) ? cur.errors.map((x: any) => ({ name: x?.name, code: x?.code, message: String(x?.message).slice(0, 120) })) : undefined,
          }
        : { depth, typeof: typeof cur },
    )
    cur = cur.cause
  }
  return out
}

const show = async (label: string, baseUrl: string): Promise<void> => {
  process.env.ANTHROPIC_BASE_URL = baseUrl
  const startedAt = Date.now()
  const e = await new AnthropicModel({ stallTimeoutMs: 2000 }).create(params).then(() => null, (err: unknown) => err)
  console.log(`\n=== ${label} (${Date.now() - startedAt} ms) ===`)
  console.log(JSON.stringify({ chain: chain(e), logged: errorFields(e) }, null, 2))
}

// A port that was open a moment ago and is closed now.
const closedPort = await new Promise<number>((resolve) => {
  const s = createServer()
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address() as AddressInfo
    s.close(() => resolve(port))
  })
})

// A plain HTTP server: a TLS client hello is not HTTP, so the handshake fails.
const plain = createServer((_req, res) => res.end('plain'))
await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', () => resolve()))
const plainPort = (plain.address() as AddressInfo).port

// A server that sends the headers of a stream and one event, then cuts the connection.
const cutter = createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(
      `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_probe', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })}\n\n`,
    )
    setTimeout(() => res.destroy(), 50)
  })
})
await new Promise<void>((resolve) => cutter.listen(0, '127.0.0.1', () => resolve()))
const cutterPort = (cutter.address() as AddressInfo).port

await show('A. a closed port on 127.0.0.1 (connection refused)', `http://127.0.0.1:${closedPort}`)
await show('B. a closed port on "localhost" (two addresses may be tried)', `http://localhost:${closedPort}`)
await show('C. a name that does not resolve', 'http://provider-that-does-not-exist.invalid')
await show('D. TLS spoken to a plain HTTP port', `https://127.0.0.1:${plainPort}`)
await show('E. the connection is cut in the middle of the stream', `http://127.0.0.1:${cutterPort}`)

plain.closeAllConnections()
cutter.closeAllConnections()
await Promise.all([new Promise<void>((r) => plain.close(() => r())), new Promise<void>((r) => cutter.close(() => r()))])
