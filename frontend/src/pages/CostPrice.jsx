import React, { useCallback, useEffect, useState } from 'react'
import { api, fmt, fmtD, apiError, can, canEdit } from '../api'
import { Loader, LoadError } from '../components/Loader'

/**
 * Себестоимость. Раньше постоянные расходы были спрятаны за кнопкой внутри
 * «Финансов»; здесь они на отдельной странице вместе с настройками
 * распределения и разбором расчёта по каждому изделию.
 */
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const monthName = (ym) => {
  const [y, m] = (ym || '').split('-')
  return MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y}` : ym
}

export default function CostPrice({ user }) {
  // три блока страницы — три отдельных права
  const seeFixed = can(user, 'finance.fixed')
  const roFixed = !canEdit(user, 'finance.fixed')
  const seeSettings = can(user, 'finance.settings')
  const roSettings = !canEdit(user, 'finance.settings')
  const seeProducts = can(user, 'analytics')
  const [cs, setCs] = useState(null)
  const [fixed, setFixed] = useState([])
  const [cats, setCats] = useState([])
  const [rows, setRows] = useState([])
  const [failed, setFailed] = useState(false)
  const [form, setForm] = useState({ name: '', monthly_amount: '', category: '' })
  const [pf, setPf] = useState(null)   // сверка норматива с фактическими выплатами

  const load = useCallback(() => {
    setFailed(false)
    const jobs = []
    if (seeSettings) jobs.push(api.get('/cost-settings/').then(r => setCs(r.data)))
    if (seeFixed) jobs.push(
      api.get('/fixed-costs/?page_size=200').then(r => setFixed(r.data.results || [])),
      api.get('/expense-categories/?page_size=100').then(r => setCats(r.data.results || [])),
      api.get('/reports/fixed-costs-fact/').then(r => setPf(r.data)))
    if (seeProducts) jobs.push(api.get('/analytics/products/').then(r => setRows(r.data)))
    Promise.all(jobs).catch(() => setFailed(true))
  }, [seeSettings, seeFixed, seeProducts])
  useEffect(() => { load() }, [load])

  const add = async () => {
    try {
      await api.post('/fixed-costs/', { ...form, category: form.category || null })
      setForm({ name: '', monthly_amount: '', category: '' })
      load()
    } catch (e) {
      alert(apiError(e))
    }
  }
  const patch = async (id, body) => { await api.patch(`/fixed-costs/${id}/`, body); load() }
  const del = async (f) => {
    if (!confirm(`Удалить постоянный расход «${f.name}»?`)) return
    await api.delete(`/fixed-costs/${f.id}/`)
    load()
  }
  const patchCs = async (body) => {
    const { data } = await api.patch('/cost-settings/', body)
    setCs(data)
    load()
  }

  const settingsPending = seeSettings && !cs
  if (failed && settingsPending) return <LoadError onRetry={load} />
  if (settingsPending) return <Loader />

  const perHour = cs ? cs.method === 'per_hour' : true
  const unit = perHour ? 'нормо-час' : 'шт'

  return (
    <div>
      <div className="pagehead"><h1>Себестоимость</h1></div>

      {cs && <div className="kpi-grid">
        <div className="kpi">
          <div className="v">{fmt(cs.monthly_fixed_total)} ₸</div>
          <div className="l">Постоянные расходы в месяц</div>
        </div>
        <div className="kpi">
          <div className="v">{fmtD(cs.overhead_rate)} ₸</div>
          <div className="l">Ставка накладных за {unit}</div>
        </div>
        <div className="kpi">
          <div className="v">{perHour ? fmt(cs.planned_monthly_hours) : fmt(cs.planned_monthly_units)}</div>
          <div className="l">Плановая база, {perHour ? 'ч/мес' : 'шт/мес'}</div>
        </div>
      </div>}

      {seeFixed && <div className={roFixed ? 'readonly' : ''}><div className="card stitch">
        <h2>1. Постоянные расходы — вводятся один раз</h2>
        <p className="muted">
          Аренда, оклады АУП, коммуналка, интернет. Вносятся один раз и действуют ежемесячно,
          пока включена галочка «Действует». Система сама разносит их в себестоимость каждого
          изделия. Переменные расходы сюда не вносятся: материалы берутся со склада по составу
          изделия, а сдельная оплата задаётся в карточке изделия.
        </p>
        <div className="formrow">
          <div>
            <label className="f">Наименование</label>
            <input value={form.name} placeholder="Аренда цеха"
              onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="f">Сумма в месяц, ₸</label>
            <input type="number" value={form.monthly_amount}
              onChange={e => setForm({ ...form, monthly_amount: e.target.value })} />
          </div>
          <div>
            <label className="f">Категория</label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              <option value="">—</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button className="btn" onClick={add} disabled={!form.name || !form.monthly_amount}>+ Добавить</button>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Наименование</th>
              <th className="num">₸ / месяц</th>
              <th>Категория</th>
              <th>Действует</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fixed.length === 0 && <tr><td colSpan={5} className="muted">Пока ничего не добавлено</td></tr>}
            {fixed.map(f => (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td className="num">
                  <input type="number" style={{ width: 120 }} defaultValue={f.monthly_amount}
                    onBlur={e => patch(f.id, { monthly_amount: e.target.value || 0 })} />
                </td>
                <td>{f.category_name || '—'}</td>
                <td>
                  <input type="checkbox" style={{ width: 'auto' }} checked={f.is_active}
                    onChange={e => patch(f.id, { is_active: e.target.checked })} />
                </td>
                <td><button className="btn small ghost" onClick={() => del(f)}>Удл.</button></td>
              </tr>
            ))}
            {cs && <tr>
              <td><b>Итого действующих</b></td>
              <td className="num"><b>{fmt(cs.monthly_fixed_total)}</b></td>
              <td colSpan={3} />
            </tr>}
          </tbody>
        </table>
      </div>

      {/* Норматив против факта. Себестоимость считается по нормативу — иначе
          в месяц квартального платежа изделие дорожало бы втрое. ОПиУ живёт
          по факту. Расхождение и есть то, ради чего расход вводится дважды. */}
      {pf && pf.rows.length > 0 && <div className="card" style={{ padding: 0, marginTop: 14 }}>
        <div style={{ padding: '13px 16px 0' }}>
          <h2>Норматив и фактические выплаты за {monthName(pf.month)}</h2>
          <p className="muted">Слева — сколько заложено в себестоимость, справа — сколько
            реально ушло со счёта по операциям этой категории в «Финансах». Расхождение
            означает одно из двух: норматив устарел или расход ещё не заведён.</p>
        </div>
        <table>
          <thead><tr>
            <th>Категория</th><th className="num">Норматив, ₸/мес</th>
            <th className="num">Оплачено</th><th className="num">Расхождение</th><th>Что входит</th>
          </tr></thead>
          <tbody>
            {pf.rows.map(r => (
              <tr key={r.category}>
                <td><b>{r.category}</b></td>
                <td className="num">{fmt(r.plan)}</td>
                <td className="num">{r.fact ? fmt(r.fact) : <span className="muted">не заведено</span>}</td>
                <td className="num">
                  {Math.abs(r.diff) < 0.005
                    ? <span className="pill ok">сходится</span>
                    : <b style={{ color: r.diff > 0 ? 'var(--red)' : 'var(--thread)' }}>
                        {r.diff > 0 ? '+' : ''}{fmt(r.diff)}</b>}
                </td>
                <td className="muted">{r.items.join(', ')}</td>
              </tr>
            ))}
            <tr>
              <td><b>Итого</b></td>
              <td className="num"><b>{fmt(pf.plan_total)}</b></td>
              <td className="num"><b>{fmt(pf.fact_total)}</b></td>
              <td className="num"><b>{pf.diff_total > 0 ? '+' : ''}{fmt(pf.diff_total)}</b></td>
              <td />
            </tr>
          </tbody>
        </table>
        {pf.without_category.length > 0 && (
          <p className="muted" style={{ padding: '0 16px 13px' }}>
            Сверить не с чем — не указана категория: {pf.without_category.map(w => w.name).join(', ')}.
            Проставьте её в строке расхода выше, и они появятся в сверке.
          </p>
        )}
      </div>}
      </div>}

      {seeSettings && cs && <div className={roSettings ? 'readonly' : ''}><div className="card stitch">
        <h2>2. Как разносить их по изделиям</h2>
        <p className="muted">
          «На нормо-час» точнее: изделие, которое шьётся дольше, забирает больше накладных.
          «На единицу» проще, но одинаково нагружает и простое, и сложное изделие.
        </p>
        <div className="formrow">
          <div>
            <label className="f">Метод распределения</label>
            <select value={cs.method} onChange={e => patchCs({ method: e.target.value })}>
              <option value="per_hour">На нормо-час (точнее)</option>
              <option value="per_unit">На единицу продукции (проще)</option>
            </select>
          </div>
          {perHour ? (
            <div>
              <label className="f">Плановый фонд времени, ч/мес</label>
              <input type="number" defaultValue={cs.planned_monthly_hours}
                onBlur={e => patchCs({ planned_monthly_hours: e.target.value || 1 })} />
            </div>
          ) : (
            <div>
              <label className="f">Плановый выпуск, шт/мес</label>
              <input type="number" defaultValue={cs.planned_monthly_units}
                onBlur={e => patchCs({ planned_monthly_units: e.target.value || 1 })} />
            </div>
          )}
        </div>
        <div className="comment important" style={{ marginTop: 10 }}>
          <div className="meta">Текущая ставка</div>
          {fmt(cs.monthly_fixed_total)} ₸ ÷ {perHour
            ? `${fmt(cs.planned_monthly_hours)} ч`
            : `${fmt(cs.planned_monthly_units)} шт`}
          {' = '}
          <b>{fmtD(cs.overhead_rate)} ₸ за {unit}</b>
        </div>
      </div></div>}

      {seeProducts && <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 18px 0' }}>
          <h2>3. Что получилось по изделиям</h2>
          <p className="muted">
            Материалы + труд + накладные = себестоимость. Материалы считаются по составу изделия
            и средневзвешенной цене со склада.
          </p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Изделие</th>
              <th className="num">Материалы</th>
              <th className="num">Труд</th>
              <th className="num">Норма, ч</th>
              <th className="num">Накладные</th>
              <th className="num">Себестоимость</th>
              <th className="num">Цена</th>
              <th className="num">Маржа</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="muted">Изделий пока нет</td></tr>}
            {rows.map(r => (
              <tr key={r.id}>
                <td>{r.name}<div className="muted" style={{ fontSize: 11.5 }}>{r.sku}</div></td>
                <td className="num">{fmt(r.material_cost)}</td>
                <td className="num">{fmt(r.labor_cost)}</td>
                <td className="num">{r.norm_hours}</td>
                <td className="num">
                  {fmt(r.overhead_cost)}
                  {r.overhead_override && <div className="pill imp" style={{ fontSize: 10 }}>вручную</div>}
                </td>
                <td className="num"><b>{fmt(r.cost_price)}</b></td>
                <td className="num">{fmt(r.base_price)}</td>
                <td className="num" style={{ color: r.margin_percent >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {r.margin_percent}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </div>
  )
}
