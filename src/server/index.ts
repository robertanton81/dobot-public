import { serve } from '@hono/node-server'
import { dirname, join } from 'node:path'
import { Approvals } from './agent/gate'
import { AnthropicModel } from './agent/model'
import { RunQueue } from './agent/queue'
import { APPROVAL_TIMEOUT_MS, Runner, USER_ANSWER_TIMEOUT_MS } from './agent/runner'
import { recoverAtBoot } from './agent/recovery'
import { basePlatformTools } from './agent/tools'
import { loadConfig, mailboxBotId, mailSettings, noticeSettings, smtpFor } from './config'
import { BUILTINS } from './connectors/builtin'
import { imapMailboxClient } from './connectors/builtin/bot-mailbox'
import { ConnectorRegistry } from './connectors/registry'
import type { ConnectorEnv } from './connectors/types'
import { BotEvents } from './bot-events'
import { createApp } from './http/app'
import { errorFields, hideInLogs, log } from './log'
import { SmtpNotifier } from './mail/notifier'
import { ImapMailbox, MAIL_EVENT, MailWatcher } from './mail/watcher'
import { fileWatermark } from './mail/watermark'
import { IDLE_SWEEP_MS, loadCompanionSource, SandboxManager } from './sandbox/manager'
import { Scheduler } from './scheduler/scheduler'
import { shutDown } from './shutdown'
import { createStore } from './store'

// One long-running process: an error nobody caught must leave a log line, never a silent exit.
process.on('uncaughtException', (e) => {
  log.error('uncaught exception', errorFields(e))
  process.exit(1)
})
process.on('unhandledRejection', (e) => {
  log.error('unhandled rejection', errorFields(e))
  process.exit(1)
})

// Boot order: config → store → recovery → sandbox manager → approvals → queue → runner → app → serve.
const config = loadConfig()
// Before anything else can log: the configured secrets never reach a log line, whatever error text carries them.
if (hideInLogs([config.E2B_API_KEY, config.ANTHROPIC_API_KEY, config.MAILBOX_PASSWORD, config.MAPY_API_KEY]) > 0) {
  log.warn('a configured secret is too short to be hidden in the log by its value; only the shapes of a credential are hidden for it')
}
const store = createStore(config.DATA_DIR, { minIntervalMs: config.ROUTINE_MIN_INTERVAL_MINUTES * 60_000, timezone: config.TZ })
await store.makePrivate()
const recovered = await recoverAtBoot(store)
if (recovered.closedRuns > 0) log.warn('runs closed at boot', { closedRuns: recovered.closedRuns })
if (recovered.endedCards > 0) log.warn('cards left open by the previous process were ended at boot', { endedCards: recovered.endedCards })
const events = new BotEvents()
const sandboxes = new SandboxManager(store, events, loadCompanionSource(), config.TZ)
const approvals = new Approvals()
const queue = new RunQueue()
// The notice mail: when a bot needs its human on the screen, the platform mails the operator from
// the bot's mailbox, with fixed text. Off unless NOTIFY_EMAIL is set.
const notice = noticeSettings(config)
const notifier = notice ? new SmtpNotifier(notice, { approvalMinutes: APPROVAL_TIMEOUT_MS / 60_000, answerMinutes: USER_ANSWER_TIMEOUT_MS / 60_000 }) : null
// The connectors: tools a bot uses instead of its computer. Keys and the mailbox are operator setup.
const mail = mailSettings(config)
const connectorEnv: ConnectorEnv = {
  fetch: globalThis.fetch,
  mapyApiKey: config.MAPY_API_KEY ?? null,
  mailbox: mail ? imapMailboxClient(mail, smtpFor(config)) : null,
  mailboxBotId: mailboxBotId(config),
}
const connectors = new ConnectorRegistry(store, BUILTINS, connectorEnv)
// A built-in that depends on no bot answers the same for any id; the mailbox answers for its own bot.
log.info('connectors ready', {
  usable: BUILTINS.filter((c) => c.unavailable(connectorEnv.mailboxBotId ?? '', connectorEnv) === null).map((c) => c.id),
  map: connectorEnv.mapyApiKey === null ? 'off: no MAPY_API_KEY' : 'on',
  mailbox: connectorEnv.mailbox === null ? 'off: no mailbox' : (connectorEnv.mailboxBotId ?? 'off: no MAILBOX_BOT_ID'),
})
const runner = new Runner({
  store,
  events,
  approvals,
  queue,
  sandboxes,
  model: new AnthropicModel(),
  modelId: config.MODEL_ID,
  tools: basePlatformTools,
  connectors,
  dailyBudgetUsd: config.DAILY_BUDGET_USD,
  timezone: config.TZ,
  blockedHoldMs: config.BLOCKED_HOLD_MINUTES * 60_000,
  reloadRoutines: (botId) => scheduler.reload(botId),
  ...(notifier ? { notifier } : {}),
})
const scheduler = new Scheduler({
  store,
  enqueueRun: (botId, input) => runner.enqueue(botId, input),
  now: () => new Date(),
  timezone: config.TZ,
  onBotUpdated: (bot) => events.emitBot(bot),
})
// `pnpm dev` starts this file with --dev-page: only then does the page come from another origin.
const app = createApp({ store, events, approvals, runner, sandboxes, devPage: process.argv.includes('--dev-page'), onRoutineSaved: (botId) => scheduler.reload(botId) })
// One bot whose routines cannot be read must not keep the server, and every other bot, from starting.
for (const bot of await store.listBots()) {
  try {
    await scheduler.reload(bot.id)
  } catch (e) {
    log.error('the routines of one bot could not be armed at boot; the bot runs without them until its next routine save', { botId: bot.id, ...errorFields(e) })
  }
}

