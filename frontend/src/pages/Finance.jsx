import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts'
import { api, fmt, apiError, can, canEdit, monthLabel, today, dmy, EXPENSE_KINDS, CONTRACT_STATUS } from '../api'
import { Loader, LoadError } from '../components/Loader'

const TABS = [
  ['summary', 'finance.reports', 'Сводка'],
  ['admin', 'finance.admin', 'Расходы административные'],
  ['expenses', 'contracts.expenses', 'Расходы по договорам'],
  ['income', 'finance.income', 'Прочие поступления'],
]

/**
 * Финансы собираются из трёх мест: оплаты и расходы — в договорах,
 * административные расходы и прочие поступления — здесь.
 */
export default function Finance({ user }) {
  const visible = TABS.filter(([, key]) => can(user, key))
  const [tab, setTab] = useState(visible[0]?.[0])
  return (
    <div>
      <div className="pagehead"><h1>Финансы</h1></div>
      <div className="tabs">
        {visible.map(([t, , label]) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{label}</button>)}
      </div>
      {tab === 'summary' && <Summary />}
      {tab === 'admin' && <AdminExpenses canWrite={canEdit(user, 'finance.admin')} />}
      {tab === 'expenses' && <AllExpenses />}
      {tab === 'income' && <OtherIncome canWrite={canEdit(user, 'finance.income')} />}
    </div>
  )
}

