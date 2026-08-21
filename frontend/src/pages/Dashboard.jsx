import React, { useCallback, useEffect, useState } from 'react'
import { api, fmt } from '../api'
import { Loader, LoadError } from '../components/Loader'
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts'

export default function Dashboard() {
  const [d, setD] = useState(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    api.get('/analytics/dashboard/').then(r => setD(r.data)).catch(() => setFailed(true))
  }, [])
  useEffect(() => { load() }, [load])

  if (failed && !d) return <LoadError onRetry={load} />
  if (!d) return <Loader />

  return (
    <div>
      <div className="pagehead"><h1>Дашборд</h1></div>
      <div className="kpi-grid">
        {d.show_money && <>
          <div className={`kpi ${d.cash_balance >= 0 ? 'good' : 'warn'}`}>
            <div className="v">{fmt(d.cash_balance)} ₸</div><div className="l">Остаток в кассе (живые деньги)</div>
          </div>
          <div className="kpi"><div className="v">{fmt(d.month_income)} ₸</div><div className="l">Доход за месяц</div></div>
          <div className="kpi"><div className="v">{fmt(d.month_expense)} ₸</div><div className="l">Расход за месяц</div></div>
          <div className={`kpi ${d.month_profit >= 0 ? 'good' : 'warn'}`}>
            <div className="v">{fmt(d.month_profit)} ₸</div><div className="l">Прибыль за месяц</div>
          </div>
        </>}
        <div className="kpi"><div className="v">{d.contracts_open}</div><div className="l">Открытые договоры</div></div>
        <div className={`kpi ${d.contracts_overdue ? 'warn' : ''}`}>
          <div className="v">{d.contracts_overdue}</div><div className="l">Просроченные</div>
        </div>
        <div className="kpi"><div className="v">{d.production_in_progress}</div><div className="l">В работе в цехе (ПЗ)</div></div>
        <div className={`kpi ${d.low_stock_materials ? 'warn' : ''}`}>
          <div className="v">{d.low_stock_materials}</div><div className="l">Материалы с низким остатком</div>
        </div>
      </div>
      {d.show_money && <div className="card stitch">
        <h2>Динамика доходов / расходов / прибыли по месяцам</h2>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={d.monthly_series}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e3e1d9" />
            <XAxis dataKey="month" fontSize={12} />
            <YAxis fontSize={11} tickFormatter={v => (v / 1000) + 'k'} />
            <Tooltip formatter={v => fmt(v) + ' ₸'} />
            <Legend />
            <Bar dataKey="income" name="Доход" fill="#2e4a8f" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expense" name="Расход" fill="#c9c4b8" radius={[4, 4, 0, 0]} />
            <Line dataKey="profit" name="Прибыль" stroke="#d97b29" strokeWidth={2.5} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>}
    </div>
  )
}
