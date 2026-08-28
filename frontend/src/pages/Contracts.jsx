import React, { useEffect, useRef, useState } from 'react'
import { api, fmt, CONTRACT_STATUS, canEdit, apiError } from '../api'
import { Link } from 'react-router-dom'

export default function Contracts({ user }) {
  // суммы и оплату видят только те, кто работает с деньгами
  const showMoney = ['admin', 'director', 'manager', 'accountant'].includes(user?.role)
  const mayEdit = canEdit(user, 'contracts')
  const [rows, setRows] = useState([])
  const [customers, setCustomers] = useState([])
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ number: '', customer: '', title: '', amount: '', deadline: '', specification: '' })
  const [showCust, setShowCust] = useState(false)
  const [editCustId, setEditCustId] = useState(null)
  const [custForm, setCustForm] = useState({ name: '', phone: '', bin_iin: '', contact_person: '' })
  const fileRef = useRef()

  const load = () => {
    const p = new URLSearchParams()
    if (status) p.set('status', status)
    if (q) p.set('search', q)
    api.get('/contracts/?' + p).then(r => setRows(r.data.results || []))
  }
  useEffect(load, [status, q])
  useEffect(() => { api.get('/customers/?page_size=200').then(r => setCustomers(r.data.results || [])) }, [])

  const loadCustomers = () => api.get('/customers/?page_size=200').then(r => setCustomers(r.data.results || []))

  const create = async () => {
    await api.post('/contracts/', { ...form, amount: form.amount || 0, deadline: form.deadline || null })
    setShowForm(false); setForm({ number: '', customer: '', title: '', amount: '', deadline: '', specification: '' }); load()
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
  const editCust = (c) => { setEditCustId(c.id); setCustForm({ name: c.name, phone: c.phone || '', bin_iin: c.bin_iin || '', contact_person: c.contact_person || '' }) }
  const deleteCust = async (c) => {
    if (!confirm(`Удалить клиента «${c.name}»?`)) return
    try { await api.delete(`/customers/${c.id}/`); await loadCustomers() }
    catch (e) { alert(apiError(e, 'Не удалось удалить')) }
  }

  const deleteContract = async (c) => {
    if (!confirm(`Удалить договор №${c.number}? Вместе с ним удалятся его платежи, файлы и комментарии.`)) return
    try { await api.delete(`/contracts/${c.id}/`); load() }
    catch (e) { alert(apiError(e, 'Не удалось удалить')) }
  }

  const exportExcel = async () => {
    const r = await api.get('/contracts/export_excel/', { responseType: 'blob' })
    const url = URL.createObjectURL(r.data)
    const a = document.createElement('a'); a.href = url; a.download = 'contracts.xlsx'; a.click()
  }

  const importExcel = async (e) => {
    const f = e.target.files[0]; if (!f) return
    const fd = new FormData(); fd.append('file', f)
    const { data } = await api.post('/contracts/import_excel/', fd)
    alert(`Импорт: создано ${data.created}, обновлено ${data.updated}` + (data.errors.length ? `\nОшибки:\n${data.errors.join('\n')}` : ''))
    e.target.value = ''; load()
  }

  return (
    <div>
      <div className="pagehead">
        <h1>Договоры</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost small" onClick={exportExcel}>Экспорт в Excel</button>
          {mayEdit && <>
            <button className="btn ghost small" onClick={() => fileRef.current.click()}>Импорт из Excel</button>
            <input type="file" ref={fileRef} accept=".xlsx" style={{ display: 'none' }} onChange={importExcel} />
            <button className="btn ghost small" onClick={() => setShowCust(s => !s)}>+ Новый клиент</button>
            <button className="btn small" onClick={() => setShowForm(s => !s)}>+ Новый договор</button>
          </>}
        </div>
      </div>

      {showCust && (
        <div className="card stitch">
          <h2>{editCustId ? 'Редактирование клиента' : 'Новый клиент'}</h2>
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
          <table>
            <thead><tr><th>Клиент</th><th>Телефон</th><th>Контакт</th><th /></tr></thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.id}>
                  <td>{c.name}</td><td>{c.phone || '—'}</td><td>{c.contact_person || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn small ghost" onClick={() => editCust(c)}>Изм.</button>{' '}
                    <button className="btn small ghost" onClick={() => deleteCust(c)}>Удл.</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Новый клиент сразу подставится в форму договора. Клиента с договорами удалить нельзя.</p>
        </div>
      )}

      {showForm && (
        <div className="card stitch">
          <div className="formrow">
            <div><label className="f">Номер</label><input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} /></div>
            <div><label className="f">Заказчик</label>
              <select value={form.customer} onChange={e => setForm({ ...form, customer: e.target.value })}>
                <option value="">— выбрать —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div><label className="f">Сумма, ₸</label><input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
            <div><label className="f">Срок</label><input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} /></div>
          </div>
          <div className="formrow"><div><label className="f">Название</label><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div></div>
          <div className="formrow"><div><label className="f">Тех. спецификация</label><textarea rows={2} value={form.specification} onChange={e => setForm({ ...form, specification: e.target.value })} /></div></div>
          <button className="btn" onClick={create} disabled={!form.number || !form.customer}>Сохранить</button>
        </div>
      )}

      <div className="formrow" style={{ maxWidth: 560 }}>
        <input placeholder="Поиск: номер, название, клиент..." value={q} onChange={e => setQ(e.target.value)} />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Все статусы</option>
          {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr>
            <th>№</th><th>Клиент</th><th>Название</th><th>Статус</th>
            {showMoney && <><th className="num">Сумма</th><th className="num">Оплачено</th></>}
            <th>Срок</th>{mayEdit && <th />}
          </tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td><Link to={`/contracts/${c.id}`} style={{ fontWeight: 700 }}>{c.number}</Link></td>
                <td>{c.customer_name}</td>
                <td>{c.title}</td>
                <td><span className="badge" style={{ background: CONTRACT_STATUS[c.status]?.color }}>{CONTRACT_STATUS[c.status]?.label}</span>
                  {c.is_overdue && <span className="pill low" style={{ marginLeft: 6 }}>просрочен</span>}</td>
                {showMoney && <>
                  <td className="num">{fmt(c.amount)}</td>
                  <td className="num">{fmt(c.paid_amount)}</td>
                </>}
                <td>{c.deadline || '—'}</td>
                {mayEdit && <td><button className="btn small ghost" onClick={() => deleteContract(c)}>Удл.</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
