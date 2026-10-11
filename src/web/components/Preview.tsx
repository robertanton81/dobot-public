export function Preview({
  lastAction,
  streamUrl,
  interactiveUrl,
  takingOver,
  takeoverActive,
  handback,
  canOverride,
  canTakeOver,
  canStop,
  canStopTakeover,
  onTakeOver,
  onStop,
  onHandBack,
  onHandBackAnyway,
}: {
  lastAction: string
  streamUrl: string | null
  interactiveUrl: string | null
  takingOver: boolean
  takeoverActive: boolean
  handback: { allowed: boolean; reason: string }
  /** The page is safe but its fingerprint never changed: offer the logged override. */
  canOverride: boolean
  canTakeOver: boolean
  /** A run is working or waiting: Stop ends it before its next action. */
  canStop: boolean
  /** The human has the screen inside a job that waits for the hand-back: Stop ends that job. False once the job is over, also while its takeover card is still open. */
  canStopTakeover: boolean
  onTakeOver: () => void
  onStop: () => void
  onHandBack: () => void
  onHandBackAnyway: () => void
}) {
  return (
    <section className="panel">
      <div className="preview-bar">
        <span className="action">{takingOver ? 'you have the screen' : lastAction || 'the bot is not doing anything right now'}</span>
        {!takingOver ? (
          <>
            <button onClick={onStop} disabled={!canStop} title="ends the current job before its next action">
              Stop
            </button>
            <button className={takeoverActive ? 'primary' : ''} onClick={onTakeOver} disabled={!canTakeOver}>
              Take over
            </button>
          </>
        ) : (
          <>
            {canStopTakeover && (
              <button onClick={onStop} title="ends the job that waits for you; nothing more is done on the screen">
                Stop
              </button>
            )}
            <span className={`hint ${handback.allowed ? 'ok' : 'no'}`}>{handback.allowed ? 'you can hand back' : handback.reason || 'checking the page…'}</span>
            <button className="primary" onClick={onHandBack} disabled={!handback.allowed}>
              Hand back
            </button>
            {!handback.allowed && canOverride && (
              <button onClick={onHandBackAnyway} title="the secret check still applies; the override is written to the run log">
                Hand back anyway
              </button>
            )}
          </>
        )}
      </div>
      {takingOver && interactiveUrl ? (
        <iframe className="preview-frame interactive" title="your hands on the bot's screen" src={interactiveUrl} allow="clipboard-read; clipboard-write" />
      ) : streamUrl ? (
        <iframe className="preview-frame" title="the bot's screen" src={streamUrl} allow="clipboard-read; clipboard-write" />
      ) : (
        <div className="preview-empty">{takingOver ? 'waiting for the bot to hand over…' : 'no live screen right now; your next goal brings the computer back'}</div>
      )}
    </section>
  )
}