// The mail event source. A routine with `event: mail-arrived` starts when mail actually arrives,
// instead of waking the bot on a timer to find an empty inbox. The watcher only reads how many
// unseen messages the inbox holds and its next message number. The bot then reads the mail itself:
// through the mailbox connector, or in its webmail with a sign-in by takeover. In both ways no
// mailbox password reaches the model, the chat or the logs.
let watcher: MailWatcher | null = null
if (mail) {
  watcher = new MailWatcher({
    mailbox: new ImapMailbox(mail),
    onMail: (cursor) => scheduler.fireEvent(MAIL_EVENT, cursor),
    pollMs: config.MAILBOX_POLL_MS,
    // Next to the bot folders, not inside one: there is one mailbox for the platform.
    watermark: fileWatermark(join(dirname(config.DATA_DIR), 'mail-watermark.json')),
  })
  watcher.start()
  log.info('mail watcher started', { host: mail.host, pollMs: config.MAILBOX_POLL_MS })
} else {
  log.info('no mailbox configured; a routine waiting for the mail event will not fire')
}

if (notifier) {
  log.info('notice mail is on: the operator is mailed when a bot needs a human on its screen')
  // Nothing waits for the check, and it never rejects: it only puts a wrong setting into the boot log.
  void notifier.verify()
} else {
  log.info('no notice address configured; nobody is mailed when a bot needs a human')
}

// The retry path for a failed pause: every five minutes, pause every idle computer.
setInterval(() => {
  sandboxes.pauseIdle().catch((e: unknown) => log.error('idle sweep failed', errorFields(e)))
}, IDLE_SWEEP_MS)

// This single-operator app has no login. Keep its API off the local network.
const server = serve({ fetch: app.fetch, port: config.PORT, hostname: '127.0.0.1' }, (info) => {
  log.info('server listening', { port: info.port, dataDir: config.DATA_DIR, model: config.MODEL_ID, dailyBudgetUsd: config.DAILY_BUDGET_USD, e2bDomain: config.E2B_DOMAIN ?? 'default' })
})

// Ctrl+C and a plain kill: the listener closes, the mail watcher and the schedules stop, every
// computer that nobody holds is paused, and the process exits. Without this a computer inside its
// grace period would stay up, because the timer that pauses it ends with the process. A request on
// a connection that is already open can still arrive until the exit; what it starts is cut like any
// other run. A second signal exits at once.
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1)
    stopping = true
    log.info('shutdown requested', { signal })
    void shutDown({
      stopNewWork: async () => {
        server.close()
        watcher?.stop()
        await scheduler.stop(0)
      },
      pauseUnheld: () => sandboxes.pauseUnheld(),
    }).then((code) => process.exit(code))
  })
}
