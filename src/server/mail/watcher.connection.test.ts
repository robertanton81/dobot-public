import { createServer, type Server, type Socket } from 'node:net'
import { ImapFlow } from 'imapflow'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { imapOptions, ImapMailbox, MailWatcher } from './watcher'

// A local IMAP peer exercises the installed client's socket-error events, including cleanup.
// PREAUTH needs no credentials. Silence on an outstanding command triggers its real watchdog.
let server: Server
let port: number
let mode: 'ready' | 'status timeout' | 'logout timeout' | 'refuse' = 'ready'
let highestUid = 4
let sockets: Set<Socket>
let closed: Promise<void>[]

beforeEach(async () => {
  mode = 'ready'
  highestUid = 4
  sockets = new Set()
  closed = []
  server = createServer((socket) => {
    sockets.add(socket)
    closed.push(new Promise((resolve) => socket.once('close', () => { sockets.delete(socket); resolve() })))
    socket.on('error', () => socket.destroy())
    if (mode === 'refuse') {
      socket.end('* BYE unavailable\r\n')
      return
    }
    socket.write('* PREAUTH [CAPABILITY IMAP4rev1] ready\r\n')
    let input = ''
    socket.on('data', (chunk) => {
      input += chunk.toString()
      while (input.includes('\r\n')) {
        const end = input.indexOf('\r\n')
        const line = input.slice(0, end)
        input = input.slice(end + 2)
        const [tag, command] = line.split(' ')
        if (command === 'CAPABILITY') socket.write('* CAPABILITY IMAP4rev1\r\n')
        else if (command === 'LIST') socket.write('* LIST () "/" "INBOX"\r\n')
        else if (command === 'LSUB') socket.write('* LSUB () "/" "INBOX"\r\n')
        else if (command === 'STATUS') {
          if (mode === 'status timeout') continue
          socket.write('* STATUS INBOX (UNSEEN 1 UIDVALIDITY 7)\r\n')
        } else if (command === 'EXAMINE') {
          socket.write('* 1 EXISTS\r\n* OK [UIDVALIDITY 7] valid\r\n* FLAGS (\\Seen)\r\n')
        } else if (command === 'FETCH') socket.write(`* 1 FETCH (UID ${highestUid})\r\n`)
        else if (command === 'LOGOUT') {
          if (mode === 'logout timeout') continue
          socket.end(`* BYE finished\r\n${tag} OK logout\r\n`)
          continue
        } else throw new Error(`unexpected IMAP command: ${command}`)
        socket.write(`${tag} OK completed\r\n`)
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no TCP address')
  port = address.port
})

afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  await Promise.all(closed)
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

function mailbox(): ImapMailbox {
  const settings = { host: '127.0.0.1', port, user: '', password: '' }
  return new ImapMailbox(settings, () => new ImapFlow({
    ...imapOptions(settings), secure: false, doSTARTTLS: false,
    disableAutoIdle: true, socketTimeout: 100,
  }))
}

describe('mailbox connection lifecycle', () => {
  it('reads real IMAP replies and closes the connection after logout', async () => {
    expect(await mailbox().read()).toEqual({ unseen: 1, uidNext: 5, uidValidity: '7' })
    await Promise.all(closed)
    expect(sockets.size).toBe(0)
  })

  it.each(['status timeout', 'logout timeout'] as const)('rejects a %s without an unhandled error and permits the next read', async (failure) => {
    mode = failure
    const reader = mailbox()
    await expect(reader.read()).rejects.toThrow()
    await Promise.all(closed)
    expect(sockets.size).toBe(0)
    mode = 'ready'
    expect(await reader.read()).toEqual({ unseen: 1, uidNext: 5, uidValidity: '7' })
  })

  it('preserves the baseline on a connection failure and detects the mail on the next poll', async () => {
    let delivered = 0
    const watcher = new MailWatcher({ mailbox: mailbox(), onMail: async () => { delivered++; return true }, debounceMs: 0 })
    await watcher.tick()
    highestUid = 5
    mode = 'status timeout'
    await watcher.tick()
    expect(delivered).toBe(0)
    mode = 'ready'
    await watcher.tick()
    expect(delivered).toBe(1)
  })

  it('closes a connection refused during the greeting and can connect on the next read', async () => {
    mode = 'refuse'
    const reader = mailbox()
    await expect(reader.read()).rejects.toThrow()
    await Promise.all(closed)
    expect(sockets.size).toBe(0)
    mode = 'ready'
    expect((await reader.read()).uidNext).toBe(5)
  })
})
