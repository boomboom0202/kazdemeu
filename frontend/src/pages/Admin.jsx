import React, { useEffect, useState } from 'react'
import { api } from '../api'
import AccessRules from '../components/AccessRules'

const ROLES = {
  admin: 'Администратор', director: 'Директор', manager: 'Менеджер (тендеры/договоры)',
  technologist: 'Технолог', accountant: 'Бухгалтер', warehouse: 'Кладовщик',
  worker: 'Сотрудник цеха', viewer: 'Только просмотр',
}

export default function Admin() {
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState([])
  const [log, setLog] = useState([])
  const [form, setForm] = useState({ username: '', password: '', first_name: '', role: 'worker' })

  const load = () => {
    api.get('/users/?page_size=100').then(r => setUsers(r.data.results || []))
    api.get('/audit-log/?page_size=100').then(r => setLog(r.data.results || []))
  }
  useEffect(load, [])

  const create = async () => {
    await api.post('/users/', form)
    setForm({ username: '', password: '', first_name: '', role: 'worker' }); load()
  }
  const setRole = async (id, role) => { await api.patch(`/users/${id}/`, { role }); load() }

  return (
    <div>
      <div className="pagehead"><h1>Администрирование</h1></div>
      <div className="tabs">
        <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Сотрудники / Роли</button>
        <button className={tab === 'access' ? 'active' : ''} onClick={() => setTab('access')}>Точечные права</button>
        <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>Журнал действий</button>
      </div>

      {tab === 'users' && (
        <>
          <div className="card stitch">
            <h2>Новый сотрудник</h2>
            <div className="formrow">
              <div><label className="f">Логин</label><input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></div>
              <div><label className="f">Имя</label><input value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} /></div>
              <div><label className="f">Пароль</label><input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
              <div><label className="f">Роль</label>
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                  {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={create} disabled={!form.username || !form.password}>Добавить</button></div>
            </div>
            <p className="muted">Роль определяет право записи: менеджер — договоры/каталог, бухгалтер — финансы, кладовщик — склад, сотрудник цеха — этапы производства. Чтение доступно всем.</p>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Логин</th><th>Имя</th><th>Роль</th><th>Активен</th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 700 }}>{u.username}</td>
                    <td>{u.first_name} {u.last_name}</td>
                    <td><select style={{ width: 'auto' }} value={u.role} onChange={e => setRole(u.id, e.target.value)}>
                      {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></td>
                    <td>{u.is_active ? <span className="pill ok">да</span> : <span className="pill low">нет</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'access' && <AccessRules users={users} />}

      {tab === 'log' && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Объект</th></tr></thead>
            <tbody>
              {log.map(l => (
                <tr key={l.id}>
                  <td>{new Date(l.created_at).toLocaleString('ru-RU')}</td>
                  <td>{l.user_name || 'система'}</td>
                  <td><span className={`pill ${l.action === 'delete' ? 'low' : l.action === 'create' ? 'ok' : 'imp'}`}>{l.action}</span></td>
                  <td>{l.model_name}: {l.object_repr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
