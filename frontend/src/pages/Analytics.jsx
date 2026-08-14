import React, { useEffect, useState } from 'react'
import { api, fmt } from '../api'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { CONTRACT_STATUS } from '../api'

export default function Analytics() {
  const [products, setProducts] = useState([])
  const [cs, setCs] = useState(null)
  const [sv, setSv] = useState(null)
  useEffect(() => {
    api.get('/analytics/products/').then(r => setProducts(r.data))
    api.get('/analytics/contracts/').then(r => setCs(r.data))
    api.get('/analytics/stock-value/').then(r => setSv(r.data))
  }, [])

  return (
    <div>
      <div className="pagehead"><h1>Аналитика</h1></div>

      {cs && (
        <div className="kpi-grid">
          <div className="kpi"><div className="v">{cs.open}</div><div className="l">Открытые договоры</div></div>
          <div className="kpi good"><div className="v">{cs.closed}</div><div className="l">Закрытые</div></div>
          <div className={`kpi ${cs.overdue ? 'warn' : ''}`}><div className="v">{cs.overdue}</div><div className="l">Просроченные</div></div>
          <div className="kpi"><div className="v">{cs.cancelled}</div><div className="l">Отменённые</div></div>
          <div className="kpi"><div className="v">{fmt(cs.total_amount)} ₸</div><div className="l">Портфель договоров</div></div>
        </div>
      )}

      {sv && (
        <div className="card stitch">
          <h2>Готовая продукция на складе — на какую сумму лежит</h2>
          <div className="kpi-grid" style={{ marginBottom: 12 }}>
            <div className="kpi"><div className="v">{sv.total_qty}</div><div className="l">Изделий на складе, шт</div></div>
            <div className="kpi"><div className="v">{fmt(sv.total_value_cost)} ₸</div><div className="l">По себестоимости (заморожено)</div></div>
            <div className="kpi good"><div className="v">{fmt(sv.total_value_price)} ₸</div><div className="l">По цене продажи</div></div>
            <div className="kpi"><div className="v">{fmt(sv.potential_margin)} ₸</div><div className="l">Потенциальная прибыль</div></div>
          </div>
          <table>
            <thead><tr><th>Изделие</th><th>SKU</th><th className="num">Кол-во</th>
              <th className="num">Себест./ед.</th><th className="num">Цена/ед.</th>
              <th className="num">Сумма по себест.</th><th className="num">Сумма по цене</th></tr></thead>
            <tbody>
              {sv.items.map(i => (
                <tr key={i.id}>
                  <td style={{ fontWeight: 700 }}>{i.name}</td><td>{i.sku}</td>
                  <td className="num">{i.qty}</td>
                  <td className="num">{fmt(i.cost_price)}</td><td className="num">{fmt(i.base_price)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{fmt(i.value_cost)}</td>
                  <td className="num">{fmt(i.value_price)}</td>
                </tr>
              ))}
              {sv.items.length === 0 && <tr><td colSpan={7} className="muted">Склад готовой продукции пуст.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <div className="card stitch">
        <h2>Рейтинг ликвидности (по количеству продаж)</h2>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={products} layout="vertical" margin={{ left: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e3e1d9" />
            <XAxis type="number" fontSize={11} />
            <YAxis type="category" dataKey="name" width={190} fontSize={12} />
            <Tooltip />
            <Bar dataKey="sold_qty" name="Продано, шт" fill="#2e4a8f" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr>
            <th>Изделие</th><th className="num">Продано</th><th className="num">Произведено</th><th className="num">На складе</th>
            <th className="num">Цена</th><th className="num">Себестоимость</th>
            <th className="num">Материалы</th><th className="num">Труд</th><th className="num">Накл.</th>
            <th className="num">Маржа</th><th className="num">Маржа %</th><th className="num">Чистая прибыль (оценка)</th>
          </tr></thead>
          <tbody>
            {products.map(p => (
              <tr key={p.id}>
                <td style={{ fontWeight: 700 }}>{p.name}</td>
                <td className="num">{p.sold_qty}</td><td className="num">{p.produced_qty}</td><td className="num">{p.fg_stock}</td>
                <td className="num">{fmt(p.base_price)}</td><td className="num">{fmt(p.cost_price)}</td>
                <td className="num">{fmt(p.material_cost)}</td><td className="num">{fmt(p.labor_cost)}</td><td className="num">{fmt(p.overhead_cost)}</td>
                <td className="num">{fmt(p.margin)}</td>
                <td className="num" style={{ color: p.margin_percent > 30 ? 'var(--green)' : p.margin_percent > 10 ? 'var(--amber)' : 'var(--red)', fontWeight: 700 }}>{p.margin_percent}%</td>
                <td className="num">{fmt(p.net_profit_est)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cs && (
        <div className="card">
          <h2>Договоры по статусам</h2>
          {Object.entries(cs.by_status).map(([k, v]) => (
            <span key={k} className="badge" style={{ background: CONTRACT_STATUS[k]?.color, marginRight: 8 }}>
              {CONTRACT_STATUS[k]?.label}: {v}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
