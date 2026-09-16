import React, { useEffect, useState } from 'react'
import { api, fmt, apiError, canEdit } from '../../api'
import { Loader, LoadError } from '../../components/Loader'

/** Бригады пошива: сколько у кого в работе и сколько сшито.
 *  Оплата бригадам — это расход договора, вид «Пошив, крой, вышивка». */
export default function Brigades({ user }) {
  const ro = !canEdit(user, 'workshop.brigades')
  const [rows, setRows] = useState(null)
  const [failed, setFailed] = useState(false)
  const [form, setForm] = useState({ leader: '', people: '' })

  const load = () => {
    setFailed(false)
    api.get('/brigades/?page_size=500').then(r => setRows(r.data.results || [])).catch(() => setFailed(true))
  }
  useEffect(load, [])

  if (failed) return <LoadError onRetry={load} />
  if (!rows) return <Loader />

  const run = async (fn) => { try { await fn(); load() } catch (e) { alert(apiError(e)) } }

  return (
    <div className={ro ? 'readonly' : ''}>
      {ro && <div className="ro-note"><b>Только просмотр.</b>&nbsp;Бригады ведёт технолог цеха.</div>}
      <div className="card stitch">
        <h2>Новая бригада</h2>
        <div className="formrow">
          <div><label className="f">Бригадир</label>
            <input value={form.leader} placeholder="Наср" onChange={e => setForm({ ...form, leader: e.target.value })} /></div>
          <div><label className="f">Людей с ним</label>
            <input type="number" value={form.people} placeholder="9" onChange={e => setForm({ ...form, people: e.target.value })} /></div>
          <div style={{ alignSelf: 'flex-end' }}><button className="btn" disabled={!form.leader}
            onClick={() => run(async () => { await api.post('/brigades/', { leader: form.leader, people: form.people || 0 }); setForm({ leader: '', people: '' }) })}>Добавить</button></div>
        </div>
        <p className="muted">В отчёте цеха пишут «Наср + 9 бала» — бригадир и девять человек с ним.</p>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap"><table>
          <thead><tr>
            <th>Бригада</th><th className="num">Партий в работе</th><th className="num">Шьётся, шт</th>
            <th className="num">Сшито всего</th><th>Работает</th><th />
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="muted">Бригад пока нет.</td></tr>}
            {rows.map(b => (
              <tr key={b.id} style={b.is_active ? {} : { opacity: 0.55 }}>
                <td><b>{b.label}</b>{b.note && <div className="muted">{b.note}</div>}</td>
                <td className="num">{b.stats.active_jobs}</td>
                <td className="num">{fmt(b.stats.in_work)}</td>
                <td className="num">{fmt(b.stats.sewn)}</td>
                <td><input type="checkbox" style={{ width: 'auto' }} checked={b.is_active}
                  onChange={e => run(() => api.patch(`/brigades/${b.id}/`, { is_active: e.target.checked }))} /></td>
                <td><button className="btn small ghost" onClick={() => confirm(`Удалить бригаду «${b.label}»?`) &&
                  run(() => api.delete(`/brigades/${b.id}/`))}>Удл.</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  )
}
