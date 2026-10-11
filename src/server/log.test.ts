import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import Anthropic from '@anthropic-ai/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleaned, cleanedExcerpt, errorFields, hideInLogs, log } from './log'

afterEach(() => vi.restoreAllMocks())

/** What one log call writes, as the text and as the parsed line. */
function written(call: () => void, stream: 'stdout' | 'stderr' = 'stderr'): { text: string; line: Record<string, unknown> } {
  let text = ''
  vi.spyOn(process[stream], 'write').mockImplementation((chunk) => {
    text += String(chunk)
    return true
  })
  call()
  return { text, line: JSON.parse(text) as Record<string, unknown> }
}

describe('the logger hides secrets on the way out', () => {
  it('hides a registered value wherever it stands: in an error message, in a thrown string, in any field', () => {
    hideInLogs(['configured-mailbox-password'])
    const fromError = written(() => log.error('send failed', errorFields(new Error('535 auth failed for configured-mailbox-password'))))
    expect(fromError.text).not.toContain('configured-mailbox-password')
    expect(fromError.line).toMatchObject({ msg: 'send failed', errorName: 'Error', errorMessage: '535 auth failed for [redacted]' })
    const fromString = written(() => log.error('odd throw', errorFields('configured-mailbox-password leaked')))
    expect(fromString.line).toMatchObject({ errorName: 'unknown', errorMessage: '[redacted] leaked' })
    const fromField = written(() => log.info('note', { nested: { deep: ['configured-mailbox-password'] } }), 'stdout')
    expect(fromField.text).not.toContain('configured-mailbox-password')
  })

  it('hides a registered value that holds a quote or a backslash, and the line is still JSON', () => {
    hideInLogs(['pa"ss\\word-with-marks', 'ends-with-a-backslash\\', '"starts-with-a-quote'])
    for (const secret of ['ends-with-a-backslash\\', '"starts-with-a-quote']) {
      const edge = written(() => log.error('failed', errorFields(new Error(secret))))
      expect(edge.line.errorMessage).toBe('[redacted]')
    }
    const { text, line } = written(() => log.error('failed', errorFields(new Error('bad login: pa"ss\\word-with-marks'))))
    expect(text).not.toContain('word-with-marks')
    expect(line.errorMessage).toBe('bad login: [redacted]')
  })

  it('does not register a short value, which would blank ordinary words', () => {
    expect(hideInLogs(['run', undefined])).toBe(1)
    expect(written(() => log.info('run started', { runId: 'run-1' }), 'stdout').line).toMatchObject({ msg: 'run started', runId: 'run-1' })
  })

  it('hides a key in a URL and keeps the rest of the address', () => {
    const { line } = written(() => log.error('stream failed', errorFields(new Error('GET https://6080-abc.example.dev/vnc.html?autoconnect=true&password=0123456789abcdef&resize=scale failed'))))
    expect(line.errorMessage).toBe('GET https://6080-abc.example.dev/vnc.html?autoconnect=true&password=[redacted]&resize=scale failed')
  })

  it('hides a bearer token, a name and password inside an address, and the shape of a provider key', () => {
    expect(cleaned('authorization: Bearer abc.DEF-123_xyz rejected')).toBe('authorization: Bearer [redacted] rejected')
    expect(cleaned('connect imaps://bot%40example.com:hunter2secret@mail.example.com:993 failed')).toBe('connect imaps://[redacted]@mail.example.com:993 failed')
    expect(cleaned('invalid x-api-key sk-ant-api03-AbCdEf123456 for request')).toBe('invalid x-api-key [redacted] for request')
    expect(cleaned('key e2b_0123456789abcdef refused')).toBe('key [redacted] refused')
  })

  it('hides what follows a name that means a secret, in plain text and as a field of the line', () => {
    const { text, line } = written(() => log.error('provider error', errorFields(new Error('request rejected; credential=SYNTHETIC-VALUE-1 and api_key: SYNTHETIC-VALUE-2, retry'))))
    expect(text).not.toContain('SYNTHETIC-VALUE')
    expect(line.errorMessage).toBe('request rejected; credential=[redacted] and api_key: [redacted], retry')
    const asField = written(() => log.info('settings', { password: 'SYNTHETIC-VALUE-3', Authorization: 'Basic SYNTHETIC-VALUE-4', user: 'bot' }), 'stdout')
    expect(asField.text).not.toContain('SYNTHETIC-VALUE')
    expect(asField.line).toMatchObject({ password: '[redacted]', Authorization: '[redacted]', user: 'bot' })
  })

  it('keeps the fields the platform logs about keys and tokens that are no secrets', () => {
    const { line } = written(() => log.info('step', { action: 'key', key: 'Return', inputTokens: 1200, outputTokens: 40, code: 'unchanged', summary: 'pressed key Return; token count 1240' }), 'stdout')
    expect(line).toMatchObject({ action: 'key', key: 'Return', inputTokens: 1200, outputTokens: 40, code: 'unchanged', summary: 'pressed key Return; token count 1240' })
  })

  // The text of an error comes from outside, and the cleaning runs on the process's one thread.
  it('cleans a large hostile text in time that grows with its size, not with its square', () => {
    for (const text of ['://' + 'a:'.repeat(100_000), '://a:b'.repeat(50_000), ('Bearer' + ' '.repeat(50)).repeat(4_000), 'password='.repeat(30_000), ('token' + ' '.repeat(40) + ':').repeat(5_000), '?key='.repeat(50_000)]) {
      const started = performance.now()
      cleaned(text)
      expect(performance.now() - started, text.slice(0, 12)).toBeLessThan(1_000)
    }
  })

  it('keeps only the start of a very long error message', () => {
    const fields = errorFields(new Error('x'.repeat(10_000)))
    expect(fields.errorMessage).toHaveLength(2_001)
    expect(fields.errorMessage.endsWith('…')).toBe(true)
    expect(errorFields(new Error('short')).errorMessage).toBe('short')
  })

  it('hides a registered value that crosses the point where a long message is cut', () => {
    const secret = `marker-${'a1b2c3d4e5f6g7'.repeat(3)}`
    hideInLogs([secret])
    // All of the value but its last character stands before the cut.
    const message = `${'x'.repeat(2_000 - (secret.length - 1))}${secret} and the rest of a long text`
    const fields = errorFields(new Error(message))
    expect(fields.errorMessage).not.toContain('marker-')
    expect(fields.errorMessage.length).toBeLessThanOrEqual(2_001)
    const { text } = written(() => log.error('failed', fields))
    expect(text).not.toContain('marker-')
    expect(text).toContain('[redacted]')
  })

  it('never throws on a message that is not text, and still hides and cuts it', () => {
    hideInLogs(['configured-mailbox-password'])
    const odd = new Error('replaced below')
    Object.defineProperty(odd, 'message', { value: { detail: 'login failed for configured-mailbox-password', filler: 'x'.repeat(5_000) } })
    const fields = errorFields(odd)
    expect(fields.errorMessage).toContain('login failed for [redacted]')
    expect(fields.errorMessage.length).toBeLessThanOrEqual(2_001)
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(errorFields(Object.assign(new Error('x'), { message: circular })).errorMessage).toBe('(a message that cannot be read)')
    expect(errorFields(Object.assign(new Error('x'), { message: undefined })).errorMessage).toBe('undefined')
    expect(errorFields(42).errorMessage).toBe('42')
  })

  it('leaves ordinary text and ordinary addresses alone', () => {
    const text = 'opened https://example.com/page?id=42&lang=en at 10:30: 3 items, see http://localhost:3000/api/health'
    expect(cleaned(text)).toBe(text)
  })
})

