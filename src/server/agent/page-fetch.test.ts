import type { LookupAddress } from 'node:dns'
import { createServer, type Server } from 'node:http'
import type { AddressInfo, LookupFunction } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkedLookup, createPageFetch, LocalAddressError } from './page-fetch'

const HEADERS = { accept: 'text/html' }
const init = (signal: AbortSignal = new AbortController().signal) => ({ signal, headers: HEADERS })

/** A resolver that answers from a table and records its calls, with the options of each. */
function resolver(table: Record<string, string[]>) {
  const asked: string[] = []
  const askedWith: unknown[] = []
  const resolve = (hostname: string, options: { family: 4; all: true }, callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void): void => {
    asked.push(hostname)
    askedWith.push(options)
    const found = table[hostname]
    if (!found) return callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), [])
    callback(null, found.map((address) => ({ address, family: 4 })))
  }
  return { resolve, asked, askedWith }
}

/** Calls a lookup the two ways Node does, and gives back what the socket would get. */
function ask(lookup: LookupFunction, hostname: string, all: boolean): Promise<{ err: Error | null; address: string | LookupAddress[]; family: number | undefined }> {
  return new Promise((done) => lookup(hostname, { all }, (err, address, family) => done({ err, address, family })))
}

describe('checkedLookup', () => {
  it('lets a name through when every address it resolves to is public, in both shapes Node asks for', async () => {
    const { resolve, askedWith } = resolver({ 'example.com': ['93.184.216.34', '93.184.216.35'] })
    expect(await ask(checkedLookup(resolve), 'example.com', true)).toEqual({ err: null, address: [{ address: '93.184.216.34', family: 4 }, { address: '93.184.216.35', family: 4 }], family: undefined })
    expect(await ask(checkedLookup(resolve), 'example.com', false)).toEqual({ err: null, address: '93.184.216.34', family: 4 })
    // The resolver is always asked for every IPv4 address, whatever Node asked this lookup for:
    // one address alone could hide a local one behind it.
    expect(askedWith).toEqual([{ family: 4, all: true }, { family: 4, all: true }])
  })

  it('uses the system resolver when it is given none: this machine\'s own name is refused', async () => {
    expect((await ask(checkedLookup(), 'localhost', true)).err).toBeInstanceOf(LocalAddressError)
  })

  it('refuses a name that resolves to this machine or the local network', async () => {
    const { resolve } = resolver({ 'loop.example': ['127.0.0.1'], 'lan.example': ['192.168.1.1'], 'meta.example': ['169.254.169.254'], 'zero.example': ['0.0.0.0'] })
    for (const name of ['loop.example', 'lan.example', 'meta.example', 'zero.example']) {
      for (const all of [true, false]) {
        const { err, address } = await ask(checkedLookup(resolve), name, all)
        expect(err, name).toBeInstanceOf(LocalAddressError)
        expect(address, name).toEqual([])
      }
    }
  })

  it('refuses the whole name when one local address hides among public ones', async () => {
    const { resolve } = resolver({ 'mixed.example': ['93.184.216.34', '10.0.0.5'] })
    expect((await ask(checkedLookup(resolve), 'mixed.example', true)).err).toBeInstanceOf(LocalAddressError)
  })

  it('refuses a name with no address, and passes a resolver error on as it is', async () => {
    const { resolve } = resolver({ 'empty.example': [] })
    expect((await ask(checkedLookup(resolve), 'empty.example', true)).err).toBeInstanceOf(LocalAddressError)
    const unknown = await ask(checkedLookup(resolve), 'nowhere.example', true)
    expect(unknown.err).toMatchObject({ code: 'ENOTFOUND' })
    expect(unknown.err).not.toBeInstanceOf(LocalAddressError)
  })
})

describe('the page client, against a real server on this machine', () => {
  let server: Server
  let port: number
  let paths: string[]
  /** Only for these tests: every name leads to this machine, unchecked, so the client can reach the server. */
  const toThisMachine: LookupFunction = (_hostname, options, callback) => (options.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4))

  beforeEach(async () => {
    paths = []
    server = createServer((req, res) => {
      paths.push(req.url ?? '')
      if (req.url === '/moved') {
        res.writeHead(302, { location: '/target' })
        res.end()
      } else if (req.url === '/zipped') {
        const body = gzipSync('<p>zipped text</p>')
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip', 'content-length': String(body.length) })
        res.end(body)
      } else if (req.url === '/endless') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.write('first part')
      } else if (req.url === '/empty') {
        res.writeHead(204)
        res.end()
      } else {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-seen-encoding': String(req.headers['accept-encoding']), 'x-seen-accept': String(req.headers.accept) })
        res.end('<p>plain text</p>')
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })
  afterEach(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  it('gives back the status, the headers and the body, and sends the headers it was given', async () => {
    const res = await createPageFetch(toThisMachine)(new URL(`http://site.test:${port}/page`), init())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('x-seen-accept')).toBe('text/html')
    expect(res.headers.get('x-seen-encoding')).toBe('gzip, deflate, br')
    expect(await res.text()).toBe('<p>plain text</p>')
  })

  it('decodes a zipped body and drops the two headers that described the coded one', async () => {
    const res = await createPageFetch(toThisMachine)(new URL(`http://site.test:${port}/zipped`), init())
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(res.headers.get('content-length')).toBeNull()
    expect(await res.text()).toBe('<p>zipped text</p>')
  })

  it('hands a redirect back as it is and never follows it', async () => {
    const res = await createPageFetch(toThisMachine)(new URL(`http://site.test:${port}/moved`), init())
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/target')
    await res.body?.cancel()
    expect(paths).toEqual(['/moved'])
  })

  it('gives an answer with no body for a status that has none', async () => {
    const res = await createPageFetch(toThisMachine)(new URL(`http://site.test:${port}/empty`), init())
    expect(res.status).toBe(204)
    expect(res.body).toBeNull()
  })

  it('ends a body that is still coming when the signal fires', async () => {
    const stop = new AbortController()
    const res = await createPageFetch(toThisMachine)(new URL(`http://site.test:${port}/endless`), init(stop.signal))
    const reader = res.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first part')
    stop.abort()
    await expect(reader.read()).rejects.toThrow()
  })

  it('refuses a host written as a local address, whatever the lookup would say, and sends nothing', async () => {
    for (const url of [`http://127.0.0.1:${port}/page`, `http://localhost:${port}/page`, `http://[::1]:${port}/page`, `http://2130706433:${port}/page`]) {
      await expect(createPageFetch(toThisMachine)(new URL(url), init()), url).rejects.toBeInstanceOf(LocalAddressError)
    }
    expect(paths).toEqual([])
  })

  // The name looks public and leads to this machine: what a rebinding name does at the moment it matters.
  it('refuses a public-looking name that resolves to this machine, asks the resolver once, and sends nothing', async () => {
    const { resolve, asked } = resolver({ 'rebind.example': ['127.0.0.1'] })
    await expect(createPageFetch(checkedLookup(resolve))(new URL(`http://rebind.example:${port}/page`), init())).rejects.toBeInstanceOf(LocalAddressError)
    expect(asked).toEqual(['rebind.example'])
    expect(paths).toEqual([])
  })
})
