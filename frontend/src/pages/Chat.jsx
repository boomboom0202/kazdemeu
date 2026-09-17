import React, { useRef, useState } from 'react'
import { api } from '../api'

export default function Chat({ user }) {
  const connected = user?.ai_enabled !== false
  const [msgs, setMsgs] = useState([{ role: 'assistant', content: 'Здравствуйте! Я отвечаю на вопросы по базе: тендеры, договоры с расходами, цех по этапам, склад и финансы. Например: «Какой договор в минусе?» или «Сколько сшито по Куртке АУП?» В режиме «Тендер» подготовлю ценовое предложение по похожим договорам.' }])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState('chat')
  const [busy, setBusy] = useState(false)
  const bottom = useRef()

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    const next = [...msgs, { role: 'user', content: text }]
    setMsgs(next); setInput(''); setBusy(true)
    try {
      let reply
      if (mode === 'tender') {
        const { data } = await api.post('/ai/tender/', { description: text })
        reply = data.reply
      } else {
        const history = next.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }))
        const { data } = await api.post('/ai/chat/', { messages: history })
        reply = data.reply
      }
      setMsgs(m => [...m, { role: 'assistant', content: reply }])
    } catch (e) {
      setMsgs(m => [...m, { role: 'assistant', content: e.response?.data?.detail || 'Сервер не ответил. Попробуйте ещё раз.' }])
    } finally {
      setBusy(false)
      setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }

  return (
    <div>
      <div className="pagehead">
        <h1>AI-ассистент</h1>
        <div className="tabs" style={{ border: 'none', margin: 0 }}>
          <button className={mode === 'chat' ? 'active' : ''} onClick={() => setMode('chat')}>Вопрос по базе</button>
          <button className={mode === 'tender' ? 'active' : ''} onClick={() => setMode('tender')}>Тендер: ценовое предложение</button>
        </div>
      </div>
      {!connected && <div className="ro-note"><b>AI-ассистент не подключён.</b>&nbsp;Чтобы он заработал,
        администратору нужно добавить на сервер ключ Anthropic. Остальная система работает без него.</div>}
      <div className="chat">
        <div className="msgs">
          {msgs.map((m, i) => <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'ai'}`}>{m.content}</div>)}
          {busy && <div className="msg ai muted">Думаю…</div>}
          <div ref={bottom} />
        </div>
        <div className="inputrow">
          <input
            placeholder={mode === 'tender' ? 'Опишите лот тендера: «300 мед. халатов, бязь, с логотипом»...' : 'Напишите ваш вопрос...'}
            value={input} onChange={e => setInput(e.target.value)} disabled={!connected}
            onKeyDown={e => e.key === 'Enter' && send()} />
          <button className="btn orange" onClick={send} disabled={busy || !connected}>Отправить</button>
        </div>
      </div>
    </div>
  )
}
