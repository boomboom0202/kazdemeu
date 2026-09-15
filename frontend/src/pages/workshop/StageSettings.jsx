import React, { useEffect, useState } from 'react'
import { api, apiError, canEdit, STAGE_KINDS } from '../../api'
import { Loader, LoadError } from '../../components/Loader'

/**
 * Настройка этапов цеха: какие этапы есть, в каком порядке, какой у каждого лист.
 * Порядок общий для всех заказов. Галочка «в новых заказах» — отмечен ли этап
 * по умолчанию при запуске в цех.
 */
export default function StageSettings({ user, onChange }) {
  const ro = !canEdit(user, 'workshop.stages')
  const [rows, setRows] = useState(null)
  const [failed, setFailed] = useState(false)
  const [form, setForm] = useState({ name: '', kind: 'count', extra_label: '' })

  const load = () => {
    setFailed(false)
    api.get('/stage-templates/?page_size=100').then(r => setRows(r.data.results || [])).catch(() => setFailed(true))
  }
  useEffect(load, [])

  if (failed) return <LoadError onRetry={load} />
  if (!rows) return <Loader />

  const run = async (fn) => { try { await fn(); load(); onChange && onChange() } catch (e) { alert(apiError(e)); load() } }
  const move = (i, d) => {
    const ids = rows.map(r => r.id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    run(() => api.post('/stage-templates/reorder/', { ids }))
  }
  const patch = (t, body) => run(() => api.patch(`/stage-templates/${t.id}/`, body))

  return (
    <div className={ro ? 'readonly' : ''}>
      {ro && <div className="ro-note"><b>Только просмотр.</b>&nbsp;Этапы настраивает технолог цеха.</div>}
      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap"><table>
          <thead><tr><th>Порядок</th><th>Этап</th><th>Вид листа</th><th>Доп. колонка</th><th>В новых заказах</th><th className="num">Заказов</th><th /></tr></thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={t.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn small ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>{' '}
                  <button className="btn small ghost" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
                </td>
                <td><input defaultValue={t.name} style={{ minWidth: 140 }} onBlur={e => e.target.value.trim() && e.target.value !== t.name && patch(t, { name: e.target.value.trim() })} /></td>
                <td><select value={t.kind} onChange={e => patch(t, { kind: e.target.value })} style={{ minWidth: 220 }}>
                  {Object.entries(STAGE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></td>
                <td>{t.kind === 'sewing' ? <span className="muted">—</span>
                  : <input defaultValue={t.extra_label} placeholder="нет" style={{ width: 120 }} onBlur={e => e.target.value !== t.extra_label && patch(t, { extra_label: e.target.value })} />}</td>
                <td><input type="checkbox" style={{ width: 'auto' }} checked={t.is_active} onChange={e => patch(t, { is_active: e.target.checked })} /></td>
                <td className="num">{t.orders_count}</td>
                <td><button className="btn small ghost" onClick={() => confirm(`Удалить этап «${t.name}»?`) && run(() => api.delete(`/stage-templates/${t.id}/`))}>Удл.</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      <div className="card stitch">
        <h2>Новый этап</h2>
        <div className="formrow">
          <div><label className="f">Название</label><input value={form.name} placeholder="Петля и кнопка" onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div style={{ flex: 2 }}><label className="f">Вид листа</label>
            <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(STAGE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          {form.kind !== 'sewing' && <div><label className="f">Доп. колонка</label><input value={form.extra_label} placeholder="Вид, Операция" onChange={e => setForm({ ...form, extra_label: e.target.value })} /></div>}
          <div style={{ alignSelf: 'flex-end' }}><button className="btn" disabled={!form.name.trim()} onClick={() => run(async () => {
            await api.post('/stage-templates/', { ...form, name: form.name.trim(), position: rows.length })
            setForm({ name: '', kind: 'count', extra_label: '' })
          })}>Добавить</button></div>
        </div>
        <p className="muted">
          Этап встаёт в конец — поднимите его стрелками на своё место. Через этап нельзя провести больше,
          чем прошло предыдущий: упаковать больше, чем почищено, не получится. Этап, по которому есть записи,
          не удаляется и не меняет вид листа — его можно выключить из новых заказов.
        </p>
      </div>
    </div>
  )
}
