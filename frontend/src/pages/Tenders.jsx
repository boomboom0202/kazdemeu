import React, { useEffect, useRef, useState } from 'react'
import { api, fmt, canEdit, apiError, can} from '../api'
import { Link } from 'react-router-dom'

export const TENDER_STATUS = {
  planned: { label: 'В плане', color: '#8892a6' },
  submitted: { label: 'Заявка подана', color: '#2456c8' },
  rejected: { label: 'Заявка отклонена', color: '#b8860b' },
  won: { label: 'Выиграли', color: '#1d7a4f' },
  lost: { label: 'Проиграли', color: '#b03030' },
  declined: { label: 'Отбой', color: '#6b6b6b' },
}

const EMPTY = {
  platform: '', own_company: '', purchase_no: '', lot_no: '', customer_name: '', item_name: '',
  product: '', qty: '', price: '', plan_price: '', cost_per_unit: '', deadline: '',
  delivery_days: '', note: '',
}

export default function Tenders({ user }) {
  const [rows, setRows] = useState([])
  const [funnel, setFunnel] = useState(null)
  const [platforms, setPlatforms] = useState([])
  const [companies, setCompanies] = useState([])
  const [products, setProducts] = useState([])
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const fileRef = useRef()
  const mayEdit = canEdit(user, 'tenders.tenders')

  const load = () => {
    const p = new URLSearchParams({ page_size: '200' })
    if (status) p.set('status', status)
    if (q) p.set('search', q)
    api.get('/tenders/?' + p).then(r => setRows(r.data.results || []))
    api.get('/tenders/funnel/').then(r => setFunnel(r.data))
  }
  useEffect(load, [status, q])
  useEffect(() => {
    if (can(user, 'tenders.platforms')) api.get('/platforms/?page_size=100').then(r => setPlatforms(r.data.results || []))
    if (can(user, 'tenders.companies')) api.get('/own-companies/?page_size=100').then(r => setCompanies(r.data.results || []))
    api.get('/products/?page_size=200').then(r => setProducts(r.data.results || [])).catch(() => {})
  }, [])

  const reset = () => { setShowForm(false); setEditId(null); setForm(EMPTY) }
  const save = async () => {
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) =>
      [k, ['platform', 'own_company', 'product', 'deadline'].includes(k) ? (v || null) : v]))
    try {
      if (editId) await api.patch(`/tenders/${editId}/`, body)
      else await api.post('/tenders/', body)
      reset(); load()
    } catch (e) { alert(apiError(e)) }
  }
  const edit = (t) => {
    setEditId(t.id); setShowForm(true)
    setForm({
      platform: t.platform || '', own_company: t.own_company || '', purchase_no: t.purchase_no,
      lot_no: t.lot_no, customer_name: t.customer_name, item_name: t.item_name,
      product: t.product || '', qty: t.qty, price: t.price, plan_price: t.plan_price,
      cost_per_unit: t.cost_per_unit, deadline: t.deadline || '',
      delivery_days: t.delivery_days || '', note: t.note || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const del = async (t) => {
    if (!confirm(`Удалить лот «${t.item_name}»?`)) return
    try { await api.delete(`/tenders/${t.id}/`); load() } catch (e) { alert('Не удалось удалить') }
  }
  const setStatusOf = async (t, s) => {
    try { await api.post(`/tenders/${t.id}/set_status/`, { status: s }); load() }
    catch (e) { alert(apiError(e)) }
  }
  const calcCost = async (t) => {
    try { await api.post(`/tenders/${t.id}/calc_cost/`); load() }
    catch (e) { alert(apiError(e)) }
  }
  const makeContract = async (t) => {
    const number = prompt('Номер договора:', `Т-${t.purchase_no || t.id}`)
    if (!number) return
    try { const { data } = await api.post(`/tenders/${t.id}/make_contract/`, { number }); load()
      alert(`Договор ${data.contract_number} создан — откройте раздел «Договоры».`) }
    catch (e) { alert(apiError(e)) }
  }
  const exportExcel = async () => {
    const r = await api.get('/tenders/export_excel/', { responseType: 'blob' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(r.data); a.download = 'план_закупок.xlsx'; a.click()
  }
  const importExcel = async (e) => {
    const f = e.target.files[0]; if (!f) return
    const fd = new FormData(); fd.append('file', f)
    try {
      const { data } = await api.post('/tenders/import_excel/', fd)
      alert(`Импорт: добавлено ${data.created}, обновлено ${data.updated ?? 0}, ` +
        `пропущено ${data.skipped}` +
        (data.errors?.length ? `\nОшибки:\n${data.errors.join('\n')}` : ''))
    } catch (err) { alert(err.response?.data?.detail || 'Ошибка импорта') }
    e.target.value = ''; load()
  }

  return (
    <div>
      <div className="pagehead">
        <h1>Тендеры / План закупок</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost small" onClick={exportExcel}>Экспорт в Excel</button>
          {mayEdit && <>
            <button className="btn ghost small" onClick={() => fileRef.current.click()}>Импорт из Excel</button>
            <input type="file" ref={fileRef} accept=".xlsx" style={{ display: 'none' }} onChange={importExcel} />
            <button className="btn small" onClick={() => showForm ? reset() : setShowForm(true)}>
              {showForm ? 'Закрыть' : '+ Новый лот'}</button>
          </>}
        </div>
      </div>

      {funnel?.urgent?.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid var(--red)' }}>
          <b>Горящие сроки подачи:</b>
          {funnel.urgent.map(u => (
            <div key={u.id} style={{ fontSize: 13, marginTop: 4 }}>
              {u.item} · {u.customer} — до {u.deadline} <b style={{ color: 'var(--red)' }}>
                (осталось {u.days_left} дн.)</b>
            </div>
          ))}
        </div>
      )}

      {funnel && (
        <div className="kpi-grid">
          {funnel.stages.map(s => (
            <div key={s.status} className="kpi">
              <div className="v">{s.count}</div>
              <div className="l">{s.status_display}<br />
                <span className="muted">{fmt(s.plan_total)} ₸</span></div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="card stitch">
          <h2>{editId ? 'Редактирование лота' : 'Новый лот'}</h2>
          <div className="formrow">
            <div><label className="f">Площадка</label>
              <select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}>
                <option value="">—</option>{platforms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
            <div><label className="f">Номер закупки</label><input value={form.purchase_no} onChange={e => setForm({ ...form, purchase_no: e.target.value })} /></div>
            <div><label className="f">Номер лота</label><input value={form.lot_no} onChange={e => setForm({ ...form, lot_no: e.target.value })} /></div>
            <div><label className="f">От какой фирмы</label>
              <select value={form.own_company} onChange={e => setForm({ ...form, own_company: e.target.value })}>
                <option value="">—</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
          </div>
          <div className="formrow">
            <div style={{ flex: 2 }}><label className="f">Организация-заказчик</label><input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} /></div>
            <div style={{ flex: 2 }}><label className="f">Наименование товара</label><input value={form.item_name} onChange={e => setForm({ ...form, item_name: e.target.value })} /></div>
            <div><label className="f">Изделие из каталога</label>
              <select value={form.product} onChange={e => setForm({ ...form, product: e.target.value })}>
                <option value="">—</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
          </div>
          <div className="formrow">
            <div><label className="f">Кол-во</label><input type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /></div>
            <div><label className="f">Цена заказчика</label><input type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></div>
            <div><label className="f">Наша план. цена</label><input type="number" value={form.plan_price} onChange={e => setForm({ ...form, plan_price: e.target.value })} /></div>
            <div><label className="f">Себестоимость/ед.</label><input type="number" value={form.cost_per_unit} onChange={e => setForm({ ...form, cost_per_unit: e.target.value })} /></div>
            <div><label className="f">Срок подачи до</label><input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} /></div>
            <div><label className="f">Срок поставки</label><input value={form.delivery_days} onChange={e => setForm({ ...form, delivery_days: e.target.value })} /></div>
          </div>
          <div className="formrow"><div><label className="f">Комментарий</label><textarea rows={2} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div></div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={save} disabled={!form.item_name || !form.customer_name}>Сохранить</button>
            <button className="btn ghost" onClick={reset}>Отмена</button>
          </div>
          <p className="muted">Выберите изделие из каталога — потом кнопкой «Себест.» подтянется расчёт по BOM.</p>
        </div>
      )}

      <div className="formrow" style={{ maxWidth: 560 }}>
        <input placeholder="Поиск: закупка, лот, товар, заказчик..." value={q} onChange={e => setQ(e.target.value)} />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Все статусы</option>
          {Object.entries(TENDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr>
            <th>Площадка</th><th>Закупка</th><th>Заказчик</th><th>Товар</th>
            <th className="num">Кол-во</th><th className="num">Цена зак.</th>
            <th className="num">План цена</th><th className="num">Себест.</th>
            <th className="num">Прибыль</th><th className="num">Маржа</th>
            <th>Срок подачи</th><th>Статус</th><th />
          </tr></thead>
          <tbody>
            {rows.map(t => (
              <tr key={t.id}>
                <td>{t.platform_name || '—'}</td>
                <td>{t.purchase_no || '—'}{t.lot_no && <div className="muted">лот {t.lot_no}</div>}</td>
                <td>{t.customer_name}</td>
                <td>{t.item_name}</td>
                <td className="num">{t.qty}</td>
                <td className="num">{fmt(t.price)}</td>
                <td className="num">{fmt(t.plan_price)}</td>
                <td className="num">{fmt(t.cost_per_unit)}</td>
                <td className="num" style={{ fontWeight: 700, color: t.profit > 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(t.profit)}</td>
                <td className="num">{t.margin_percent.toFixed(1)}%</td>
                <td>{t.deadline || '—'}
                  {t.is_urgent && <div><span className="pill low">{t.days_left} дн.</span></div>}</td>
                <td><span className="badge" style={{ background: TENDER_STATUS[t.status]?.color }}>
                  {TENDER_STATUS[t.status]?.label}</span>
                  {t.contract_number && <div style={{ fontSize: 11 }}>
                    <Link to="/contracts">дог. {t.contract_number}</Link></div>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {mayEdit && <>
                    {t.allowed_transitions?.map(s => (
                      <button key={s} className="btn small ghost" style={{ marginRight: 4 }}
                        onClick={() => setStatusOf(t, s)}>→ {TENDER_STATUS[s]?.label}</button>
                    ))}
                    {t.product && <button className="btn small ghost" onClick={() => calcCost(t)}>Себест.</button>}{' '}
                    {t.status === 'won' && !t.contract_number &&
                      <button className="btn small orange" onClick={() => makeContract(t)}>В договор</button>}{' '}
                    <button className="btn small ghost" onClick={() => edit(t)}>Изм.</button>{' '}
                    <button className="btn small ghost" onClick={() => del(t)}>Удл.</button>
                  </>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={13} className="muted" style={{ padding: 16 }}>
              Лотов нет. Добавьте вручную или загрузите свой файл «план закупок» кнопкой «Импорт из Excel».</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