function Summary() {
  const [d, setD] = useState(null)
  const [failed, setFailed] = useState(false)
  const [sort, setSort] = useState('balance')
  const [onlyMinus, setOnlyMinus] = useState(false)
  const load = () => { setFailed(false); api.get('/finance/summary/').then(r => setD(r.data)).catch(() => setFailed(true)) }
  useEffect(load, [])
  const rows = useMemo(() => {
    if (!d) return []
    const list = d.contracts.filter(c => !onlyMinus || (c.expenses > 0 && c.balance < 0))
    return [...list].sort((a, b) => sort === 'amount' ? b.amount - a.amount : a[sort] - b[sort])
  }, [d, sort, onlyMinus])
  if (failed) return <LoadError onRetry={load} />
  if (!d) return <Loader />
  const chart = d.months.filter(m => m.month !== 'none').map(m => ({ ...m, label: monthLabel(m.month),
    spent: m.contract_expenses + m.admin_expenses, got: m.income + m.other_income }))
  const noDate = d.months.find(m => m.month === 'none')

  return (
    <>
      <div className="kpi-grid">
        <div className="kpi good"><div className="v">{fmt(d.paid)}</div><div className="l">получено от заказчиков</div></div>
        <div className="kpi"><div className="v">{fmt(d.debt)}</div><div className="l">заказчики ещё должны</div></div>
        <div className="kpi"><div className="v">{fmt(d.contract_expenses)}</div><div className="l">расходы по договорам</div></div>
        <div className="kpi"><div className="v">{fmt(d.admin_expenses)}</div><div className="l">административные</div></div>
        {d.other_income > 0 && <div className="kpi"><div className="v">{fmt(d.other_income)}</div><div className="l">прочие поступления</div></div>}
        <div className={'kpi ' + (d.cash < 0 ? 'warn' : 'good')}><div className="v">{fmt(d.cash)}</div><div className="l">деньги сейчас: получено − потрачено</div></div>
        <div className={'kpi ' + (d.expected_result < 0 ? 'warn' : 'good')}><div className="v">{fmt(d.expected_result)}</div><div className="l">итог, когда заказчики доплатят</div></div>
      </div>

      {chart.length > 0 && (
        <div className="card stitch">
          <h2>Приход и расход по месяцам</h2>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3e1d9" />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis fontSize={10} tickFormatter={v => Math.round(v / 1e6) + ' млн'} />
              <Tooltip formatter={v => fmt(v) + ' ₸'} />
              <Legend />
              <Bar dataKey="got" name="Приход" fill="#2e4a8f" radius={[4, 4, 0, 0]} />
              <Bar dataKey="contract_expenses" name="Расходы договоров" stackId="s" fill="#c9c4b8" />
              <Bar dataKey="admin_expenses" name="Административные" stackId="s" fill="#d97b29" radius={[4, 4, 0, 0]} />
              <Line dataKey="cumulative" name="Нарастающим итогом" stroke="#1d7a4f" strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
          {noDate && <p className="muted">Без даты (строки из «Расходы.xlsx» дат не имеют): приход {fmt(noDate.income)}, расходы договоров {fmt(noDate.contract_expenses)} — в график не попали, но в итогах учтены.</p>}
        </div>
      )}

      <div className="grid2 wide-left">
        <div className="card" style={{ padding: 0 }}>
          <div className="toolbar"><b>По месяцам</b></div>
          <div className="tablewrap"><table className="sheet">
            <thead><tr><th>Месяц</th><th className="num">Приход</th><th className="num">Расходы договоров</th><th className="num">Адм.</th><th className="num">Итог</th><th className="num">Нарастающим</th></tr></thead>
            <tbody>
              {d.months.length === 0 && <tr><td colSpan={6} className="muted">Движений денег нет.</td></tr>}
              {d.months.map(m => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month)}</td>
                  <td className="num">{fmt(m.income + m.other_income)}</td>
                  <td className="num">{fmt(m.contract_expenses)}</td>
                  <td className="num">{fmt(m.admin_expenses)}</td>
                  <td className={'num ' + (m.net < 0 ? 'neg' : 'pos')}>{fmt(m.net)}</td>
                  <td className="num">{fmt(m.cumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
        <div className="card">
          <h2>Куда уходят деньги договоров</h2>
          {d.kinds.length === 0 && <p className="muted">Расходов нет.</p>}
          {d.kinds.map(k => {
            const share = d.contract_expenses ? Math.round(k.total / d.contract_expenses * 1000) / 10 : 0
            return (
              <div key={k.kind} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{k.label}</span><span className="num">{fmt(k.total)} · {share}%</span></div>
                <div className="kindbar" style={{ width: Math.max(2, share) + '%' }} />
              </div>
            )
          })}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="toolbar">
          <b>По договорам</b>
          <label className="check"><input type="checkbox" checked={onlyMinus} onChange={e => setOnlyMinus(e.target.checked)} />только в минусе ({d.minus_count})</label>
          <select style={{ width: 'auto', marginLeft: 'auto' }} value={sort} onChange={e => setSort(e.target.value)}>
            <option value="balance">сначала худший остаток</option>
            <option value="profit">сначала меньшая прибыль</option>
            <option value="amount">сначала крупные</option>
          </select>
        </div>
        <div className="tablewrap"><table className="sheet">
          <thead><tr><th>Закупка</th><th>Заказчик · предмет</th><th>Статус</th><th className="num">Сумма</th><th className="num">Оплачено</th><th className="num">Долг</th><th className="num">Расходы</th><th className="num">Прибыль</th><th className="num">Остаток</th></tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td style={{ whiteSpace: 'nowrap' }}><Link to={`/contracts/${c.id}`}><b>{c.number}</b></Link></td>
                <td className="wide">{c.customer}<div className="muted">{c.title}</div></td>
                <td><span className="badge" style={{ background: CONTRACT_STATUS[c.status]?.color }}>{c.status_display}</span></td>
                <td className="num">{fmt(c.amount)}</td><td className="num">{fmt(c.paid)}</td><td className="num">{fmt(c.debt)}</td>
                <td className="num">{fmt(c.expenses)}</td>
                <td className={'num ' + (c.profit < 0 ? 'neg' : '')}>{fmt(c.profit)}</td>
                <td className={'num ' + (c.expenses > 0 && c.balance < 0 ? 'neg' : '')}>{fmt(c.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  )
}

function AdminExpenses({ canWrite }) {
  const fileRef = useRef()
  const [sum, setSum] = useState(null)
  const [cat, setCat] = useState('')
  const [month, setMonth] = useState('')
  const [lines, setLines] = useState([])
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const thisMonth = today().slice(0, 7)
  const [form, setForm] = useState({ cat: '', amount: '', comment: '', month: thisMonth })

  const loadSummary = () => {
    setFailed(false)
    return api.get('/admin-expenses/summary/').then(r => {
      setSum(r.data)
      const first = r.data.categories[0]
      if (first) setCat(c => c || String(first.id))
    }).catch(() => setFailed(true))
  }
  const loadLines = () => {
    if (!cat) return setLines([])
    api.get(`/admin-expenses/?page_size=5000&category=${cat}`).then(r => setLines(r.data.results || []))
  }
  useEffect(() => { loadSummary() }, [])
  useEffect(() => { loadLines() }, [cat])
  const reload = () => { loadSummary(); loadLines() }

  const shown = useMemo(() => lines.filter(l => !month
    || (month === 'none' ? !l.month : (l.month || '').slice(0, 7) === month)), [lines, month])

  if (failed && !sum) return <LoadError onRetry={reload} />
  if (!sum) return <Loader />

  const run = async (fn) => { try { await fn(); reload() } catch (e) { alert(apiError(e)) } }
  const importFile = async (e) => {
    const f = e.target.files[0]; if (!f) return
    const fd = new FormData(); fd.append('file', f); setBusy(true)
    try {
      const { data: r } = await api.post('/admin-expenses/import_excel/', fd)
      alert(`Загружено: строк ${r.expenses}, новых статей ${r.categories_created}.` +
        (r.without_month ? `\nБез месяца: ${r.without_month} — в комментариях месяц не указан, проставьте в строке.` : '') +
        (r.warnings.length ? `\n\nЗамечания:\n• ${r.warnings.join('\n• ')}` : ''))
    } catch (err) { alert(apiError(err)) }
    finally { setBusy(false); e.target.value = ''; reload() }
  }
  const shownTotal = shown.reduce((a, l) => a + Number(l.amount), 0)

  return (
    <div className={canWrite ? '' : 'readonly'}>
      <div className="pagehead" style={{ marginTop: 0 }}>
        <span className="muted">Лист «Расход административные»: оклады, аренда, прочие траты цеха.</span>
        {canWrite && <><button className="btn ghost small" disabled={busy} onClick={() => fileRef.current.click()}>
          {busy ? 'Загружаю…' : 'Импорт «Расход административные.xlsx»'}</button>
          <input type="file" ref={fileRef} accept=".xlsx" style={{ display: 'none' }} onChange={importFile} /></>}
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="v">{fmt(sum.total)}</div><div className="l">всего{sum.plan_total ? ` · план ${fmt(sum.plan_total)}/мес` : ''}</div></div>
        {sum.categories.map(c => (
          <div key={c.id} className="kpi" style={{ cursor: 'pointer' }} onClick={() => { setCat(String(c.id)); setMonth('') }}>
            <div className="v">{fmt(c.total)}</div><div className="l">{c.name}{c.monthly_plan ? ` · план ${fmt(c.monthly_plan)}` : ''}</div>
          </div>
        ))}
      </div>

      {sum.months.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="toolbar"><b>По месяцам</b><span className="muted">красным — больше плана статьи. Клик по ячейке — строки ниже.</span></div>
          <div className="tablewrap"><table className="matrix sheet">
            <thead><tr><th>Статья</th><th className="num">План/мес</th>{sum.months.map(m => <th key={m} className="num">{monthLabel(m)}</th>)}<th className="num">Итого</th></tr></thead>
            <tbody>
              {sum.categories.map(c => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td className="num muted">{c.monthly_plan ? fmt(c.monthly_plan) : ''}</td>
                  {sum.months.map(m => (
                    <td key={m} className={'num cell' + (String(cat) === String(c.id) && month === m ? ' sel' : '') +
                      (c.monthly_plan && m !== 'none' && c.months[m] > c.monthly_plan ? ' neg' : '')}
                      onClick={() => { setCat(String(c.id)); setMonth(month === m && String(cat) === String(c.id) ? '' : m) }}>
                      {c.months[m] ? fmt(c.months[m]) : ''}</td>
                  ))}
                  <td className="num"><b>{fmt(c.total)}</b></td>
                </tr>
              ))}
              <tr className="total"><td>Итого</td><td className="num">{sum.plan_total ? fmt(sum.plan_total) : ''}</td>
                {sum.months.map(m => <td key={m} className="num">{fmt(sum.by_month[m])}</td>)}
                <td className="num">{fmt(sum.total)}</td></tr>
            </tbody>
          </table></div>
        </div>
      )}

      {canWrite && (
        <div className="card stitch">
          <h2>Внести расход</h2>
          <div className="formrow">
            <div style={{ flex: 1.5 }}><label className="f">Статья</label>
              <input list="admin-cats" value={form.cat} placeholder="Оклады, Аренда, Налоги…"
                onChange={e => setForm({ ...form, cat: e.target.value })} />
              <datalist id="admin-cats">{sum.categories.map(c => <option key={c.id} value={c.name} />)}</datalist></div>
            <div><label className="f">Сумма</label><input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
            <div style={{ flex: 2 }}><label className="f">Комментарий</label>
              <input value={form.comment} placeholder="оклад конструктор, аренда цех…" onChange={e => setForm({ ...form, comment: e.target.value })} /></div>
            <div><label className="f">Месяц</label><input type="month" value={form.month} onChange={e => setForm({ ...form, month: e.target.value })} /></div>
            <div style={{ alignSelf: 'flex-end' }}><button className="btn" disabled={!form.cat.trim() || !form.amount} onClick={() => run(async () => {
              const name = form.cat.trim()
              let c = sum.categories.find(x => x.name.toLowerCase() === name.toLowerCase())
              if (!c) c = (await api.post('/admin-categories/', { name, position: sum.categories.length })).data
              await api.post('/admin-expenses/', { category: c.id, amount: form.amount, comment: form.comment, month: form.month ? `${form.month}-01` : null })
              setForm({ ...form, amount: '', comment: '' }); setCat(String(c.id))
            })}>Добавить</button></div>
          </div>
          <p className="muted">
            Это траты вне договоров: оклады, аренда, налоги, связь. Статью можно выбрать из списка или
            вписать новую — она создастся сама.
            {sum.categories.length === 0 && <> Обычно заводят: {['Оклады', 'Аренда', 'Налоги', 'Связь', 'Хозрасходы', 'Транспорт'].map(n => (
              <button key={n} type="button" className="btn small ghost" style={{ margin: '0 4px 4px 0' }}
                onClick={() => setForm(f => ({ ...f, cat: n }))}>{n}</button>))}</>}
          </p>
          <p className="muted">Расходы по договору — пошив, ткань, доставка — вносятся в самом договоре, во вкладке «Расходы».</p>
        </div>
      )}

      {sum.categories.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="toolbar">
            <select style={{ width: 'auto' }} value={cat} onChange={e => setCat(e.target.value)}>
              {sum.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select style={{ width: 'auto' }} value={month} onChange={e => setMonth(e.target.value)}>
              <option value="">все месяцы</option>
              {sum.months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <span className="muted">строк {shown.length}, на <b>{fmt(shownTotal)}</b> ₸</span>
            {canWrite && cat && <input type="number" style={{ width: 150, marginLeft: 'auto' }} placeholder="план в месяц"
              key={cat} defaultValue={sum.categories.find(c => String(c.id) === cat)?.monthly_plan || ''}
              onBlur={e => run(() => api.patch(`/admin-categories/${cat}/`, { monthly_plan: e.target.value || 0 }))} title="План статьи в месяц" />}
          </div>
          <div className="tablewrap"><table className="sheet">
            <thead><tr><th>Месяц</th><th className="num">Сумма</th><th>Комментарий</th><th /></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={4} className="muted">Строк нет.</td></tr>}
              {shown.map(l => (
                <tr key={l.id}>
                  <td>{canWrite
                    ? <input type="month" style={{ width: 150 }} defaultValue={l.month ? l.month.slice(0, 7) : ''}
                        onBlur={e => (e.target.value || null) !== (l.month ? l.month.slice(0, 7) : null) &&
                          run(() => api.patch(`/admin-expenses/${l.id}/`, { month: e.target.value ? `${e.target.value}-01` : null }))} />
                    : monthLabel(l.month ? l.month.slice(0, 7) : null)}</td>
                  <td className="num">{fmt(l.amount)}</td>
                  <td>{l.comment}{l.source === 'excel' && <span className="src">xlsx</span>}</td>
                  <td>{canWrite && <button className="btn small ghost" onClick={() => confirm(`Удалить ${fmt(l.amount)} «${l.comment}»?`) && run(() => api.delete(`/admin-expenses/${l.id}/`))}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  )
}

function AllExpenses() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  useEffect(() => {
    const p = new URLSearchParams({ page_size: 5000 })
    if (q) p.set('search', q)
    if (kind) p.set('kind', kind)
    api.get('/contract-expenses/?' + p).then(r => setRows(r.data.results || []))
  }, [q, kind])
  if (!rows) return <Loader />
  const total = rows.reduce((a, e) => a + Number(e.amount), 0)
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="toolbar">
        <input style={{ maxWidth: 320 }} placeholder="Поиск: комментарий, закупка, предмет" value={q} onChange={e => setQ(e.target.value)} />
        <select style={{ width: 'auto' }} value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">все виды</option>{EXPENSE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <span className="muted">строк {rows.length} на <b>{fmt(total)}</b> ₸</span>
      </div>
      <div className="tablewrap"><table className="sheet">
        <thead><tr><th>Договор</th><th className="num">Сумма</th><th>Комментарий</th><th>Вид</th><th>Дата</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="muted">Ничего не найдено.</td></tr>}
          {rows.map(e => (
            <tr key={e.id}>
              <td><Link to={`/contracts/${e.contract}`}><b>{e.contract_number}</b></Link><div className="muted">{e.contract_title}</div></td>
              <td className="num">{fmt(e.amount)}</td>
              <td>{e.comment}{e.source === 'excel' && <span className="src">xlsx</span>}</td>
              <td>{e.kind_display}</td>
              <td className="muted">{e.date ? dmy(e.date) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  )
}

function OtherIncome({ canWrite }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState({ amount: '', comment: '', date: today() })
  const load = () => api.get('/other-income/?page_size=1000').then(r => setRows(r.data.results || []))
  useEffect(() => { load() }, [])
  const run = async (fn) => { try { await fn(); load() } catch (e) { alert(apiError(e)) } }
  return (
    <div className="card" style={{ padding: 0 }}>
      {canWrite && <div style={{ padding: '14px 16px 0' }}>
        <p className="muted" style={{ marginBottom: 8 }}>Деньги не от заказчика по договору: заём, вложение инвестора. Оплаты заказчиков пишутся в сам договор.</p>
        <div className="formrow">
          <div><label className="f">Сумма</label><input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
          <div style={{ flex: 2 }}><label className="f">Комментарий</label><input value={form.comment} placeholder="заём, инвестор" onChange={e => setForm({ ...form, comment: e.target.value })} /></div>
          <div><label className="f">Дата</label><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
          <div style={{ alignSelf: 'flex-end', flex: '0 0 auto' }}><button className="btn" disabled={!form.amount}
            onClick={() => run(async () => { await api.post('/other-income/', form); setForm({ ...form, amount: '', comment: '' }) })}>Добавить</button></div>
        </div>
      </div>}
      <div className="tablewrap"><table className="sheet">
        <thead><tr><th>Дата</th><th className="num">Сумма</th><th>Комментарий</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={4} className="muted">Записей нет.</td></tr>}
          {rows.map(r => (
            <tr key={r.id}><td>{dmy(r.date)}</td><td className="num">{fmt(r.amount)}</td><td>{r.comment}</td>
              <td>{canWrite && <button className="btn small ghost" onClick={() => confirm('Удалить запись?') && run(() => api.delete(`/other-income/${r.id}/`))}>✕</button>}</td></tr>
          ))}
        </tbody>
      </table></div>
    </div>
  )
}
