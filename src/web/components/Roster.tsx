import { useState } from 'react'
import type { Bot } from '../api'

export function Roster({ bots, selected, onSelect, onCreate }: { bots: Bot[]; selected: string | null; onSelect: (id: string) => void; onCreate: (input: { name: string; avatar?: string; persona: string }) => Promise<void> }) {
  const [form, setForm] = useState({ name: '', avatar: '🤖', persona: '' })
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!form.name.trim() || busy) return
    setBusy(true)
    try {
      await onCreate({ name: form.name.trim(), avatar: form.avatar.trim() || undefined, persona: form.persona.trim() })
      setForm({ name: '', avatar: '🤖', persona: '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="panel">
      <div className="panel-head">
        <h1>dobot</h1>
      </div>
      <div className="panel-body">
        {bots.length === 0 && <p className="note">No bots yet. Create one below.</p>}
        {bots.map((b) => (
          <button key={b.id} className={`roster-item${b.id === selected ? ' selected' : ''}`} onClick={() => onSelect(b.id)}>
            <span className={`avatar ${b.state}`} title={b.state}>
              {b.avatar}
            </span>
            <span className="roster-text">
              <div className="roster-name">{b.name}</div>
              <div className="roster-status">{b.statusLine || b.state}</div>
            </span>
          </button>
        ))}
      </div>
      <form
        className="new-bot"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <h3>New bot</h3>
        <div className="row">
          <input aria-label="name of the new bot" placeholder="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input aria-label="emoji of the new bot" placeholder="emoji" value={form.avatar} maxLength={4} onChange={(e) => setForm({ ...form, avatar: e.target.value })} />
        </div>
        <textarea aria-label="persona of the new bot" placeholder="persona: who this coworker is and what it is for" rows={3} value={form.persona} onChange={(e) => setForm({ ...form, persona: e.target.value })} />
        <button type="submit" className="primary" disabled={!form.name.trim() || busy}>
          {busy ? 'creating…' : 'Create'}
        </button>
      </form>
    </aside>
  )
}
