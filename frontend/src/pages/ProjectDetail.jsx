import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, fmt, apiError, can, canEdit } from '../api'
import { Loader, LoadError } from '../components/Loader'
import { WorkBar, WorkLegend, today } from '../components/WorkBar'

export const KINDS = [
  ['delivery', 'Доставка'], ['travel', 'Командировки'], ['samples', 'Образцы и лекала'],
  ['fabric', 'Ткань и материалы'], ['accessories', 'Фурнитура и шевроны'],
  ['sewing', 'Пошив, крой, вышивка'], ['packaging', 'Упаковка'], ['purchase', 'Закуп товара'],
  ['percent', 'Проценты и сертификаты'], ['legal', 'Пени, суды, документы'], ['other', 'Прочее'],
]

/** Проект: расходы и приход построчно, куда ушли деньги, позиции реестра, цех. */
export default function ProjectDetail({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const wProj = canEdit(user, 'projects.projects')
  const wExp = canEdit(user, 'projects.expenses')
  const wInc = canEdit(user, 'projects.income')
  const seeContracts = can(user, 'contracts.contracts')
  const wContracts = canEdit(user, 'contracts.contracts')

  const [p, setP] = useState(null)
  const [failed, setFailed] = useState(false)
  const [free, setFree] = useState([])
  const [exp, setExp] = useState({ amount: '', comment: '', kind: '', date: '' })
  const [inc, setInc] = useState({ amount: '', comment: 'приход', date: today() })
  const [attach, setAttach] = useState('')
  const [filter, setFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')

  const load = () => {
    setFailed(false)
    api.get(`/projects/${id}/`).then(r => setP(r.data)).catch(() => setFailed(true))
    if (seeContracts) api.get('/contracts/?project__isnull=true&page_size=2000').then(r => setFree(r.data.results || []))
  }
  useEffect(() => { load() }, [id])

  const expenses = useMemo(() => (p ? p.expenses.filter(e =>
    (!filter || (e.comment || '').toLowerCase().includes(filter.toLowerCase())) &&
    (!kindFilter || e.kind === kindFilter)) : []), [p, filter, kindFilter])

  if (failed && !p) return <LoadError onRetry={load} />
  if (!p) return <Loader />
  const s = p.stats

  const run = async (fn) => { try { await fn(); load() } catch (e) { alert(apiError(e)) } }
  const del = (url, q) => confirm(q) && run(() => api.delete(url))

  const addExpense = () => run(async () => {
    await api.post('/project-expenses/', { project: id, amount: exp.amount, comment: exp.comment,
      ...(exp.kind ? { kind: exp.kind } : {}), date: exp.date || null })
    setExp({ amount: '', comment: '', kind: exp.kind, date: exp.date })
  })
  const addIncome = () => run(async () => {
    await api.post('/project-incomes/', { project: id, amount: inc.amount, comment: inc.comment, date: inc.date || null })
    setInc({ amount: '', comment: 'приход', date: inc.date })
  })
  const rename = () => {
    const name = prompt('Название проекта', p.name)
    if (name && name.trim() && name !== p.name) run(() => api.patch(`/projects/${id}/`, { name: name.trim() }))
  }
  const removeProject = async () => {
    if (!confirm(`Удалить проект «${p.name}»?`)) return
    try { await api.delete(`/projects/${id}/`); navigate('/projects') }
    catch (e) { alert(apiError(e, 'Проект с расходами или приходом удалить нельзя — сначала удалите строки.')) }
  }

  const expTotal = expenses.reduce((a, e) => a + Number(e.amount), 0)

  return (
    <div>
      <div className="pagehead">
        <div>
          <Link to="/projects" className="muted">← Проекты</Link>
          <h1>{p.name}</h1>
          {p.note && <div className="muted">{p.note}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {s.minus && <span className="pill low">в минусе</span>}
          <span className={'pill ' + (p.status === 'done' ? 'ok' : 'imp')}>{p.status_display}</span>
          {wProj && <>
            <button className="btn small ghost" onClick={rename}>Переименовать</button>
            <button className="btn small ghost" onClick={() => run(() => api.patch(`/projects/${id}/`, { status: p.status === 'done' ? 'active' : 'done' }))}>
              {p.status === 'done' ? 'Вернуть в работу' : 'Завершить'}</button>
            <button className="btn small ghost" onClick={removeProject}>Удалить</button>
          </>}
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="v">{fmt(s.contracts_amount)}</div><div className="l">сумма договоров ({s.contracts_count})</div></div>
        <div className="kpi good"><div className="v">{fmt(s.income)}</div><div className="l">приход</div></div>
        <div className="kpi"><div className="v">{fmt(s.expenses)}</div><div className="l">расход</div></div>
        <div className={'kpi' + (s.minus ? ' warn' : ' good')}><div className="v">{fmt(s.balance)}</div><div className="l">остаток</div></div>
        {s.contracts_count > 0 && <div className="kpi"><div className="v">{fmt(s.expected_profit)}</div>
          <div className="l">прибыль по договорам{s.margin !== null ? ` · ${s.margin}%` : ''}</div></div>}
      </div>

      <div className="grid2">
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '13px 16px 6px' }}><h2 style={{ margin: 0 }}>Расходы</h2></div>
          {wExp && <div style={{ padding: '0 16px' }}>
            <div className="formrow">
              <div><label className="f">Сумма</label><input type="number" value={exp.amount} onChange={e => setExp({ ...exp, amount: e.target.value })} /></div>
              <div style={{ flex: 2 }}><label className="f">Комментарий</label>
                <input value={exp.comment} placeholder="дост, ткань ашок, пошив аванс…" onChange={e => setExp({ ...exp, comment: e.target.value })}
                  onKeyDown={e => e.key === 'Enter' && exp.amount && addExpense()} /></div>
            </div>
            <div className="formrow">
              <div><label className="f">Вид</label>
                <select value={exp.kind} onChange={e => setExp({ ...exp, kind: e.target.value })}>
                  <option value="">по комментарию</option>
                  {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></div>
              <div><label className="f">Дата</label><input type="date" value={exp.date} onChange={e => setExp({ ...exp, date: e.target.value })} /></div>
              <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={addExpense} disabled={!exp.amount}>Добавить</button></div>
            </div>
          </div>}
          <div style={{ padding: '0 16px 8px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input style={{ flex: 1, minWidth: 140 }} placeholder="Найти в комментариях…" value={filter} onChange={e => setFilter(e.target.value)} />
            <select style={{ width: 'auto' }} value={kindFilter} onChange={e => setKindFilter(e.target.value)}>
              <option value="">все виды</option>
              {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="tablewrap" style={{ maxHeight: 560, overflowY: 'auto' }}><table>
            <thead><tr><th className="num">Сумма</th><th>Комментарий</th><th>Вид</th><th /></tr></thead>
            <tbody>
              {expenses.length === 0 && <tr><td colSpan={4} className="muted">Строк нет.</td></tr>}
              {expenses.map(e => (
                <tr key={e.id}>
                  <td className="num">{fmt(e.amount)}</td>
                  <td>{e.comment || '—'}{e.date && <span className="muted"> · {e.date}</span>}
                    {e.source === 'excel' && <span className="src" title="Загружено из Excel: при повторной загрузке заменится">xlsx</span>}</td>
                  <td>{wExp
                    ? <select style={{ width: 'auto', fontSize: 12, padding: '2px 4px' }} value={e.kind}
                        onChange={ev => run(() => api.patch(`/project-expenses/${e.id}/`, { kind: ev.target.value }))}>
                        {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    : e.kind_display}</td>
                  <td>{wExp && <button className="btn small ghost" onClick={() => del(`/project-expenses/${e.id}/`, `Удалить расход ${fmt(e.amount)} «${e.comment}»?`)}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div style={{ padding: '8px 16px 12px' }} className="muted">
            {filter || kindFilter ? <>Отобрано: <b>{fmt(expTotal)}</b> из {fmt(s.expenses)}</> : <>Всего: <b>{fmt(s.expenses)}</b>, строк {p.expenses.length}</>}
          </div>
        </div>

        <div>
          <div className="card">
            <h2>Куда ушли деньги</h2>
            {p.by_kind.length === 0 && <p className="muted">Расходов пока нет.</p>}
            {p.by_kind.map(k => (
              <div key={k.kind} style={{ marginBottom: 8, cursor: 'pointer' }} onClick={() => setKindFilter(kindFilter === k.kind ? '' : k.kind)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: kindFilter === k.kind ? 800 : 600 }}>{k.label}</span>
                  <span className="num">{fmt(k.total)} · {k.share}%</span>
                </div>
                <div className="kindbar" style={{ width: Math.max(2, k.share) + '%' }} />
              </div>
            ))}
            {p.by_kind.length > 0 && <p className="muted" style={{ marginTop: 8 }}>Вид определяется по комментарию. Если ошибся — поправьте в строке расхода. Клик по виду — отбор в таблице.</p>}
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '13px 16px 6px' }}><h2 style={{ margin: 0 }}>Приход</h2></div>
            {wInc && <div style={{ padding: '0 16px' }}><div className="formrow">
              <div><label className="f">Сумма</label><input type="number" value={inc.amount} onChange={e => setInc({ ...inc, amount: e.target.value })} /></div>
              <div><label className="f">Комментарий</label><input value={inc.comment} onChange={e => setInc({ ...inc, comment: e.target.value })} /></div>
              <div><label className="f">Дата</label><input type="date" value={inc.date} onChange={e => setInc({ ...inc, date: e.target.value })} /></div>
              <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={addIncome} disabled={!inc.amount}>Добавить</button></div>
            </div></div>}
            <table>
              <tbody>
                {p.incomes.length === 0 && <tr><td className="muted">Прихода пока нет.</td></tr>}
                {p.incomes.map(i => (
                  <tr key={i.id}>
                    <td className="num">{fmt(i.amount)}</td>
                    <td>{i.comment}{i.date && <span className="muted"> · {i.date}</span>}{i.source === 'excel' && <span className="src">xlsx</span>}</td>
                    <td>{wInc && <button className="btn small ghost" onClick={() => del(`/project-incomes/${i.id}/`, `Удалить приход ${fmt(i.amount)}?`)}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '13px 16px 6px' }}><h2 style={{ margin: 0 }}>Позиции реестра договоров</h2></div>
        <div className="tablewrap"><table>
          <thead><tr><th>Закупка</th><th>Организация</th><th>Предмет</th><th className="num">Кол-во</th>
            <th className="num">Сумма</th><th className="num">Оплачено</th><th>Договор №</th><th>Статус</th><th /></tr></thead>
          <tbody>
            {p.contracts.length === 0 && <tr><td colSpan={9} className="muted">Не привязано ни одной позиции.</td></tr>}
            {p.contracts.map(c => (
              <tr key={c.id}>
                <td>{seeContracts ? <Link to={`/contracts/${c.id}`}><b>{c.purchase_no || c.number}</b></Link> : <b>{c.purchase_no || c.number}</b>}
                  {c.own_company_name && <div className="muted">{c.own_company_name}</div>}</td>
                <td>{c.customer_name}</td><td>{c.title}</td>
                <td className="num">{c.qty !== null ? fmt(c.qty) : '—'}</td>
                <td className="num">{fmt(c.amount)}</td><td className="num">{fmt(c.paid_amount)}</td>
                <td>{c.contract_no || '—'}</td><td>{c.status_display}</td>
                <td>{wContracts && <button className="btn small ghost" onClick={() => run(() => api.patch(`/contracts/${c.id}/`, { project: null }))}>Отвязать</button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {wContracts && free.length > 0 && (
          <div style={{ padding: '10px 16px 14px' }} className="formrow">
            <div style={{ flex: 3 }}>
              <select value={attach} onChange={e => setAttach(e.target.value)}>
                <option value="">— привязать позицию реестра —</option>
                {free.map(c => <option key={c.id} value={c.id}>{c.purchase_no || c.number} · {c.customer_name} · {c.title} · {fmt(c.amount)} ₸</option>)}
              </select>
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <button className="btn" disabled={!attach} onClick={() => run(async () => { await api.patch(`/contracts/${attach}/`, { project: id }); setAttach('') })}>Привязать</button>
            </div>
          </div>
        )}
      </div>

      {p.work_orders && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '13px 16px 6px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Цех по проекту</h2>
            <WorkLegend />
          </div>
          {p.work_orders.length === 0 && <p className="muted" style={{ padding: '0 16px 14px' }}>Заказов цеха нет.</p>}
          {p.work_orders.map(w => (
            <Link key={w.id} className="ordercard" to={`/workshop/${w.id}`}>
              <div><div className="t">{w.product}</div><div className="muted">{w.status_display}{w.deadline ? ` · срок ${w.deadline}` : ''}</div></div>
              <div className="nums">сшито <b>{fmt(w.totals.sewn)}</b> из {fmt(w.totals.planned)} · упаковано {fmt(w.totals.packed)}</div>
              <WorkBar t={w.totals} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
