import React, { useCallback, useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { api, can, canAny } from '../../api'
import Orders from './Orders'
import OrderCard from './OrderCard'
import StageSheet from './StageSheet'
import Workers from './Workers'
import StageSettings from './StageSettings'

/**
 * Цех. Вкладки — это листы отчёта цеха: заказы и по листу на каждый этап
 * (Крой, Вышивка, Тигин…). Число у этапа — сколько штук ждёт его:
 * прошли предыдущий этап, а сюда ещё не взяты.
 */
export default function Workshop({ user }) {
  const [overview, setOverview] = useState([])
  const location = useLocation()

  const reload = useCallback(() => {
    api.get('/stage-templates/overview/').then(r => setOverview(r.data)).catch(() => {})
  }, [])
  useEffect(() => { reload() }, [reload, location.pathname])

  const seeEntries = can(user, 'workshop.entries')

  return (
    <div>
      <div className="pagehead"><h1>Цех</h1></div>
      <nav className="tabs linktabs">
        {can(user, 'workshop.orders') && <NavLink end to="/workshop">Заказы</NavLink>}
        {seeEntries && overview.map(t => (
          <NavLink key={t.id} to={`/workshop/stages/${t.id}`}>
            {t.name}{t.waiting > 0 && <span className="tabcount" title="ждут этапа, шт">{t.waiting}</span>}
          </NavLink>
        ))}
        {seeEntries && <NavLink to="/workshop/workers">Исполнители</NavLink>}
        {can(user, 'workshop.stages') && <NavLink to="/workshop/settings">Настройка этапов</NavLink>}
      </nav>
      {!canAny(user, 'workshop') && <p className="muted">Цех вам не открыт.</p>}
      <Routes>
        <Route index element={<Orders user={user} overview={overview} />} />
        <Route path="orders/:id" element={<OrderCard user={user} onChange={reload} />} />
        <Route path="stages/:id" element={<StageSheet user={user} onChange={reload} />} />
        <Route path="workers" element={<Workers />} />
        <Route path="settings" element={<StageSettings user={user} onChange={reload} />} />
      </Routes>
    </div>
  )
}
