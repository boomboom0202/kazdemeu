import React, { useEffect, useState } from 'react'
import { api, fmt } from '../api'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, Legend, CartesianGrid, PieChart, Pie, Cell } from 'recharts'
import { useIsMobile } from '../useIsMobile'

const COLORS = ['#2e4a8f', '#d97b29', '#1d7a4f', '#b8860b', '#7a5195', '#b03030']

export default function Finance() {
  const isMobile = useIsMobile()
  const [cf, setCf] = useState(null)
  const [pnl, setPnl] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [entries, setEntries] = useState([])
  const [cats, setCats] = useState([])
  const [contracts, setContracts] = useState([])
  const [form, setForm] = useState({ direction: 'in', amount: '', date: new Date().toISOString().slice(0, 10), category: '', contract: '', description: '' })
  const [showCat, setShowCat] = useState(false)
  const [editCatId, setEditCatId] = useState(null)
  const [catForm, setCatForm] = useState({ name: '', kind: 'variable' })
  const [showFixed, setShowFixed] = useState(false)
  const [fixed, setFixed] = useState([])
  const [cs, setCs] = useState(null)
  const [fxForm, setFxForm] = useState({ name: '', monthly_amount: '', category: '' })

  const loadFixed = () => {
    api.get('/fixed-costs/?page_size=100').then(r => setFixed(r.data.results || []))
    api.get('/cost-settings/').then(r => setCs(r.data))
  }
  useEffect(() => { if (showFixed) loadFixed() }, [showFixed])

  const addFixed = async () => {
    try {
      await api.post('/fixed-costs/', { ...fxForm, category: fxForm.category || null })
      setFxForm({ name: '', monthly_amount: '', category: '' }); loadFixed()
    } catch (e) { alert(e.response?.data ? JSON.stringify(e.response.data) : 'Ошибка') }
  }
  const patchFixed = async (id, body) => { await api.patch(`/fixed-costs/${id}/`, body); loadFixed() }
  const delFixed = async (f) => {
    if (!confirm(`Удалить постоянный расход «${f.name}»?`)) return
    await api.delete(`/fixed-costs/${f.id}/`); loadFixed()
  }
  const patchCs = async (body) => {
    const { data } = await api.patch('/cost-settings/', body); setCs(data); loadFixed()
  }

  const load = () => {
    api.get('/reports/cashflow/').then(r => setCf(r.data))
    api.get('/reports/pnl/').then(r => setPnl(r.data))
    api.get('/reports/forecast/').then(r => setForecast(r.data))
    api.get('/cash-entries/?page_size=30').then(r => setEntries(r.data.results || []))
  }
  const loadCats = () => api.get('/expense-categories/?page_size=100').then(r => setCats(r.data.results || []))
  useEffect(() => {
    load()
    loadCats()
    api.get('/contracts/?page_size=200').then(r => setContracts(r.data.results || []))
  }, [])

  const add = async () => {
    await api.post('/cash-entries/', { ...form, category: form.category || null, contract: form.contract || null })
    setForm({ ...form, amount: '', description: '' }); load()
  }

  const resetCat = () => { setEditCatId(null); setCatForm({ name: '', kind: 'variable' }) }
  const saveCat = async () => {
    try {
      if (editCatId) { await api.patch(`/expense-categories/${editCatId}/`, catForm); resetCat(); await loadCats() }
      else {
        const { data } = await api.post('/expense-categories/', catForm)
        resetCat(); await loadCats(); setForm(f => ({ ...f, category: data.id }))
      }
    } catch (e) { alert(e.response?.data ? JSON.stringify(e.response.data) : 'Ошибка') }
  }
  const editCat = (c) => { setEditCatId(c.id); setCatForm({ name: c.name, kind: c.kind }) }
  const deleteCat = async (c) => {
    if (!confirm(`Удалить категорию «${c.name}»?`)) return
    try { await api.delete(`/expense-categories/${c.id}/`); await loadCats() }
    catch (e) { alert(e.response?.data?.detail || 'Не удалось удалить') }
  }
  const delEntry = async (id) => {
    if (!confirm('Удалить операцию?')) return
    try { await api.delete(`/cash-entries/${id}/`); load() }
    catch (e) { alert(e.response?.data?.detail || 'Не удалось удалить') }
  }

  if (!cf || !pnl || !forecast) return null

  return (
    <div>
      <div className="pagehead">
        <h1>Финансы</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost small" onClick={() => setShowFixed(s => !s)}>
            {showFixed ? 'Скрыть постоянные расходы' : 'Постоянные расходы'}</button>
          <button className="btn ghost small" onClick={() => setShowCat(s => !s)}>+ Категория расхода</button>
        </div>
      </div>

      {showFixed && cs && (
        <div className="card stitch">
          <h2>Постоянные расходы — вводятся один раз</h2>
          <p className="muted">Аренда, оклады АУП, коммуналка вносятся сюда один раз и действуют
            ежемесячно. Система сама распределяет их в себестоимость каждого изделия.
            Переменные расходы (материалы, сдельная оплата) вводятся при каждой операции.</p>
          <div className="formrow">
            <div><label className="f">Наименование</label><input value={fxForm.name} onChange={e => setFxForm({ ...fxForm, name: e.target.value })} placeholder="Аренда цеха" /></div>
            <div><label className="f">Сумма в месяц, ₸</label><input type="number" value={fxForm.monthly_amount} onChange={e => setFxForm({ ...fxForm, monthly_amount: e.target.value })} /></div>
            <div><label className="f">Категория</label>
              <select value={fxForm.category} onChange={e => setFxForm({ ...fxForm, category: e.target.value })}>
                <option value="">—</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={addFixed} disabled={!fxForm.name || !fxForm.monthly_amount}>+ Добавить</button></div>
          </div>
          <table>
            <thead><tr><th>Наименование</th><th className="num">₸ / месяц</th><th>Категория</th><th>Действует</th><th /></tr></thead>
            <tbody>
              {fixed.map(f => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td className="num"><input type="number" style={{ width: 110 }} defaultValue={f.monthly_amount} onBlur={e => patchFixed(f.id, { monthly_amount: e.target.value || 0 })} /></td>
                  <td>{f.category_name || '—'}</td>
                  <td><input type="checkbox" style={{ width: 'auto' }} checked={f.is_active} onChange={e => patchFixed(f.id, { is_active: e.target.checked })} /></td>
                  <td><button className="btn small ghost" onClick={() => delFixed(f)}>Удл.</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="formrow" style={{ marginTop: 12, borderTop: '1px dashed var(--line)', paddingTop: 12 }}>
            <div><label className="f">Метод распределения</label>
              <select value={cs.method} onChange={e => patchCs({ method: e.target.value })}>
                <option value="per_hour">На нормо-час (точнее)</option>
                <option value="per_unit">На единицу продукции (проще)</option>
              </select></div>
            {cs.method === 'per_hour'
              ? <div><label className="f">Плановый фонд времени, ч/мес</label>
                  <input type="number" defaultValue={cs.planned_monthly_hours} onBlur={e => patchCs({ planned_monthly_hours: e.target.value || 1 })} /></div>
              : <div><label className="f">Плановый выпуск, шт/мес</label>
                  <input type="number" defaultValue={cs.planned_monthly_units} onBlur={e => patchCs({ planned_monthly_units: e.target.value || 1 })} /></div>}
            <div style={{ alignSelf: 'flex-end' }}>
              <div className="muted" style={{ fontSize: 13 }}>Итого постоянных: <b>{fmt(cs.monthly_fixed_total)} ₸/мес</b></div>
              <div className="muted" style={{ fontSize: 13 }}>Ставка накладных: <b>{fmt(cs.overhead_rate)} ₸</b> / {cs.method === 'per_hour' ? 'час' : 'шт'}</div>
            </div>
          </div>
        </div>
      )}

      {showCat && (
        <div className="card stitch">
          <h2>{editCatId ? 'Редактирование категории' : 'Новая категория расхода'}</h2>
          <div className="formrow">
            <div><label className="f">Название категории</label><input value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} /></div>
            <div><label className="f">Тип</label>
              <select value={catForm.kind} onChange={e => setCatForm({ ...catForm, kind: e.target.value })}>
                <option value="variable">Переменные</option><option value="fixed">Постоянные</option>
              </select></div>
            <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 6 }}>
              <button className="btn" onClick={saveCat} disabled={!catForm.name}>Сохранить</button>
              {editCatId && <button className="btn ghost" onClick={resetCat}>Отмена</button>}
            </div>
          </div>
          <table>
            <thead><tr><th>Категория</th><th>Тип</th><th /></tr></thead>
            <tbody>
              {cats.map(c => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.kind === 'fixed' ? 'постоянные' : 'переменные'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn small ghost" onClick={() => editCat(c)}>Изм.</button>{' '}
                    <button className="btn small ghost" onClick={() => deleteCat(c)}>Удл.</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Категории (аренда, зарплата, материалы…) нужны для структуры расходов в ОПиУ.</p>
        </div>
      )}
      <div className="kpi-grid">
        <div className={`kpi ${cf.balance >= 0 ? 'good' : 'warn'}`}><div className="v">{fmt(cf.balance)} ₸</div><div className="l">Остаток в кассе</div></div>
        <div className="kpi"><div className="v">{fmt(pnl.income)} ₸</div><div className="l">Доход (всего)</div></div>
        <div className="kpi"><div className="v">{fmt(pnl.total_expenses)} ₸</div><div className="l">Расход (всего)</div></div>
        <div className={`kpi ${pnl.net_profit >= 0 ? 'good' : 'warn'}`}><div className="v">{fmt(pnl.net_profit)} ₸</div><div className="l">Чистая прибыль (ОПиУ)</div></div>
        <div className="kpi"><div className="v">{pnl.profitability_percent}%</div><div className="l">Рентабельность</div></div>
        <div className="kpi"><div className="v">{fmt(forecast.expected_total)} ₸</div><div className="l">Ожидаемые поступления (воронка)</div></div>
      </div>

      <div className="grid2">
        <div className="card stitch">
          <h2>ДДС / Cash Flow — по месяцам</h2>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={cf.series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3e1d9" />
              <XAxis dataKey="month" fontSize={11} /><YAxis fontSize={10} tickFormatter={v => v / 1000 + 'k'} />
              <Tooltip formatter={v => fmt(v) + ' ₸'} /><Legend />
              <Area dataKey="income" name="Доход" stroke="#2e4a8f" fill="#2e4a8f33" />
              <Area dataKey="expense" name="Расход" stroke="#b03030" fill="#b0303022" />
              <Area dataKey="balance" name="Остаток (нараст.)" stroke="#d97b29" fill="transparent" strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="card stitch">
          <h2>Структура расходов</h2>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
            <ResponsiveContainer width={isMobile ? '100%' : '55%'} height={230}>
              <PieChart>
                <Pie data={pnl.expenses} dataKey="total" nameKey="category" innerRadius={45} outerRadius={85}>
                  {pnl.expenses.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={v => fmt(v) + ' ₸'} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 13 }}>
              {pnl.expenses.map((e, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, background: COLORS[i % COLORS.length], borderRadius: 3, marginRight: 6 }} />
                  {e.category}: <b>{fmt(e.total)}</b> <span className="muted">({e.kind === 'fixed' ? 'постоянные' : 'переменные'})</span>
                </div>
              ))}
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--line)' }}>
                Постоянные: <b>{fmt(pnl.fixed_total)}</b> · Переменные: <b>{fmt(pnl.variable_total)}</b>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Ожидаемые поступления (прогноз по воронке)</h2>
        <table>
          <thead><tr><th>Договор</th><th>Клиент</th><th>Статус</th><th className="num">Остаток</th><th className="num">Вероятность</th><th className="num">Взвешенно</th></tr></thead>
          <tbody>
            {forecast.funnel.map((f, i) => (
              <tr key={i}><td>{f.contract}</td><td>{f.customer}</td><td>{f.status}</td>
                <td className="num">{fmt(f.remaining)}</td><td className="num">{(f.probability * 100).toFixed(0)}%</td>
                <td className="num" style={{ fontWeight: 700 }}>{fmt(f.weighted)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card stitch">
        <h2>Новая операция</h2>
        <div className="formrow">
          <div><label className="f">Тип</label>
            <select value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })}>
              <option value="in">Поступление</option><option value="out">Расход</option>
            </select></div>
          <div><label className="f">Сумма</label><input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
          <div><label className="f">Дата</label><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
          <div><label className="f">Категория (для расходов)</label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              <option value="">—</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div><label className="f">Договор</label>
            <select value={form.contract} onChange={e => setForm({ ...form, contract: e.target.value })}>
              <option value="">—</option>{contracts.map(c => <option key={c.id} value={c.id}>{c.number}</option>)}
            </select></div>
          <div><label className="f">Описание</label><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={add} disabled={!form.amount}>Добавить</button></div>
        </div>
        <table>
          <thead><tr><th>Дата</th><th>Тип</th><th className="num">Сумма</th><th>Категория</th><th>Договор</th><th>Описание</th><th /></tr></thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id}><td>{e.date}</td>
                <td>{e.direction === 'in' ? <span className="pill ok">приход</span> : <span className="pill low">расход</span>}</td>
                <td className="num">{fmt(e.amount)}</td><td>{e.category_name || '—'}</td><td>{e.contract_number || '—'}</td><td>{e.description}</td>
                <td><button className="btn small ghost" onClick={() => delEntry(e.id)}>Удл.</button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
