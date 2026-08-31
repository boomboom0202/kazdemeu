import React, { useCallback, useEffect, useState } from 'react'
import { api, apiError } from '../api'
import { Loader } from './Loader'

const LEVELS = [
  { v: '', label: 'По роли' },
  { v: 'none', label: 'Нет доступа' },
  { v: 'read', label: 'Только просмотр' },
  { v: 'write', label: 'Просмотр и изменение' },
]

const LEVEL_TEXT = { none: 'нет доступа', read: 'просмотр', write: 'изменение' }

/**
 * Точечные права: роль задаёт доступ по умолчанию, здесь его уточняют
 * для конкретного человека — целым разделом или отдельной его частью.
 */
export default function AccessRules({ users }) {
  const [userId, setUserId] = useState('')
  const [keys, setKeys] = useState([])
  const [rules, setRules] = useState({})   // key -> {id, level}
  const [perms, setPerms] = useState({})   // key -> {level}
  const [busy, setBusy] = useState(false)

  useEffect(() => { api.get('/access-keys/').then(r => setKeys(r.data)) }, [])

  const load = useCallback(async (id) => {
    if (!id) { setRules({}); setPerms({}); return }
    const [ru, us] = await Promise.all([
      api.get(`/user-access/?user=${id}&page_size=200`),
      api.get(`/users/${id}/`),
    ])
    const map = {}
    for (const r of (ru.data.results || ru.data)) map[r.key] = { id: r.id, level: r.level }
    setRules(map)
    setPerms(us.data.perms || {})
  }, [])

  useEffect(() => { load(userId) }, [userId, load])

  const change = async (key, level) => {
    setBusy(true)
    try {
      const existing = rules[key]
      if (!level) {
        // «По роли» — правило убирается, остаётся то, что даёт роль
        if (existing) await api.delete(`/user-access/${existing.id}/`)
      } else if (existing) {
        await api.patch(`/user-access/${existing.id}/`, { level })
      } else {
        await api.post('/user-access/', { user: userId, key, level })
      }
      await load(userId)
    } catch (e) {
      alert(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  const user = users.find(u => String(u.id) === String(userId))
  const isAdmin = user?.role === 'admin'

  const row = (key, title, indent) => {
    const rule = rules[key]
    const eff = perms[key]?.level
    return (
      <tr key={key}>
        <td style={{ paddingLeft: indent ? 28 : 10, fontWeight: indent ? 400 : 700 }}>
          {title}
          <div className="muted" style={{ fontSize: 11 }}>{key}</div>
        </td>
        <td>
          <select value={rule ? rule.level : ''} disabled={busy || isAdmin}
            onChange={e => change(key, e.target.value)} style={{ minWidth: 180 }}>
            {LEVELS.map(l => <option key={l.v} value={l.v}>{l.label}</option>)}
          </select>
        </td>
        <td>
          {rule
            ? <span className="pill imp">задано вручную</span>
            : <span className="muted">от роли</span>}
        </td>
        <td className={eff === 'none' ? 'muted' : ''}>
          <b>{LEVEL_TEXT[eff] || '—'}</b>
        </td>
      </tr>
    )
  }

  return (
    <>
      <div className="card stitch">
        <h2>Точечные права</h2>
        <p className="muted">
          Роль задаёт доступ по умолчанию. Здесь его можно уточнить для одного человека:
          открыть раздел, которого у его роли нет, или наоборот закрыть часть раздела.
          Правило на часть важнее правила на весь раздел, а любое правило важнее роли.
        </p>
        <div className="formrow">
          <div>
            <label className="f">Сотрудник</label>
            <select value={userId} onChange={e => setUserId(e.target.value)}>
              <option value="">— выберите —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.first_name || u.username} · {u.role_display}
                </option>
              ))}
            </select>
          </div>
        </div>
        {isAdmin && (
          <div className="ro-note">
            <b>Администратор.</b>&nbsp;Его права не ограничиваются — иначе можно
            отобрать доступ к управлению правами и запереть систему.
          </div>
        )}
      </div>

      {userId && keys.length === 0 && <Loader />}

      {userId && keys.map(sec => (
        <div className="card" style={{ padding: 0 }} key={sec.section}>
          <div style={{ padding: '13px 16px 0' }}><h2>{sec.title}</h2></div>
          <table>
            <thead>
              <tr>
                <th>Раздел и его части</th>
                <th>Правило</th>
                <th>Источник</th>
                <th>Итоговый доступ</th>
              </tr>
            </thead>
            <tbody>
              {row(sec.section, 'Весь раздел', false)}
              {sec.areas.map(a => row(a.key, a.title, true))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  )
}
