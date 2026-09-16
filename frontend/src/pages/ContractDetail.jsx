import React, { useEffect, useMemo, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api, fmt, money, CONTRACT_STATUS, EXPENSE_KINDS, apiError, canEdit, can, today, dmy } from '../api'
import { Loader, LoadError } from '../components/Loader'
import StageBars from '../components/StageBars'
import LaunchForm from './workshop/LaunchForm'

const FILE_KINDS = { sketch: 'Эскиз', layout: 'Макет', techcard: 'Техкарта', photo: 'Фото', other: 'Другое' }
const REGISTRY = [
  ['purchase_no', 'Номер закупки'], ['platform', 'Площадка'], ['contract_no', 'Номер договора'],
  ['qty', 'Кол-во', 'number'], ['price', 'Цена', 'number'], ['amount', 'Сумма без НДС', 'number'],
  ['signed_date', 'Дата подписания', 'date'], ['deadline', 'Срок исполнения', 'date'],
  ['planned_execution', 'Планируемый срок (как в реестре)'], ['delivery_place', 'Место поставки'],
  ['delivery_terms', 'Срок поставки', 'text'], ['phone', 'Телефон'], ['investor', 'Инвестор'],
  ['costs_note', 'Затраты'], ['payment_note', 'Оплата'], ['comment', 'Комментарии', 'text'],
  ['note', 'Коментарий', 'text'], ['specification', 'Тех. спецификация', 'text'],
]

/**
 * Договор — центр работы: сверху деньги (как внизу колонки в «Расходах»),
 * во вкладках — расходы и оплаты построчно, цех по договору, реквизиты из реестра.
 */
