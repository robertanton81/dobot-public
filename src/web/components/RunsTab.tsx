import { useEffect, useState } from 'react'
import { api, type BotState, type RunEvent, type RunSummary } from '../api'

// The Runs tab: what the bot did, read from the record every run writes. The list has one line per
// run, newest first; a click opens that run step by step, with the screen the model was shown after
// each action. Read-only: nothing here changes a run.

const POLL_MS = 3_000
const LONG_TEXT = 160

const clock = (t: string | null) => (t ? new Date(t).toLocaleTimeString() : '')
const day = (t: string | null) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'not started')
const json = (v: unknown) => (v === undefined ? '' : JSON.stringify(v))
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function Outcome({ outcome }: { outcome: string | null }) {
  return <span className={`outcome ${outcome ?? 'running'}`}>{outcome ?? 'running'}</span>
}

/** Long text folds to its first line; the full text is one click away, never cut. */
function Text({ text }: { text: string }) {
  if (text.length <= LONG_TEXT) return <span className="trace-text">{text}</span>
  return (
    <details className="trace-text">
      <summary>{text.slice(0, LONG_TEXT)}…</summary>
      <pre>{text}</pre>
    </details>
  )
}

/**
 * One recorded event as a label and a sentence. A cost event has no row and no total: what a run
 * costs the operator in model calls is not what a person pays for the product, so the page shows none of it.
 */
function describe(e: RunEvent): { kind: string; text: string; bad?: boolean } | null {
  switch (e.type) {
    case 'queued':
      return { kind: 'goal', text: e.goal }
    case 'text':
      return { kind: 'bot said', text: e.text }
    case 'step':
      return { kind: 'screen', text: `${e.action} ${json(e.input)}` }
    case 'tool_call':
      return { kind: 'tool', text: `${e.name} ${json(e.input)}` }
    case 'tool_result':
      return { kind: e.ok ? 'result' : 'failed', text: `${e.name}: ${e.summary}`, bad: !e.ok }
    case 'gate':
      return { kind: 'gate', text: `${e.decision}${e.rule ? ` by rule "${e.rule}"` : ''}: ${e.reason}`, bad: e.decision === 'block' }
    case 'approval':
      return { kind: 'approval', text: e.status }
    case 'takeover':
      return { kind: 'takeover', text: `${e.status}: ${e.reason}` }
    case 'status':
      return { kind: 'status', text: `${e.botState}: ${e.text}` }
    case 'end':
      return { kind: 'end', text: `${e.outcome}: ${e.summary}`, bad: e.outcome !== 'done' }
    default:
      return null
  }
}

function Trace({ botId, run, onBack }: { botId: string; run: RunSummary; onBack: () => void }) {
  const [events, setEvents] = useState<RunEvent[] | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  // A run with no end event is still going: ask again every few seconds until it ends. A failed
  // request stops the asking and shows the error; Refresh starts it again.
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const { events: next } = await api.getRun(botId, run.runId)
        if (stopped) return
        setEvents(next)
        setError('')
        if (!next.some((e) => e.type === 'end')) timer = setTimeout(() => void load(), POLL_MS)
      } catch (e) {
        if (!stopped) setError(String(e))
      }
    }
    void load()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [botId, run.runId, reload])

  const end = events?.find((e) => e.type === 'end')
  const actions = events?.filter((e) => e.type === 'step' || e.type === 'tool_call').length ?? run.actions
  return (
    <div className="panel-body runs">
      <div className="runs-bar">
        <button onClick={onBack}>← All runs</button>
        <button onClick={() => setReload((n) => n + 1)}>Refresh</button>
        <span className="note">
          {day(run.startedAt)} · {count(actions, 'action')}
        </span>
        <Outcome outcome={end?.type === 'end' ? end.outcome : events ? null : run.outcome} />
      </div>
      {error && <div className="note bad">{error}</div>}
      {!events && !error && <div className="note">loading…</div>}
      {events && (
        <ol className="trace">
          {events.map((e, i) => {
            const row = describe(e)
            if (!row) return null
            const step = 'step' in e ? e.step : null
            const shot = e.type === 'tool_result' && e.shot !== null ? `/api/bots/${botId}/runs/${run.runId}/shots/${e.shot}` : null
            return (
              <li key={i} className={`trace-row ${e.type}${row.bad ? ' bad' : ''}`}>
                <span className="trace-time">{clock(e.t)}</span>
                <span className="trace-step">{step ?? ''}</span>
                <span className="trace-kind">{row.kind}</span>
                <Text text={row.text} />
                {shot && (
                  <a className="trace-shot" href={shot} target="_blank" rel="noreferrer">
                    <img src={shot} loading="lazy" alt={`the screen after step ${step}`} />
                  </a>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

export function RunsTab({ botId, botState }: { botId: string; botState: BotState }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<RunSummary | null>(null)
  const [reload, setReload] = useState(0)

  // The list is read when the tab opens, on Refresh, and when the bot's state changes: a run that
  // starts or ends changes the state, so the list follows the bot without a timer.
  useEffect(() => {
    let stopped = false
    api
      .listRuns(botId)
      .then(({ runs: next }) => {
        if (stopped) return
        setRuns(next)
        setError('')
      })
      .catch((e: unknown) => {
        if (!stopped) setError(String(e))
      })
    return () => {
      stopped = true
    }
  }, [botId, botState, reload])

  if (open) return <Trace botId={botId} run={open} onBack={() => setOpen(null)} />
  return (
    <div className="panel-body runs">
      <div className="runs-bar">
        <button onClick={() => setReload((n) => n + 1)}>Refresh</button>
        {runs && <span className="note">{count(runs.length, 'run')}</span>}
      </div>
      {error && <div className="note bad">{error}</div>}
      {!runs && !error && <div className="note">loading…</div>}
      {runs?.length === 0 && <div className="note">No runs yet. A run starts when you send the bot a goal, or when a routine fires.</div>}
      {runs?.map((r) => (
        <button key={r.runId} className="run-row" onClick={() => setOpen(r)}>
          <span className="run-head">
            <Outcome outcome={r.outcome} />
            <span className="note">
              {day(r.startedAt)} · {r.source === 'routine' ? `routine ${r.routineName ?? ''}` : 'message'} · {count(r.actions, 'action')}
            </span>
          </span>
          <span className="run-goal">{r.goal || '(no goal recorded)'}</span>
          {r.summary && <span className="run-summary">{r.summary}</span>}
        </button>
      ))}
    </div>
  )
}
