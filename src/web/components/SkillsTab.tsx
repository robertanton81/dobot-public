import { useEffect, useRef, useState } from 'react'
import { api, type BotFiles } from '../api'

function FileEditor({ title, text, onSave, note }: { title: string; text: string; onSave: (text: string, base: string) => Promise<{ text: string }>; note?: string }) {
  const [draft, setDraft] = useState(text)
  const [state, setState] = useState<'clean' | 'dirty' | 'saving' | 'saved' | 'error'>('clean')
  const [message, setMessage] = useState('')
  // One request at a time: Save is disabled while one is in flight.
  const [saving, setSaving] = useState(false)
  // What the textarea holds right now, for the moment the save request comes back: a draft typed
  // meanwhile was never sent, so it stays dirty and Save stays enabled.
  const latest = useRef(text)
  // The file as the server last gave it: sent with a save, so the server can refuse a save over
  // text the bot has changed meanwhile.
  const base = useRef(text)
  useEffect(() => {
    setDraft(text)
    latest.current = text
    base.current = text
    setState('clean')
  }, [text])
  const save = async () => {
    const submitted = draft
    setSaving(true)
    setState('saving')
    try {
      base.current = (await onSave(submitted, base.current)).text
      setMessage('')
      setState(latest.current === submitted ? 'saved' : 'dirty')
    } catch (e) {
      setState('error')
      setMessage(String(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="file">
      <h3>{title}</h3>
      <textarea
        value={draft}
        onChange={(e) => {
          latest.current = e.target.value
          setDraft(e.target.value)
          setState('dirty')
        }}
      />
      <div className="file-actions">
        <button onClick={() => void save()} disabled={state !== 'dirty' || saving}>
          Save
        </button>
        <span className="note">{state === 'saved' ? 'saved' : state === 'saving' ? 'saving…' : state === 'error' ? message : note}</span>
      </div>
    </div>
  )
}

export function SkillsTab({ botId }: { botId: string }) {
  const [files, setFiles] = useState<BotFiles | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api
      .getFiles(botId)
      .then(setFiles)
      .catch((e: unknown) => setError(String(e)))
  }, [botId])
  if (error) return <div className="panel-body">{error}</div>
  if (!files) return <div className="panel-body">loading…</div>
  return (
    <div className="panel-body files">
      <FileEditor title="memory.md" text={files.memory} onSave={(text, base) => api.putMemory(botId, text, base)} note="one dated line per note; the bot writes here with remember" />
      {files.skills.length === 0 && <div className="note">No skills yet. The bot writes one after a job that worked.</div>}
      {files.skills.map((s) => (
        <FileEditor key={s.name} title={`skills/${s.name}.md`} text={s.text} onSave={(text, base) => api.putSkill(botId, s.name, text, base)} />
      ))}
      {files.routines.map((r) => (
        <FileEditor key={r.name} title={`routines/${r.name}.md`} text={r.text} onSave={(text, base) => api.putRoutine(botId, r.name, text, base)} note="schedule is a cron expression; enabled is true or false" />
      ))}
      <div className="file">
        <h3>approval-rules.json</h3>
        <pre>{files.rules}</pre>
        <div className="note">edited on disk, no tool can write it</div>
      </div>
      {files.artifacts.length > 0 && (
        <div className="file">
          <h3>artifacts</h3>
          <ul>
            {files.artifacts.map((a) => (
              <li key={a}>
                <a href={`/api/bots/${botId}/artifacts/${a}`} target="_blank" rel="noreferrer">
                  {a}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
