import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Bot, type ChatMessage, type HandbackState, type RunEvent } from './api'
import { Chat } from './components/Chat'
import { Composer } from './components/Composer'
import { Preview } from './components/Preview'
import { Roster } from './components/Roster'
import { RunsTab } from './components/RunsTab'
import { SkillsTab } from './components/SkillsTab'
import { subscribe } from './events'
import { entersByCard, takeoverEnd } from './takeover-view'

// Three columns: the roster, the chat (or the Skills tab, or the Runs tab), and the live preview of
// the bot's screen. One SSE stream per selected bot keeps everything current. The page shows nothing
// about the sandbox except the bot's state: no id, no timers, no cost.

const STREAM_REFRESH_MS = 30_000
const HANDBACK_POLL_MS = 2_000
const OVERRIDE_AFTER_POLLS = 3

export function App() {
  const [bots, setBots] = useState<Bot[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [lastAction, setLastAction] = useState('')
  // Whether a job is going on, as far as this tab has seen: any event of a run says yes, its end says
  // no. A tab that has seen nothing says no, so it never offers a Stop that has nothing to stop.
  const [runActive, setRunActive] = useState(false)
  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<'chat' | 'skills' | 'runs'>('chat')
  const [takingOver, setTakingOver] = useState(false)
  const [interactiveUrl, setInteractiveUrl] = useState<string | null>(null)
  const [handback, setHandback] = useState<HandbackState>({ allowed: false, reason: '', code: 'ok' })
  const [unchangedPolls, setUnchangedPolls] = useState(0)
  const lastState = useRef<string>('')
  // True while this tab is on the screen because the bot's takeover card switched it there, false
  // when the user pressed Take over. Only a switch the card made is undone when the card ends.
  const switchedByCard = useRef(false)
  // True while this tab's own Hand back is on its way: the bot's new state can arrive before the
  // answer to that request, and the tab's own hand-back needs no notice.
  const handingBack = useRef(false)
  /** The takeover card this tab handed back: its end reaches the page a moment after the answer does. */
  const handedBackCard = useRef<string | null>(null)

  const refreshBots = useCallback(async () => {
    try {
      setBots((await api.listBots()).bots)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    void refreshBots()
  }, [refreshBots])

  const refreshStream = useCallback(async (botId: string) => {
    try {
      setStreamUrl((await api.streamUrl(botId)).url)
    } catch {
      setStreamUrl(null)
    }
  }, [])

  /** Puts this tab back to watching: the interactive stream is dropped and the hand-back poll stops. */
  const leaveTakeover = useCallback(() => {
    switchedByCard.current = false
    setTakingOver(false)
    setInteractiveUrl(null)
    setHandback({ allowed: false, reason: '', code: 'ok' })
    setUnchangedPolls(0)
  }, [])

  // Subscribe to the selected bot: history first, then live events.
  useEffect(() => {
    if (!selected) return
    setChat([])
    setLastAction('')
    setRunActive(false)
    setError('')
    setTakingOver(false)
    setInteractiveUrl(null)
    switchedByCard.current = false
    setView('chat')
    lastState.current = ''
    void refreshStream(selected)
    const timer = setInterval(() => void refreshStream(selected), STREAM_REFRESH_MS)
    const stop = subscribe(selected, {
      onBot: (bot) => {
        setBots((all) => all.map((b) => (b.id === bot.id ? bot : b)))
        if (lastState.current !== bot.state) {
          lastState.current = bot.state
          void refreshStream(bot.id)
        }
      },
      onChat: (message) =>
        setChat((all) => {
          const index = all.findIndex((m) => m.id === message.id)
          if (index === -1) return [...all, message]
          const next = [...all]
          next[index] = message
          return next
        }),
      onRun: (event: RunEvent) => {
        setRunActive(event.type !== 'end')
        if (event.type === 'step') setLastAction(`step ${String(event.step)}: ${String(event.action)}`)
        if (event.type === 'tool_call') setLastAction(`using ${String(event.name)}`)
        if (event.type === 'end') setLastAction(`run ended: ${String(event.outcome)} — ${String(event.summary)}`)
      },
      onError: () => setError('the event stream dropped; the browser reconnects on its own'),
    })
    return () => {
      stop()
      clearInterval(timer)
    }
  }, [selected, refreshStream])

  const bot = bots.find((b) => b.id === selected) ?? null
  const activeCardId = chat.findLast((m) => m.card?.card === 'takeover' && m.card.status === 'active')?.id ?? null
  const takeoverActive = activeCardId !== null

  // While the human has the screen, ask the server every two seconds whether hand-back is allowed.
  useEffect(() => {
    if (!selected || !takingOver) return
    let stopped = false
    const poll = async () => {
      // The server counts this question as a person on the screen (the blocked hold); a hidden
      // tab or a minimised window is nobody on the screen.
      if (document.visibilityState !== 'visible') return
      try {
        const state = await api.handbackState(selected)
        if (stopped) return
        setHandback(state)
        setUnchangedPolls((n) => (!state.allowed && state.code === 'unchanged' ? n + 1 : 0))
      } catch (e) {
        if (!stopped) setHandback({ allowed: false, reason: String(e), code: 'unanswered' })
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), HANDBACK_POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [selected, takingOver])

  // A page reload during a takeover: the bot is blocked and the history holds an active card,
  // so the screen is the human's already; show the interactive stream without another click.
  useEffect(() => {
    if (!selected || !entersByCard({ takingOver, activeCardId, handedBackCardId: handedBackCard.current }, bot?.state)) return
    switchedByCard.current = true
    setTakingOver(true)
  }, [selected, takingOver, activeCardId, bot?.state])

  // The takeover ended elsewhere, or the bot acts again while this tab still shows the interactive
  // stream: the tab goes back to watching, so the user never types while the model acts, and it
  // stops asking the server every two seconds. takeoverEnd() holds the rule.
  useEffect(() => {
    if (!selected) return
    const end = takeoverEnd({ takingOver, interactiveUrl, switchedByCard: switchedByCard.current, cardActive: takeoverActive, handingBack: handingBack.current }, bot?.state)
    if (end === 'stay') return
    leaveTakeover()
    if (end === 'leave-and-say-why') setError('the bot started working, so the screen went back to it')
    if (end === 'leave-run-ended') setError('the run ended before the bot could give you the screen; press Take over again if you still need it')
    void refreshStream(selected)
  }, [selected, takingOver, interactiveUrl, takeoverActive, bot?.state, leaveTakeover, refreshStream])

  // The bot went blocked after the user asked to take over: fetch the interactive stream now.
  // An answer that arrives after the tab left takeover mode is dropped: the address would go stale.
  useEffect(() => {
    if (!selected || !takingOver || interactiveUrl || bot?.state !== 'blocked') return
    let live = true
    api
      .streamUrl(selected, 'interactive')
      .then(({ url }) => {
        if (live) setInteractiveUrl(url)
      })
      .catch((e: unknown) => {
        if (live) setError(String(e))
      })
    return () => {
      live = false
    }
  }, [selected, takingOver, interactiveUrl, bot?.state])

  const send = async (text: string) => {
    if (!selected) return
    try {
      await api.sendMessage(selected, text)
    } catch (e) {
      setError(String(e))
    }
  }

  const decide = async (approvalId: string, decision: 'allow' | 'deny') => {
    if (!selected) return
    try {
      await api.decide(selected, approvalId, decision)
    } catch (e) {
      setError(String(e))
    }
  }

  // `stop` is taken: the SSE effect above names its unsubscribe function so.
  const stopRun = async () => {
    if (!selected) return
    try {
      await api.stop(selected)
      // Stop pressed from takeover mode: the job is over, so the screen is not the human's any more.
      if (takingOver) {
        leaveTakeover()
        await refreshStream(selected)
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const create = async (input: { name: string; avatar?: string; persona: string }) => {
    try {
      const { bot: created } = await api.createBot(input)
      await refreshBots()
      setSelected(created.id)
    } catch (e) {
      setError(String(e))
    }
  }

  const takeOver = async () => {
    if (!selected || !bot) return
    try {
      if (bot.state === 'working' || bot.state === 'waiting') {
        await api.requestTakeover(selected)
      } else {
        const { url } = await api.streamUrl(selected, 'interactive')
        setInteractiveUrl(url)
      }
      setTakingOver(true)
    } catch (e) {
      setError(String(e))
    }
  }

  const handBack = async (force = false) => {
    if (!selected) return
    handingBack.current = true
    try {
      const card = activeCardId
      await api.handback(selected, force)
      handedBackCard.current = card
      leaveTakeover()
      await refreshStream(selected)
    } catch (e) {
      setError(String(e))
    } finally {
      handingBack.current = false
    }
  }

  return (
    <div className={`app${takingOver ? ' takeover' : ''}`}>
      <Roster bots={bots} selected={selected} onSelect={setSelected} onCreate={create} />

      <section className="panel">
        <div className="panel-head">
          <h2>{bot ? `${bot.avatar} ${bot.name}` : 'pick a bot'}</h2>
          {bot && (
            <div className="tabs">
              <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}>
                Chat
              </button>
              <button className={view === 'skills' ? 'active' : ''} onClick={() => setView('skills')}>
                Skills
              </button>
              <button className={view === 'runs' ? 'active' : ''} onClick={() => setView('runs')}>
                Runs
              </button>
            </div>
          )}
        </div>
        {error && (
          <div className="error">
            <span>{error}</span>
            <button onClick={() => setError('')}>ok</button>
          </div>
        )}
        {bot && view === 'skills' ? (
          <SkillsTab botId={bot.id} />
        ) : bot && view === 'runs' ? (
          <RunsTab botId={bot.id} botState={bot.state} />
        ) : bot ? (
          <>
            <Chat bot={bot} chat={chat} onDecide={(id, d) => void decide(id, d)} />
            <Composer bot={bot} onSend={send} />
          </>
        ) : (
          <div className="panel-body preview-empty">Pick a bot on the left, or create one.</div>
        )}
      </section>

      <Preview
        lastAction={lastAction}
        streamUrl={streamUrl}
        interactiveUrl={interactiveUrl}
        takingOver={takingOver}
        takeoverActive={takeoverActive}
        handback={handback}
        canOverride={unchangedPolls >= OVERRIDE_AFTER_POLLS}
        canTakeOver={!!bot && streamUrl !== null}
        canStop={!!bot && (bot.state === 'working' || bot.state === 'waiting')}
        canStopTakeover={takeoverActive && bot?.state === 'blocked' && runActive}
        onTakeOver={() => void takeOver()}
        onStop={() => void stopRun()}
        onHandBack={() => void handBack(false)}
        onHandBackAnyway={() => void handBack(true)}
      />
    </div>
  )
}
