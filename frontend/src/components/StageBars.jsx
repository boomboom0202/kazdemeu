import React from 'react'
import { fmt } from '../api'

/**
 * Полоски по этапам заказа: сколько штук прошло каждый этап из плана.
 * У пошива бледной частью — выданное бригадам, но ещё не сшитое.
 * Одна строка отвечает на вопрос «на каком этапе застряли».
 */
export default function StageBars({ summary, compact }) {
  if (!summary || !summary.stages?.length) return <span className="muted">этапы не заданы</span>
  const planned = summary.planned || 0
  const pct = (v) => (planned ? Math.min(100, (v / planned) * 100) : 0)
  return (
    <div className={'stagebars' + (compact ? ' compact' : '')}>
      {summary.stages.map(s => (
        <div key={s.id} className="sb" title={`${s.name}: прошло ${s.done} из ${planned}` + (s.in_work ? `, в работе ${s.in_work}` : '')}>
          <div className="sb-top"><span>{s.name}</span><b>{fmt(s.done)}</b></div>
          <div className="bar">
            {s.kind === 'sewing' && <i className="l-cut" style={{ width: pct(s.assigned) + '%' }} />}
            <i className={s.done >= planned && planned ? 'l-packed' : 'l-sewn'} style={{ width: pct(s.done) + '%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}
