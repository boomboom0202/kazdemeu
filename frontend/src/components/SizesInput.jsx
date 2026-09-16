import React, { useEffect, useState } from 'react'
import { fmt } from '../api'

// Размерная сетка ГОСТ: размер — чётный обхват груди, рост — через 6 см
const CHESTS = Array.from({ length: 24 }, (_, i) => 38 + i * 2)      // 38 … 84
const HEIGHTS = Array.from({ length: 20 }, (_, i) => 98 + i * 6)     // 98 … 212
const ONE = 'без размера'

const nums = (s) => (String(s).match(/\d+/g) || []).map(Number)
const split = (s) => { const n = nums(s); return { chest: n.filter(x => x < 90), height: n.filter(x => x >= 90) } }

/** Разложить размеры заказа обратно на сетку: диапазоны, шаг и заполненные клетки. */
function fromExisting(existing) {
  const cells = {}, cs = [], hs = []
  let noSize = false, noSizeQty = '', chestStep = 1, heightStep = 1, withHeight = 0, withoutHeight = 0
  for (const z of existing || []) {
    if (z.size === ONE) { noSize = true; noSizeQty = String(z.planned); continue }
    const { chest, height } = split(z.size)
    if (!chest.length) continue
    if (chest.length > 1) chestStep = 2
    if (height.length > 1) heightStep = 2
    if (height.length) withHeight++; else withoutHeight++
    cells[z.size] = String(z.planned)
    cs.push(...chest); hs.push(...height)
  }
  return {
    cells, noSize, noSizeQty, chestStep, heightStep,
    noHeight: withoutHeight > 0 && withHeight === 0,
    c1: cs.length ? Math.min(...cs) : 44, c2: cs.length ? Math.max(...cs) : 60,
    h1: hs.length ? Math.min(...hs) : 158, h2: hs.length ? Math.max(...hs) : 188,
  }
}

/**
 * Размеры заказа — сеткой «размер × рост»: вписываются только количества,
 * поэтому размер нельзя написать с ошибкой и один и тот же размер не появится
 * дважды в разном написании. Изделия без размерного ряда — галочка «без размера».
 * Наружу отдаётся тот же столбик «размер - количество», который принимает система.
 */
