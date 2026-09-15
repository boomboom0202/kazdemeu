import React, { useEffect, useRef, useState } from 'react'
import { api, fmt } from '../api'

// Размерная сетка ГОСТ: размер — чётный обхват груди, рост — через 6 см
const CHESTS = Array.from({ length: 24 }, (_, i) => 38 + i * 2)      // 38 … 84
const HEIGHTS = Array.from({ length: 20 }, (_, i) => 98 + i * 6)     // 98 … 212

/**
 * Ввод размеров заказа. Размеры пишут столбиком, как в отчёте цеха, а рядом
 * сразу видно, как каждая строка запишется в заказ: «54-188» станет 54/188,
 * а размер, которого в сетке нет («48/192»), не пройдёт — с объяснением.
 * Проверяет сервер, по тем же правилам, по которым потом записывает.
 */
export default function SizesInput({ value, onChange, orderId, contractQty, onValidity, rows = 7 }) {
  const [check, setCheck] = useState(null)
  const [busy, setBusy] = useState(false)
  const [grid, setGrid] = useState(false)
  const timer = useRef()

  useEffect(() => {
    clearTimeout(timer.current)
    if (!value.trim()) { setCheck(null); setBusy(false); onValidity && onValidity(true, 0); return }
    setBusy(true)
    onValidity && onValidity(false, 0)
    timer.current = setTimeout(() => {
      api.post('/work-orders/check_sizes/', { text: value, order: orderId || null })
        .then(r => { setCheck(r.data); onValidity && onValidity(r.data.errors.length === 0, r.data.rows.length) })
        .catch(() => { setCheck(null); onValidity && onValidity(false, 0) })
        .finally(() => setBusy(false))
    }, 400)
    return () => clearTimeout(timer.current)
  }, [value, orderId])

  const addLines = (lines) => {
    onChange((value.trim() ? value.replace(/\s*$/, '\n') : '') + lines.join('\n'))
    setGrid(false)
  }

  return (
    <div className="sizes">
      <div className="sizes-cols">
        <div>
          <label className="f">Размеры — столбиком: размер/рост и количество</label>
          <textarea rows={rows} value={value} placeholder={'54/176 - 27\n56-58/170-176 - 116\n50 - 10\nXL - 5'}
            onChange={e => onChange(e.target.value)} />
          <p className="muted" style={{ margin: '4px 0 6px' }}>
            Размер — чётный, рост — через 6 см (158, 164, 170…). Можно диапазон <b>56-58/170-176</b>, только
            размер <b>50</b>, буквы <b>S … 6XL</b> или <b>без размера</b>. «54-188», «52|194», «48.182»
            система сама запишет как 54/188, 52/194, 48/182.
          </p>
          <button type="button" className="btn small ghost" onClick={() => setGrid(g => !g)}>
            {grid ? 'Скрыть сетку' : 'Заполнить сеткой размер × рост'}</button>
        </div>
        <div className="sizecheck">
          <label className="f">Как запишется в заказ</label>
          {!value.trim() && <p className="muted">Начните вводить — здесь появятся размеры и ошибки, если они есть.</p>}
          {busy && value.trim() && <p className="muted">Проверяю…</p>}
          {!busy && check && <>
            {check.errors.length > 0 && <ul className="errlist">{check.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
            {check.rows.length > 0 && (
              <div className="tablewrap" style={{ maxHeight: 260 }}><table className="sheet mini">
                <thead><tr><th>Размер</th><th className="num">Шт</th>{orderId && <th />}</tr></thead>
                <tbody>
                  {check.rows.map(r => (
                    <tr key={r.size}><td><b>{r.size}</b></td><td className="num">{r.qty}</td>
                      {orderId && <td className="muted">{r.exists ? 'обновится план' : 'новый'}</td>}</tr>
                  ))}
                </tbody>
              </table></div>
            )}
            <div className="muted" style={{ marginTop: 6 }}>
              Итого <b>{fmt(check.total)}</b> шт
              {contractQty !== null && contractQty !== undefined && <> из {fmt(contractQty)} по договору
                {check.total !== contractQty && <span className="neg"> — не сходится на {fmt(Math.abs(contractQty - check.total))}</span>}</>}
              {check.errors.length > 0 && <span className="neg"> · исправьте ошибки, чтобы записать</span>}
            </div>
          </>}
        </div>
      </div>
      {grid && <SizeGrid onAdd={addLines} />}
    </div>
  )
}

/** Сетка «размер × рост»: вписываете только количества — размеры пишутся без ошибок. */
function SizeGrid({ onAdd }) {
  const [c1, setC1] = useState(44)
  const [c2, setC2] = useState(60)
  const [h1, setH1] = useState(158)
  const [h2, setH2] = useState(188)
  const [noHeight, setNoHeight] = useState(false)
  const [cells, setCells] = useState({})
  const chests = CHESTS.filter(c => c >= c1 && c <= c2)
  const heights = noHeight ? [null] : HEIGHTS.filter(h => h >= h1 && h <= h2)
  const key = (c, h) => (h ? `${c}/${h}` : `${c}`)
  const lines = chests.flatMap(c => heights.map(h => [key(c, h), Number(cells[key(c, h)])]))
    .filter(([, q]) => q > 0).map(([k, q]) => `${k} - ${q}`)
  const total = lines.reduce((a, l) => a + Number(l.split(' - ')[1]), 0)

  return (
    <div className="sizegrid">
      <div className="formrow">
        <div><label className="f">Размеры от</label>
          <select value={c1} onChange={e => setC1(Number(e.target.value))}>{CHESTS.map(c => <option key={c}>{c}</option>)}</select></div>
        <div><label className="f">до</label>
          <select value={c2} onChange={e => setC2(Number(e.target.value))}>{CHESTS.map(c => <option key={c}>{c}</option>)}</select></div>
        <div><label className="f">Рост от</label>
          <select value={h1} disabled={noHeight} onChange={e => setH1(Number(e.target.value))}>{HEIGHTS.map(h => <option key={h}>{h}</option>)}</select></div>
        <div><label className="f">до</label>
          <select value={h2} disabled={noHeight} onChange={e => setH2(Number(e.target.value))}>{HEIGHTS.map(h => <option key={h}>{h}</option>)}</select></div>
        <div style={{ alignSelf: 'flex-end' }}>
          <label className="check"><input type="checkbox" checked={noHeight} onChange={e => setNoHeight(e.target.checked)} />без роста</label></div>
      </div>
      <div className="tablewrap" style={{ maxHeight: 420 }}><table className="sheet mini">
        <thead><tr><th>Размер \ рост</th>{heights.map(h => <th key={h || 'x'} className="num">{h || 'шт'}</th>)}<th className="num">Итого</th></tr></thead>
        <tbody>
          {chests.map(c => (
            <tr key={c}>
              <td><b>{c}</b></td>
              {heights.map(h => (
                <td key={h || 'x'}><input type="number" min="0" className="cellin" value={cells[key(c, h)] || ''}
                  onChange={e => setCells({ ...cells, [key(c, h)]: e.target.value })} /></td>
              ))}
              <td className="num">{heights.reduce((a, h) => a + (Number(cells[key(c, h)]) || 0), 0) || ''}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <button type="button" className="btn small" disabled={!lines.length} onClick={() => onAdd(lines)}>
        Добавить в список: {lines.length} размер(ов), {fmt(total)} шт</button>
    </div>
  )
}
