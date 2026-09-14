import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmt, CONTRACT_STATUS, can, canEdit, apiError } from '../api'

// Реестр как в «Договора.xlsx»: одна строка — одна позиция закупки
const EMPTY = {
  purchase_no: '', number: '', own_company: '', platform: '', customer: '', title: '',
  qty: '', price: '', amount: '', contract_no: '', signed_date: '', deadline: '',
  planned_execution: '', delivery_place: '', delivery_terms: '', phone: '', investor: '',
  project: '', costs_note: '', payment_note: '', comment: '', note: '', specification: '',
}
const orNull = (v) => (v === '' || v === undefined ? null : v)
const val = (v) => (v === null || v === undefined ? '' : v)

export default function Contracts({ user }) {
  // суммы и оплату видят только те, кто работает с деньгами
  const showMoney = ['admin', 'director', 'manager', 'accountant'].includes(user?.role)
  const mayEdit = canEdit(user, 'contracts.contracts')
  const seeProjects = can(user, 'projects.projects')
  const [rows, setRows] = useState([])
  const [customers, setCustomers] = useState([])
  const [companies, setCompanies] = useState([])
  const [projects, setProjects] = useState([])
  const [status, setStatus] = useState('')
  const [company, setCompany] = useState('')
  const [project, setProject] = useState('')
  const [q, setQ] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [showCust, setShowCust] = useState(false)
  const [editCustId, setEditCustId] = useState(null)
  const [custForm, setCustForm] = useState({ name: '', phone: '', bin_iin: '', contact_person: '' })
  const [carryOver, setCarryOver] = useState(false)
  const fileRef = useRef()

  const load = () => {
    const p = new URLSearchParams({ page_size: 5000 })
    if (status) p.set('status', status)
    if (q) p.set('search', q)
    if (company) p.set('own_company', company)
    if (project === 'none') p.set('project__isnull', 'true')
    else if (project) p.set('project', project)
    api.get('/contracts/?' + p).then(r => setRows(r.data.results || []))
  }
  useEffect(load, [status, q, company, project])
  const loadCustomers = () => api.get('/customers/?page_size=2000').then(r => setCustomers(r.data.results || []))
  useEffect(() => {
    loadCustomers()
    api.get('/own-companies/?page_size=200').then(r => setCompanies(r.data.results || [])).catch(() => {})
    if (seeProjects) api.get('/projects/?page_size=2000').then(r => setProjects(r.data.results || []))
  }, [])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const resetForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY) }

  const save = async () => {
    const qty = orNull(form.qty), price = orNull(form.price)
    let amount = form.amount
    if (amount === '' && qty !== null && price !== null) amount = Number(qty) * Number(price)
    // Даты и ссылки пустыми строками не принимаются — их нужно слать как null
    const body = {
      ...form, number: form.number || form.purchase_no, qty, price, amount: amount === '' ? 0 : amount,
      own_company: orNull(form.own_company), project: orNull(form.project),
      deadline: orNull(form.deadline), signed_date: orNull(form.signed_date),
    }
    try {
      if (editId) await api.patch(`/contracts/${editId}/`, body)
      else await api.post('/contracts/', body)
      resetForm(); load()
    } catch (e) { alert(apiError(e)) }
  }

  const editContract = (c) => {
    setEditId(c.id); setShowForm(true); setShowCust(false)
    const f = {}
    Object.keys(EMPTY).forEach(k => { f[k] = val(c[k]) })
    setForm(f)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const setRowProject = async (c, pid) => {
    try { await api.patch(`/contracts/${c.id}/`, { project: pid || null }); load() }
    catch (e) { alert(apiError(e)) }
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
    if (!confirm(`Удалить клиента «${c.name}»?`)) return
    try { await api.delete(`/customers/${c.id}/`); await loadCustomers() }
    catch (e) { alert(apiError(e, 'Не удалось удалить')) }
  }
  const deleteContract = async (c) => {
    if (!confirm(`Удалить позицию ${c.purchase_no || c.number} «${c.title}»? Вместе с ней удалятся её платежи, файлы и комментарии.`)) return
    try { await api.delete(`/contracts/${c.id}/`); load() }
    catch (e) { alert(apiError(e, 'Не удалось удалить')) }
  }

  const exportExcel = async () => {
    const r = await api.get('/contracts/export_excel/', { responseType: 'blob' })
    const url = URL.createObjectURL(r.data)
    const a = document.createElement('a'); a.href = url; a.download = 'Договора.xlsx'; a.click()
  }

  const importExcel = async (e) => {
    const f = e.target.files[0]; if (!f) return
    const fd = new FormData(); fd.append('file', f)
    if (carryOver) fd.append('carry_over', '1')
    try {
      const { data } = await api.post('/contracts/import_excel/', fd)
      alert(`Реестр загружен: новых позиций ${data.created}, обновлено ${data.updated}.` +
        (data.errors.length ? `\n\nЗамечания:\n• ${data.errors.join('\n• ')}` : ''))
    } catch (err) { alert(apiError(err)) }
    e.target.value = ''; load(); loadCustomers()
  }

  const total = rows.reduce((a, c) => a + Number(c.amount || 0), 0)
  const paid = rows.reduce((a, c) => a + Number(c.paid_amount || 0), 0)

  return (
    <div>
      <div className="pagehead">
        <h1>Договоры</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn ghost small" onClick={exportExcel}>Экспорт в Excel</button>
          {mayEdit && <>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
              title="Статус из файла берётся как есть, минуя цепочку согласований. Нужно при переезде с прежнего учёта.">
              <input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={carryOver} onChange={e => setCarryOver(e.target.checked)} />
              перенос истории
            </label>
            <button className="btn ghost small" onClick={() => fileRef.current.click()}>Импорт «Договора.xlsx»</button>
            <input type="file" ref={fileRef} accept=".xlsx" style={{ display: 'none' }} onChange={importExcel} />
            <button className="btn ghost small" onClick={() => setShowCust(s => !s)}>Заказчики</button>
            <button className="btn small" onClick={() => showForm ? resetForm() : setShowForm(true)}>{showForm ? 'Закрыть' : '+ Позиция'}</button>
          </>}
        </div>
      </div>

      {showCust && (
        <div className="card stitch">
          <h2>{editCustId ? 'Редактирование заказчика' : 'Новый заказчик'}</h2>
          <div className="formrow">
            <div><label className="f">Название / ФИО</label><input value={custForm.name} onChange={e => setCustForm({ ...custForm, name: e.target.value })} /></div>
            <div><label className="f">Телефон</label><input value={custForm.phone} onChange={e => setCustForm({ ...custForm, phone: e.target.value })} /></div>
            <div><label className="f">БИН/ИИН</label><input value={custForm.bin_iin} onChange={e => setCustForm({ ...custForm, bin_iin: e.target.value })} /></div>
            <div><label className="f">Контактное лицо</label><input value={custForm.contact_person} onChange={e => setCustForm({ ...custForm, contact_person: e.target.value })} /></div>
            <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 6 }}>
              <button className="btn" onClick={saveCustomer} disabled={!custForm.name}>Сохранить</button>
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
          <h2>{editId ? 'Редактирование позиции' : 'Новая позиция реестра'}</h2>
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
            <div><label className="f">Планируемый срок (как в реестре)</label><input value={form.planned_execution} placeholder="по заявке" onChange={set('planned_execution')} /></div>
            {seeProjects && <div><label className="f">Проект</label>
              <select value={form.project} onChange={set('project')}>
                <option value="">—</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>}
          </div>
          <div className="formrow">
            <div style={{ flex: 2 }}><label className="f">Место поставки</label><input value={form.delivery_place} onChange={set('delivery_place')} /></div>
            <div style={{ flex: 2 }}><label className="f">Срок поставки</label><input value={form.delivery_terms} onChange={set('delivery_terms')} /></div>
            <div><label className="f">Телефон</label><input value={form.phone} onChange={set('phone')} /></div>
          </div>
          <div className="formrow">
            <div><label className="f">Инвестор</label><input value={form.investor} onChange={set('investor')} /></div>
            <div><label className="f">Затраты</label><input value={form.costs_note} onChange={set('costs_note')} /></div>
            <div><label className="f">Оплата</label><input value={form.payment_note} onChange={set('payment_note')} /></div>
            <div style={{ flex: 2 }}><label className="f">Комментарии</label><input value={form.comment} onChange={set('comment')} /></div>
            <div style={{ flex: 2 }}><label className="f">Коментарий</label><input value={form.note} onChange={set('note')} /></div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={save} disabled={!(form.number || form.purchase_no) || !form.customer}>Сохранить</button>
            <button className="btn ghost" onClick={resetForm}>Отмена</button>
          </div>
        </div>
      )}

      <div className="formrow">
        <input placeholder="Поиск: закупка, договор, предмет, организация, инвестор…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 3 }} />
        <select value={company} onChange={e => setCompany(e.target.value)}>
          <option value="">Все фирмы</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {seeProjects && <select value={project} onChange={e => setProject(e.target.value)}>
          <option value="">Все проекты</option><option value="none">Без проекта</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>}
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Все статусы</option>
          {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap"><table>
          <thead><tr>
            <th>Закупка</th><th>Фирма</th><th>Организация</th><th>Предмет</th><th className="num">Кол-во</th>
            {showMoney && <><th className="num">Цена</th><th className="num">Сумма</th><th className="num">Оплачено</th></>}
            <th>Договор №</th><th>Подписан</th><th>Срок</th>{seeProjects && <th>Проект</th>}<th>Статус</th>{mayEdit && <th />}
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={14} className="muted">Позиций нет.</td></tr>}
            {rows.map(c => (
              <tr key={c.id}>
                <td style={{ whiteSpace: 'nowrap' }}><Link to={`/contracts/${c.id}`} style={{ fontWeight: 700 }}>{c.purchase_no || c.number}</Link></td>
                <td>{c.own_company_name || '—'}</td>
                <td style={{ minWidth: 180 }}>{c.customer_name}</td>
                <td style={{ minWidth: 200 }}>{c.title}</td>
                <td className="num">{c.qty !== null ? fmt(c.qty) : '—'}</td>
                {showMoney && <>
                  <td className="num">{c.price !== null ? fmt(c.price) : '—'}</td>
                  <td className="num">{fmt(c.amount)}</td>
                  <td className="num">{fmt(c.paid_amount)}</td>
                </>}
                <td style={{ whiteSpace: 'nowrap' }}>{c.contract_no || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{c.signed_date || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{c.deadline || c.planned_execution || '—'}
                  {c.is_overdue && <span className="pill low" style={{ marginLeft: 6 }}>просрочен</span>}</td>
                {seeProjects && <td>{mayEdit
                  ? <select style={{ width: 'auto', maxWidth: 190, fontSize: 12, padding: '2px 4px' }} value={c.project || ''} onChange={e => setRowProject(c, e.target.value)}>
                      <option value="">—</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  : (c.project ? <Link to={`/projects/${c.project}`}>{c.project_name}</Link> : '—')}</td>}
                <td><span className="badge" style={{ background: CONTRACT_STATUS[c.status]?.color }}>{CONTRACT_STATUS[c.status]?.label}</span></td>
                {mayEdit && <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn small ghost" onClick={() => editContract(c)}>Изм.</button>{' '}
                  <button className="btn small ghost" onClick={() => deleteContract(c)}>Удл.</button>
                </td>}
              </tr>
            ))}
            {showMoney && rows.length > 0 && (
              <tr>
                <td colSpan={5}><b>Итого позиций: {rows.length}</b></td>
                <td /><td className="num"><b>{fmt(total)}</b></td><td className="num"><b>{fmt(paid)}</b></td>
                <td colSpan={seeProjects ? 5 : 4} />{mayEdit && <td />}
              </tr>
            )}
          </tbody>
        </table></div>
      </div>
    </div>
  )
}
