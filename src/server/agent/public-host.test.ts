import { describe, expect, it } from 'vitest'
import { isPublicHost } from './public-host'

/** The hostname as the tool sees it: after the URL parser. */
function hostOf(url: string): string {
  return new URL(url).hostname
}

describe('isPublicHost', () => {
  it('allows a public name and a public address', () => {
    for (const url of ['https://example.com/a', 'https://www.example.co.uk', 'http://93.184.216.34/', 'http://172.32.0.1/', 'http://100.128.0.1/']) {
      expect(isPublicHost(hostOf(url)), url).toBe(true)
    }
  })

  it('refuses this machine under every spelling the URL parser accepts', () => {
    for (const url of [
      'http://localhost:3000/api/bots',
      'http://LOCALHOST/',
      'http://localhost./',
      'http://app.localhost/',
      'http://127.0.0.1:3000/',
      'http://127.1/',
      'http://2130706433/',
      'http://0x7f.0.0.1/',
      'http://0177.0.0.1/',
      'http://0.0.0.0/',
      'http://user@127.0.0.1/',
      'http://[::1]:3000/',
      'http://[::ffff:127.0.0.1]/',
    ]) {
      expect(isPublicHost(hostOf(url)), url).toBe(false)
    }
  })

  it('refuses the local network: private, link-local and provider-shared ranges, and a name with no dot', () => {
    for (const url of [
      'http://10.0.0.5/',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://100.64.0.1/',
      'http://router/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
      'http://224.0.0.1/',
      'http://192.0.0.1/',
      'http://192.0.2.10/',
      'http://192.88.99.1/',
      'http://198.18.0.1/',
      'http://198.19.255.255/',
      'http://198.51.100.7/',
      'http://203.0.113.7/',
      'http://255.255.255.255/',
    ]) {
      expect(isPublicHost(hostOf(url)), url).toBe(false)
    }
  })

  it('keeps the neighbours of each private range public', () => {
    for (const url of ['http://9.255.255.255/', 'http://11.0.0.1/', 'http://172.15.0.1/', 'http://192.167.0.1/', 'http://169.253.0.1/', 'http://100.63.0.1/', 'http://223.255.255.1/', 'http://192.0.1.1/', 'http://192.0.3.1/', 'http://198.17.0.1/', 'http://198.20.0.1/', 'http://198.51.101.1/', 'http://203.0.112.1/']) {
      expect(isPublicHost(hostOf(url)), url).toBe(true)
    }
  })
})
