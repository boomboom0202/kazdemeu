import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, fmt, CONTRACT_STATUS } from '../api'
import { Loader, LoadError } from '../components/Loader'

const FILE_KINDS = { sketch: 'Эскиз', layout: 'Макет', techcard: 'Техкарта', photo: 'Фото', other: 'Другое' }

export default function ContractDetail() {
  const { id } = useParams()
  const [c, setC] = useState(null)
  const [tab, setTab] = useState('payments')
  const [comment, setComment] = useState('')
  const [important, setImportant] = useState(false)
  const [pay, setPay] = useState({ due_date: '', amount: '', note: '' })
  const [fileForm, setFileForm] = useState({ kind: 'sketch', title: '', url: '', file: null })

  const [failed, setFailed] = useState(false)

  const load = () => {
    setFailed(false)
    return api.get(`/contracts/${id}/`).then(r => setC(r.data)).catch(() => setFailed(true))
  }
  // useEffect(load, [id]) возвращал промис, а React принимает возвращённое
  // значение за функцию очистки — оборачиваем вызов.
  useEffect(() => { load() }, [id])

  if (failed && !c) return <LoadError onRetry={load} />
  if (!c) return <Loader />

  const setStatus = async (s) => {
    try { const { data } = await api.post(`/contracts/${id}/set_status/`, { status: s }); setC(data) }
    catch (e) { alert(e.response?.data?.detail || 'Ошибка') }
  }

  const addComment = async () => {
    await api.post('/comments/', { contract: id, text: comment, importance: important ? 'important' : 'normal' })
    setComment(''); setImportant(false); load()
  }

  const addPayment = async () => {
    await api.post('/payment-schedule/', { contract: id, ...pay })
    setPay({ due_date: '', amount: '', note: '' }); load()
  }

  const markPaid = async (p) => {
    const amount = prompt('Поступившая сумма:', p.amount)
    if (amount == null) return
    await api.patch(`/payment-schedule/${p.id}/`, { paid_amount: amount, paid_date: new Date().toISOString().slice(0, 10) })
    load()
  }

  const addFile = async () => {
    const fd = new FormData()
    fd.append('contract', id); fd.append('kind', fileForm.kind); fd.append('title', fileForm.title)
    if (fileForm.file) fd.append('file', fileForm.file)
    if (fileForm.url) fd.append('url', fileForm.url)
    await api.post('/contract-files/', fd)
    setFileForm({ kind: 'sketch', title: '', url: '', file: null }); load()
  }

  const del = async (url, msg) => {
    if (!confirm(msg)) return
    try { await api.delete(url); load() }
    catch (e) { alert(e.response?.data?.detail || 'Не удалось удалить') }
  }

  return (
    <div>
      <div className="pagehead">
        <div>
          <h1>№{c.number} — {c.title}</h1>
          <div className="muted">{c.customer_name} · Менеджер: {c.manager_name || '—'} · Срок: {c.deadline || '—'}</div>
        </div>
        <div>
          <span className="badge" style={{ background: CONTRACT_STATUS[c.status]?.color, fontSize: 14 }}>{c.status_display}</span>
        </div>
      </div>

      <div className="card stitch">
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><label className="f">Сумма</label><b className="num" style={{ fontSize: 17 }}>{fmt(c.amount)} ₸</b></div>
          <div><label className="f">Оплачено</label><b className="num" style={{ fontSize: 17, color: 'var(--green)' }}>{fmt(c.paid_amount)} ₸</b></div>
          <div><label className="f">Остаток</label><b className="num" style={{ fontSize: 17 }}>{fmt(c.amount - c.paid_amount)} ₸</b></div>
          <div style={{ marginLeft: 'auto' }}>
            <label className="f">Сменить статус</label>
            {c.allowed_transitions.length === 0 && <span className="muted">закрыт</span>}
            {c.allowed_transitions.map(s => (
              <button key={s} className="btn small ghost" style={{ marginRight: 6 }} onClick={() => setStatus(s)}>
                → {CONTRACT_STATUS[s]?.label}
              </button>
            ))}
          </div>
        </div>
        {c.specification && <div style={{ marginTop: 12 }}><label className="f">Тех. спецификация</label>{c.specification}</div>}
      </div>

      <div className="tabs">
        <button className={tab === 'payments' ? 'active' : ''} onClick={() => setTab('payments')}>График платежей ({c.payment_schedule.length})</button>
        <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>Файлы ({c.files.length})</button>
        <button className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>Комментарии ({c.comments.length})</button>
      </div>

      {tab === 'payments' && (
        <div className="card">
          <table>
            <thead><tr><th>Срок оплаты</th><th className="num">Сумма</th><th className="num">Оплачено</th><th>Дата оплаты</th><th>Примечание</th><th /><th /></tr></thead>
            <tbody>
              {c.payment_schedule.map(p => (
                <tr key={p.id}>
                  <td>{p.due_date}</td>
                  <td className="num">{fmt(p.amount)}</td>
                  <td className="num">{fmt(p.paid_amount)} {p.is_paid ? <span className="pill ok">оплачено</span> : <span className="pill low">ожидается</span>}</td>
                  <td>{p.paid_date || '—'}</td>
                  <td>{p.note}</td>
                  <td>{!p.is_paid && <button className="btn small" onClick={() => markPaid(p)}>Платёж поступил</button>}</td>
                  <td><button className="btn small ghost" onClick={() => del(`/payment-schedule/${p.id}/`, 'Удалить строку платежа?')}>Удл.</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="formrow" style={{ marginTop: 12 }}>
            <div><label className="f">Срок оплаты</label><input type="date" value={pay.due_date} onChange={e => setPay({ ...pay, due_date: e.target.value })} /></div>
            <div><label className="f">Сумма</label><input type="number" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} /></div>
            <div><label className="f">Примечание</label><input value={pay.note} onChange={e => setPay({ ...pay, note: e.target.value })} /></div>
            <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={addPayment} disabled={!pay.due_date || !pay.amount}>Добавить</button></div>
          </div>
        </div>
      )}

      {tab === 'files' && (
        <div className="card">
          <table>
            <thead><tr><th>Тип</th><th>Название</th><th>Ссылка</th><th>Кто загрузил</th><th>Когда</th><th /></tr></thead>
            <tbody>
              {c.files.map(f => (
                <tr key={f.id}>
                  <td><span className="pill imp">{FILE_KINDS[f.kind]}</span></td>
                  <td>{f.title || '—'}</td>
                  <td>{(f.file || f.url) ? <a href={f.file || f.url} target="_blank" rel="noreferrer">Открыть →</a> : '—'}</td>
                  <td>{f.uploaded_by_name}</td>
                  <td>{new Date(f.created_at).toLocaleDateString('ru-RU')}</td>
                  <td><button className="btn small ghost" onClick={() => del(`/contract-files/${f.id}/`, 'Удалить файл?')}>Удл.</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="formrow" style={{ marginTop: 12 }}>
            <div><label className="f">Тип</label>
              <select value={fileForm.kind} onChange={e => setFileForm({ ...fileForm, kind: e.target.value })}>
                {Object.entries(FILE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="f">Название</label><input value={fileForm.title} onChange={e => setFileForm({ ...fileForm, title: e.target.value })} /></div>
            <div><label className="f">Файл</label><input type="file" onChange={e => setFileForm({ ...fileForm, file: e.target.files[0] })} /></div>
            <div><label className="f">или URL</label><input value={fileForm.url} onChange={e => setFileForm({ ...fileForm, url: e.target.value })} /></div>
            <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={addFile}>Прикрепить</button></div>
          </div>
        </div>
      )}

      {tab === 'comments' && (
        <div className="card">
          <div className="formrow">
            <div style={{ flex: 3 }}><textarea rows={2} placeholder="Написать комментарий..." value={comment} onChange={e => setComment(e.target.value)} /></div>
            <div style={{ flex: 1, alignSelf: 'center' }}>
              <label style={{ fontSize: 13 }}><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={important} onChange={e => setImportant(e.target.checked)} />Важный</label>
              <br /><button className="btn small" style={{ marginTop: 6 }} onClick={addComment} disabled={!comment.trim()}>Отправить</button>
            </div>
          </div>
          {c.comments.map(m => (
            <div key={m.id} className={`comment ${m.importance === 'important' ? 'important' : ''}`}>
              <div className="meta" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>
                  <b>{m.author_name || '—'}</b> · {new Date(m.created_at).toLocaleString('ru-RU')}
                  {m.importance === 'important' && <span className="pill imp" style={{ marginLeft: 8 }}>Важный</span>}
                </span>
                <button className="btn small ghost" onClick={() => del(`/comments/${m.id}/`, 'Удалить комментарий?')}>Удл.</button>
              </div>
              {m.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
