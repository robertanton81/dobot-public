import { z } from 'zod'
import { log } from './log'
import type { ImapSettings } from './mail/watcher'
import type { NoticeSettings } from './mail/notifier'
import { DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES } from './store/routines'
import { SLUG } from './store/types'

// The only module that reads the keys. Values are never logged; on failure only the names are.

// `.env.example` ships these names with empty values, and process.loadEnvFile turns `NAME=` into
// an empty string. An empty value means "not set", never "invalid", or a clean clone would fail
// to boot on the template it was given.
const blankIsUnset = (v: unknown): unknown => (v === '' ? undefined : v)
const OPTIONAL_TEXT = z.preprocess(blankIsUnset, z.string().min(1).optional())
const optionalNumber = (fallback: number, min: number, max: number) =>
  z.preprocess(blankIsUnset, z.coerce.number().int().min(min).max(max).default(fallback))

/**
 * The routines, the daily budget and the density check all hand `TZ` to Intl and croner, which
 * throw on a name they do not know. Caught at boot, by name, instead of failing every run later.
 */
export function isKnownTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return true
  } catch {
    return false
  }
}

const EnvSchema = z.object({
  E2B_API_KEY: z.string().min(1),
  // The E2B cluster. Empty means E2B's default cluster. The EU cluster is a separate E2B project
  // with its own key and domain, enabled by E2B support on the Pro tier. The SDK reads E2B_DOMAIN
  // from the environment by itself (e2b 2.49.1, ConnectionOpts.domain); this entry only makes the
  // choice visible at boot.
  E2B_DOMAIN: OPTIONAL_TEXT,
  ANTHROPIC_API_KEY: z.string().min(1),
  MODEL_ID: z.string().default('claude-sonnet-5'),
  TZ: z.string().default('Europe/Prague').refine(isKnownTimeZone, 'unknown time zone'),
  PORT: z.coerce.number().default(3000),
  DATA_DIR: z.string().default('data/bots'),
  // The mail event source. Optional: with none of these set, routines that wait for the
  // `mail-arrived` event simply never fire and everything else works.
  MAILBOX_HOST: OPTIONAL_TEXT,
  MAILBOX_PORT: optionalNumber(993, 1, 65535),
  MAILBOX_USER: OPTIONAL_TEXT,
  MAILBOX_PASSWORD: OPTIONAL_TEXT,
  MAILBOX_POLL_MS: optionalNumber(60_000, 10_000, 24 * 60 * 60_000),
  // The notice mail: the address the platform calls when a bot needs its human, and the sending
  // side of the mailbox above. Operator setup on purpose: no tool can
  // change who is called, so no text on a web page can talk the model into silencing the human.
  NOTIFY_EMAIL: OPTIONAL_TEXT,
  MAILBOX_SMTP_HOST: OPTIONAL_TEXT,
  // Text on purpose: a port that is not a number turns the notifier off (noticeSettings); it must
  // not stop the boot the way a malformed MAILBOX_PORT does.
  MAILBOX_SMTP_PORT: OPTIONAL_TEXT,
  // The connectors' operator setup. Optional: without the map key the map connector is not offered;
  // without a mailbox bot no bot is offered the mailbox connector.
  MAPY_API_KEY: OPTIONAL_TEXT,
  MAILBOX_BOT_ID: OPTIONAL_TEXT,
  // Operator limits. Operator setup, never a user setting (invariant 7).
  ROUTINE_MIN_INTERVAL_MINUTES: optionalNumber(DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES, 1, 24 * 60),
  DAILY_BUDGET_USD: optionalNumber(25, 0, 100_000),
  BLOCKED_HOLD_MINUTES: optionalNumber(30, 1, 24 * 60),
})

export type Config = z.infer<typeof EnvSchema>

/**
 * The mailbox to watch, or null when it is not configured. All three of host, user and password
 * are needed; a half-filled mailbox is a configuration mistake and says so in the log.
 */
export function mailSettings(config: Config): ImapSettings | null {
  const { MAILBOX_HOST: host, MAILBOX_USER: user, MAILBOX_PASSWORD: password } = config
  if (host === undefined && user === undefined && password === undefined) return null
  if (host === undefined || user === undefined || password === undefined) {
    log.warn('the mailbox is only half configured, so no mail event will fire; set all of MAILBOX_HOST, MAILBOX_USER and MAILBOX_PASSWORD, or none')
    return null
  }
  return { host, port: config.MAILBOX_PORT, user, password }
}

