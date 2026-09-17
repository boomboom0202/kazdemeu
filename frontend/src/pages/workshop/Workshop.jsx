import React from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { can, canAny } from '../../api'
import ContractsBoard from './ContractsBoard'
import ContractShop from './ContractShop'
import OrderCard from './OrderCard'
import Workers from './Workers'
import StageSettings from './StageSettings'

/**
 * Цех. Главная — договоры: у каждого видно, какие изделия шьются и как идут
 * этапы. Проваливаешься в договор — там его изделия, листы этапов
 * (Крой, Вышивка, Тигин…) и исполнители только по этому договору.
 * Заказы без договора — отдельной папкой.
 */
export default function Workshop({ user }) {
  const { pathname } = useLocation()
  const onBoard = pathname === '/workshop' || pathname.startsWith('/workshop/contracts') || pathname.startsWith('/workshop/orders')

  return (
    <div>
      <div className="pagehead"><h1>Цех</h1></div>
      <nav className="tabs linktabs">
        {can(user, 'workshop.orders') && <NavLink to="/workshop" className={onBoard ? 'active' : ''} end>Договоры</NavLink>}
        {can(user, 'workshop.entries') && <NavLink to="/workshop/workers">Исполнители</NavLink>}
        {can(user, 'workshop.stages') && <NavLink to="/workshop/settings">Настройка этапов</NavLink>}
      </nav>
      {!canAny(user, 'workshop') && <p className="muted">Цех вам не открыт.</p>}
      <Routes>
        <Route index element={<ContractsBoard />} />
        <Route path="contracts/:cid/*" element={<ContractShop user={user} />} />
        <Route path="orders/:id" element={<OrderCard user={user} />} />
        <Route path="workers" element={<Workers />} />
        <Route path="settings" element={<StageSettings user={user} />} />
      </Routes>
    </div>
  )
}
