import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, fmt, can, canEdit, dmy } from '../../api'
import { Loader, LoadError } from '../../components/Loader'
import StageBars from '../../components/StageBars'
import LaunchForm from './LaunchForm'

/** Заказы цеха: сверху этапы (сколько ждёт каждого), ниже заказы с полосками по этапам. */
export default function Orders({ user, overview }) {
  const navigate = useNavigate()
  const mayCreate = canEdit(user, 'workshop.orders')
  const [status, setStatus] = useState('in_work')
  const [q, setQ] = useState('')
  const [orders, setOrders] = useState(null)
  const [failed, setFailed] = useState(false)
  const [show, setShow] = useState(false)

  const load = () => {
    setFailed(false)
    const p = new URLSearchParams({ page_size: 1000 })
    if (status) p.set('status', status)
    if (q) p.set('search', q)
    api.get('/work-orders/?' + p).then(r => setOrders(r.data.results || [])).catch(() => setFailed(true))
  }
  useEffect(load, [status, q])

  if (failed) return <LoadError onRetry={load} />
  if (!orders) return <Loader />

  const total = (k) => orders.reduce((a, o) => a + (o.summary[k] || 0), 0)
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div>
      {can(user, 'workshop.entries') && overview.length > 0 && (
        <div className="stagecards">
          {overview.map(t => (
            <Link key={t.id} to={`/workshop/stages/${t.id}`} className="stagecard">
              <div className="n">{t.name}</div>
              <div className="nums">
                <span title="прошли этап по заказам в работе"><b>{fmt(t.done)}</b> прошло</span>
                <span title="прошли предыдущий этап, сюда ещё не взяты" className={t.waiting ? 'wait' : ''}><b>{fmt(t.waiting)}</b> ждёт</span>
                {t.kind === 'sewing' && <span><b>{fmt(t.in_work)}</b> шьётся</span>}
              </div>
              <div className="muted">{t.orders} заказ(ов) · открыть лист →</div>
            </Link>
          ))}
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi"><div className="v">{orders.length}</div><div className="l">заказов в списке</div></div>
        <div className="kpi"><div className="v">{fmt(total('planned'))}</div><div className="l">план, шт</div></div>
        <div className="kpi good"><div className="v">{fmt(total('finished'))}</div><div className="l">прошли все этапы</div></div>
        <div className="kpi"><div className="v">{fmt(total('left'))}</div><div className="l">осталось</div></div>
      </div>

      {show && <LaunchForm user={user} onCancel={() => setShow(false)} onDone={(o) => navigate(`/workshop/orders/${o.id}`)} />}

      <div className="card" style={{ padding: 0 }}>
        <div className="toolbar">
          <select value={status} onChange={e => setStatus(e.target.value)} style={{ width: 'auto' }}>
            <option value="in_work">В работе</option>
            <option value="done">Сданные</option>
            <option value="">Все</option>
          </select>
          <input placeholder="Поиск: изделие, закупка, заказчик" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 320 }} />
          {mayCreate && <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => setShow(s => !s)}>
            {show ? 'Закрыть' : '+ Заказ без договора'}</button>}
        </div>
        {orders.length === 0 && <p className="muted" style={{ padding: 16 }}>Заказов нет. Заказ цеха запускается из карточки договора кнопкой «Запустить в цех».</p>}
        {orders.map(o => (
          <Link key={o.id} className="ordercard" to={`/workshop/orders/${o.id}`}>
            <div>
              <div className="t">{o.product}</div>
              <div className="muted">
                {[o.contract_number && `закупка ${o.contract_number}`, o.customer_name || o.client,
                  o.deadline && `срок ${dmy(o.deadline)}`, `размеров: ${o.sizes_count}`].filter(Boolean).join(' · ')}
                {o.deadline && o.deadline < today && o.status === 'in_work' && <span className="pill low" style={{ marginLeft: 6 }}>срок прошёл</span>}
              </div>
            </div>
            <div className="nums">готово <b>{fmt(o.summary.finished)}</b> из {fmt(o.summary.planned)}</div>
            <StageBars summary={o.summary} compact />
          </Link>
        ))}
      </div>
    </div>
  )
}
