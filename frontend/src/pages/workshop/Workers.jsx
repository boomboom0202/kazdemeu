import React, { useEffect, useState } from 'react'
import { api, fmt } from '../../api'
import { Loader, LoadError } from '../../components/Loader'

/**
 * Кто сколько сделал: по всему цеху — по заказам в работе, в папке договора —
 * всё, что по нему делали. Строка — ответственный сотрудник
 * и те, кого он вписал в записи («Наср + 9»): у бригад своих учётных
 * записей нет, поэтому их пишут руками в листе этапа.
 */
export default function Workers({ contract }) {
  const [rows, setRows] = useState(null)
  const [failed, setFailed] = useState(false)

  const load = () => {
    setFailed(false)
    api.get('/stage-entries/workers/' + (contract ? `?contract=${contract}` : ''))
      .then(r => setRows(r.data)).catch(() => setFailed(true))
  }
  useEffect(load, [contract])

  if (failed) return <LoadError onRetry={load} />
  if (!rows) return <Loader />

  const stages = []
  for (const r of rows) for (const s of r.by_stage) if (!stages.includes(s.name)) stages.push(s.name)

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="toolbar"><b>Кто сколько сделал</b>
        <span className="muted">{contract ? 'по этому договору' : 'по заказам в работе'}; ответственный — из сотрудников, рядом — кого он вписал</span></div>
      <div className="tablewrap"><table className="sheet">
        <thead><tr>
          <th>Ответственный · кто делал</th>
          {stages.map(s => <th key={s} className="num">{s}</th>)}
          <th className="num">Всего</th><th className="num">Шьётся</th>
        </tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={stages.length + 3} className="muted">
            {contract ? 'По договору ещё ничего не записано.' : 'Записей по заказам в работе пока нет.'}</td></tr>}
          {rows.map((r, i) => {
            const by = Object.fromEntries(r.by_stage.map(s => [s.name, s.qty]))
            return (
              <tr key={i}>
                <td><b>{r.label}</b></td>
                {stages.map(s => <td key={s} className="num">{by[s] ? fmt(by[s]) : ''}</td>)}
                <td className="num"><b>{fmt(r.total)}</b></td>
                <td className="num">{r.in_work ? fmt(r.in_work) : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table></div>
      <p className="muted" style={{ padding: '8px 16px 12px' }}>
        На пошиве считается сшитое: выдано × последняя готовность партии. Сотрудники заводятся
        в Администрировании, а кто именно кроил или шил — вписывается в записи этапа.
      </p>
    </div>
  )
}
