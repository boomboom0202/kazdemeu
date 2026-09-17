import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmt, dmy } from '../../api'
import { Loader, LoadError } from '../../components/Loader'
import StageBars from '../../components/StageBars'

/**
 * Главная цеха — договоры. Карточка договора: какие изделия шьются, план,
 * как идут этапы и сколько ждёт каждого этапа. Клик — всё по этому договору.
 * Заказы без договора — отдельной папкой. Ниже — договоры в работе, по которым
 * цех ещё не запускали.
 */
export default function ContractsBoard() {
  const [status, setStatus] = useState('in_work')
  const [q, setQ] = useState('')
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  const load = () => {
    setFailed(false)
    api.get(`/work-orders/by_contracts/?status=${status}`).then(r => setData(r.data)).catch(() => setFailed(true))
  }
  useEffect(load, [status])

  if (failed) return <LoadError onRetry={load} />
  if (!data) return <Loader />

  const needle = q.trim().toLowerCase()
  const match = (...parts) => !needle || parts.join(' ').toLowerCase().includes(needle)
  const groups = data.groups.filter(g => g.key === 'none' || match(g.number, g.customer, g.title, ...g.products))
  const withOrders = groups.filter(g => g.key !== 'none')
  const notLaunched = data.not_launched.filter(c => match(c.number, c.customer, c.title))
  const total = (k) => withOrders.reduce((a, g) => a + g[k], 0) + (groups.find(g => g.key === 'none')?.[k] || 0)

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi"><div className="v">{withOrders.length}</div><div className="l">договоров в цехе</div></div>
        <div className="kpi"><div className="v">{fmt(total('planned'))}</div><div className="l">план, шт</div></div>
        <div className="kpi good"><div className="v">{fmt(total('finished'))}</div><div className="l">прошли все этапы</div></div>
        <div className="kpi"><div className="v">{fmt(total('left'))}</div><div className="l">осталось</div></div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="toolbar">
          <b>Договоры в цехе</b>
          <select value={status} onChange={e => setStatus(e.target.value)} style={{ width: 'auto' }}>
            <option value="in_work">Заказы в работе</option>
            <option value="done">Сданные</option>
            <option value="all">Все</option>
          </select>
          <input placeholder="Поиск: закупка, заказчик, изделие" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        </div>
        {withOrders.length === 0 && <p className="muted" style={{ padding: '12px 16px' }}>
          {needle ? 'Ничего не найдено.' : 'По договорам в цехе ничего нет. Договор запускается в цех из его папки или из карточки договора.'}</p>}
        {groups.map(g => {
          const none = g.key === 'none'
          const waiting = g.stages.filter(s => s.waiting > 0)
          return (
            <Link key={g.key} to={`/workshop/contracts/${g.key}`} className={'ordercard' + (none ? ' nocontract' : '')}>
              <div>
                <div className="t">{none ? 'Без договора' : g.title}</div>
                <div className="muted">
                  {none
                    ? 'частные заказы и образцы — всё, что шьётся не по договору'
                    : [`закупка ${g.number}`, g.customer, g.deadline && `срок ${dmy(g.deadline)}`].filter(Boolean).join(' · ')}
                  {g.late && <span className="pill low" style={{ marginLeft: 6 }}>срок прошёл</span>}
                </div>
                <div className="muted">
                  {g.orders ? `изделия: ${g.products.join(', ')}` : 'заказов нет'}
                  {waiting.length > 0 && <span className="chips" style={{ display: 'inline-flex', marginLeft: 8 }}>
                    {waiting.map(s => <span key={s.id} className="chip wait">{s.name} ждёт {fmt(s.waiting)}</span>)}
                  </span>}
                </div>
              </div>
              <div className="nums">{g.planned ? <>готово <b>{fmt(g.finished)}</b> из {fmt(g.planned)}</> : 'открыть →'}</div>
              {g.stages.length > 0 && <StageBars summary={{ planned: g.planned, stages: g.stages }} compact />}
            </Link>
          )
        })}
      </div>

      {notLaunched.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="toolbar"><b>Договоры, не запущенные в цех</b>
            <span className="muted">новые и в работе — откройте и нажмите «Запустить в цех»</span></div>
          <div className="tablewrap"><table className="sheet">
            <thead><tr><th>Закупка</th><th>Заказчик · предмет</th><th className="num">Кол-во</th><th>Срок</th><th>Статус</th><th /></tr></thead>
            <tbody>
              {notLaunched.map(c => (
                <tr key={c.contract}>
                  <td style={{ whiteSpace: 'nowrap' }}><b>{c.number}</b></td>
                  <td className="wide">{c.customer}<div className="muted">{c.title}</div></td>
                  <td className="num">{c.qty !== null ? fmt(c.qty) : ''}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{c.deadline ? dmy(c.deadline) : ''}</td>
                  <td>{c.status_display}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><Link to={`/workshop/contracts/${c.contract}`}>открыть →</Link></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  )
}
