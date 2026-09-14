import React, { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, fmt, fmtD, apiError, can, canEdit } from '../api'
import { Loader, LoadError } from '../components/Loader'
import { WorkBar, WorkLegend, today, dm } from '../components/WorkBar'

const MATERIALS = ['основа', 'подклад', 'флис', 'синтепон', 'кокетка', 'рибана', 'кант']
const READY = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
const KIND = { cut: 'крой', embroidery: 'вышивка', sewing: 'пошив', progress: 'готовность', pack: 'упаковка' }
const pct = (v) => (v >= 1 ? 'на упаковке' : `${Math.round(v * 100)}%`)

/**
 * Заказ цеха. Главное — таблица по размерам: клик по размеру раскрывает
 * всё, что по нему происходило, — крой с метражом, вышивку, партии бригад
 * с готовностью по дням, упаковку.
 */
export default function WorkOrderDetail({ user }) {
  const { id } = useParams()
  const roOrders = !canEdit(user, 'workshop.orders')
  const wCut = canEdit(user, 'workshop.cutting')
  const wSew = canEdit(user, 'workshop.sewing')
  const wPack = canEdit(user, 'workshop.packing')
  const seeContracts = can(user, 'contracts.contracts')
  const formRef = useRef(null)

  const [o, setO] = useState(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(null)
  const [brigades, setBrigades] = useState([])
  const modes = [wCut && 'cut', wCut && 'embroidery', wSew && 'sewing', wPack && 'pack', !roOrders && 'sizes'].filter(Boolean)
  const [mode, setMode] = useState(modes[0] || null)

  const [size, setSize] = useState('')
  const [date, setDate] = useState(today())
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [mats, setMats] = useState([{ material: 'основа', meters: '' }])
  const [kind, setKind] = useState('')
  const [brigade, setBrigade] = useState('')
  const [sizesText, setSizesText] = useState('')
  const [progressDate, setProgressDate] = useState(today())

  const load = () => {
    setFailed(false)
    return api.get(`/work-orders/${id}/`).then(r => {
      setO(r.data)
      setSize(s => s || (r.data.sizes[0] ? String(r.data.sizes[0].id) : ''))
    }).catch(() => setFailed(true))
  }
  useEffect(() => { load() }, [id])
  useEffect(() => {
    if (can(user, 'workshop.sewing')) api.get('/brigades/?page_size=300').then(r => setBrigades((r.data.results || []).filter(b => b.is_active)))
  }, [])

  if (failed && !o) return <LoadError onRetry={load} />
  if (!o) return <Loader />

  const t = o.totals
  const cur = o.sizes.find(s => String(s.id) === String(size))
  const resetEntry = () => { setQty(''); setNote(''); setKind(''); setMats([{ material: 'основа', meters: '' }]) }

  const run = async (fn) => { try { await fn(); resetEntry(); await load() } catch (e) { alert(apiError(e)) } }
  const del = async (url, q) => {
    if (!confirm(q)) return
    try { await api.delete(url); load() } catch (e) { alert(apiError(e, 'Не удалось удалить')) }
  }

  const startEntry = (m, sizeId) => {
    setMode(m); setSize(String(sizeId)); resetEntry()
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const submit = () => {
    if (mode === 'cut') {
      const clean = mats.filter(m => m.material.trim() && m.meters !== '')
      if (clean.some(m => !(Number(m.meters) >= 0))) return alert('Метраж должен быть числом, не меньше нуля.')
      return run(() => api.post('/cut-entries/', { size, date, qty, note, materials: clean }))
    }
    if (mode === 'embroidery') return run(() => api.post('/embroidery-entries/', { size, date, qty, kind, note }))
    if (mode === 'sewing') return run(() => api.post('/sewing-jobs/', { size, brigade, qty, started: date }))
    if (mode === 'pack') return run(() => api.post('/pack-entries/', { size, date, qty, note }))
  }

  const addSizes = () => run(async () => {
    const { data } = await api.post(`/work-orders/${id}/sizes_bulk/`, { text: sizesText })
    setSizesText('')
    alert(`Размеры: добавлено ${data.report.added}, обновлено ${data.report.updated}.`)
  })
  const patchSize = (s, planned) => run(() => api.patch(`/work-sizes/${s.id}/`, { planned }))
  const setProgress = (job, ready) => run(() => api.post(`/sewing-jobs/${job.id}/progress/`, { date: progressDate, ready }))
  const setStatus = (st) => run(() => api.post(`/work-orders/${id}/set_status/`, { status: st }))

  const perUnit = (m) => (qty && m.meters !== '' ? fmtD(Number(m.meters) / Number(qty)) : '—')

  return (
    <div>
      <div className="pagehead">
        <div>
          <Link to="/workshop" className="muted">← Цех</Link>
          <h1>{o.product}</h1>
          <div className="muted">
            {o.contract_number && (seeContracts
              ? <>договор <Link to={`/contracts/${o.contract}`}>{o.contract_number}</Link> · </>
              : <>договор {o.contract_number} · </>)}
            {o.client && <>{o.client} · </>}
            {o.deadline && <>срок {o.deadline} · </>}
            расценка {fmt(o.sewing_rate)} ₸/шт
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={'pill ' + (o.status === 'done' ? 'ok' : 'imp')}>{o.status_display}</span>
          {!roOrders && (o.status === 'done'
            ? <button className="btn small ghost" onClick={() => setStatus('in_work')}>Вернуть в работу</button>
            : <button className="btn small" onClick={() => setStatus('done')}>Отметить сданным</button>)}
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="v">{fmt(t.planned)}</div><div className="l">план</div></div>
        <div className={'kpi' + (t.cut > t.planned ? ' warn' : '')}><div className="v">{fmt(t.cut)}</div><div className="l">скроено</div></div>
        <div className="kpi"><div className="v">{fmt(t.embroidered)}</div><div className="l">вышито</div></div>
        <div className="kpi"><div className="v">{fmt(t.in_sewing)}</div><div className="l">в пошиве</div></div>
        <div className="kpi good"><div className="v">{fmt(t.sewn)}</div><div className="l">сшито</div></div>
        <div className="kpi"><div className="v">{fmt(t.packed)}</div><div className="l">упаковано</div></div>
        <div className="kpi"><div className="v">{fmt(t.left)}</div><div className="l">осталось</div></div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '13px 16px 8px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>По размерам</h2>
          <WorkLegend />
        </div>
        <table>
          <thead><tr>
            <th>Размер</th><th className="num">План</th><th className="num">Скроено</th><th className="num">Вышито</th>
            <th className="num">В пошиве</th><th className="num">Сшито</th><th className="num">Упаковано</th>
            <th className="num">Осталось</th><th style={{ minWidth: 110 }} />
          </tr></thead>
          <tbody>
            {o.sizes.length === 0 && <tr><td colSpan={9} className="muted">Размеров нет — добавьте их во вкладке «Размеры» ниже.</td></tr>}
            {o.sizes.map(s => {
              const st = s.stats
              const isOpen = open === s.id
              return (
                <Fragment key={s.id}>
                  <tr className={'clickable' + (isOpen ? ' open' : '')} onClick={() => setOpen(isOpen ? null : s.id)}>
                    <td><b>{isOpen ? '▾' : '▸'} {s.size}</b></td>
                    <td className="num">{st.planned}</td>
                    <td className={'num' + (st.cut > st.planned ? ' over' : '')}>{st.cut}</td>
                    <td className="num">{st.embroidered}</td>
                    <td className={'num' + (st.assigned > st.cut ? ' over' : '')}
                      title={st.assigned > st.cut ? 'Выдано в пошив больше, чем скроено' : ''}>{st.in_sewing}</td>
                    <td className="num"><b>{st.sewn}</b></td>
                    <td className="num">{st.packed}</td>
                    <td className="num">{st.left}</td>
                    <td><WorkBar t={st} /></td>
                  </tr>
                  {isOpen && (
                    <tr><td colSpan={9} style={{ padding: 0 }}>
                      <div className="drill">
                        <div className="chips" style={{ marginBottom: 10 }}>
                          {wCut && <button className="btn small ghost" onClick={() => startEntry('cut', s.id)}>+ крой</button>}
                          {wCut && <button className="btn small ghost" onClick={() => startEntry('embroidery', s.id)}>+ вышивка</button>}
                          {wSew && <button className="btn small ghost" onClick={() => startEntry('sewing', s.id)}>+ выдать бригаде</button>}
                          {wPack && <button className="btn small ghost" onClick={() => startEntry('pack', s.id)}>+ упаковка</button>}
                        </div>

                        <h3>Крой</h3>
                        {s.cuts.length === 0 && <p className="muted">Не кроили.</p>}
                        {s.cuts.map(c => (
                          <div key={c.id} style={{ marginBottom: 4 }}>
                            <b>{dm(c.date)}</b> · {c.qty} шт
                            {c.materials.map(m => <span key={m.material} className="muted"> · {m.material} {fmtD(m.meters)} м ({fmtD(m.per_unit)} м/шт)</span>)}
                            {c.note && <span className="muted"> · {c.note}</span>}
                            {wCut && <button className="btn small ghost" style={{ marginLeft: 8 }} onClick={() => del(`/cut-entries/${c.id}/`, 'Удалить эту запись кроя?')}>✕</button>}
                          </div>
                        ))}
                        {s.materials.length > 0 && (
                          <div className="chips" style={{ marginTop: 6 }}>
                            {s.materials.map(m => <span key={m.material} className="chip">{m.material}: {fmtD(m.meters)} м · {fmtD(m.per_unit)} м/шт</span>)}
                          </div>
                        )}

                        <h3>Вышивка</h3>
                        {s.embroidery.length === 0 && <p className="muted">Не вышивали.</p>}
                        {s.embroidery.map(e => (
                          <div key={e.id} style={{ marginBottom: 4 }}>
                            <b>{dm(e.date)}</b> · {e.qty} шт{e.kind && <span className="muted"> · {e.kind}</span>}
                            {wCut && <button className="btn small ghost" style={{ marginLeft: 8 }} onClick={() => del(`/embroidery-entries/${e.id}/`, 'Удалить запись вышивки?')}>✕</button>}
                          </div>
                        ))}

                        <h3>Пошив</h3>
                        {s.jobs.length === 0 && <p className="muted">Бригадам не выдавали.</p>}
                        {s.jobs.length > 0 && wSew && (
                          <div className="muted" style={{ marginBottom: 6 }}>
                            Отмечать готовность на дату:{' '}
                            <input type="date" value={progressDate} onChange={e => setProgressDate(e.target.value)} style={{ width: 'auto', display: 'inline-block' }} />
                          </div>
                        )}
                        {s.jobs.map(j => (
                          <div key={j.id} style={{ marginBottom: 10 }}>
                            <div>
                              <b>{j.brigade_label}</b> · выдано {j.qty} шт {dm(j.started)} ·{' '}
                              <span className={j.ready >= 1 ? 'chip done' : 'chip'}>{pct(j.ready)}</span>{' '}
                              сшито <b>{j.sewn}</b>
                              {wSew && <button className="btn small ghost" style={{ marginLeft: 8 }}
                                onClick={() => del(`/sewing-jobs/${j.id}/`, `Удалить партию ${j.brigade_label} вместе с отметками готовности?`)}>✕</button>}
                            </div>
                            {j.progress.length > 0 && (
                              <div className="chips" style={{ marginTop: 4 }}>
                                {j.progress.map(p => <span key={p.id} className="chip" title="по дням">{dm(p.date)} {pct(p.ready)}</span>)}
                              </div>
                            )}
                            {wSew && j.ready < 1 && (
                              <div className="chips" style={{ marginTop: 6 }}>
                                {READY.filter(r => r > j.ready).map(r => (
                                  <button key={r} className="btn small ghost" onClick={() => setProgress(j, r)}>{pct(r)}</button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}

                        <h3>Упаковка</h3>
                        {s.packs.length === 0 && <p className="muted">Не упаковывали.</p>}
                        {s.packs.map(p => (
                          <div key={p.id} style={{ marginBottom: 4 }}>
                            <b>{dm(p.date)}</b> · {p.qty} шт{p.note && <span className="muted"> · {p.note}</span>}
                            {wPack && <button className="btn small ghost" style={{ marginLeft: 8 }} onClick={() => del(`/pack-entries/${p.id}/`, 'Удалить запись упаковки?')}>✕</button>}
                          </div>
                        ))}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              )
            })}
            {o.sizes.length > 0 && (
              <tr>
                <td><b>Итого</b></td>
                <td className="num"><b>{fmt(t.planned)}</b></td><td className="num"><b>{fmt(t.cut)}</b></td>
                <td className="num"><b>{fmt(t.embroidered)}</b></td><td className="num"><b>{fmt(t.in_sewing)}</b></td>
                <td className="num"><b>{fmt(t.sewn)}</b></td><td className="num"><b>{fmt(t.packed)}</b></td>
                <td className="num"><b>{fmt(t.left)}</b></td><td><WorkBar t={t} /></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {mode && (
        <div className="card stitch" ref={formRef}>
          <div className="tabs">
            {wCut && <button className={mode === 'cut' ? 'active' : ''} onClick={() => setMode('cut')}>Крой</button>}
            {wCut && <button className={mode === 'embroidery' ? 'active' : ''} onClick={() => setMode('embroidery')}>Вышивка</button>}
            {wSew && <button className={mode === 'sewing' ? 'active' : ''} onClick={() => setMode('sewing')}>Выдать бригаде</button>}
            {wPack && <button className={mode === 'pack' ? 'active' : ''} onClick={() => setMode('pack')}>Упаковка</button>}
            {!roOrders && <button className={mode === 'sizes' ? 'active' : ''} onClick={() => setMode('sizes')}>Размеры</button>}
          </div>

          {mode !== 'sizes' && (o.sizes.length === 0
            ? <p className="muted">Сначала добавьте размеры во вкладке «Размеры».</p>
            : <>
              <div className="formrow">
                <div><label className="f">Размер</label>
                  <select value={size} onChange={e => setSize(e.target.value)}>
                    {o.sizes.map(s => <option key={s.id} value={s.id}>{s.size} (план {s.planned})</option>)}
                  </select></div>
                <div><label className="f">{mode === 'sewing' ? 'Дата выдачи' : 'Дата'}</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
                <div><label className="f">{{ cut: 'Скроено, шт', embroidery: 'Вышито, шт', sewing: 'Выдано, шт', pack: 'Упаковано, шт' }[mode]}</label>
                  <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} /></div>
                {mode === 'sewing' && <div><label className="f">Бригада</label>
                  <select value={brigade} onChange={e => setBrigade(e.target.value)}>
                    <option value="">— выбрать —</option>
                    {brigades.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </select></div>}
                {mode === 'embroidery' && <div><label className="f">Вид</label>
                  <input list="emb-kinds" value={kind} placeholder="полный, карман" onChange={e => setKind(e.target.value)} />
                  <datalist id="emb-kinds"><option value="полный" /><option value="карман" /></datalist></div>}
                {mode !== 'sewing' && <div><label className="f">Примечание</label>
                  <input value={note} onChange={e => setNote(e.target.value)} /></div>}
              </div>

              {cur && (
                <p className="muted" style={{ marginBottom: 10 }}>
                  {mode === 'cut' && <>По размеру {cur.size}: план {cur.stats.planned}, скроено {cur.stats.cut}.</>}
                  {mode === 'embroidery' && <>По размеру {cur.size}: скроено {cur.stats.cut}, вышито {cur.stats.embroidered}.</>}
                  {mode === 'sewing' && <>По размеру {cur.size}: скроено {cur.stats.cut}, уже выдано {cur.stats.assigned}
                    {cur.stats.cut > cur.stats.assigned && <> — свободно {cur.stats.cut - cur.stats.assigned}</>}.
                    {brigades.length === 0 && <> Бригад пока нет — заведите их в «Цех → Бригады».</>}</>}
                  {mode === 'pack' && <>По размеру {cur.size}: сшито {cur.stats.sewn}, упаковано {cur.stats.packed} — можно упаковать ещё {Math.max(cur.stats.sewn - cur.stats.packed, 0)}.</>}
                </p>
              )}

              {mode === 'cut' && (
                <div style={{ marginBottom: 10 }}>
                  <label className="f">Расход ткани</label>
                  <datalist id="mat-kinds">{MATERIALS.map(m => <option key={m} value={m} />)}</datalist>
                  {mats.map((m, i) => (
                    <div className="formrow" key={i} style={{ marginBottom: 6 }}>
                      <div><input list="mat-kinds" value={m.material} placeholder="материал"
                        onChange={e => setMats(mats.map((x, k) => k === i ? { ...x, material: e.target.value } : x))} /></div>
                      <div><input type="number" step="0.01" value={m.meters} placeholder="метров"
                        onChange={e => setMats(mats.map((x, k) => k === i ? { ...x, meters: e.target.value } : x))} /></div>
                      <div style={{ alignSelf: 'center' }} className="muted">{perUnit(m)} м/шт</div>
                      <div style={{ alignSelf: 'center', flex: '0 0 auto', minWidth: 0 }}>
                        {mats.length > 1 && <button className="btn small ghost" onClick={() => setMats(mats.filter((_, k) => k !== i))}>✕</button>}
                      </div>
                    </div>
                  ))}
                  <button className="btn small ghost" onClick={() => setMats([...mats, { material: '', meters: '' }])}>+ материал</button>
                </div>
              )}

              <button className="btn" onClick={submit}
                disabled={!size || !qty || (mode === 'sewing' && !brigade)}>Записать</button>
            </>)}

          {mode === 'sizes' && <>
            <label className="f">Добавить размеры — столбиком, как в отчёте цеха</label>
            <textarea rows={5} value={sizesText} placeholder={'54/176 - 27 шт\n58/182 29'} onChange={e => setSizesText(e.target.value)} />
            <div style={{ margin: '10px 0 14px' }}>
              <button className="btn" onClick={addSizes} disabled={!sizesText.trim()}>Добавить</button>
              <span className="muted" style={{ marginLeft: 10 }}>Если размер уже есть — у него обновится план.</span>
            </div>
            {o.sizes.length > 0 && (
              <table>
                <thead><tr><th>Размер</th><th className="num">План, шт</th><th /></tr></thead>
                <tbody>
                  {o.sizes.map(s => (
                    <tr key={s.id}>
                      <td>{s.size}</td>
                      <td className="num"><input type="number" min="1" style={{ width: 90 }} defaultValue={s.planned}
                        onBlur={e => Number(e.target.value) !== s.planned && patchSize(s, e.target.value)} /></td>
                      <td><button className="btn small ghost" onClick={() => del(`/work-sizes/${s.id}/`, `Удалить размер ${s.size}?`)}>Удл.</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>}
        </div>
      )}

      <div className="grid2">
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '13px 16px 4px' }}><h2>Бригады по заказу</h2></div>
          <table>
            <thead><tr><th>Бригада</th><th className="num">Выдано</th><th className="num">Сшито</th><th className="num">Начислено, ₸</th></tr></thead>
            <tbody>
              {o.brigades.length === 0 && <tr><td colSpan={4} className="muted">Пока никому не выдавали.</td></tr>}
              {o.brigades.map(b => (
                <tr key={b.brigade}>
                  <td><b>{b.label}</b><div className="muted">{b.sizes.join(', ')}</div></td>
                  <td className="num">{b.assigned}</td><td className="num">{b.sewn}</td><td className="num">{fmt(b.earned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '13px 16px 4px' }}><h2>Ткань по заказу</h2></div>
          <table>
            <thead><tr><th>Материал</th><th className="num">Метров</th><th className="num">Скроено, шт</th><th className="num">м/шт</th></tr></thead>
            <tbody>
              {o.materials.length === 0 && <tr><td colSpan={4} className="muted">Расход ткани не вносили.</td></tr>}
              {o.materials.map(m => (
                <tr key={m.material}>
                  <td>{m.material}</td><td className="num">{fmtD(m.meters)}</td>
                  <td className="num">{m.cut_qty}</td><td className="num">{fmtD(m.per_unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '13px 16px 4px' }}><h2>История</h2></div>
        <table>
          <tbody>
            {o.history.length === 0 && <tr><td className="muted">Записей пока нет.</td></tr>}
            {o.history.map((h, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap' }}><b>{dm(h.date)}</b></td>
                <td><span className="chip">{KIND[h.kind]}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>{h.size}</td>
                <td>{h.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
