import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ResponsiveContainer, BarChart, Bar, ComposedChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts'
import { api, fmt, monthLabel, dm, dmy, CONTRACT_STATUS } from '../api'
import { Loader, LoadError } from '../components/Loader'

const STAGE_COLORS = ['#2e4a8f', '#d97b29', '#1d7a4f', '#b8860b', '#7a5195', '#b03030', '#5a6275']

/** Вся цепочка на одной странице: тендеры → договоры → цех → деньги. */
export default function Analytics() {
  const [d, setD] = useState(null)
  const [failed, setFailed] = useState(false)
  const load = () => { setFailed(false); api.get('/analytics/overview/').then(r => setD(r.data)).catch(() => setFailed(true)) }
  useEffect(load, [])
  if (failed) return <LoadError onRetry={load} />
  if (!d) return <Loader />

  const t = d.tenders, c = d.contracts, m = d.money, w = d.workshop
  const stageNames = w ? [...new Set(w.weekly.flatMap(r => Object.keys(r).filter(k => k !== 'week')))] : []

  return (
    <div>
      <div className="pagehead"><h1>Аналитика</h1></div>

      {t && (
        <div className="card stitch">
          <h2>Тендеры</h2>
          <div className="kpi-grid">
            <div className="kpi"><div className="v">{t.total}</div><div className="l">лотов всего</div></div>
            <div className="kpi good"><div className="v">{t.win_rate === null ? '—' : t.win_rate + '%'}</div><div className="l">выигрываем из решённых</div></div>
            <div className={'kpi ' + (t.urgent ? 'warn' : '')}><div className="v">{t.urgent}</div><div className="l">подача в ближайшие 3 дня</div></div>
          </div>
          <div className="funnel">
            {t.stages.filter(s => s.count).map(s => {
              const max = Math.max(...t.stages.map(x => x.count), 1)
              return (
                <div key={s.status} className="frow">
                  <span className="fl">{s.label}</span>
                  <div className="fbar"><i style={{ width: (s.count / max * 100) + '%' }} /></div>
                  <span className="num">{s.count} · {fmt(s.amount)} ₸</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {c && (
        <div className="grid2">
          <div className="card">
            <h2>Договоры по статусам</h2>
            {c.by_status.filter(s => s.count).map(s => (
              <div key={s.status} className="frow">
                <span className="fl"><span className="badge" style={{ background: CONTRACT_STATUS[s.status]?.color }}>{s.label}</span></span>
                <span className="num">{s.count} шт · {fmt(s.amount)} ₸</span>
              </div>
            ))}
            <h2 style={{ marginTop: 14 }}>Крупнейшие заказчики</h2>
            {c.top_customers.map(x => (
              <div key={x.customer} className="frow"><span className="fl">{x.customer}</span><span className="num">{fmt(x.amount)}</span></div>
            ))}
          </div>
          <div className="card">
            <h2>Просроченные договоры</h2>
            {c.overdue.length === 0 && <p className="muted">Просроченных нет.</p>}
            {c.overdue.map(x => (
              <div key={x.id} className="frow">
                <span className="fl"><Link to={`/contracts/${x.id}`}>{x.number}</Link> · {x.title}<div className="muted">{x.customer}</div></span>
                <span className="neg">{x.days} дн.</span>
              </div>
            ))}
            {c.worst && c.worst.length > 0 && <>
              <h2 style={{ marginTop: 14 }}>Меньше всего прибыли</h2>
              {c.worst.map(x => (
                <div key={x.id} className="frow">
                  <span className="fl"><Link to={`/contracts/${x.id}`}>{x.number}</Link> · {x.title}</span>
                  <span className={'num ' + (x.profit < 0 ? 'neg' : '')}>{fmt(x.profit)}{x.margin !== null ? ` · ${x.margin}%` : ''}</span>
                </div>
              ))}
            </>}
          </div>
        </div>
      )}

      {m && (
        <div className="card stitch">
          <h2>Деньги по месяцам</h2>
          <div className="kpi-grid">
            <div className="kpi good"><div className="v">{fmt(m.paid)}</div><div className="l">получено от заказчиков</div></div>
            <div className="kpi"><div className="v">{fmt(m.contract_expenses + m.admin_expenses)}</div><div className="l">потрачено всего</div></div>
            <div className={'kpi ' + (m.cash < 0 ? 'warn' : 'good')}><div className="v">{fmt(m.cash)}</div><div className="l">деньги сейчас</div></div>
            <div className="kpi"><div className="v">{fmt(m.debt)}</div><div className="l">долг заказчиков</div></div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={m.months.filter(x => x.month !== 'none').map(x => ({ ...x, label: monthLabel(x.month), got: x.income + x.other_income }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3e1d9" />
              <XAxis dataKey="label" fontSize={11} /><YAxis fontSize={10} tickFormatter={v => Math.round(v / 1e6) + ' млн'} />
              <Tooltip formatter={v => fmt(v) + ' ₸'} /><Legend />
              <Bar dataKey="got" name="Приход" fill="#2e4a8f" radius={[4, 4, 0, 0]} />
              <Bar dataKey="contract_expenses" name="Расходы договоров" stackId="s" fill="#c9c4b8" />
              <Bar dataKey="admin_expenses" name="Административные" stackId="s" fill="#d97b29" />
              <Line dataKey="net" name="Итог месяца" stroke="#1d7a4f" strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {w && (
        <div className="card stitch">
          <h2>Цех</h2>
          <div className="kpi-grid">
            <div className="kpi"><div className="v">{w.orders}</div><div className="l">заказов в работе</div></div>
            <div className="kpi"><div className="v">{fmt(w.planned)}</div><div className="l">план, шт</div></div>
            <div className="kpi good"><div className="v">{fmt(w.finished)}</div><div className="l">прошли все этапы</div></div>
            <div className="kpi"><div className="v">{fmt(w.left)}</div><div className="l">осталось</div></div>
          </div>
          <div className="grid2">
            <div>
              <h3 className="sub">Прошло по этапам (заказы в работе)</h3>
              {w.stages.map(s => {
                const max = Math.max(...w.stages.map(x => x.done), 1)
                return <div key={s.name} className="frow"><span className="fl">{s.name}</span>
                  <div className="fbar"><i style={{ width: (s.done / max * 100) + '%' }} /></div>
                  <span className="num">{fmt(s.done)}{s.in_work ? ` +${fmt(s.in_work)} в работе` : ''}</span></div>
              })}
              <h3 className="sub">Бригады: сшито</h3>
              {w.brigades.map(b => <div key={b.brigade} className="frow"><span className="fl">{b.brigade}</span><span className="num">{fmt(b.sewn)}{b.in_work ? ` · шьётся ${fmt(b.in_work)}` : ''}</span></div>)}
            </div>
            <div>
              <h3 className="sub">Записи этапов по неделям, шт</h3>
              {w.weekly.length === 0 ? <p className="muted">За 8 недель записей нет.</p> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={w.weekly.map(r => ({ ...r, label: dm(r.week) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e3e1d9" />
                    <XAxis dataKey="label" fontSize={11} /><YAxis fontSize={10} /><Tooltip /><Legend />
                    {stageNames.map((n, i) => <Bar key={n} dataKey={n} fill={STAGE_COLORS[i % STAGE_COLORS.length]} />)}
                  </BarChart>
                </ResponsiveContainer>
              )}
              {w.late.length > 0 && <>
                <h3 className="sub">Опаздывают</h3>
                {w.late.map(o => <div key={o.id} className="frow"><span className="fl"><Link to={`/workshop/orders/${o.id}`}>{o.product}</Link> · срок {dmy(o.deadline)}</span>
                  <span className="neg">осталось {fmt(o.left)} шт</span></div>)}
              </>}
            </div>
          </div>
        </div>
      )}

      {d.warehouse && d.warehouse.low_stock.length > 0 && (
        <div className="card">
          <h2>Заканчиваются на складе</h2>
          {d.warehouse.low_stock.map(x => <div key={x.id} className="frow"><span className="fl">{x.name}</span>
            <span className="neg num">{fmt(x.stock)} {x.unit} при минимуме {fmt(x.min)}</span></div>)}
        </div>
      )}
    </div>
  )
}
