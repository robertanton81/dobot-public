import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'
import { pipeline, Readable } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { isPublicHost, isPublicIpv4 } from './public-host'

// The network client of fetch_url: one GET to a public host, and nothing else. It differs from the
// built-in fetch in the one place that matters here: the name is resolved by this file's own lookup,
// inside the connection, and the socket connects only to the addresses that lookup let through. A
// check of the name before the request cannot give that: the name's owner can answer the check with
// a public address and the connection with a local one.
//
// Only IPv4 addresses are asked for, so there is one list of ranges to get right. A host that has
// only an IPv6 address cannot be read.
//
// A redirect is never followed: the 3xx answer goes back to the caller, which checks the next address.

/** The host is this machine or the local network: by its written address, or by what its name resolves to. */
export class LocalAddressError extends Error {
  override name = 'LocalAddressError'
}

export type PageFetchInit = { signal: AbortSignal; headers: Record<string, string> }
/** Resolves with the answer, whatever its status; rejects when no answer came. The body is a stream: the caller reads or cancels it. */
export type PageFetch = (url: URL, init: PageFetchInit) => Promise<Response>

type Resolve = (hostname: string, options: { family: 4; all: true }, callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void

/**
 * A lookup for `net.connect` that lets a name through only when every address it resolves to is
 * public. One local address among public ones refuses the name: which of them the socket would try
 * is not this function's choice. `resolve` is the system resolver; the tests pass their own.
 */
export function checkedLookup(resolve: Resolve = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { family: 4, all: true }, (err, addresses) => {
      if (err) return callback(err, [])
      if (addresses.length === 0 || !addresses.every((a) => a.family === 4 && isPublicIpv4(a.address))) {
        return callback(new LocalAddressError(`${hostname} does not resolve to a public address`), [])
      }
      // Node asks for every address when it may try more than one, and for one otherwise.
      if (options.all) return callback(null, addresses)
      const first = addresses[0]
      if (first === undefined) return callback(new LocalAddressError(`${hostname} does not resolve to a public address`), [])
      callback(null, first.address, first.family)
    })
  }
}

// Statuses whose answer has no body; `Response` refuses a body for them.
const NO_BODY = new Set([204, 205, 304])

function decoderFor(encoding: string) {
  if (encoding === 'gzip' || encoding === 'x-gzip') return createGunzip()
  if (encoding === 'deflate') return createInflate()
  if (encoding === 'br') return createBrotliDecompress()
  return null
}

function toResponse(res: IncomingMessage): Response {
  const headers = new Headers()
  for (const [name, value] of Object.entries(res.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  const status = res.statusCode ?? 0
  if (NO_BODY.has(status)) {
    res.resume()
    return new Response(null, { status, headers })
  }
  const decoder = decoderFor((res.headers['content-encoding'] ?? '').trim().toLowerCase())
  if (decoder !== null) {
    // The body below is the decoded one, so the two headers that describe the coded one go.
    headers.delete('content-encoding')
    headers.delete('content-length')
  }
  // pipeline ties the two streams together: a caller that cancels the body closes the socket too, and
  // a broken connection or broken coding ends the body with that error. The callback has nothing to add.
  const body = decoder === null ? res : pipeline(res, decoder, () => undefined)
  // Node's web stream and the DOM's are one class with two type declarations.
  return new Response(Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>, { status, headers })
}

/** `lookup` is what stands between a name and a socket; only the tests replace it, to reach a server on this machine. */
export function createPageFetch(lookup: LookupFunction = checkedLookup()): PageFetch {
  return (url, { signal, headers }) =>
    new Promise<Response>((resolve, reject) => {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return reject(new TypeError('only http and https can be fetched'))
      // Node skips the lookup for a host written as numbers, so that spelling is checked here.
      if (!isPublicHost(url.hostname)) return reject(new LocalAddressError(`${url.hostname} is not a public host`))
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest
      // agent: false gives the request a connection of its own, closed when the body ends or is cancelled.
      const request = send(url, { method: 'GET', headers: { ...headers, 'accept-encoding': 'gzip, deflate, br' }, lookup, family: 4, signal, agent: false }, (res) => {
        try {
          resolve(toResponse(res))
        } catch (e) {
          res.destroy()
          reject(e)
        }
      })
      request.on('error', reject)
      request.end()
    })
}

export const pageFetch: PageFetch = createPageFetch()
