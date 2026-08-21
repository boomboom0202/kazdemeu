import React from 'react'

/**
 * Раньше страницы при незагруженных данных возвращали null — экран
 * оставался пустым, и отличить «ещё грузится» от «сломалось» было нельзя.
 */
export function Loader({ text = 'Загрузка…' }) {
  return (
    <div className="statebox">
      <div className="spinner" />
      <div className="muted">{text}</div>
    </div>
  )
}

export function LoadError({ onRetry, text = 'Не удалось загрузить данные.' }) {
  return (
    <div className="statebox">
      <div style={{ fontWeight: 700 }}>{text}</div>
      <div className="muted" style={{ maxWidth: 340, textAlign: 'center' }}>
        Сервис мог «уснуть» после простоя — первое обращение к нему занимает
        до минуты. Попробуйте ещё раз.
      </div>
      {onRetry && <button className="btn" onClick={onRetry}>Повторить</button>}
    </div>
  )
}
