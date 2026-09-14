import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmt, apiError, canEdit } from '../api'
import { Loader, LoadError } from '../components/Loader'

/**
 * Проекты — колонки из «Расходы.xlsx»: под каждым проектом траты и приход,
 * внизу остаток. Здесь то же самое, только посчитанное и сведённое вместе.
 */
export default function Projects({ user }) {
  const mayEdit = canEdit(user, 'projects.projects')
  const mayImport = canEdit(user, 'projects.expenses') && canEdit(user, 'projects.income')
  const navigate = useNavigate()
  const fileRef = useRef()
  const [rows, setRows] = useState(null)
  const [sum, setSum] = useState(null)
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [failed, setFailed] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    setFailed(false)
    const p = new URLSearchParams({ page_size: 2000 })
    if (status) p.set('status', status)
    if (q) p.set('search', q)
    Promise.all([
      api.get('/projects/?' + p).then(r => setRows(r.data.results || [])),
      api.get('/projects/summary/?' + p).then(r => setSum(r.data)),
    ]).catch(() => setFailed(true))
  }
  useEffect(() => { load() }, [status, q])

  const create = async () => {
    try {
      const { data } = await api.post('/projects/', { name })
      setName(''); navigate(`/projects/${data.id}`)
    } catch (e) { alert(apiError(e)) }
  }

  const importFile = async (e) => {
    const f = e.target.files[0]; if (!f) return
    const fd = new FormData(); fd.append('file', f)
    setBusy(true)
    try {
      const { data: r } = await api.post('/projects/import_expenses/', fd)
      alert(`Загружено из «Расходов».\n` +
        `Проектов новых: ${r.projects_created}, обновлено: ${r.projects_updated}.\n` +
        `Строк расходов: ${r.expenses}, прихода: ${r.incomes}.` +
        (r.warnings.length ? `\n\nЗамечания:\n• ${r.warnings.join('\n• ')}` : ''))
    } catch (err) { alert(apiError(err)) }
    finally { setBusy(false); e.target.value = ''; load() }
  }

  if (failed) return <LoadError onRetry={load} />
  if (!rows || !sum) return <Loader />

  return (
    <div>
      <div className="pagehead">
        <h1>Проекты</h1>
        {mayImport && <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost small" disabled={busy} onClick={() => fileRef.current.click()}>
            {busy ? 'Загружаю…' : 'Импорт «Расходы.xlsx»'}</button>
          <input type="file" ref={fileRef} accept=".xlsx" style={{ display: 'none' }} onChange={importFile} />
        </div>}
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="v">{fmt(sum.contracts_amount)}</div><div className="l">сумма договоров, ₸</div></div>
        <div className="kpi good"><div className="v">{fmt(sum.income)}</div><div className="l">приход</div></div>
        <div className="kpi"><div className="v">{fmt(sum.expenses)}</div><div className="l">расход по проектам</div></div>
        <div className={'kpi' + (sum.balance < 0 ? ' warn' : ' good')}><div className="v">{fmt(sum.balance)}</div><div className="l">остаток (приход − расход)</div></div>
        {sum.admin_expenses !== null && <>
          <div className="kpi"><div className="v">{fmt(sum.admin_expenses)}</div><div className="l">административные</div></div>
          <div className={'kpi' + (sum.result < 0 ? ' warn' : ' good')}><div className="v">{fmt(sum.result)}</div><div className="l">итог с учётом административных</div></div>
        </>}
      </div>

      {mayEdit && (
        <div className="card stitch">
          <div className="formrow">
            <div><label className="f">Новый проект</label>
              <input value={name} placeholder="Павлодар 741 шт ДИНА" onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && name.trim() && create()} /></div>
            <div style={{ alignSelf: 'flex-end', flex: '0 0 auto' }}>
              <button className="btn" onClick={create} disabled={!name.trim()}>Создать</button></div>
          </div>
          <p className="muted">Проект — это колонка из «Расходов»: всё, что потрачено и получено по заказу.
            Проект заводится с первой траты, даже до договора — например, на образцы.</p>
        </div>
      )}

      <div className="formrow" style={{ maxWidth: 560 }}>
        <input placeholder="Поиск проекта…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Все</option>
          <option value="active">В работе</option>
          <option value="done">Завершённые</option>
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap"><table>
          <thead><tr>
            <th>Проект</th><th className="num">Позиций</th><th className="num">Сумма договоров</th>
            <th className="num">Приход</th><th className="num">Расход</th><th className="num">Остаток</th>
            <th className="num">Прибыль по договорам</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">Проектов нет. Загрузите «Расходы.xlsx» или создайте проект.</td></tr>}
            {rows.map(p => (
              <tr key={p.id} className="clickable" onClick={() => navigate(`/projects/${p.id}`)}>
                <td><b>{p.name}</b>{p.status === 'done' && <span className="pill ok" style={{ marginLeft: 6 }}>завершён</span>}</td>
                <td className="num">{p.stats.contracts_count || '—'}</td>
                <td className="num">{p.stats.contracts_amount ? fmt(p.stats.contracts_amount) : '—'}</td>
                <td className="num">{fmt(p.stats.income)}</td>
                <td className="num">{fmt(p.stats.expenses)}</td>
                <td className={'num ' + (p.stats.minus ? 'neg' : 'pos')}>{fmt(p.stats.balance)}</td>
                <td className="num">{p.stats.contracts_count ? <>{fmt(p.stats.expected_profit)}{p.stats.margin !== null && <span className="muted"> · {p.stats.margin}%</span>}</> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      <p className="muted">Остаток — как внизу колонки в «Расходах»: пришло минус потрачено. Красным — проект в минусе.
        Прибыль по договорам — сумма привязанных позиций реестра минус расходы: то, что останется, когда заказчик заплатит всё.</p>
    </div>
  )
}
