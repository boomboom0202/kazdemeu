import React, { useCallback, useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { api, can, canAny } from './api'
import Login from './pages/Login'
import Tenders from './pages/Tenders'
import Contracts from './pages/Contracts'
import ContractDetail from './pages/ContractDetail'
import Workshop from './pages/workshop/Workshop'
import Warehouse from './pages/Warehouse'
import Finance from './pages/Finance'
import Analytics from './pages/Analytics'
import Chat from './pages/Chat'
import Admin from './pages/Admin'
import Notifications from './components/Notifications'
import { Loader, LoadError } from './components/Loader'

// Меню повторяет порядок работы: тендер → договор → цех → склад → деньги
const MENU = [
  ['/tenders', 'Тендеры / План закупок', (u) => canAny(u, 'tenders')],
  ['/contracts', 'Договоры', (u) => can(u, 'contracts.contracts')],
  ['/workshop', 'Цех', (u) => canAny(u, 'workshop')],
  ['/warehouse', 'Склад', (u) => canAny(u, 'warehouse')],
  ['/finance', 'Финансы', (u) => canAny(u, 'finance')],
  ['/analytics', 'Аналитика', (u) => can(u, 'analytics')],
  ['/chat', 'AI-ассистент', () => true],
  ['/admin', 'Администрирование', (u) => u?.role === 'admin'],
]

function Layout({ user, onLogout, children }) {
  const [navOpen, setNavOpen] = useState(false)
  const close = () => setNavOpen(false)

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
        <nav className="nav" onClick={close}>
          {MENU.filter(([, , ok]) => ok(user)).map(([to, label]) => (
            <NavLink key={to} to={to}>{label}</NavLink>
          ))}
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

/** Стартовая страница — первый доступный раздел по порядку работы. */
function Home({ user }) {
  const first = MENU.find(([, , ok]) => ok(user))
  return <Navigate to={first ? first[0] : '/chat'} replace />
}

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [meFailed, setMeFailed] = useState(false)
  const navigate = useNavigate()
  const authed = !!localStorage.getItem('access')

  // Профиль определяет, какие разделы показывать. Сбой загрузки виден
  // и повторяется, а не превращается в меню из двух пунктов.
  const loadMe = useCallback(() => {
    setLoading(true)
    setMeFailed(false)
    api.get('/me/')
      .then(r => setUser(r.data))
      .catch(() => setMeFailed(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!authed) { setLoading(false); return }
    loadMe()
  }, [authed, loadMe])

  const logout = () => { localStorage.clear(); setUser(null); navigate('/login') }

  if (!authed) return (
    <Routes>
      <Route path="/login" element={<Login onLogin={setUser} />} />
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  )
  if (loading) return <Loader text="Загружаем рабочее место…" />
  if (meFailed) return <LoadError onRetry={loadMe} text="Не удалось загрузить профиль." />

  return (
    <Layout user={user} onLogout={logout}>
      <Routes>
        <Route path="/" element={<Home user={user} />} />
        <Route path="/tenders" element={<Tenders user={user} />} />
        <Route path="/contracts" element={<Contracts user={user} />} />
        <Route path="/contracts/:id" element={<ContractDetail user={user} />} />
        <Route path="/workshop/*" element={<Workshop user={user} />} />
        <Route path="/warehouse" element={<Warehouse user={user} />} />
        <Route path="/finance" element={<Finance user={user} />} />
        <Route path="/analytics" element={<Analytics user={user} />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/login" element={<Navigate to="/" />} />
        <Route path="*" element={<Home user={user} />} />
      </Routes>
    </Layout>
  )
}
