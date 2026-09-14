import React from 'react'

/** Полоска готовности: скроено → сшито → упаковано, в долях плана. */
export function WorkBar({ t }) {
  const p = (v) => (t.planned ? Math.min(100, (v / t.planned) * 100) : 0)
  return (
    <div className="bar" title={`скроено ${t.cut} · сшито ${t.sewn} · упаковано ${t.packed} из ${t.planned}`}>
      <i className="l-cut" style={{ width: p(t.cut) + '%' }} />
      <i className="l-sewn" style={{ width: p(t.sewn) + '%' }} />
      <i className="l-packed" style={{ width: p(t.packed) + '%' }} />
    </div>
  )
}

export function WorkLegend() {
  return (
    <div className="legend">
      <span style={{ '--c': 'var(--indigo)', '--o': 0.22 }}>скроено</span>
      <span style={{ '--c': 'var(--indigo)', '--o': 0.75 }}>сшито</span>
      <span style={{ '--c': 'var(--green)' }}>упаковано</span>
    </div>
  )
}

// Дата в поле ввода — по местному времени: toISOString даёт UTC,
// и в Алматы после полуночи до пяти утра подставлялось бы вчера.
export const today = () => {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

export const dm = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}` : '')
