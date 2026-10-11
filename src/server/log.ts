// One JSON line per entry. No formatting library. A caller passes names, counts and states, never a
// secret; an error's message is the one field whose text comes from outside (a provider, a mail
// server, a page), so every line is also cleaned on its way out: the values the process was told to
// hide, and the shapes a credential has inside a text (a key in a URL, a bearer token, a provider key).

type Fields = Record<string, unknown>

const REDACTED = '[redacted]'
/** Shorter values are not hidden: a short word would blank ordinary text. */
const MIN_SECRET_LENGTH = 8
const hidden = new Set<string>()

/** Registers values that must never reach a log line: the configured keys and passwords, and the keys a session makes. Gives back how many were too short to register. */
export function hideInLogs(values: (string | undefined)[]): number {
  let tooShort = 0
  for (const value of values) {
    if (value === undefined) continue
    if (value.length < MIN_SECRET_LENGTH) {
      tooShort += 1
      continue
    }
    // First the value as it stands inside a JSON string, which is the longer one when the value holds
    // a quote or a backslash: replaced second, its first half would be gone and a stray backslash left.
    hidden.add(JSON.stringify(value).slice(1, -1))
    hidden.add(value)
  }
  return tooShort
}

// None of these patterns can take a quote or a backslash away, so a cleaned line is still valid JSON.
// A short name such as `key` or `code` counts only as a parameter of an address; in plain text only
// names that mean a secret and nothing else count, so a line about a pressed key stays whole.
const SECRET_NAME = 'password|passwd|pwd|secret|token|credentials?|api[_-]?key|auth[_-]?key|access[_-]?key|private[_-]?key'
const SECRET_SHAPES: [RegExp, string][] = [
  [/([?&](?:password|passwd|pwd|token|access_token|id_token|refresh_token|key|api_key|apikey|authkey|auth|secret|signature|sig|code)=)[^&\s"'\\]+/gi, `$1${REDACTED}`],
  [new RegExp(`(\\b(?:${SECRET_NAME})\\s*[=:]\\s*)[^\\s"'\\\\&;,]+`, 'gi'), `$1${REDACTED}`],
  [new RegExp(`("(?:${SECRET_NAME}|authorization)"\\s*:\\s*")[^"\\\\]+`, 'gi'), `$1${REDACTED}`],
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`],
  // The name holds no colon, so a text of many colons and no @ is read once, not once per colon.
  [/(:\/\/)[^/\s"'\\@:]+:[^/\s"'\\@]+@/g, `$1${REDACTED}@`],
  [/\b(?:sk-ant-|e2b_)[A-Za-z0-9_-]{8,}/g, REDACTED],
]

/** The line as it may be written. Exported for the tests. */
export function cleaned(line: string): string {
  let out = line
  for (const value of hidden) out = out.replaceAll(value, REDACTED)
  for (const [shape, replacement] of SECRET_SHAPES) out = out.replace(shape, replacement)
  return out
}

/**
 * The start of a text from outside (a command's error output, a helper's answer) for an error
 * message. It is cleaned before it is cut: a cut through a registered value would leave a piece
 * that matches nothing any more. Only a bounded head is cleaned, so a huge text costs little.
 */
export function cleanedExcerpt(text: string, max: number): string {
  return cleaned(text.slice(0, max * 20)).slice(0, max)
}

function write(stream: NodeJS.WriteStream, level: 'info' | 'warn' | 'error', msg: string, fields: Fields): void {
  stream.write(cleaned(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields })) + '\n')
}

export const log = {
  info: (msg: string, fields: Fields = {}): void => write(process.stdout, 'info', msg, fields),
  warn: (msg: string, fields: Fields = {}): void => write(process.stdout, 'warn', msg, fields),
  error: (msg: string, fields: Fields = {}): void => write(process.stderr, 'error', msg, fields),
}

/** An error's message is text from outside, of any length; the log keeps its start. */
const MESSAGE_CHARS = 2_000
/** How many causes of one error the log names. */
const MAX_CAUSES = 5
/**
 * What a name or a code must look like to be logged: a short identifier, never a sentence. The
 * runtime's own error codes reach 49 characters, so the limit leaves them room (measured in
 * docs/evidence/2026-09-20-provider-refusal-in-stream).
 */
const IDENTIFIER = /^[\w.-]{1,64}$/

/**
 * One cause as the log may hold it: its name, and its code when it has one. Each is read once: it
 * can be a getter, and what passed the check must be what is logged.
 */
function causeLabel(cause: Error): string {
  const rawName: unknown = cause.name
  const name = typeof rawName === 'string' && IDENTIFIER.test(rawName) ? rawName : 'unknown'
  const code: unknown = 'code' in cause ? cause.code : undefined
  if (typeof code === 'string' && IDENTIFIER.test(code)) return `${name} ${code}`
  if (typeof code === 'number' && Number.isFinite(code)) return `${name} ${code}`
  return name
}

/**
 * The chain of causes under an error, outermost first. A failed connection keeps its real reason
 * there: under the model SDK's "Connection error." lies fetch's "fetch failed", and under that the
 * system error whose code tells a refused connection from a name that does not resolve. Each cause
 * is named by its kind only, never by its text: a library's text can quote a request, an address
 * with a token in it, or a model's answer. A cause that is not an error is named by its type and
 * ends the chain. This runs inside catch blocks, so it never throws: a cause that cannot be read
 * ends the chain too.
 */
function causeLabels(e: Error): string[] {
  const labels: string[] = []
  const seen = new Set<unknown>([e])
  try {
    let cause: unknown = e.cause
    while (cause !== undefined && cause !== null && labels.length < MAX_CAUSES && !seen.has(cause)) {
      seen.add(cause)
      if (!(cause instanceof Error)) {
        labels.push(`(${typeof cause})`)
        break
      }
      labels.push(causeLabel(cause))
      cause = cause.cause
    }
  } catch {
    // What was read so far is kept.
  }
  return labels
}

/**
 * A thrown value's message as text. A message is text by contract, and a library can still set
 * anything. This runs inside catch blocks, so it never throws: a value that cannot be turned into
 * text is named as such.
 */
function messageText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return '(a message that cannot be read)'
  }
}

/**
 * Turns a thrown value into loggable fields: the error's class name and the start of its message,
 * never its stack, and the names and codes of its causes when it has any. The message is cleaned
 * before it is cut: a value the cut divides matches its registered form no longer, and all of it
 * but its end would be written. The logger cleans the whole line again, which changes nothing here.
 */
export function errorFields(e: unknown): { errorName: string; errorMessage: string; errorCauses?: string[] } {
  const message = cleaned(messageText(e instanceof Error ? e.message : e))
  const errorMessage = message.length > MESSAGE_CHARS ? `${message.slice(0, MESSAGE_CHARS)}…` : message
  if (!(e instanceof Error)) return { errorName: 'unknown', errorMessage }
  const errorCauses = causeLabels(e)
  return { errorName: e.name, errorMessage, ...(errorCauses.length === 0 ? {} : { errorCauses }) }
}