// A failed connection keeps its real reason two causes deep: the SDK's "Connection error." is
// caused by fetch's "fetch failed", and that is caused by the system error that has the code.
// The log names this chain, so a refused connection can be told from a name that does not
// resolve. Each cause is named by its kind only, never by its text: a library's text can quote a
// request, an address with a token in it, or a model's answer.

/** A port on this machine that was open a moment ago and is closed now. */
const closedPort = (): Promise<number> =>
  new Promise((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      server.close(() => resolve(port))
    })
  })

const causedBy = (cause: unknown): Error => new Error('outer', { cause })

describe('errorFields', () => {
  it('keeps its two fields, and adds none, for an error without a cause', () => {
    expect(errorFields(new Error('plain'))).toStrictEqual({ errorName: 'Error', errorMessage: 'plain' })
    expect(errorFields('a thrown string')).toStrictEqual({ errorName: 'unknown', errorMessage: 'a thrown string' })
  })

  it('names the causes of a refused connection, outermost first, by name and code', async () => {
    const refused = await fetch(`http://127.0.0.1:${await closedPort()}`).then(
      () => null,
      (e: unknown) => e,
    )
    // The error the model SDK builds around what fetch rejected with.
    const error = new Anthropic.APIConnectionError({ cause: refused as Error })

    expect(errorFields(error)).toStrictEqual({ errorName: 'Error', errorMessage: 'Connection error.', errorCauses: ['TypeError', 'Error ECONNREFUSED'] })
  })

  // Several addresses tried for one name fail as one error that carries the code itself.
  it('names an error that stands for several failed tries by its own name and code', () => {
    const tries = Object.assign(new AggregateError([new Error('connect ECONNREFUSED ::1:1'), new Error('connect ECONNREFUSED 127.0.0.1:1')], ''), { code: 'ECONNREFUSED' })

    expect(errorFields(causedBy(new TypeError('fetch failed', { cause: tries }))).errorCauses).toEqual(['TypeError', 'AggregateError ECONNREFUSED'])
  })

  it('never logs the text of a cause', () => {
    const inner = Object.assign(new Error('GET https://example.com/stream?token=MARKER_TOKEN failed'), { code: 'ECONNRESET' })
    const fields = errorFields(causedBy(new TypeError('MARKER_PAYLOAD quoted from an answer', { cause: inner })))

    expect(fields.errorCauses).toEqual(['TypeError', 'Error ECONNRESET'])
    expect(JSON.stringify(fields)).not.toMatch(/MARKER|example\.com|token/)
  })

  it('logs a name or a code only when it is a short identifier', () => {
    const wordy = Object.assign(new Error('inner'), { name: 'a name with MARKER text', code: 'a code with MARKER text' })
    const long = Object.assign(new Error('inner'), { code: 'A'.repeat(65) })

    expect(errorFields(causedBy(wordy)).errorCauses).toEqual(['unknown'])
    expect(errorFields(causedBy(long)).errorCauses).toEqual(['Error'])
  })

  // A name is text by its type only. At run time it can be anything, and testing a symbol against
  // a pattern throws, which would end the chain before the cause that has the code.
  it('names a cause whose name is not text as unknown, and goes on down the chain', () => {
    const deepest = Object.assign(new Error('deepest'), { code: 'ENOTFOUND' })
    const odd = Object.assign(new Error('inner', { cause: deepest }), { name: Symbol('MARKER') })
    const shifty = Object.assign(new Error('inner'), { name: { toString: (): string => 'MARKER text' } })

    expect(errorFields(causedBy(odd)).errorCauses).toEqual(['unknown', 'Error ENOTFOUND'])
    expect(errorFields(causedBy(shifty)).errorCauses).toEqual(['unknown'])
  })

  // A name or a code can be a getter. Each is read once, so what passed the check is what is
  // logged, and a value that changes between two reads cannot put a sentence into the log.
  it('reads a name and a code once each', () => {
    const changing = (reads = 0): (() => string) => () => ((reads += 1) <= 2 ? 'Fine' : 'MARKER text that is not an identifier')
    const shifty = new Error('inner')
    Object.defineProperty(shifty, 'name', { get: changing() })
    Object.defineProperty(shifty, 'code', { get: changing() })

    const fields = errorFields(causedBy(shifty))

    expect(fields.errorCauses).toEqual(['Fine Fine'])
    expect(JSON.stringify(fields)).not.toContain('MARKER')
  })

  it('logs a code that is a number', () => {
    const unavailable = Object.assign(new Error('inner'), { name: 'ConnectError', code: 14 })

    expect(errorFields(causedBy(unavailable)).errorCauses).toEqual(['ConnectError 14'])
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('leaves out a code that is a number but not a finite one (%s)', (code) => {
    expect(errorFields(causedBy(Object.assign(new Error('inner'), { code }))).errorCauses).toEqual(['Error'])
  })

  it('logs a name and a code of exactly 64 characters, the longest it accepts', () => {
    const longest = 'A'.repeat(64)

    expect(errorFields(causedBy(Object.assign(new Error('inner'), { name: longest, code: longest }))).errorCauses).toEqual([`${longest} ${longest}`])
  })

  // `typeof null` is "object", so a null cause must end the chain before it is named by its type.
  it('adds nothing for a cause that is null', () => {
    expect(errorFields(new Error('outer', { cause: null }))).toStrictEqual({ errorName: 'Error', errorMessage: 'outer' })
  })

  it('names a cause that is not an error by its kind only, and looks no deeper', () => {
    expect(errorFields(causedBy('MARKER text')).errorCauses).toEqual(['(string)'])
    expect(errorFields(causedBy({ secret: 'MARKER', cause: new Error('deeper') })).errorCauses).toEqual(['(object)'])
  })

  it('stops after five causes', () => {
    let chain = new Error('cause 8')
    for (let depth = 7; depth >= 1; depth -= 1) chain = new RangeError(`cause ${depth}`, { cause: chain })

    expect(errorFields(causedBy(chain)).errorCauses).toEqual(['RangeError', 'RangeError', 'RangeError', 'RangeError', 'RangeError'])
  })

  it('stops at a cause it has already named', () => {
    const first = new Error('first')
    const second = new TypeError('second', { cause: first })
    first.cause = second

    expect(errorFields(first).errorCauses).toEqual(['TypeError'])
  })

  // The function runs inside catch blocks, where a second failure would hide the first.
  it('does not throw when a cause cannot be read, and keeps its two fields', () => {
    const hostile = new Error('outer')
    Object.defineProperty(hostile, 'cause', {
      get(): never {
        throw new Error('unreadable')
      },
    })

    expect(errorFields(hostile)).toStrictEqual({ errorName: 'Error', errorMessage: 'outer' })
  })
})

describe('cleanedExcerpt', () => {
  it('cleans before it cuts, so a registered value that the cut would divide never shows in part', () => {
    const value = 'probe-session-value-0123456789abcdef'
    hideInLogs([value])
    const text = 'x'.repeat(190) + value + ' and more'
    const excerpt = cleanedExcerpt(text, 200)
    expect(excerpt.length).toBeLessThanOrEqual(200)
    expect(excerpt).not.toContain('probe-sess')
  })
})