const DEFAULT_SMTP_PORT = 465
// One plain address: no display name, no list, no line break. It goes into a mail header.
const PLAIN_ADDRESS = /^[^\s@<>()[\],;:"'\\]+@[^\s@<>()[\],;:"'\\]+\.[^\s@<>()[\],;:"'\\]+$/

/**
 * Where to send a notice, or null when the notifier is off. A mistake here never ends the
 * process: like a half-filled mailbox it turns the feature off and says why, by key name only.
 */
export function noticeSettings(config: Config): NoticeSettings | null {
  const { NOTIFY_EMAIL: to, MAILBOX_SMTP_HOST: host, MAILBOX_USER: user, MAILBOX_PASSWORD: password } = config
  if (to === undefined) return null
  if (host === undefined || user === undefined || password === undefined) {
    log.warn('NOTIFY_EMAIL is set but the notice mail is off: set MAILBOX_SMTP_HOST, MAILBOX_USER and MAILBOX_PASSWORD as well')
    return null
  }
  if (!PLAIN_ADDRESS.test(to)) {
    log.warn('the notice mail is off: NOTIFY_EMAIL must be one plain mail address')
    return null
  }
  // The notice is sent from the mailbox user, so it must be the full address. A bare login name
  // signs in, and then the server refuses the sender (SMTP 501 at MAIL FROM). It would also never
  // match the address in the check below.
  if (!PLAIN_ADDRESS.test(user)) {
    log.warn("the notice mail is off: MAILBOX_USER must be the full mail address of the bot's mailbox, because the notice is sent from it")
    return null
  }
  if (to.toLowerCase() === user.toLowerCase()) {
    log.warn("the notice mail is off: NOTIFY_EMAIL is the bot's own mailbox, and a notice landing there would start the mail routine")
    return null
  }
  const port = smtpPort(config)
  if (port === null) {
    log.warn('the notice mail is off: MAILBOX_SMTP_PORT must be a whole number from 1 to 65535')
    return null
  }
  return { host, port, user, password, to }
}

/** The outgoing port of the mailbox, or null when MAILBOX_SMTP_PORT is not a whole number from 1 to 65535. */
function smtpPort(config: Config): number | null {
  const portText = config.MAILBOX_SMTP_PORT ?? String(DEFAULT_SMTP_PORT)
  const port = /^\d{1,5}$/.test(portText) ? Number(portText) : Number.NaN
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

/** The mailbox's outgoing server for the mailbox connector, or null when none is set. It needs no notice address. */
export function smtpFor(config: Config): { host: string; port: number } | null {
  if (config.MAILBOX_SMTP_HOST === undefined) return null
  const port = smtpPort(config)
  if (port === null) {
    log.warn('the mailbox connector cannot send: MAILBOX_SMTP_PORT must be a whole number from 1 to 65535')
    return null
  }
  return { host: config.MAILBOX_SMTP_HOST, port }
}

/** The one bot that may use the mailbox connector, or null. A value that is not a bot id is named by key, never shown. */
export function mailboxBotId(config: Config): string | null {
  const id = config.MAILBOX_BOT_ID
  if (id === undefined) return null
  if (!SLUG.test(id)) {
    log.warn('no bot is offered the mailbox connector: MAILBOX_BOT_ID must be a bot id (lower-case letters, digits and dashes)')
    return null
  }
  return id
}

export type ParseEnvResult =
  | { ok: true; config: Config }
  | { ok: false; missing: string[]; invalid: string[] }

/** Pure: validates an environment-shaped record. Reports variable names only, never values. */
export function parseEnv(env: Record<string, string | undefined>): ParseEnvResult {
  const result = EnvSchema.safeParse(env)
  if (result.success) return { ok: true, config: result.data }
  const missing: string[] = []
  const invalid: string[] = []
  for (const issue of result.error.issues) {
    const name = String(issue.path[0] ?? '?')
    if (env[name] === undefined) {
      if (!missing.includes(name)) missing.push(name)
    } else if (!invalid.includes(name)) {
      invalid.push(name)
    }
  }
  return { ok: false, missing, invalid }
}

/** Loads .env.local into process.env when it exists. Variables already set in the shell win. */
export function loadDotEnvLocal(path = '.env.local'): void {
  try {
    process.loadEnvFile(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
}

/** Boot entry: loads .env.local, validates, and exits the process when a key is missing. */
export function loadConfig(): Config {
  loadDotEnvLocal()
  const parsed = parseEnv(process.env)
  if (!parsed.ok) {
    log.error('configuration is incomplete; set the variables in .env.local (see .env.example)', {
      missing: parsed.missing,
      invalid: parsed.invalid,
    })
    process.exit(1)
  }
  return parsed.config
}
