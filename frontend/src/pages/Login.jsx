import React, { useState } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

export default function Login({ onLogin }) {
  const [username, setU] = useState('')
  const [password, setP] = useState('')
  const [err, setErr] = useState('')
  const navigate = useNavigate()

  const submit = async () => {
    setErr('')
    try {
      const { data } = await axios.post('/api/auth/token/', { username, password })
      localStorage.setItem('access', data.access)
      localStorage.setItem('refresh', data.refresh)
      const me = await api.get('/me/')
      onLogin(me.data)
      navigate('/')
    } catch {
      setErr('Неверный логин или пароль')
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="logo" style={{ color: 'var(--ink)', borderColor: 'var(--line)' }}>Каз<span style={{ color: 'var(--thread)' }}>Демеу</span></div>
        <label className="f">Логин</label>
        <input value={username} onChange={e => setU(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
        <div style={{ height: 10 }} />
        <label className="f">Пароль</label>
        <input type="password" value={password} onChange={e => setP(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
        <div style={{ height: 16 }} />
        <button className="btn" style={{ width: '100%' }} onClick={submit}>Войти</button>
        {err && <div className="error">{err}</div>}
      </div>
    </div>
  )
}
