import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, fmt, apiError, can, canEdit } from '../api'
import { Loader, LoadError } from '../components/Loader'
import { WorkBar, WorkLegend } from '../components/WorkBar'

/**
 * Цех: все заказы с полоской готовности. Клик по заказу — провал в размеры.
 * Вторая вкладка — бригады: сколько сшили и сколько им начислено.
 */
export default function Workshop({ user }) {
  const seeOrders = can(user, 'workshop.orders')
  const roOrders = !canEdit(user, 'workshop.orders')
  const seeBrigades = can(user, 'workshop.sewing')
  const roBrigades = !canEdit(user, 'workshop.sewing')
  const seeContracts = can(user, 'contracts.contracts')
  const navigate = useNavigate()

  const [tab, setTab] = useState(seeOrders ? 'orders' : 'brigades')
  const [status, setStatus] = useState('in_work')
  const [orders, setOrders] = useState(null)
  const [brigades, setBrigades] = useState(null)
  const [contracts, setContracts] = useState([])
  const [failed, setFailed] = useState(false)
  const [show, setShow] = useState(false)
  const empty = { product: '', contract: '', client: '', deadline: '', sewing_rate: '', sizes_text: '' }
  const [form, setForm] = useState(empty)
  const [bForm, setBForm] = useState({ leader: '', people: '' })

  const load = () => {
    setFailed(false)
    const jobs = []
    if (seeOrders) jobs.push(api.get('/work-orders/?page_size=300' + (status ? `&status=${status}` : ''))
      .then(r => setOrders(r.data.results || [])))
    if (seeBrigades) jobs.push(api.get('/brigades/?page_size=300').then(r => setBrigades(r.data.results || [])))
    Promise.all(jobs).catch(() => setFailed(true))
  }
  useEffect(() => { load() }, [status])
  useEffect(() => {
    if (seeContracts) api.get('/contracts/?page_size=300').then(r => setContracts(r.data.results || []))
  }, [])

  const create = async () => {
    try {
      const { data } = await api.post('/work-orders/', {
        ...form, contract: form.contract || null, deadline: form.deadline || null,
        sewing_rate: form.sewing_rate || 0,
      })
      setForm(empty); setShow(false)
      navigate(`/workshop/${data.id}`)
    } catch (e) { alert(apiError(e)) }
  }

  // Выбрали договор — «для кого» подставится из заказчика, если пусто
  const pickContract = (id) => {
    const c = contracts.find(x => String(x.id) === String(id))
    setForm(f => ({ ...f, contract: id, client: f.client || (c ? c.customer_name : '') }))
  }

  const addBrigade = async () => {
    try {
      await api.post('/brigades/', { leader: bForm.leader, people: bForm.people || 0 })
      setBForm({ leader: '', people: '' }); load()
    } catch (e) { alert(apiError(e)) }
  }
  const patchBrigade = async (b, body) => {
    try { await api.patch(`/brigades/${b.id}/`, body); load() } catch (e) { alert(apiError(e)) }
  }
  const delBrigade = async (b) => {
    if (!confirm(`Удалить бригаду «${b.label}»?`)) return
    try { await api.delete(`/brigades/${b.id}/`); load() }
    catch (e) { alert(apiError(e, 'Бригаду с выданными партиями удалить нельзя — отметьте, что не работает.')) }
  }

  if (failed) return <LoadError onRetry={load} />
  if ((seeOrders && !orders) || (seeBrigades && !brigades)) return <Loader />

  const sum = (k) => (orders || []).reduce((a, o) => a + o.totals[k], 0)

  return (
    <div>
      <div className="pagehead">
        <h1>Цех</h1>
        {tab === 'orders' && !roOrders &&
          <button className="btn small" onClick={() => setShow(s => !s)}>{show ? 'Закрыть' : '+ Заказ цеха'}</button>}
      </div>

      <div className="tabs">
        {seeOrders && <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>Заказы</button>}
        {seeBrigades && <button className={tab === 'brigades' ? 'active' : ''} onClick={() => setTab('brigades')}>Бригады</button>}
      </div>

      {tab === 'orders' && <>
        {show && (
          <div className="card stitch">
            <h2>Новый заказ цеха</h2>
            <div className="formrow">
              <div><label className="f">Изделие</label>
                <input value={form.product} placeholder="Куртка АУП" onChange={e => setForm({ ...form, product: e.target.value })} /></div>
              {seeContracts && <div><label className="f">Договор</label>
                <select value={form.contract} onChange={e => pickContract(e.target.value)}>
                  <option value="">— без договора —</option>
                  {contracts.map(c => <option key={c.id} value={c.id}>{c.number} · {c.customer_name}</option>)}
                </select></div>}
              <div><label className="f">Для кого</label>
                <input value={form.client} placeholder="Павлодар, частный заказ…" onChange={e => setForm({ ...form, client: e.target.value })} /></div>
              <div><label className="f">Срок</label>
                <input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} /></div>
              <div><label className="f">Расценка пошива, ₸/шт</label>
                <input type="number" value={form.sewing_rate} placeholder="3000" onChange={e => setForm({ ...form, sewing_rate: e.target.value })} /></div>
            </div>
            <label className="f">Размеры — столбиком, как в отчёте цеха</label>
            <textarea rows={6} value={form.sizes_text} placeholder={'54/176 - 27 шт\n54/182 - 35 шт\n56-58/170-176 116'}
              onChange={e => setForm({ ...form, sizes_text: e.target.value })} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn" onClick={create} disabled={!form.product}>Создать и открыть</button>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>Размеры можно добавить и позже, в карточке заказа.
              Расценка нужна, чтобы считать, сколько начислить бригадам за сшитое.</p>
          </div>
        )}

        <div className="kpi-grid">
          <div className="kpi"><div className="v">{(orders || []).length}</div><div className="l">заказов</div></div>
          <div className="kpi"><div className="v">{fmt(sum('planned'))}</div><div className="l">план, шт</div></div>
          <div className="kpi"><div className="v">{fmt(sum('cut'))}</div><div className="l">скроено</div></div>
          <div className="kpi"><div className="v">{fmt(sum('in_sewing'))}</div><div className="l">в пошиве</div></div>
          <div className="kpi good"><div className="v">{fmt(sum('sewn'))}</div><div className="l">сшито</div></div>
          <div className="kpi"><div className="v">{fmt(sum('packed'))}</div><div className="l">упаковано</div></div>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
            <select value={status} onChange={e => setStatus(e.target.value)} style={{ width: 'auto' }}>
              <option value="in_work">В работе</option>
              <option value="done">Сданные</option>
              <option value="">Все</option>
            </select>
            <WorkLegend />
          </div>
          {orders.length === 0 && <p className="muted" style={{ padding: 16 }}>Заказов нет.</p>}
          {orders.map(o => (
            <Link key={o.id} className="ordercard" to={`/workshop/${o.id}`}>
              <div>
                <div className="t">{o.product}</div>
                <div className="muted">
                  {[o.contract_number && `договор ${o.contract_number}`, o.client,
                    o.deadline && `срок ${o.deadline}`, `размеров: ${o.sizes_count}`]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="nums">
                сшито <b>{fmt(o.totals.sewn)}</b> из {fmt(o.totals.planned)} · упаковано {fmt(o.totals.packed)}
              </div>
              <WorkBar t={o.totals} />
            </Link>
          ))}
        </div>
      </>}

      {tab === 'brigades' && <div className={roBrigades ? 'readonly' : ''}>
        {roBrigades && <div className="ro-note"><b>Только просмотр.</b>&nbsp;Бригады ведёт цех.</div>}
        <div className="card stitch">
          <h2>Новая бригада</h2>
          <div className="formrow">
            <div><label className="f">Бригадир</label>
              <input value={bForm.leader} placeholder="Наср" onChange={e => setBForm({ ...bForm, leader: e.target.value })} /></div>
            <div><label className="f">Людей с ним</label>
              <input type="number" value={bForm.people} placeholder="9" onChange={e => setBForm({ ...bForm, people: e.target.value })} /></div>
            <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={addBrigade} disabled={!bForm.leader}>Добавить</button></div>
          </div>
          <p className="muted">В отчёте цеха пишут «Наср + 9 бала» — бригадир и девять человек с ним.</p>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr>
              <th>Бригада</th><th className="num">Партий в работе</th><th className="num">В пошиве, шт</th>
              <th className="num">Сшито всего</th><th className="num">Начислено, ₸</th><th>Работает</th><th />
            </tr></thead>
            <tbody>
              {brigades.length === 0 && <tr><td colSpan={7} className="muted">Бригад пока нет.</td></tr>}
              {brigades.map(b => (
                <tr key={b.id} style={b.is_active ? {} : { opacity: 0.55 }}>
                  <td><b>{b.label}</b>{b.note && <div className="muted">{b.note}</div>}</td>
                  <td className="num">{b.stats.active_jobs}</td>
                  <td className="num">{fmt(b.stats.in_work)}</td>
                  <td className="num">{fmt(b.stats.sewn)}</td>
                  <td className="num">{fmt(b.stats.earned)}</td>
                  <td><input type="checkbox" style={{ width: 'auto' }} checked={b.is_active}
                    onChange={e => patchBrigade(b, { is_active: e.target.checked })} /></td>
                  <td><button className="btn small ghost" onClick={() => delBrigade(b)}>Удл.</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>}
    </div>
  )
}
