import React, { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, fmt, fmtD, apiError, canEdit, today, dm, dmy } from '../../api'
import { Loader, LoadError } from '../../components/Loader'

const MATERIALS = ['основа', 'подклад', 'флис', 'синтепон', 'кокетка', 'рибана', 'кант']
const READY = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
const pct = (v) => (v >= 1 ? 'на упаковке' : `${Math.round(v * 100)}%`)

/**
 * Лист этапа — как лист «цех отчёт.xlsx».
 * Крой: блоки по дням — изделие, материал, размер, штук, метраж, м/шт.
 * Штучный этап (вышивка, чистка, упаковка): по дням — изделие, размер, штук.
 * Пошив (Тигин): кто шьёт, изделие, размер, выдано и готовность по датам колонками.
 * Сверху — что по каждому заказу можно взять в работу на этом этапе.
 */
export default function StageSheet({ user, onChange }) {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const mayWrite = canEdit(user, 'workshop.entries')
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const [people, setPeople] = useState([])
  const status = params.get('status') || 'in_work'
  const orderFilter = params.get('order') || ''
  const [dates, setDates] = useState({ from: '', to: '' })
  const [showFree, setShowFree] = useState(true)

  const empty = { date: today(), order: orderFilter, size: '', qty: '', extra: '', note: '',
    responsible: '', workers: '' }
  const [form, setForm] = useState(empty)
  const [mats, setMats] = useState([{ material: 'основа', meters: '' }])
  const [markDate, setMarkDate] = useState(today())

  const load = () => {
    setFailed(false)
    const p = new URLSearchParams({ status: status === 'all' ? 'all' : status })
    if (orderFilter) p.set('order', orderFilter)
    if (dates.from) p.set('date_from', dates.from)
    if (dates.to) p.set('date_to', dates.to)
    return api.get(`/stage-templates/${id}/sheet/?${p}`).then(r => setData(r.data)).catch(() => setFailed(true))
  }
  useEffect(() => { setData(null); load() }, [id, status, orderFilter, dates.from, dates.to])
  useEffect(() => { setForm(f => ({ ...f, order: orderFilter, size: '' })) }, [orderFilter, id])
  useEffect(() => {
    // ответственный — сотрудник системы; кого он поставил на работу, пишут строкой ниже
    api.get('/users/?page_size=200').then(r => setPeople((r.data.results || []).filter(u => u.is_active)))
      .catch(() => {})
  }, [])

  const setParam = (k, v) => { const n = new URLSearchParams(params); v ? n.set(k, v) : n.delete(k); setParams(n) }

  if (failed && !data) return <LoadError onRetry={load} />
  if (!data) return <Loader />

  const t = data.template
  const kind = t.kind
  const orderRow = data.orders.find(o => String(o.order) === String(form.order))
  const sizeRow = orderRow?.sizes.find(s => String(s.id) === String(form.size))

  const run = async (fn) => {
    try { await fn(); await load(); onChange && onChange() }
    catch (e) { alert(apiError(e)) }
  }
  const prefill = (o, s) => {
    setForm({ ...empty, date: form.date, order: String(o.order), size: String(s.id), qty: s.free || '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const submit = () => run(async () => {
    if (kind === 'sewing') {
      await api.post('/sewing-jobs/', { stage: orderRow.stage, size: form.size, qty: form.qty,
        responsible: form.responsible || null, workers: form.workers, started: form.date })
    } else {
      const materials = kind === 'cut' ? mats.filter(m => m.material.trim() && m.meters !== '') : []
      await api.post('/stage-entries/', { stage: orderRow.stage, size: form.size, date: form.date, qty: form.qty,
        responsible: form.responsible || null, workers: form.workers,
        extra: form.extra, note: form.note, materials })
    }
    setForm(f => ({ ...f, size: '', qty: '', extra: '', note: '' }))
    setMats([{ material: 'основа', meters: '' }])
  })

  return (
    <div>
      <div className="pagehead" style={{ marginBottom: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Лист «{t.name}»</h2>
          <div className="muted">{t.kind_display}</div>
        </div>
        <div className="toolbar" style={{ padding: 0, border: 'none' }}>
          <select value={status} onChange={e => setParam('status', e.target.value === 'in_work' ? '' : e.target.value)} style={{ width: 'auto' }}>
            <option value="in_work">Заказы в работе</option>
            <option value="done">Сданные</option>
            <option value="all">Все заказы</option>
          </select>
          <select value={orderFilter} onChange={e => setParam('order', e.target.value)} style={{ width: 'auto', maxWidth: 260 }}>
            <option value="">Все изделия</option>
            {data.orders.map(o => <option key={o.order} value={o.order}>{o.product}{o.contract_number ? ` · ${o.contract_number}` : ''}</option>)}
          </select>
          <input type="date" value={dates.from} onChange={e => setDates({ ...dates, from: e.target.value })} style={{ width: 'auto' }} title="с даты" />
          <input type="date" value={dates.to} onChange={e => setDates({ ...dates, to: e.target.value })} style={{ width: 'auto' }} title="по дату" />
        </div>
      </div>

      {data.orders.length === 0 && <div className="card muted">Нет заказов, которые проходят этот этап. Этапы заказа задаются при запуске в цех.</div>}

      {mayWrite && data.orders.length > 0 && (
        <div className="card stitch">
          <h2>{kind === 'sewing' ? 'Выдать партию в пошив' : `Записать в «${t.name}»`}</h2>
          <div className="formrow">
            <div><label className="f">{kind === 'sewing' ? 'Дата выдачи' : 'Дата'}</label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
            <div style={{ flex: 2 }}><label className="f">Изделие (заказ)</label>
              <select value={form.order} onChange={e => setForm({ ...form, order: e.target.value, size: '' })}>
                <option value="">— выбрать —</option>
                {data.orders.map(o => <option key={o.order} value={o.order}>{o.product}{o.contract_number ? ` · ${o.contract_number}` : ''}{o.customer ? ` · ${o.customer}` : ''}</option>)}
              </select></div>
            <div><label className="f">Размер</label>
              <select value={form.size} onChange={e => setForm({ ...form, size: e.target.value })} disabled={!orderRow}>
                <option value="">—</option>
                {orderRow?.sizes.map(s => <option key={s.id} value={s.id}>{s.size} · можно {s.free}</option>)}
              </select></div>
            <div><label className="f">{kind === 'sewing' ? 'Выдано, шт' : 'Штук'}</label>
              <input type="number" min="1" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /></div>
            <div><label className="f">Ответственный</label>
              <select value={form.responsible} onChange={e => setForm({ ...form, responsible: e.target.value })}>
                <option value="">— не указан —</option>
                {people.map(u => <option key={u.id} value={u.id}>{u.first_name || u.username}</option>)}
              </select></div>
            <div><label className="f">{kind === 'sewing' ? 'Кто шьёт' : 'Кто делал'}</label>
              <input value={form.workers} placeholder="Наср + 9, Акбар"
                onChange={e => setForm({ ...form, workers: e.target.value })} /></div>
            {kind !== 'sewing' && t.extra_label && <div><label className="f">{t.extra_label}</label>
              <input value={form.extra} onChange={e => setForm({ ...form, extra: e.target.value })} /></div>}
            {kind !== 'sewing' && <div><label className="f">Примечание</label>
              <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>}
          </div>
          {sizeRow && <p className="muted" style={{ marginBottom: 8 }}>
            {orderRow.prev_stage
              ? <>Размер {sizeRow.size}: прошли «{orderRow.prev_stage}» — {sizeRow.prev_done} шт, на «{t.name}» уже {sizeRow.assigned} — можно ещё <b>{sizeRow.free}</b>.</>
              : <>Размер {sizeRow.size}: план {sizeRow.planned}, уже {sizeRow.done}. Первый этап не ограничен — кроят и сверх плана.</>}
          </p>}
          {kind === 'cut' && (
            <div style={{ marginBottom: 10 }}>
              <label className="f">Расход ткани</label>
              <datalist id="mat-kinds">{MATERIALS.map(m => <option key={m} value={m} />)}</datalist>
              {mats.map((m, i) => (
                <div className="formrow" key={i} style={{ marginBottom: 6 }}>
                  <div><input list="mat-kinds" value={m.material} placeholder="материал"
                    onChange={e => setMats(mats.map((x, k) => k === i ? { ...x, material: e.target.value } : x))} /></div>
                  <div><input type="number" step="0.01" value={m.meters} placeholder="метров"
                    onChange={e => setMats(mats.map((x, k) => k === i ? { ...x, meters: e.target.value } : x))} /></div>
                  <div style={{ alignSelf: 'center' }} className="muted">{form.qty && m.meters !== '' ? fmtD(m.meters / form.qty) : '—'} м/шт</div>
                  <div style={{ alignSelf: 'center', flex: '0 0 auto', minWidth: 0 }}>
                    {mats.length > 1 && <button className="btn small ghost" onClick={() => setMats(mats.filter((_, k) => k !== i))}>✕</button>}
                  </div>
                </div>
              ))}
              <button className="btn small ghost" onClick={() => setMats([...mats, { material: '', meters: '' }])}>+ материал</button>
            </div>
          )}
          <button className="btn" onClick={submit}
            disabled={!orderRow || !form.size || !form.qty}>
            {kind === 'sewing' ? 'Выдать' : 'Записать'}</button>
        </div>
      )}

      {data.orders.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <b>Что можно взять в работу</b>
            <button className="btn small ghost btn-read" onClick={() => setShowFree(s => !s)}>{showFree ? 'Свернуть' : 'Показать'}</button>
          </div>
          {showFree && <div className="tablewrap"><table className="sheet">
            <thead><tr><th>Изделие</th><th>Размер</th><th className="num">План</th>
              <th className="num">Прошли пред. этап</th><th className="num">{kind === 'sewing' ? 'Выдано' : 'Здесь'}</th>
              {kind === 'sewing' && <th className="num">Сшито</th>}
              <th className="num">Можно ещё</th>{mayWrite && <th />}</tr></thead>
            <tbody>
              {data.orders.map(o => (
                <Fragment key={o.order}>
                  <tr className="group"><td colSpan={mayWrite ? 8 : 7}>
                    <Link to={`/workshop/orders/${o.order}`}><b>{o.product}</b></Link>
                    <span className="muted"> · {[o.contract_number, o.customer, o.deadline && `срок ${dmy(o.deadline)}`].filter(Boolean).join(' · ')}
                      {o.prev_stage ? ` · до этого: «${o.prev_stage}»` : ' · первый этап заказа'}</span>
                  </td></tr>
                  {o.sizes.map(s => (
                    <tr key={s.id}>
                      <td />
                      <td>{s.size}</td><td className="num">{s.planned}</td>
                      <td className="num">{s.prev_done ?? '—'}</td>
                      <td className="num">{s.assigned}</td>
                      {kind === 'sewing' && <td className="num">{s.done}</td>}
                      <td className={'num' + (s.free > 0 ? ' pos' : '')}>{s.free}</td>
                      {mayWrite && <td>{s.free > 0 && <button className="btn small ghost" onClick={() => prefill(o, s)}>+ записать</button>}</td>}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table></div>}
        </div>
      )}

      {kind === 'sewing'
        ? <SewingGrid data={data} mayWrite={mayWrite} markDate={markDate} setMarkDate={setMarkDate} run={run} />
        : <EntriesGrid data={data} mayWrite={mayWrite} run={run} />}
    </div>
  )
}

/** Крой и штучные этапы: блоки по дням, как в листе. */
function EntriesGrid({ data, mayWrite, run }) {
  const t = data.template
  const byDate = useMemo(() => {
    const groups = []
    for (const e of data.entries) {
      const last = groups[groups.length - 1]
      if (last && last.date === e.date) last.items.push(e)
      else groups.push({ date: e.date, items: [e] })
    }
    return groups
  }, [data.entries])
  const cols = (t.kind === 'cut' ? 7 : 5 + (t.extra_label ? 1 : 0)) + 1   // +1 — «кто делал»

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="toolbar"><b>Записи по дням</b><span className="muted">{data.entries.length} записей</span></div>
      <div className="tablewrap"><table className="sheet">
        <thead><tr>
          <th>Изделие</th>
          {t.kind === 'cut' && <th>Материал</th>}
          <th>Размер</th><th className="num">Шт</th>
          {t.kind === 'cut' && <><th className="num">Метраж</th><th className="num">м/шт</th></>}
          {t.kind !== 'cut' && t.extra_label && <th>{t.extra_label}</th>}
          <th>Кто делал</th><th>Примечание</th>{mayWrite && <th />}
        </tr></thead>
        <tbody>
          {byDate.length === 0 && <tr><td colSpan={cols + 1} className="muted">Записей пока нет.</td></tr>}
          {byDate.map(g => (
            <Fragment key={g.date}>
              <tr className="group"><td colSpan={cols + (mayWrite ? 1 : 0)}>
                <b>{t.name} {dmy(g.date)}</b><span className="muted"> · {fmt(g.items.reduce((a, e) => a + e.qty, 0))} шт</span>
              </td></tr>
              {g.items.map(e => {
                const mats = t.kind === 'cut' && e.materials.length ? e.materials : [null]
                return mats.map((m, i) => (
                  <tr key={`${e.id}-${i}`} className={i ? 'cont' : ''}>
                    {i === 0 && <td rowSpan={mats.length}>{e.product}</td>}
                    {t.kind === 'cut' && <td>{m ? m.material : <span className="muted">—</span>}</td>}
                    {i === 0 && <td rowSpan={mats.length}>{e.size}</td>}
                    {i === 0 && <td rowSpan={mats.length} className="num"><b>{e.qty}</b></td>}
                    {t.kind === 'cut' && <><td className="num">{m ? fmtD(m.meters) : ''}</td><td className="num">{m ? fmtD(m.per_unit) : ''}</td></>}
                    {t.kind !== 'cut' && t.extra_label && <td>{e.extra}</td>}
                    {i === 0 && <td rowSpan={mats.length}>{e.who_label || <span className="muted">—</span>}</td>}
                    {i === 0 && <td rowSpan={mats.length}>{e.note}</td>}
                    {i === 0 && mayWrite && <td rowSpan={mats.length}>
                      <button className="btn small ghost" title="Удалить запись" onClick={() => confirm(`Удалить запись ${e.size} · ${e.qty} шт от ${dmy(e.date)}?`) && run(() => api.delete(`/stage-entries/${e.id}/`))}>✕</button>
                    </td>}
                  </tr>
                ))
              })}
            </Fragment>
          ))}
        </tbody>
      </table></div>
    </div>
  )
}

/** Пошив: партии по исполнителям, готовность по датам колонками, последняя колонка — отметить. */
function SewingGrid({ data, mayWrite, markDate, setMarkDate, run }) {
  const groups = useMemo(() => {
    const out = []
    for (const j of data.jobs) {
      const last = out[out.length - 1]
      if (last && last.label === j.who_label) last.items.push(j)
      else out.push({ label: j.who_label, items: [j] })
    }
    return out
  }, [data.jobs])
  const cols = 4 + data.dates.length + 2 + (mayWrite ? 2 : 0)

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="toolbar">
        <b>Партии в пошиве и готовность по дням</b>
        {mayWrite && <span className="muted" style={{ marginLeft: 'auto' }}>Отмечать на дату:{' '}
          <input type="date" value={markDate} onChange={e => setMarkDate(e.target.value)} style={{ width: 'auto', display: 'inline-block' }} /></span>}
      </div>
      <div className="tablewrap"><table className="sheet grid">
        <thead><tr>
          <th>Кто шьёт</th><th>Изделие</th><th>Размер</th><th className="num">Шт</th>
          {data.dates.map(d => <th key={d} className="num date">{dm(d)}</th>)}
          <th className="num">Сшито</th><th>Выдано</th>
          {mayWrite && <><th>{dm(markDate)}</th><th /></>}
        </tr></thead>
        <tbody>
          {groups.length === 0 && <tr><td colSpan={cols} className="muted">В пошив ещё ничего не выдавали.</td></tr>}
          {groups.map(g => g.items.map((j, i) => (
            <tr key={j.id} className={i === 0 ? 'first' : 'cont'}>
              {i === 0 && <td rowSpan={g.items.length}><b>{g.label}</b></td>}
              <td><Link to={`/workshop/orders/${j.order}`}>{j.product}</Link></td>
              <td>{j.size}</td>
              <td className="num">{j.qty}</td>
              {data.dates.map(d => (
                <td key={d} className={'num cellpct' + (j.cells[d] >= 1 ? ' done' : '')}>{j.cells[d] !== undefined ? pct(j.cells[d]) : ''}</td>
              ))}
              <td className="num"><b>{j.sewn}</b></td>
              <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dm(j.started)}</td>
              {mayWrite && <>
                <td>{j.ready < 1
                  ? <select style={{ width: 'auto', fontSize: 12, padding: '2px 4px' }} value=""
                      onChange={e => e.target.value && run(() => api.post(`/sewing-jobs/${j.id}/progress/`, { date: markDate, ready: e.target.value }))}>
                      <option value="">{pct(j.ready)} →</option>
                      {READY.map(r => <option key={r} value={r}>{pct(r)}</option>)}
                    </select>
                  : <span className="chip done">на упаковке</span>}</td>
                <td><button className="btn small ghost" title="Удалить партию" onClick={() => confirm(`Удалить партию ${g.label} · ${j.size} · ${j.qty} шт вместе с отметками?`) && run(() => api.delete(`/sewing-jobs/${j.id}/`))}>✕</button></td>
              </>}
            </tr>
          )))}
        </tbody>
      </table></div>
      <p className="muted" style={{ padding: '8px 16px 12px' }}>Готовность — доля партии: 0,3 → 30%. «На упаковке» — партия сшита целиком. Сшито = выдано × последняя готовность.</p>
    </div>
  )
}
