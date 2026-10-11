import { useEffect, useRef } from 'react'
import type { Bot, ChatMessage } from '../api'
import { CardView } from './Cards'

function time(t: string): string {
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function Chat({ bot, chat, onDecide }: { bot: Bot; chat: ChatMessage[]; onDecide: (approvalId: string, decision: 'allow' | 'deny') => void }) {
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [chat])

  return (
    <div className="panel-body">
      {chat.map((m) => {
        if (m.role === 'card' && m.card) return <CardView key={m.id} botId={bot.id} card={m.card} onDecide={onDecide} />
        return (
          <div key={m.id} className={`msg ${m.role}`} title={time(m.t)}>
            {m.text}
          </div>
        )
      })}
      <div ref={bottom} />
    </div>
  )
}
