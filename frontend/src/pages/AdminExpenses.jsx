import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, fmt, apiError, canEdit } from '../api'
import { Loader, LoadError } from '../components/Loader'

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const monthLabel = (m) => (!m || m === 'none' ? 'без месяца' : `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`)
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

/**
 * Административные расходы — лист «Расход административные»: статьи колонками,
 * под ними суммы с комментариями. Месяц достаётся из комментария, поэтому
 * здесь видно то, чего не видно в самой таблице: сколько ушло по месяцам.
 */
export default function AdminExpenses({ user }) {
  const mayEdit = canEdit(user, 'finance.admin')
  const fileRef = useRef()
  const [sum, setSum] = useState(null)
  const [cat, setCat] = useState('')
  const [month, setMonth] = useState('')
  const [lines, setLines] = useState([])
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ category: '', amount: '', comment: '', month: thisMonth() })
  const [newCat, setNewCat] = useState('')

  const loadSummary = () => {
    setFailed(false)
    return api.get('/admin-expenses/summary/').then(r => {
      setSum(r.data)
      const first = r.data.categories[0]
      if (first) { setCat(c => c || String(first.id)); setForm(f => ({ ...f, category: f.category || String(first.id) })) }
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

  const add = async () => {
    try {
      await api.post('/admin-expenses/', { category: form.category, amount: form.amount,
        comment: form.comment, month: form.month ? `${form.month}-01` : null })
      setForm({ ...form, amount: '', comment: '' }); setCat(String(form.category)); reload()
    } catch (e) { alert(apiError(e)) }
  }
  const addCategory = async () => {
    try {
      const { data } = await api.post('/admin-categories/', { name: newCat.trim(), position: sum.categories.length })
      setNewCat(''); setCat(String(data.id)); setForm(f => ({ ...f, category: String(data.id) })); reload()
    } catch (e) { alert(apiError(e)) }
  }
  const del = async (l) => {
    if (!confirm(`Удалить ${fmt(l.amount)} «${l.comment}»?`)) return
    try { await api.delete(`/admin-expenses/${l.id}/`); reload() } catch (e) { alert(apiError(e)) }
  }
  const setLineMonth = async (l, value) => {
    try { await api.patch(`/admin-expenses/${l.id}/`, { month: value ? `${value}-01` : null }); reload() }
    catch (e) { alert(apiError(e)) }
  }
  const importFile = async (e) => {
    const f = e.target.files[0]; if (!f) return
    const fd = new FormData(); fd.append('file', f); setBusy(true)
    try {
      const { data: r } = await api.post('/admin-expenses/import_excel/', fd)
      alert(`Загружено: строк ${r.expenses}, новых статей ${r.categories_created}.` +
        (r.without_month ? `\nБез месяца: ${r.without_month} — в комментариях не нашлось месяца.` : '') +
        (r.warnings.length ? `\n\nЗамечания:\n• ${r.warnings.join('\n• ')}` : ''))
    } catch (err) { alert(apiError(err)) }
    finally { setBusy(false); e.target.value = ''; reload() }
  }

  const shownTotal = shown.reduce((a, l) => a + Number(l.amount), 0)
  const catName = sum.categories.find(c => String(c.id) === String(cat))?.name

  return (
    <div>
      <div className="pagehead">
        <h1>Административные расходы</h1>
        {mayEdit && <div>
          <button className="btn ghost small" disabled={busy} onClick={() => fileRef.current.click()}>
            {busy ? 'Загружаю…' : 'Импорт «Расход административные.xlsx»'}</button>
          <input type="file" ref={fileRef} accept=".xlsx" style={{ display: 'none' }} onChange={importFile} />
        </div>}
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="v">{fmt(sum.total)}</div><div className="l">всего</div></div>
        {sum.categories.map(c => (
          <div key={c.id} className="kpi" style={{ cursor: 'pointer' }} onClick={() => { setCat(String(c.id)); setMonth('') }}>
            <div className="v">{fmt(c.total)}</div><div className="l">{c.name}</div>
          </div>
        ))}
      </div>

      {sum.months.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '13px 16px 6px' }}><h2 style={{ margin: 0 }}>По месяцам</h2></div>
          <div className="tablewrap"><table className="matrix">
            <thead><tr><th>Статья</th>{sum.months.map(m => <th key={m} className="num">{monthLabel(m)}</th>)}<th className="num">Итого</th></tr></thead>
            <tbody>
              {sum.categories.map(c => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  {sum.months.map(m => (
                    <td key={m} className={'num cell' + (String(cat) === String(c.id) && month === m ? ' sel' : '')}
                      onClick={() => { setCat(String(c.id)); setMonth(month === m && String(cat) === String(c.id) ? '' : m) }}>
                      {c.months[m] ? fmt(c.months[m]) : ''}</td>
                  ))}
                  <td className="num"><b>{fmt(c.total)}</b></td>
                </tr>
              ))}
              <tr>
                <td><b>Итого</b></td>
                {sum.months.map(m => <td key={m} className="num"><b>{fmt(sum.by_month[m])}</b></td>)}
                <td className="num"><b>{fmt(sum.total)}</b></td>
              </tr>
            </tbody>
          </table></div>
          <p className="muted" style={{ padding: '6px 16px 12px' }}>Месяц взят из комментария («хайр май окл»), у строк без месяца — от соседних строк. Клик по ячейке — строки этого месяца ниже.</p>
        </div>
      )}

      {mayEdit && (
        <div className="card stitch">
          <div className="formrow">
            <div><label className="f">Статья</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                <option value="">— выбрать —</option>
                {sum.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div><label className="f">Сумма</label><input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
            <div style={{ flex: 2 }}><label className="f">Комментарий</label>
              <input value={form.comment} placeholder="оклад конструктор, аренда цех…" onChange={e => setForm({ ...form, comment: e.target.value })}
                onKeyDown={e => e.key === 'Enter' && form.amount && form.category && add()} /></div>
            <div><label className="f">Месяц</label><input type="month" value={form.month} onChange={e => setForm({ ...form, month: e.target.value })} /></div>
            <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={add} disabled={!form.category || !form.amount}>Добавить</button></div>
          </div>
          <div className="formrow" style={{ maxWidth: 480 }}>
            <div><input value={newCat} placeholder="Новая статья: Реклама, Налоги…" onChange={e => setNewCat(e.target.value)} /></div>
            <div style={{ flex: '0 0 auto' }}><button className="btn ghost" onClick={addCategory} disabled={!newCat.trim()}>+ статья</button></div>
          </div>
        </div>
      )}

      {sum.categories.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
            <select style={{ width: 'auto' }} value={cat} onChange={e => setCat(e.target.value)}>
              {sum.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select style={{ width: 'auto' }} value={month} onChange={e => setMonth(e.target.value)}>
              <option value="">все месяцы</option>
              {sum.months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <span className="muted">{catName}: строк {shown.length}, на <b>{fmt(shownTotal)}</b> ₸</span>
          </div>
          <div className="tablewrap"><table>
            <thead><tr><th>Месяц</th><th className="num">Сумма</th><th>Комментарий</th><th /></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={4} className="muted">Строк нет.</td></tr>}
              {shown.map(l => (
                <tr key={l.id}>
                  <td>{mayEdit
                    ? <input type="month" style={{ width: 140 }} defaultValue={l.month ? l.month.slice(0, 7) : ''}
                        onBlur={e => (e.target.value || null) !== (l.month ? l.month.slice(0, 7) : null) && setLineMonth(l, e.target.value)} />
                    : monthLabel(l.month ? l.month.slice(0, 7) : null)}</td>
                  <td className="num">{fmt(l.amount)}</td>
                  <td>{l.comment}{l.source === 'excel' && <span className="src">xlsx</span>}</td>
                  <td>{mayEdit && <button className="btn small ghost" onClick={() => del(l)}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  )
}
