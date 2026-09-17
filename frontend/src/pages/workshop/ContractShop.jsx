import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, fmt, dmy, can, canEdit } from '../../api'
import { Loader, LoadError } from '../../components/Loader'
import StageBars from '../../components/StageBars'
import LaunchForm from './LaunchForm'
import StageSheet from './StageSheet'
import Workers from './Workers'

/** Итог по заказам договора: план и сколько прошёл каждый этап, сложенные по всем изделиям. */
function combine(orders) {
  const stages = new Map()
  let planned = 0, finished = 0, left = 0
  for (const o of orders) {
    planned += o.summary.planned
    finished += o.summary.finished
    left += o.summary.left
    for (const s of o.summary.stages) {
      const r = stages.get(s.template) || { id: s.template, template: s.template, name: s.name, kind: s.kind,
        done: 0, assigned: 0, in_work: 0 }
      r.done += s.done; r.assigned += s.assigned; r.in_work += s.in_work
      stages.set(s.template, r)
    }
  }
  return { planned, finished, left, stages: [...stages.values()] }
}

/**
 * Цех по одному договору (или папка «Без договора»): изделия, листы этапов
 * и исполнители — только по заказам этого договора.
 */
export default function ContractShop({ user }) {
  const { cid } = useParams()
  const none = cid === 'none'
  const base = `/workshop/contracts/${cid}`
  const location = useLocation()
  const seeEntries = can(user, 'workshop.entries')
  const [orders, setOrders] = useState(null)
  const [overview, setOverview] = useState([])
  const [contract, setContract] = useState(null)
  const [failed, setFailed] = useState(false)

  const reload = useCallback(() => {
    setFailed(false)
    api.get(`/work-orders/?contract=${cid}&page_size=1000`).then(r => setOrders(r.data.results || []))
      .catch(() => setFailed(true))
    if (seeEntries) api.get(`/stage-templates/overview/?contract=${cid}`).then(r => setOverview(r.data)).catch(() => {})
  }, [cid])
  useEffect(() => { reload() }, [reload, location.pathname])
  useEffect(() => {
    setContract(null)
    if (!none && can(user, 'contracts.contracts'))
      api.get(`/contracts/${cid}/`).then(r => setContract(r.data)).catch(() => {})
  }, [cid])

  const summary = useMemo(() => combine(orders || []), [orders])

  if (failed && !orders) return <LoadError onRetry={reload} />
  if (!orders) return <Loader />

  // этапы — по порядку из настроек цеха; очередь — по заказам в работе
  const rank = new Map(overview.map((t, i) => [t.id, i]))
  const waiting = new Map(overview.map(t => [t.id, t.waiting]))
  const stages = [...summary.stages].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99))
  const first = orders[0]
  const number = contract ? (contract.purchase_no || contract.number) : first?.contract_number
  const customer = contract ? contract.customer_name : first?.customer_name
  const deadline = contract ? contract.deadline : first?.deadline

  return (
    <div>
      <div className="pagehead">
        <div>
          <Link to="/workshop" className="muted">← Все договоры цеха</Link>
          <h1>{none ? 'Без договора' : (contract?.title || orders.map(o => o.product).join(', ') || `Договор ${number || ''}`)}</h1>
          <div className="muted">
            {none ? 'частные заказы и образцы — всё, что шьётся не по договору'
              : [number && `закупка ${number}`, customer, deadline && `срок ${dmy(deadline)}`].filter(Boolean).join(' · ')}
            {!none && can(user, 'contracts.contracts') && <> · <Link to={`/contracts/${cid}`}>карточка договора →</Link></>}
          </div>
        </div>
      </div>

      {orders.length > 0 && <>
        <div className="kpi-grid">
          <div className="kpi"><div className="v">{fmt(summary.planned)}</div><div className="l">план, шт</div></div>
          {stages.map(s => (
            <div key={s.id} className="kpi"><div className="v">{fmt(s.done)}</div>
              <div className="l">{s.name}{s.in_work ? ` · шьётся ${fmt(s.in_work)}` : ''}</div></div>
          ))}
          <div className="kpi"><div className="v">{fmt(summary.left)}</div><div className="l">осталось</div></div>
        </div>
        <div className="card"><StageBars summary={{ planned: summary.planned, stages }} /></div>
      </>}

      <nav className="tabs linktabs">
        <NavLink end to={base}>Изделия ({orders.length})</NavLink>
        {seeEntries && stages.map(t => (
          <NavLink key={t.id} to={`${base}/stages/${t.id}`}>
            {t.name}{waiting.get(t.id) > 0 && <span className="tabcount" title="ждут этапа, шт">{waiting.get(t.id)}</span>}
          </NavLink>
        ))}
        {seeEntries && orders.length > 0 && <NavLink to={`${base}/workers`}>Исполнители</NavLink>}
      </nav>

      <Routes>
        <Route index element={<Products user={user} none={none} contract={contract} orders={orders} />} />
        <Route path="stages/:tid" element={<StageSheet user={user} contract={cid} defaultStatus="all" onChange={reload} />} />
        <Route path="workers" element={<Workers contract={cid} />} />
      </Routes>
    </div>
  )
}

function Products({ user, none, contract, orders }) {
  const navigate = useNavigate()
  const [show, setShow] = useState(false)
  const mayLaunch = canEdit(user, 'workshop.orders') && (none || contract)
  const today = new Date().toISOString().slice(0, 10)
  const sorted = [...orders].sort((a, b) => (a.status === 'done') - (b.status === 'done'))

  return (
    <div>
      {show && <LaunchForm user={user} contract={none ? null : contract} noContract={none}
        onCancel={() => setShow(false)} onDone={(o) => navigate(`/workshop/orders/${o.id}`)} />}
      <div className="card" style={{ padding: 0 }}>
        <div className="toolbar">
          <b>Изделия в цехе</b>
          <span className="muted">клик — размеры по этапам, история, исполнители и ткань по изделию</span>
          {mayLaunch && !show && <button className="btn small orange" style={{ marginLeft: 'auto' }} onClick={() => setShow(true)}>
            {none ? '+ Заказ без договора' : 'Запустить в цех'}</button>}
        </div>
        {orders.length === 0 && <p className="muted" style={{ padding: 16 }}>
          {none ? 'Заказов без договора нет.' : 'По договору в цех ещё не запускали. «Запустить в цех» создаст заказ: изделие, размеры и этапы.'}</p>}
        {sorted.map(o => (
          <Link key={o.id} className="ordercard" to={`/workshop/orders/${o.id}`}>
            <div>
              <div className="t">{o.product}
                {o.status === 'done' && <span className="pill ok" style={{ marginLeft: 8 }}>сдан</span>}</div>
              <div className="muted">
                {[!none ? null : o.client, o.deadline && `срок ${dmy(o.deadline)}`, `размеров: ${o.sizes_count}`].filter(Boolean).join(' · ')}
                {o.deadline && o.deadline < today && o.status === 'in_work' && o.summary.left > 0 &&
                  <span className="pill low" style={{ marginLeft: 6 }}>срок прошёл</span>}
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