export default function SizesInput({ onChange, existing, contractQty, onValidity }) {
  const [s, setS] = useState(() => fromExisting(existing))
  const set = (patch) => setS(v => ({ ...v, ...patch }))
  const cell = (k, v) => setS(st => ({ ...st, cells: { ...st.cells, [k]: v } }))

  const chests = [], heights = []
  for (let c = s.c1; c + 2 * (s.chestStep - 1) <= s.c2; c += 2 * s.chestStep)
    chests.push(s.chestStep === 1 ? String(c) : `${c}-${c + 2}`)
  if (s.noHeight) heights.push(null)
  else for (let h = s.h1; h + 6 * (s.heightStep - 1) <= s.h2; h += 6 * s.heightStep)
    heights.push(s.heightStep === 1 ? String(h) : `${h}-${h + 6}`)

  const key = (c, h) => (h ? `${c}/${h}` : c)
  const qty = (k) => Number(s.cells[k]) || 0
  const inGrid = new Set(chests.flatMap(c => heights.map(h => key(c, h))))
  // размеры заказа, не попавшие в выбранные диапазоны: их видно, но они остаются как есть
  const others = Object.entries(s.cells).filter(([k, v]) => !inGrid.has(k) && Number(v) > 0)

  const lines = s.noSize
    ? (Number(s.noSizeQty) > 0 ? [[ONE, Number(s.noSizeQty)]] : [])
    : Object.entries(s.cells).map(([k, v]) => [k, Number(v) || 0]).filter(([, q]) => q > 0)
  const total = lines.reduce((a, [, q]) => a + q, 0)
  const text = lines.map(([k, q]) => `${k} - ${q}`).join('\n')

  useEffect(() => { onChange(text); onValidity && onValidity(total > 0, total) }, [text])

  return (
    <div className="sizes">
      <label className="check" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={s.noSize} onChange={e => set({
          noSize: e.target.checked,
          noSizeQty: e.target.checked && !s.noSizeQty && contractQty ? String(contractQty) : s.noSizeQty,
        })} />
        <b>Без размера</b> — изделие без размерного ряда, одна строка на всё количество
      </label>

      {s.noSize ? (
        <div className="formrow" style={{ maxWidth: 260 }}>
          <div><label className="f">Штук</label>
            <input type="number" min="1" value={s.noSizeQty} placeholder={contractQty || '980'}
              onChange={e => set({ noSizeQty: e.target.value })} /></div>
        </div>
      ) : (
        <div className="sizegrid">
          <div className="formrow">
            <div><label className="f">Размеры от</label>
              <select value={s.c1} onChange={e => set({ c1: Number(e.target.value) })}>
                {CHESTS.map(c => <option key={c}>{c}</option>)}</select></div>
            <div><label className="f">до</label>
              <select value={s.c2} onChange={e => set({ c2: Number(e.target.value) })}>
                {CHESTS.map(c => <option key={c}>{c}</option>)}</select></div>
            <div><label className="f">Размеры идут</label>
              <select value={s.chestStep} onChange={e => set({ chestStep: Number(e.target.value) })}>
                <option value={1}>по одному</option>
                <option value={2}>парами: 56-58</option></select></div>
            <div><label className="f">Рост от</label>
              <select value={s.h1} disabled={s.noHeight} onChange={e => set({ h1: Number(e.target.value) })}>
                {HEIGHTS.map(h => <option key={h}>{h}</option>)}</select></div>
            <div><label className="f">до</label>
              <select value={s.h2} disabled={s.noHeight} onChange={e => set({ h2: Number(e.target.value) })}>
                {HEIGHTS.map(h => <option key={h}>{h}</option>)}</select></div>
            <div><label className="f">Рост идёт</label>
              <select value={s.heightStep} disabled={s.noHeight} onChange={e => set({ heightStep: Number(e.target.value) })}>
                <option value={1}>по одному</option>
                <option value={2}>парами: 170-176</option></select></div>
            <div style={{ alignSelf: 'flex-end' }}>
              <label className="check"><input type="checkbox" checked={s.noHeight}
                onChange={e => set({ noHeight: e.target.checked })} />без роста</label></div>
          </div>

          <div className="tablewrap" style={{ maxHeight: 460 }}><table className="sheet mini">
            <thead><tr>
              <th>Размер · рост</th>
              {heights.map(h => <th key={h || 'x'} className="num">{h || 'штук'}</th>)}
              <th className="num">Итого</th>
            </tr></thead>
            <tbody>
              {chests.map(c => {
                const row = heights.reduce((a, h) => a + qty(key(c, h)), 0)
                return (
                  <tr key={c}>
                    <td><b>{c}</b></td>
                    {heights.map(h => (
                      <td key={h || 'x'}><input type="number" min="0" className="cellin"
                        value={s.cells[key(c, h)] || ''} onChange={e => cell(key(c, h), e.target.value)} /></td>
                    ))}
                    <td className="num">{row || ''}</td>
                  </tr>
                )
              })}
              <tr className="total">
                <td>Итого</td>
                {heights.map(h => <td key={h || 'x'} className="num">
                  {chests.reduce((a, c) => a + qty(key(c, h)), 0) || ''}</td>)}
                <td className="num">{fmt(total)}</td>
              </tr>
            </tbody>
          </table></div>
        </div>
      )}

      <div className="muted" style={{ marginTop: 8 }}>
        {total > 0 ? <>Итого <b>{fmt(total)}</b> шт
          {contractQty ? <> из {fmt(contractQty)} по договору
            {total !== contractQty && <span className="neg"> — не сходится на {fmt(Math.abs(contractQty - total))}</span>}</> : null}</>
          : <>Впишите количества в сетку — или поставьте «без размера», если размерного ряда нет
            {contractQty ? <> (по договору {fmt(contractQty)} шт)</> : null}.</>}
      </div>
      {others.length > 0 && (
        <div className="muted" style={{ marginTop: 4 }}>
          Ещё в заказе, вне выбранных диапазонов: {others.map(([k, v]) => `${k} — ${v} шт`).join(', ')}.
        </div>
      )}
    </div>
  )
}
