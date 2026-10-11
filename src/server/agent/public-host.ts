import { isIP } from 'node:net'

// The guard for a tool that fetches an address the model chose. The model reads pages and mail that
// anyone can write, so the address can come from a stranger. A request from this process starts on
// the operator's machine: it reaches the platform's own API, other local programs and the local
// network, which no outside page can reach. Only a host on the public internet is allowed.
//
// Two checks, because a host is written in two ways. An address written as numbers is checked here,
// before any request. A name says nothing about where it leads, and its owner can change the answer
// between two questions, so a name is checked where the connection is made: page-fetch.ts resolves
// it and connects only to the addresses that passed `isPublicIpv4`.

/** `hostname` is a URL's hostname: the URL parser has already turned every numeric IPv4 form into four dotted numbers. */
export function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  // An IPv6 literal keeps its brackets in a URL's hostname. No public page needs one, so none is allowed.
  if (host.startsWith('[')) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (isIP(host) === 4) return isPublicIpv4(host)
  // A name with no dot is a name on the local network.
  return host.includes('.')
}

/** `address` is four dotted numbers. */
export function isPublicIpv4(address: string): boolean {
  const [a = 0, b = 0, c = 0] = address.split('.').map(Number)
  if (a === 0 || a === 10 || a === 127) return false // this host, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false // shared address space of a provider
  if (a === 169 && b === 254) return false // link-local
  if (a === 172 && b >= 16 && b <= 31) return false // private
  if (a === 192 && b === 168) return false // private
  // Set aside for protocols, for a retired relay service, for measuring and for examples in documents.
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
  if (a === 192 && b === 88 && c === 99) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if ((a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return false
  return a < 224 // multicast and reserved
}
