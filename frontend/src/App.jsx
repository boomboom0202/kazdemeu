import React, { useCallback, useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { api } from './api'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Contracts from './pages/Contracts'
import ContractDetail from './pages/ContractDetail'
import Production from './pages/Production'
import Warehouse from './pages/Warehouse'
import Finance from './pages/Finance'
import CostPrice from './pages/CostPrice'
import Analytics from './pages/Analytics'
import Chat from './pages/Chat'
import Admin from './pages/Admin'
import Tenders from './pages/Tenders'
import Notifications from './components/Notifications'
import { Loader, LoadError } from './components/Loader'
import { canAny } from './api'

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
          {canAny(user, 'tenders') && <NavLink to="/tenders">Тендеры / План закупок</NavLink>}
          {canAny(user, 'contracts') && <NavLink to="/contracts">Договоры</NavLink>}
          {canAny(user, 'production') && <NavLink to="/production">Производство / Цех</NavLink>}
          {canAny(user, 'warehouse') && <NavLink to="/warehouse">Склад</NavLink>}
          {canAny(user, 'finance') && <NavLink to="/finance">Финансы</NavLink>}
          {canAny(user, 'finance') && <NavLink to="/cost-price">Себестоимость</NavLink>}
          {canAny(user, 'analytics') && <NavLink to="/analytics">Аналитика</NavLink>}
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
  const [meFailed, setMeFailed] = useState(false)
  const navigate = useNavigate()
  const authed = !!localStorage.getItem('access')

  // Профиль определяет, какие разделы показывать в меню: пункты скрыты
  // через can(user, ...). Раньше ошибка этого запроса молча гасилась,
  // user оставался null, все проверки прав давали false — и приложение
  // рисовалось с меню из двух пунктов. Теперь сбой виден и его можно
  // повторить, не перезагружая страницу.
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
        <Route path="/" element={<Dashboard />} />
        <Route path="/tenders" element={<Tenders user={user} />} />
        <Route path="/contracts" element={<Contracts user={user} />} />
        <Route path="/contracts/:id" element={<ContractDetail user={user} />} />
        <Route path="/production" element={<Production user={user} />} />
        <Route path="/warehouse" element={<Warehouse user={user} />} />
        <Route path="/finance" element={<Finance user={user} />} />
        <Route path="/cost-price" element={<CostPrice user={user} />} />
        <Route path="/analytics" element={<Analytics user={user} />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/login" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  )
}
