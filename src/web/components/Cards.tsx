import type { Card } from '../api'

export function CardView({ botId, card, onDecide }: { botId: string; card: Card; onDecide: (approvalId: string, decision: 'allow' | 'deny') => void }) {
  switch (card.card) {
    case 'approval':
      return (
        <div className={`card approval decided-${card.status}`}>
          <h4>
            {card.announced ? 'Approval requested' : <span className="unannounced">Unannounced action stopped</span>}
            <span className="tag">{card.actionKind}</span>
            {card.status !== 'pending' && <span className="tag">{card.status}</span>}
          </h4>
          <div>{card.summary}</div>
          {card.connectorTool ? (
            <div className="meta">
              Connector: <strong>{card.connectorTool}</strong>
            </div>
          ) : (
            <div className="meta">
              Control: <strong>{card.target || '(unknown)'}</strong> on <code>{card.url || '(unknown page)'}</code>
            </div>
          )}
          {card.connectorArgs && <pre>{card.connectorArgs}</pre>}
          {card.consequences.length > 0 && (
            <ul>
              {card.consequences.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
          {card.warnings.map((w, i) => (
            <div key={i} className="warning">
              ⚠ {w}
            </div>
          ))}
          {card.shot && <img className="shot" src={`/api/bots/${botId}/runs/${card.runId}/shots/${card.shot}`} alt="the screen when the approval was requested" />}
          {card.status === 'expired' && <div className="meta">The server restarted before this was decided, and the run behind it is over.</div>}
          {card.status === 'pending' && (
            <div className="actions">
              <button className="primary" onClick={() => onDecide(card.approvalId, 'allow')}>
                Allow once
              </button>
              <button className="danger" onClick={() => onDecide(card.approvalId, 'deny')}>
                Deny
              </button>
            </div>
          )}
        </div>
      )
    case 'connect':
      return (
        <div className={`card connect decided-${card.status}`}>
          <h4>
            Connect {card.title} <span className="tag">connector</span>
            {card.status !== 'pending' && <span className="tag">{card.status}</span>}
          </h4>
          <div>{card.reason}</div>
          <div className="meta">{card.what}</div>
          {card.status === 'expired' && <div className="meta">The server restarted before you answered.</div>}
          {card.status === 'failed' && <div className="meta">You said Connect, but the connection could not be saved. The bot goes on without it.</div>}
          {card.status === 'pending' && (
            <div className="actions">
              <button className="primary" onClick={() => onDecide(card.approvalId, 'allow')}>
                Connect
              </button>
              <button onClick={() => onDecide(card.approvalId, 'deny')}>Not now</button>
            </div>
          )}
        </div>
      )
    case 'takeover':
      return (
        <div className={`card takeover ${card.status}`}>
          <h4>
            {card.status === 'active' ? 'Your turn on the screen' : 'Takeover ended'} <span className="tag">{card.status}</span>
          </h4>
          <div>{card.reason}</div>
          {card.status === 'active' && <div className="meta">The screen is yours: do the step on it, then press Hand back.</div>}
        </div>
      )
    case 'artifact':
      return (
        <div className="card artifact">
          <h4>
            {card.name} <span className="tag">artifact</span>
          </h4>
          <pre>{card.preview}</pre>
          <div className="actions">
            <a href={`/api/bots/${botId}/artifacts/${card.name}`} target="_blank" rel="noreferrer">
              open the full file
            </a>
          </div>
        </div>
      )
    case 'status':
      return <div className="card status">{card.text}</div>
    case 'skill':
      return (
        <div className="card skill">
          <h4>
            Skill saved: {card.name} <span className="tag">skill</span>
          </h4>
          <div className="meta">{card.description}</div>
          <pre>{card.body}</pre>
        </div>
      )
    case 'routine':
      return (
        <div className="card routine">
          <h4>
            Routine saved: {card.name} <span className="tag">routine</span>
          </h4>
          <div className="meta">
            {card.schedule ? `schedule: ${card.schedule}` : `event: ${card.event ?? ''}`} · skill: {card.skill}
          </div>
          <pre>{card.instruction}</pre>
        </div>
      )
  }
}
