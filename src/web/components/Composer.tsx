import { useState } from 'react'
import type { Bot } from '../api'

export function Composer({ bot, onSend }: { bot: Bot | null; onSend: (text: string) => Promise<void> }) {
  const [draft, setDraft] = useState('')
  const send = async () => {
    const text = draft.trim()
    if (!text || !bot) return
    setDraft('')
    await onSend(text)
  }
  const placeholder = !bot ? 'pick a bot' : bot.state === 'waiting' ? `${bot.name} is waiting for your answer` : `give ${bot.name} a goal`
  return (
    <div className="composer">
      <input
        aria-label="message to the bot"
        value={draft}
        placeholder={placeholder}
        disabled={!bot}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void send()
          }
        }}
      />
      <button className="primary" onClick={() => void send()} disabled={!bot || !draft.trim()}>
        Send
      </button>
    </div>
  )
}