export default function ContractDetail({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const wContract = canEdit(user, 'contracts.contracts')
  const wExp = canEdit(user, 'contracts.expenses')
  const wPay = canEdit(user, 'contracts.payments')
  const wFiles = canEdit(user, 'contracts.files')
  const wComments = canEdit(user, 'contracts.comments')
  const [c, setC] = useState(null)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState(null)

  const load = () => {
    setFailed(false)
    return api.get(`/contracts/${id}/`).then(r => {
      setC(r.data)
      setTab(t => t || (r.data.expenses !== null ? 'expenses' : r.data.work_orders !== null ? 'workshop' : 'registry'))
    }).catch(() => setFailed(true))
  }
  useEffect(() => { load() }, [id])

  if (failed && !c) return <LoadError onRetry={load} />
  if (!c) return <Loader />

  const run = async (fn) => { try { await fn(); await load() } catch (e) { alert(apiError(e)) } }
  const m = c.money
  const tabs = [
    c.expenses !== null && ['expenses', `Расходы (${c.expenses.length})`],
    c.payments !== null && ['payments', `Оплаты (${c.payments.length})`],
    c.work_orders !== null && ['workshop', `Цех (${c.work_orders.length})`],
    ['registry', 'Реквизиты'],
    c.files !== null && ['files', `Файлы (${c.files.length})`],
    c.comments !== null && ['comments', `Комментарии (${c.comments.length})`],
  ].filter(Boolean)

  return (
    <div>
      <div className="pagehead">
        <div>
          <Link to="/contracts" className="muted">← Реестр договоров</Link>
          <h1>{c.title}</h1>
          <div className="muted">
            закупка <b>{c.purchase_no || c.number}</b> · {c.customer_name}
            {c.own_company_name && <> · с фирмы {c.own_company_name}</>}
            {c.deadline && <> · срок {dmy(c.deadline)}</>}
            {c.tender && <> · из тендера {can(user, 'tenders.tenders') ? <Link to="/tenders">{c.tender.purchase_no || 'лот'}</Link> : c.tender.purchase_no}</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="badge" style={{ background: CONTRACT_STATUS[c.status]?.color, fontSize: 13 }}>{c.status_display}</span>
          {c.is_overdue && <span className="pill low">просрочен</span>}
          {wContract && c.allowed_transitions.map(s => (
            <button key={s} className="btn small ghost" onClick={() => run(async () => { const { data } = await api.post(`/contracts/${id}/set_status/`, { status: s }); setC(data) })}>
              → {CONTRACT_STATUS[s]?.label}</button>
          ))}
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="v">{fmt(c.amount)}</div><div className="l">сумма договора{c.qty ? ` · ${fmt(c.qty)} шт` : ''}</div></div>
        {m.paid !== null && <div className="kpi good"><div className="v">{fmt(m.paid)}</div><div className="l">оплачено заказчиком</div></div>}
        {m.debt !== null && <div className="kpi"><div className="v">{fmt(m.debt)}</div><div className="l">ещё должен</div></div>}
        {m.expenses !== null && <div className="kpi"><div className="v">{fmt(m.expenses)}</div><div className="l">расходы</div></div>}
        {m.profit !== null && <div className={'kpi ' + (m.profit < 0 ? 'warn' : 'good')}><div className="v">{fmt(m.profit)}</div>
          <div className="l">прибыль{c.amount > 0 ? ` · ${Math.round(m.profit / c.amount * 100)}%` : ''}</div></div>}
        {m.balance !== null && <div className={'kpi ' + (m.balance < 0 ? 'warn' : '')}><div className="v">{fmt(m.balance)}</div><div className="l">остаток: пришло − потрачено</div></div>}
      </div>
      {m.net_profit !== null && (
        <p className="muted" style={{ margin: '-6px 0 16px' }}>
          Прибыль выше — без окладов и аренды. С их учётом: доля административных расходов{' '}
          <b>{fmt(m.admin_share)}</b> ₸, чистая прибыль{' '}
          <b className={m.net_profit < 0 ? 'neg' : ''}>{fmt(m.net_profit)}</b> ₸.
          Административные расходы месяца делятся между договорами в работе по сумме договора.
        </p>
      )}

      <div className="tabs">
        {tabs.map(([k, label]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>

      {tab === 'expenses' && <Expenses c={c} canWrite={wExp} run={run} />}
      {tab === 'payments' && <Payments c={c} canWrite={wPay} run={run} />}
      {tab === 'workshop' && <Workshop c={c} user={user} navigate={navigate} />}
      {tab === 'registry' && <Registry c={c} canWrite={wContract} run={run} />}
      {tab === 'files' && <Files c={c} canWrite={wFiles} run={run} />}
      {tab === 'comments' && <Comments c={c} canWrite={wComments} run={run} />}
    </div>
  )
}

function Expenses({ c, canWrite, run }) {
  const [form, setForm] = useState({ amount: '', comment: '', kind: '', date: today() })
  const [filter, setFilter] = useState('')
  const [kind, setKind] = useState('')
  const rows = useMemo(() => c.expenses.filter(e =>
    (!filter || (e.comment || '').toLowerCase().includes(filter.toLowerCase())) && (!kind || e.kind === kind)),
  [c.expenses, filter, kind])
  const shown = rows.reduce((a, e) => a + Number(e.amount), 0)

  const add = () => run(async () => {
    await api.post('/contract-expenses/', { contract: c.id, amount: form.amount, comment: form.comment,
      date: form.date || null, ...(form.kind ? { kind: form.kind } : {}) })
    setForm({ ...form, amount: '', comment: '' })
  })

  return (
    <div className="grid2 wide-left">
      <div className="card" style={{ padding: 0 }}>
        {canWrite && <div style={{ padding: '14px 16px 0' }}>
          <div className="formrow">
            <div><label className="f">Сумма</label><input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
            <div style={{ flex: 2 }}><label className="f">Комментарий — как в таблице</label>
              <input value={form.comment} placeholder="дост, ткань ашок, вахид пошив…" onChange={e => setForm({ ...form, comment: e.target.value })}
                onKeyDown={e => e.key === 'Enter' && form.amount && add()} /></div>
            <div><label className="f">Вид</label>
              <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
                <option value="">по комментарию</option>
                {EXPENSE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></div>
            <div><label className="f">Дата</label><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
            <div style={{ alignSelf: 'flex-end', flex: '0 0 auto' }}><button className="btn" onClick={add} disabled={!form.amount}>Добавить</button></div>
          </div>
        </div>}
        <div className="toolbar">
          <input style={{ flex: 1, minWidth: 140 }} placeholder="Найти в комментариях…" value={filter} onChange={e => setFilter(e.target.value)} />
          <select style={{ width: 'auto' }} value={kind} onChange={e => setKind(e.target.value)}>
            <option value="">все виды</option>
            {EXPENSE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="tablewrap" style={{ maxHeight: 620, overflowY: 'auto' }}><table className="sheet">
          <thead><tr><th className="num">Сумма</th><th>Комментарий</th><th>Вид</th><th>Дата</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">Расходов нет.</td></tr>}
            {rows.map(e => (
              <tr key={e.id}>
                <td className="num">{fmt(e.amount)}</td>
                <td>{e.comment || '—'}{e.source === 'excel' && <span className="src" title="Загружено из «Расходы.xlsx» — заменится при повторной загрузке">xlsx</span>}</td>
                <td>{canWrite
                  ? <select style={{ width: 'auto', fontSize: 12, padding: '2px 4px' }} value={e.kind}
                      onChange={ev => run(() => api.patch(`/contract-expenses/${e.id}/`, { kind: ev.target.value }))}>
                      {EXPENSE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  : e.kind_display}</td>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{e.date ? dmy(e.date) : '—'}</td>
                <td>{canWrite && <button className="btn small ghost" onClick={() => confirm(`Удалить расход ${fmt(e.amount)} «${e.comment}»?`) && run(() => api.delete(`/contract-expenses/${e.id}/`))}>✕</button>}</td>
              </tr>
            ))}
            <tr className="total"><td className="num">{fmt(shown)}</td><td colSpan={4}>{filter || kind ? `отобрано из ${fmt(c.money.expenses)}` : 'расход'}</td></tr>
          </tbody>
        </table></div>
      </div>
      <div className="card">
        <h2>Куда ушли деньги</h2>
        {c.by_kind.length === 0 && <p className="muted">Расходов пока нет.</p>}
        {c.by_kind.map(k => (
          <div key={k.kind} style={{ marginBottom: 8, cursor: 'pointer' }} onClick={() => setKind(kind === k.kind ? '' : k.kind)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontWeight: kind === k.kind ? 800 : 600 }}>{k.label}</span>
              <span className="num">{fmt(k.total)} · {k.share}%</span>
            </div>
            <div className="kindbar" style={{ width: Math.max(2, k.share) + '%' }} />
          </div>
        ))}
        {c.by_kind.length > 0 && <p className="muted" style={{ marginTop: 8 }}>Вид определяется по комментарию. Ошибся — поправьте в строке. Клик по виду — отбор строк.</p>}
      </div>
    </div>
  )
}

function Payments({ c, canWrite, run }) {
  const [form, setForm] = useState({ amount: '', comment: '', date: today() })
  const add = () => run(async () => {
    await api.post('/contract-payments/', { contract: c.id, amount: form.amount, comment: form.comment, date: form.date || null })
    setForm({ ...form, amount: '', comment: '' })
  })
  return (
    <div className="card" style={{ padding: 0 }}>
      {canWrite && <div style={{ padding: '14px 16px 0' }}><div className="formrow">
        <div><label className="f">Сумма</label><input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
        <div style={{ flex: 2 }}><label className="f">Комментарий</label><input value={form.comment} placeholder="аванс 50%, окончательный расчёт" onChange={e => setForm({ ...form, comment: e.target.value })} /></div>
        <div><label className="f">Дата поступления</label><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
        <div style={{ alignSelf: 'flex-end', flex: '0 0 auto' }}><button className="btn" onClick={add} disabled={!form.amount}>Добавить</button></div>
      </div></div>}
      <div className="tablewrap"><table className="sheet">
        <thead><tr><th>Дата</th><th className="num">Сумма</th><th>Комментарий</th><th /></tr></thead>
        <tbody>
          {c.payments.length === 0 && <tr><td colSpan={4} className="muted">Оплат пока не было.</td></tr>}
          {c.payments.map(p => (
            <tr key={p.id}>
              <td>{p.date ? dmy(p.date) : <span className="muted">без даты</span>}</td>
              <td className="num">{fmt(p.amount)}</td>
              <td>{p.comment}{p.source === 'excel' && <span className="src">xlsx</span>}</td>
              <td>{canWrite && <button className="btn small ghost" onClick={() => confirm(`Удалить оплату ${fmt(p.amount)}?`) && run(() => api.delete(`/contract-payments/${p.id}/`))}>✕</button>}</td>
            </tr>
          ))}
          <tr className="total"><td>Итого</td><td className="num">{money(c.money.paid)}</td><td colSpan={2}>из {fmt(c.amount)} · долг {money(c.money.debt)}</td></tr>
        </tbody>
      </table></div>
    </div>
  )
}

function Workshop({ c, user, navigate }) {
  const [show, setShow] = useState(false)
  const mayLaunch = canEdit(user, 'workshop.orders')
  return (
    <div>
      {show && <LaunchForm user={user} contract={c} onCancel={() => setShow(false)} onDone={(o) => navigate(`/workshop/orders/${o.id}`)} />}
      <div className="card" style={{ padding: 0 }}>
        <div className="toolbar">
          <b>Заказы цеха по договору</b>
          {mayLaunch && !show && <button className="btn small orange" style={{ marginLeft: 'auto' }} onClick={() => setShow(true)}>Запустить в цех</button>}
        </div>
        {c.work_orders.length === 0 && <p className="muted" style={{ padding: 16 }}>В цех ещё не запускали. Кнопка «Запустить в цех» создаст заказ: изделие, размеры и этапы.</p>}
        {c.work_orders.map(w => (
          <Link key={w.id} className="ordercard" to={`/workshop/orders/${w.id}`}>
            <div><div className="t">{w.product}</div>
              <div className="muted">{w.status_display}{w.deadline ? ` · срок ${dmy(w.deadline)}` : ''}</div></div>
            <div className="nums">готово <b>{fmt(w.summary.finished)}</b> из {fmt(w.summary.planned)}</div>
            <StageBars summary={w.summary} compact />
          </Link>
        ))}
      </div>
    </div>
  )
}

function Registry({ c, canWrite, run }) {
  const [edit, setEdit] = useState(false)
  const [form, setForm] = useState({})
  const start = () => { setForm(Object.fromEntries(REGISTRY.map(([k]) => [k, c[k] ?? '']))); setEdit(true) }
  const save = () => run(async () => {
    const body = Object.fromEntries(REGISTRY.map(([k, , type]) => {
      const v = form[k]
      if (type === 'number' || type === 'date') return [k, v === '' ? (k === 'amount' ? 0 : null) : v]
      return [k, v]
    }))
    await api.patch(`/contracts/${c.id}/`, body)
    setEdit(false)
  })
  if (edit) return (
    <div className="card stitch">
      <div className="kv edit">
        {REGISTRY.map(([k, label, type]) => (
          <div key={k}><label className="f">{label}</label>
            {type === 'text'
              ? <textarea rows={2} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />
              : <input type={type || 'text'} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={save}>Сохранить</button>
        <button className="btn ghost" onClick={() => setEdit(false)}>Отмена</button>
      </div>
    </div>
  )
  return (
    <div className="card">
      <div className="kv">
        {REGISTRY.filter(([k]) => c[k] !== null && c[k] !== '' && c[k] !== undefined).map(([k, label, type]) => (
          <div key={k}><div className="k">{label}</div>
            <div className="v">{type === 'number' ? fmt(c[k]) : type === 'date' ? dmy(c[k]) : c[k]}</div></div>
        ))}
      </div>
      {canWrite && <button className="btn small ghost" style={{ marginTop: 12 }} onClick={start}>Изменить реквизиты</button>}
    </div>
  )
}

function Files({ c, canWrite, run }) {
  const [form, setForm] = useState({ kind: 'sketch', title: '', url: '', file: null })
  const add = () => run(async () => {
    const fd = new FormData()
    fd.append('contract', c.id); fd.append('kind', form.kind); fd.append('title', form.title)
    if (form.file) fd.append('file', form.file)
    if (form.url) fd.append('url', form.url)
    await api.post('/contract-files/', fd)
    setForm({ kind: 'sketch', title: '', url: '', file: null })
  })
  return (
    <div className="card">
      <div className="tablewrap"><table>
        <thead><tr><th>Тип</th><th>Название</th><th>Ссылка</th><th>Кто загрузил</th><th>Когда</th><th /></tr></thead>
        <tbody>
          {c.files.length === 0 && <tr><td colSpan={6} className="muted">Файлов нет.</td></tr>}
          {c.files.map(f => (
            <tr key={f.id}>
              <td><span className="pill imp">{FILE_KINDS[f.kind]}</span></td>
              <td>{f.title || '—'}</td>
              <td>{(f.file || f.url) ? <a href={f.file || f.url} target="_blank" rel="noreferrer">Открыть →</a> : '—'}</td>
              <td>{f.uploaded_by_name}</td>
              <td>{new Date(f.created_at).toLocaleDateString('ru-RU')}</td>
              <td>{canWrite && <button className="btn small ghost" onClick={() => confirm('Удалить файл?') && run(() => api.delete(`/contract-files/${f.id}/`))}>Удл.</button>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {canWrite && <div className="formrow" style={{ marginTop: 12 }}>
        <div><label className="f">Тип</label>
          <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
            {Object.entries(FILE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label className="f">Название</label><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
        <div><label className="f">Файл</label><input type="file" onChange={e => setForm({ ...form, file: e.target.files[0] })} /></div>
        <div><label className="f">или ссылка</label><input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} /></div>
        <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={add} disabled={!form.file && !form.url}>Прикрепить</button></div>
      </div>}
    </div>
  )
}

function Comments({ c, canWrite, run }) {
  const [text, setText] = useState('')
  const [important, setImportant] = useState(false)
  return (
    <div className="card">
      {canWrite && <div className="formrow">
        <div style={{ flex: 3 }}><textarea rows={2} placeholder="Написать комментарий…" value={text} onChange={e => setText(e.target.value)} /></div>
        <div style={{ flex: 1, alignSelf: 'center' }}>
          <label className="check"><input type="checkbox" checked={important} onChange={e => setImportant(e.target.checked)} />Важный</label>
          <button className="btn small" style={{ marginTop: 6 }} disabled={!text.trim()} onClick={() => run(async () => {
            await api.post('/comments/', { contract: c.id, text, importance: important ? 'important' : 'normal' })
            setText(''); setImportant(false)
          })}>Отправить</button>
        </div>
      </div>}
      {c.comments.length === 0 && <p className="muted">Комментариев нет.</p>}
      {c.comments.map(m => (
        <div key={m.id} className={`comment ${m.importance === 'important' ? 'important' : ''}`}>
          <div className="meta" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span><b>{m.author_name || '—'}</b> · {new Date(m.created_at).toLocaleString('ru-RU')}
              {m.importance === 'important' && <span className="pill imp" style={{ marginLeft: 8 }}>Важный</span>}</span>
            {canWrite && <button className="btn small ghost" onClick={() => confirm('Удалить комментарий?') && run(() => api.delete(`/comments/${m.id}/`))}>Удл.</button>}
          </div>
          {m.text}
        </div>
      ))}
    </div>
  )
}
