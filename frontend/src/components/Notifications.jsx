import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { Link } from 'react-router-dom'

export default function Notifications() {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)

  const load = () => api.get('/notifications/?page_size=50').then(r => setItems(r.data.results || []))
  useEffect(() => {
    api.post('/notifications/refresh/').catch(() => {}).finally(load)
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [])

  const unread = items.filter(i => !i.is_read)
  return (
    <div style={{ position: 'relative', display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
      <button className="btn ghost small" style={{ position: 'relative' }} onClick={() => setOpen(o => !o)}>
        Уведомления
        {unread.length > 0 && <span className="notif-dot">{unread.length}</span>}
      </button>
      {open && (
        <div className="card notif-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
            <b>Уведомления</b>
            <button className="btn small ghost" onClick={() => api.post('/notifications/mark_all_read/').then(load)}>Отметить все прочитанными</button>
          </div>
          {items.length === 0 && <div className="notif-item muted">Уведомлений нет</div>}
          {items.map(n => (
            <div key={n.id} className={`notif-item ${n.level}`} style={{ opacity: n.is_read ? 0.55 : 1 }}>
              <div className="t">{n.title}</div>
              <div className="m">{n.message}</div>
              {n.link && <Link to={n.link} onClick={() => setOpen(false)} style={{ fontSize: 12 }}>Открыть →</Link>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
