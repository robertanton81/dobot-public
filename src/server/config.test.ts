import { describe, expect, it, vi } from 'vitest'
import { mailboxBotId, mailSettings, noticeSettings, parseEnv, smtpFor } from './config'
import { log } from './log'

describe('parseEnv', () => {
  it('reports the two required keys by name when the environment is empty', () => {
    const result = parseEnv({})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missing).toEqual(['E2B_API_KEY', 'ANTHROPIC_API_KEY'])
    expect(result.invalid).toEqual([])
  })

  it('treats an empty value as invalid, not missing, and still names only the variable', () => {
    const result = parseEnv({ E2B_API_KEY: '', ANTHROPIC_API_KEY: 'y' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missing).toEqual([])
    expect(result.invalid).toEqual(['E2B_API_KEY'])
  })

  it('fills in the defaults when only the keys are set', () => {
    const result = parseEnv({ E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config).toEqual({
      E2B_API_KEY: 'x',
      ANTHROPIC_API_KEY: 'y',
      MODEL_ID: 'claude-sonnet-5',
      TZ: 'Europe/Prague',
      PORT: 3000,
      DATA_DIR: 'data/bots',
      MAILBOX_PORT: 993,
      MAILBOX_POLL_MS: 60_000,
      ROUTINE_MIN_INTERVAL_MINUTES: 15,
      DAILY_BUDGET_USD: 25,
      BLOCKED_HOLD_MINUTES: 30,
    })
  })

  it('coerces PORT from a string and keeps an explicit MODEL_ID', () => {
    const result = parseEnv({ E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y', PORT: '4000', MODEL_ID: 'claude-opus-5' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.PORT).toBe(4000)
    expect(result.config.MODEL_ID).toBe('claude-opus-5')
  })

  // .env.example ships the mailbox names with empty values. If an empty value counted as invalid,
  // a clean clone would refuse to boot on the template the README tells people to copy.
  it('treats the empty optional mailbox values from .env.example as unset', () => {
    const result = parseEnv({ E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y', MAILBOX_HOST: '', MAILBOX_PORT: '', MAILBOX_USER: '', MAILBOX_PASSWORD: '', MAILBOX_POLL_MS: '' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.MAILBOX_HOST).toBeUndefined()
    expect(result.config.MAILBOX_PORT).toBe(993)
    expect(result.config.MAILBOX_POLL_MS).toBe(60_000)
    expect(mailSettings(result.config)).toBeNull()
  })

  // .env.example ships E2B_DOMAIN empty. Empty must mean "E2B's default cluster", and a set value
  // must survive unchanged, because the SDK reads the same variable from the environment.
  it('treats an empty E2B_DOMAIN as unset and keeps a set one', () => {
    const empty = parseEnv({ E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y', E2B_DOMAIN: '' })
    expect(empty.ok).toBe(true)
    if (!empty.ok) return
    expect(empty.config.E2B_DOMAIN).toBeUndefined()
    const set = parseEnv({ E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y', E2B_DOMAIN: 'eu.example' })
    expect(set.ok).toBe(true)
    if (!set.ok) return
    expect(set.config.E2B_DOMAIN).toBe('eu.example')
  })

  // A wrong zone would otherwise surface as a failed run: the budget check formats dates in it.
  it('rejects an unknown time zone by name and accepts a known one', () => {
    const bad = parseEnv({ E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y', TZ: 'Europe/Nowhere' })
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.invalid).toEqual(['TZ'])
    const utc = parseEnv({ E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y', TZ: 'UTC' })
    expect(utc.ok && utc.config.TZ).toBe('UTC')
  })

  it('rejects a poll interval below ten seconds by name', () => {
    const result = parseEnv({ E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y', MAILBOX_POLL_MS: '500' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.invalid).toEqual(['MAILBOX_POLL_MS'])
  })

  it('rejects a routine interval outside one minute to one day by name', () => {
    for (const value of ['0', '1441', '-5']) {
      const result = parseEnv({ E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y', ROUTINE_MIN_INTERVAL_MINUTES: value })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.invalid).toEqual(['ROUTINE_MIN_INTERVAL_MINUTES'])
    }
  })

  // DAILY_BUDGET_USD=0 is the operator's off switch: every run is refused and nothing is spent.
  it('accepts a daily budget of zero and rejects a negative one by name', () => {
    const zero = parseEnv({ E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y', DAILY_BUDGET_USD: '0' })
    expect(zero.ok && zero.config.DAILY_BUDGET_USD).toBe(0)
    const negative = parseEnv({ E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y', DAILY_BUDGET_USD: '-1' })
    expect(negative.ok).toBe(false)
    if (negative.ok) return
    expect(negative.invalid).toEqual(['DAILY_BUDGET_USD'])
  })
})

describe('mailSettings', () => {
  const base = { E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' }
  const config = (extra: Record<string, string>) => {
    const result = parseEnv({ ...base, ...extra })
    if (!result.ok) throw new Error('the test environment does not parse: ' + JSON.stringify(result))
    return result.config
  }

  it('returns the mailbox when host, user and password are all set', () => {
    expect(mailSettings(config({ MAILBOX_HOST: 'imap.example.com', MAILBOX_USER: 'bot@example.com', MAILBOX_PASSWORD: 'secret', MAILBOX_PORT: '1993' }))).toEqual({
      host: 'imap.example.com',
      port: 1993,
      user: 'bot@example.com',
      password: 'secret',
    })
  })

  // Half-configured is a mistake, not a mailbox: firing nothing beats connecting with no password.
  it('returns null when only some of the three are set', () => {
    expect(mailSettings(config({ MAILBOX_HOST: 'imap.example.com' }))).toBeNull()
    expect(mailSettings(config({ MAILBOX_HOST: 'imap.example.com', MAILBOX_USER: 'bot@example.com' }))).toBeNull()
    expect(mailSettings(config({ MAILBOX_USER: 'bot@example.com', MAILBOX_PASSWORD: 'secret' }))).toBeNull()
  })
})

describe('noticeSettings', () => {
  const BASE = { E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' }
  const FULL = { ...BASE, NOTIFY_EMAIL: 'human@example.test', MAILBOX_SMTP_HOST: 'smtp.example.test', MAILBOX_USER: 'bot@example.test', MAILBOX_PASSWORD: 'not-a-real-password' }
  const settingsOf = (env: Record<string, string>) => {
    const parsed = parseEnv(env)
    if (!parsed.ok) throw new Error('the test environment must parse')
    return noticeSettings(parsed.config)
  }

  it('is off, and silent, when no notice address is set: a clean clone runs as before', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    expect(settingsOf({ ...BASE, NOTIFY_EMAIL: '', MAILBOX_SMTP_HOST: '', MAILBOX_SMTP_PORT: '' })).toBeNull()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns the settings when the address, the SMTP host, the user and the password are set', () => {
    expect(settingsOf(FULL)).toEqual({ host: 'smtp.example.test', port: 465, user: 'bot@example.test', password: 'not-a-real-password', to: 'human@example.test' })
    expect(settingsOf({ ...FULL, MAILBOX_SMTP_PORT: '' })?.port).toBe(465)
    expect(settingsOf({ ...FULL, MAILBOX_SMTP_PORT: '587' })?.port).toBe(587)
  })

  it('turns the notifier off with a warning that names keys and never values: a missing part, the bot\'s own mailbox, an address that is not plain', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    const { MAILBOX_SMTP_HOST: _host, ...noHost } = FULL
    expect(settingsOf(noHost)).toBeNull()
    expect(settingsOf({ ...FULL, NOTIFY_EMAIL: 'Bot@Example.test' })).toBeNull()
    for (const bad of ['human@example.test, other@example.test', 'Human <human@example.test>', 'human@example', 'human@example.test\r\nBcc: x@example.test']) expect(settingsOf({ ...FULL, NOTIFY_EMAIL: bad })).toBeNull()
    expect(warn).toHaveBeenCalledTimes(6)
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/example\.test|not-a-real-password/)
    warn.mockRestore()
  })

  // A login name without a domain signs in, so a boot check would say ok, and then the server
  // refuses the sender (SMTP 501 at MAIL FROM), because the notice is sent from this value. A bare
  // login name would also never match the "bot's own mailbox" guard.
  it('a mailbox user that is not a full mail address turns the notifier off and names the key: the notice is sent from it', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    for (const bad of ['bot', 'bot@example', 'Bot <bot@example.test>']) expect(settingsOf({ ...FULL, MAILBOX_USER: bad })).toBeNull()
    expect(warn).toHaveBeenCalledTimes(3)
    for (const call of warn.mock.calls) expect(String(call[0])).toContain('MAILBOX_USER')
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/example\.test|not-a-real-password/)
    warn.mockRestore()
  })

  it('a port that is not a whole number from 1 to 65535 turns the notifier off and never stops the boot', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    for (const bad of ['smtps', '0', '70000', '46.5', '465 ']) {
      const parsed = parseEnv({ ...FULL, MAILBOX_SMTP_PORT: bad })
      expect(parsed.ok).toBe(true)
      expect(settingsOf({ ...FULL, MAILBOX_SMTP_PORT: bad })).toBeNull()
    }
    expect(warn).toHaveBeenCalledTimes(5)
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/example\.test|not-a-real-password/)
    warn.mockRestore()
  })
})

describe('the connector settings', () => {
  const BASE = { E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' }
  const configOf = (env: Record<string, string>) => {
    const parsed = parseEnv({ ...BASE, ...env })
    if (!parsed.ok) throw new Error('the test environment must parse')
    return parsed.config
  }

  it('treats the map key and the mailbox bot as optional, and an empty value as unset', () => {
    const empty = configOf({ MAPY_API_KEY: '', MAILBOX_BOT_ID: '' })
    expect(empty.MAPY_API_KEY).toBeUndefined()
    expect(mailboxBotId(empty)).toBeNull()
    expect(configOf({ MAPY_API_KEY: 'k-123' }).MAPY_API_KEY).toBe('k-123')
    expect(mailboxBotId(configOf({}))).toBeNull()
  })

  it('takes the mailbox bot only as a bot id, and names the key, never the value, when it is not one', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    expect(mailboxBotId(configOf({ MAILBOX_BOT_ID: 'hunter-1234' }))).toBe('hunter-1234')
    expect(warn).not.toHaveBeenCalled()
    expect(mailboxBotId(configOf({ MAILBOX_BOT_ID: 'Not A Slug' }))).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('MAILBOX_BOT_ID')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Not A Slug')
    warn.mockRestore()
  })

  it('gives the outgoing server of the mailbox without needing a notice address', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    expect(smtpFor(configOf({}))).toBeNull()
    expect(smtpFor(configOf({ MAILBOX_SMTP_HOST: 'smtp.example.test' }))).toEqual({ host: 'smtp.example.test', port: 465 })
    expect(smtpFor(configOf({ MAILBOX_SMTP_HOST: 'smtp.example.test', MAILBOX_SMTP_PORT: '587' }))).toEqual({ host: 'smtp.example.test', port: 587 })
    expect(smtpFor(configOf({ MAILBOX_SMTP_HOST: 'smtp.example.test', MAILBOX_SMTP_PORT: 'smtps' }))).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('MAILBOX_SMTP_PORT')
    warn.mockRestore()
  })
})
