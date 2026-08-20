import React, { useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { api } from './api'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Contracts from './pages/Contracts'
import ContractDetail from './pages/ContractDetail'
import Production from './pages/Production'
import Warehouse from './pages/Warehouse'
import Finance from './pages/Finance'
import Analytics from './pages/Analytics'
import Chat from './pages/Chat'
import Admin from './pages/Admin'
import Tenders from './pages/Tenders'
import Notifications from './components/Notifications'
import { can } from './api'

function Layout({ user, onLogout, children }) {
  // На ширине ≤900px сайдбар превращается в выдвижное меню
  const [navOpen, setNavOpen] = useState(false)
  const close = () => setNavOpen(false)

  // Пока меню открыто, фон не должен прокручиваться под ним
  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [navOpen])

  return (
    <div className="layout">
      <header className="topbar">
        <button className="burger" onClick={() => setNavOpen(o => !o)} aria-label="Меню" aria-expanded={navOpen}>
          <i />
        </button>
        <div className="logo">Каз<span>Демеу</span></div>
      </header>

      {navOpen && <div className="nav-overlay" onClick={close} />}

      <aside className={navOpen ? 'sidebar open' : 'sidebar'}>
        <div className="logo">Каз<span>Демеу</span></div>
        {/* клик по любому пункту закрывает меню на телефоне */}
        <nav className="nav" onClick={close}>
          <NavLink to="/">Дашборд</NavLink>
          {can(user, 'tenders') && <NavLink to="/tenders">Тендеры / План закупок</NavLink>}
          {can(user, 'contracts') && <NavLink to="/contracts">Договоры</NavLink>}
          {can(user, 'production') && <NavLink to="/production">Производство / Цех</NavLink>}
          {can(user, 'warehouse') && <NavLink to="/warehouse">Склад</NavLink>}
          {can(user, 'finance') && <NavLink to="/finance">Финансы</NavLink>}
          {can(user, 'analytics') && <NavLink to="/analytics">Аналитика</NavLink>}
          <NavLink to="/chat">AI-ассистент</NavLink>
          {user?.role === 'admin' && <NavLink to="/admin">Администрирование</NavLink>}
        </nav>
        <div className="userbox">
          <b>{user?.first_name || user?.username}</b>
          {user?.role_display}
          <br />
          <button className="logout" onClick={onLogout}>Выйти</button>
        </div>
      </aside>

      <main className="main">
        <Notifications />
        {children}
      </main>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const authed = !!localStorage.getItem('access')

  useEffect(() => {
    if (!authed) { setLoading(false); return }
    api.get('/me/').then(r => setUser(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [authed])

  const logout = () => { localStorage.clear(); setUser(null); navigate('/login') }

  if (loading) return null
  if (!authed) return (
    <Routes>
      <Route path="/login" element={<Login onLogin={setUser} />} />
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  )

  return (
    <Layout user={user} onLogout={logout}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tenders" element={<Tenders user={user} />} />
        <Route path="/contracts" element={<Contracts user={user} />} />
        <Route path="/contracts/:id" element={<ContractDetail user={user} />} />
        <Route path="/production" element={<Production user={user} />} />
        <Route path="/warehouse" element={<Warehouse />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/login" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  )
}
