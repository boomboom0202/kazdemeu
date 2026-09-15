import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, fmt, money, CONTRACT_STATUS, can, canEdit, apiError, download } from '../api'
import ExpenseImport from '../components/ExpenseImport'

// Реестр как в «Договора.xlsx»: одна строка — одна позиция закупки
const EMPTY = {
  purchase_no: '', own_company: '', platform: '', customer: '', title: '',
  qty: '', price: '', amount: '', contract_no: '', signed_date: '', deadline: '',
  planned_execution: '', delivery_place: '', delivery_terms: '', phone: '', investor: '',
  costs_note: '', payment_note: '', comment: '', note: '', specification: '',
}
const orNull = (v) => (v === '' || v === undefined ? null : v)

export default function Contracts({ user }) {
  const mayEdit = canEdit(user, 'contracts.contracts')
  const seePay = can(user, 'contracts.payments')
  const seeExp = can(user, 'contracts.expenses')
  const mayImportExp = canEdit(user, 'contracts.expenses') && canEdit(user, 'contracts.payments')
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [sum, setSum] = useState(null)
  const [customers, setCustomers] = useState([])
  const [companies, setCompanies] = useState([])
  const [status, setStatus] = useState('')
  const [company, setCompany] = useState('')
  const [q, setQ] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [showCust, setShowCust] = useState(false)
  const [editCustId, setEditCustId] = useState(null)
  const [custForm, setCustForm] = useState({ name: '', phone: '', bin_iin: '', contact_person: '' })
  const [expImport, setExpImport] = useState(false)
  const fileRef = useRef()

  const params = () => {
    const p = new URLSearchParams({ page_size: 5000 })
    if (status) p.set('status', status)
    if (q) p.set('search', q)
    if (company) p.set('own_company', company)
    return p
  }
  const load = () => {
    api.get('/contracts/?' + params()).then(r => setRows(r.data.results || []))
    api.get('/contracts/summary/?' + params()).then(r => setSum(r.data))
  }
  useEffect(load, [status, q, company])
  const loadCustomers = () => api.get('/customers/?page_size=2000').then(r => setCustomers(r.data.results || []))
  useEffect(() => {
    loadCustomers()
    api.get('/own-companies/?page_size=200').then(r => setCompanies(r.data.results || [])).catch(() => {})
  }, [])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const create = async () => {
    const qty = orNull(form.qty), price = orNull(form.price)
    let amount = form.amount
    if (amount === '' && qty !== null && price !== null) amount = Number(qty) * Number(price)
    try {
      const { data } = await api.post('/contracts/', {
        ...form, number: form.purchase_no, qty, price, amount: amount === '' ? 0 : amount,
        own_company: orNull(form.own_company), deadline: orNull(form.deadline), signed_date: orNull(form.signed_date),
      })
      navigate(`/contracts/${data.id}`)
    } catch (e) { alert(apiError(e)) }
  }

  const resetCust = () => { setEditCustId(null); setCustForm({ name: '', phone: '', bin_iin: '', contact_person: '' }) }
  const saveCustomer = async () => {
    try {
      if (editCustId) { await api.patch(`/customers/${editCustId}/`, custForm); resetCust(); await loadCustomers() }
      else {
        const { data } = await api.post('/customers/', custForm)
        resetCust(); await loadCustomers(); setForm(f => ({ ...f, customer: data.id }))
      }
    } catch (e) { alert(apiError(e)) }
  }
  const deleteCust = async (c) => {
    if (!confirm(`Удалить заказчика «${c.name}»?`)) return
    try { await api.delete(`/customers/${c.id}/`); await loadCustomers() }
    catch (e) { alert(apiError(e, 'Не удалось удалить')) }
  }

  const importExcel = async (e) => {
    const f = e.target.files[0]; if (!f) return
    const fd = new FormData(); fd.append('file', f)
    try {
      const { data } = await api.post('/contracts/import_excel/', fd)
      alert(`Реестр загружен: новых позиций ${data.created}, обновлено ${data.updated}.` +
        (data.errors.length ? `\n\nЗамечания:\n• ${data.errors.join('\n• ')}` : ''))
    } catch (err) { alert(apiError(err)) }
    e.target.value = ''; load(); loadCustomers()
  }

  const minus = (c) => c.money.balance !== null && c.money.expenses > 0 && c.money.balance < 0

  return (
    <div>
      <div className="pagehead">
        <h1>Договоры</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn ghost small btn-read" onClick={() => download('/contracts/export_excel/?' + params(), 'Договора.xlsx')}>Экспорт в Excel</button>
          {mayEdit && <>
            <button className="btn ghost small" onClick={() => fileRef.current.click()}>Импорт «Договора.xlsx»</button>
            <input type="file" ref={fileRef} accept=".xlsx" style={{ display: 'none' }} onChange={importExcel} />
          </>}
          {mayImportExp && <button className="btn ghost small" onClick={() => setExpImport(s => !s)}>Импорт «Расходы.xlsx»</button>}
          {can(user, 'contracts.customers') && <button className="btn ghost small btn-read" onClick={() => setShowCust(s => !s)}>Заказчики</button>}
          {mayEdit && <button className="btn small" onClick={() => setShowForm(s => !s)}>{showForm ? 'Закрыть' : '+ Позиция'}</button>}
        </div>
      </div>

      {expImport && <ExpenseImport contracts={rows} onClose={() => setExpImport(false)} onDone={load} />}

      {sum && (
        <div className="kpi-grid">
          <div className="kpi"><div className="v">{sum.count}</div><div className="l">позиций в отборе</div></div>
          <div className="kpi"><div className="v">{fmt(sum.amount)}</div><div className="l">сумма договоров, ₸</div></div>
          {seePay && <div className="kpi good"><div className="v">{money(sum.paid)}</div><div className="l">оплачено заказчиками</div></div>}
          {seePay && <div className="kpi"><div className="v">{money(sum.debt)}</div><div className="l">ещё должны</div></div>}
          {seeExp && <div className="kpi"><div className="v">{money(sum.expenses)}</div><div className="l">расходы по договорам</div></div>}
          {seeExp && <div className={'kpi ' + (sum.profit < 0 ? 'warn' : 'good')}><div className="v">{money(sum.profit)}</div><div className="l">прибыль (сумма − расходы)</div></div>}
        </div>
      )}

      {showCust && (
        <div className={'card stitch' + (canEdit(user, 'contracts.customers') ? '' : ' readonly')}>
          <h2>{editCustId ? 'Редактирование заказчика' : 'Заказчики'}</h2>
          <div className="formrow">
            <div><label className="f">Название / ФИО</label><input value={custForm.name} onChange={e => setCustForm({ ...custForm, name: e.target.value })} /></div>
            <div><label className="f">Телефон</label><input value={custForm.phone} onChange={e => setCustForm({ ...custForm, phone: e.target.value })} /></div>
            <div><label className="f">БИН/ИИН</label><input value={custForm.bin_iin} onChange={e => setCustForm({ ...custForm, bin_iin: e.target.value })} /></div>
            <div><label className="f">Контактное лицо</label><input value={custForm.contact_person} onChange={e => setCustForm({ ...custForm, contact_person: e.target.value })} /></div>
            <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 6 }}>
              <button className="btn" onClick={saveCustomer} disabled={!custForm.name}>{editCustId ? 'Сохранить' : 'Добавить'}</button>
              {editCustId && <button className="btn ghost" onClick={resetCust}>Отмена</button>}
            </div>
          </div>
          <div className="tablewrap" style={{ maxHeight: 280, overflowY: 'auto' }}><table>
            <thead><tr><th>Заказчик</th><th>Телефон</th><th>Контакт</th><th /></tr></thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.id}>
                  <td>{c.name}</td><td>{c.phone || '—'}</td><td>{c.contact_person || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn small ghost" onClick={() => { setEditCustId(c.id); setCustForm({ name: c.name, phone: c.phone || '', bin_iin: c.bin_iin || '', contact_person: c.contact_person || '' }) }}>Изм.</button>{' '}
                    <button className="btn small ghost" onClick={() => deleteCust(c)}>Удл.</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {showForm && (
        <div className="card stitch">
          <h2>Новая позиция реестра</h2>
          <p className="muted" style={{ marginBottom: 10 }}>Обычно позиция появляется из выигранного тендера кнопкой «В договор». Вручную — для договоров без тендера.</p>
          <div className="formrow">
            <div><label className="f">Номер закупки</label><input value={form.purchase_no} onChange={set('purchase_no')} /></div>
            <div><label className="f">С какой фирмы</label>
              <select value={form.own_company} onChange={set('own_company')}>
                <option value="">—</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div><label className="f">Площадка</label><input value={form.platform} onChange={set('platform')} /></div>
            <div><label className="f">Организация</label>
              <select value={form.customer} onChange={set('customer')}>
                <option value="">— выбрать —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
          </div>
          <div className="formrow">
            <div style={{ flex: 3 }}><label className="f">Предмет закупки</label><input value={form.title} onChange={set('title')} /></div>
            <div><label className="f">Кол-во</label><input type="number" value={form.qty} onChange={set('qty')} /></div>
            <div><label className="f">Цена</label><input type="number" value={form.price} onChange={set('price')} /></div>
            <div><label className="f">Сумма без НДС</label><input type="number" value={form.amount}
              placeholder={form.qty && form.price ? fmt(Number(form.qty) * Number(form.price)) : ''} onChange={set('amount')} /></div>
          </div>
          <div className="formrow">
            <div><label className="f">Номер договора</label><input value={form.contract_no} onChange={set('contract_no')} /></div>
            <div><label className="f">Дата подписания</label><input type="date" value={form.signed_date} onChange={set('signed_date')} /></div>
            <div><label className="f">Срок исполнения</label><input type="date" value={form.deadline} onChange={set('deadline')} /></div>
            <div style={{ flex: 2 }}><label className="f">Место поставки</label><input value={form.delivery_place} onChange={set('delivery_place')} /></div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={create} disabled={!form.purchase_no || !form.customer || !form.title}>Создать и открыть</button>
            <button className="btn ghost" onClick={() => { setShowForm(false); setForm(EMPTY) }}>Отмена</button>
          </div>
        </div>
      )}

      <div className="formrow">
        <input placeholder="Поиск: закупка, договор, предмет, организация, инвестор…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 3 }} />
        <select value={company} onChange={e => setCompany(e.target.value)}>
          <option value="">Все фирмы</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Все статусы</option>
          {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap"><table>
          <thead><tr>
            <th>Закупка</th><th>Организация</th><th>Предмет</th><th className="num">Кол-во</th><th className="num">Сумма</th>
            {seePay && <th className="num">Оплачено</th>}
            {seeExp && <><th className="num">Расходы</th><th className="num">Прибыль</th></>}
            <th>Договор №</th><th>Срок</th><th>Статус</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={11} className="muted">Позиций нет.</td></tr>}
            {rows.map(c => (
              <tr key={c.id} className="clickable" onClick={() => navigate(`/contracts/${c.id}`)}>
                <td style={{ whiteSpace: 'nowrap' }}><Link to={`/contracts/${c.id}`} onClick={e => e.stopPropagation()} style={{ fontWeight: 700 }}>{c.purchase_no || c.number}</Link>
                  {c.own_company_name && <div className="muted">{c.own_company_name}</div>}</td>
                <td style={{ minWidth: 170 }}>{c.customer_name}</td>
                <td style={{ minWidth: 190 }}>{c.title}</td>
                <td className="num">{c.qty !== null ? fmt(c.qty) : '—'}</td>
                <td className="num">{fmt(c.amount)}</td>
                {seePay && <td className="num">{money(c.money.paid)}</td>}
                {seeExp && <><td className="num">{money(c.money.expenses)}</td>
                  <td className={'num ' + (c.money.profit < 0 ? 'neg' : '')}>{money(c.money.profit)}{minus(c) && <div><span className="pill low">в минусе</span></div>}</td></>}
                <td style={{ whiteSpace: 'nowrap' }}>{c.contract_no || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{c.deadline || c.planned_execution || '—'}
                  {c.is_overdue && <div><span className="pill low">просрочен</span></div>}</td>
                <td><span className="badge" style={{ background: CONTRACT_STATUS[c.status]?.color }}>{CONTRACT_STATUS[c.status]?.label}</span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      {seeExp && seePay && <p className="muted">«В минусе» — по договору потрачено больше, чем заказчик уже заплатил. Прибыль — сумма договора минус расходы: столько останется, когда заказчик заплатит всё.</p>}
    </div>
  )
}
