import React, { Fragment, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, fmt, fmtD, apiError, can, canEdit, dm, dmy } from '../../api'
import { Loader, LoadError } from '../../components/Loader'
import StageBars from '../../components/StageBars'

/**
 * Заказ цеха. Главное — таблица «размер × этап»: по каждому размеру видно,
 * сколько прошло каждый этап. Клик по размеру раскрывает всё, что с ним
 * происходило; клик по названию этапа открывает лист этапа по этому заказу.
 */
export default function OrderCard({ user, onChange }) {
  const { id } = useParams()
  const mayEdit = canEdit(user, 'workshop.orders')
  const seeEntries = can(user, 'workshop.entries')
  const [o, setO] = useState(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(null)
  const [tab, setTab] = useState('sizes')
  const [sizesText, setSizesText] = useState('')
  const [templates, setTemplates] = useState([])

  const load = () => {
    setFailed(false)
    return api.get(`/work-orders/${id}/`).then(r => setO(r.data)).catch(() => setFailed(true))
  }
  useEffect(() => { load() }, [id])
  useEffect(() => { api.get('/stage-templates/?page_size=100').then(r => setTemplates(r.data.results || [])) }, [])

  if (failed && !o) return <LoadError onRetry={load} />
  if (!o) return <Loader />

  const run = async (fn) => { try { await fn(); await load(); onChange && onChange() } catch (e) { alert(apiError(e)) } }
  const del = (url, q) => confirm(q) && run(() => api.delete(url))
  const s = o.summary
  const route = o.stages.map(st => st.template)

  return (
    <div>
      <div className="pagehead">
        <div>
          <Link to="/workshop" className="muted">← Заказы цеха</Link>
          <h1>{o.product}</h1>
          <div className="muted">
            {o.contract && (can(user, 'contracts.contracts')
              ? <>договор <Link to={`/contracts/${o.contract}`}>{o.contract_number}</Link> · </>
              : <>договор {o.contract_number} · </>)}
            {(o.customer_name || o.client) && <>{o.customer_name || o.client} · </>}
            {o.deadline && <>срок {dmy(o.deadline)} · </>}
            расценка пошива {fmt(o.sewing_rate)} ₸/шт
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={'pill ' + (o.status === 'done' ? 'ok' : 'imp')}>{o.status_display}</span>
          {mayEdit && (o.status === 'done'
            ? <button className="btn small ghost" onClick={() => run(() => api.post(`/work-orders/${id}/set_status/`, { status: 'in_work' }))}>Вернуть в работу</button>
            : <button className="btn small" onClick={() => run(() => api.post(`/work-orders/${id}/set_status/`, { status: 'done' }))}>Отметить сданным</button>)}
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="v">{fmt(s.planned)}</div><div className="l">план, шт</div></div>
        {s.stages.map(st => (
          <div key={st.id} className="kpi"><div className="v">{fmt(st.done)}</div>
            <div className="l">{st.name}{st.in_work ? ` · шьётся ${fmt(st.in_work)}` : ''}</div></div>
        ))}
        <div className="kpi"><div className="v">{fmt(s.left)}</div><div className="l">осталось</div></div>
      </div>

      <div className="card">
        <StageBars summary={s} />
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '13px 16px 6px' }}><h2 style={{ margin: 0 }}>Размер × этап</h2>
          <div className="muted">Клик по размеру — всё, что по нему делали. Клик по этапу — его лист по этому заказу.</div></div>
        <div className="tablewrap"><table className="sheet">
          <thead><tr>
            <th>Размер</th><th className="num">План</th>
            {o.stages.map(st => (
              <th key={st.id} className="num">{seeEntries
                ? <Link to={`/workshop/stages/${st.template}?order=${o.id}`}>{st.name}</Link> : st.name}</th>
            ))}
            <th className="num">Осталось</th>
          </tr></thead>
          <tbody>
            {o.sizes.length === 0 && <tr><td colSpan={o.stages.length + 3} className="muted">Размеров нет — добавьте ниже.</td></tr>}
            {o.sizes.map(z => {
              const isOpen = open === z.id
              const events = o.history.filter(h => h.size === z.size)
              return (
                <Fragment key={z.id}>
                  <tr className={'clickable' + (isOpen ? ' open' : '')} onClick={() => setOpen(isOpen ? null : z.id)}>
                    <td><b>{isOpen ? '▾' : '▸'} {z.size}</b></td>
                    <td className="num">{z.planned}</td>
                    {o.stages.map((st, i) => {
                      const v = z.stages[st.id]
                      const prev = i ? z.stages[o.stages[i - 1].id].done : z.planned
                      return (
                        <td key={st.id} className={'num' + (v.done >= z.planned ? ' done' : '') + (v.assigned > prev && i ? ' over' : '')}>
                          {v.done}{st.kind === 'sewing' && v.in_work > 0 && <span className="muted"> +{v.in_work}</span>}
                        </td>
                      )
                    })}
                    <td className="num">{z.left}</td>
                  </tr>
                  {isOpen && (
                    <tr><td colSpan={o.stages.length + 3} style={{ padding: 0 }}>
                      <div className="drill">
                        {events.length === 0 && <p className="muted">По размеру ещё ничего не записано.</p>}
                        {events.map((h, k) => (
                          <div key={k} style={{ marginBottom: 3 }}>
                            <b>{dm(h.date)}</b> <span className="chip">{h.stage}</span> {h.text}
                          </div>
                        ))}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              )
            })}
            {o.sizes.length > 0 && (
              <tr className="total">
                <td>Итого</td><td className="num">{fmt(s.planned)}</td>
                {s.stages.map(st => <td key={st.id} className="num">{fmt(st.done)}</td>)}
                <td className="num">{fmt(s.left)}</td>
              </tr>
            )}
          </tbody>
        </table></div>
      </div>

      <div className="tabs">
        {mayEdit && <button className={tab === 'sizes' ? 'active' : ''} onClick={() => setTab('sizes')}>Размеры</button>}
        {mayEdit && <button className={tab === 'route' ? 'active' : ''} onClick={() => setTab('route')}>Этапы заказа</button>}
        <button className={tab === 'brigades' ? 'active' : ''} onClick={() => setTab('brigades')}>Бригады</button>
        <button className={tab === 'fabric' ? 'active' : ''} onClick={() => setTab('fabric')}>Ткань</button>
      </div>

      {tab === 'sizes' && mayEdit && (
        <div className="card">
          <label className="f">Добавить размеры — столбиком, как в отчёте цеха</label>
          <textarea rows={4} value={sizesText} placeholder={'54/176 - 27 шт\n58/182 29'} onChange={e => setSizesText(e.target.value)} />
          <div style={{ margin: '10px 0 14px' }}>
            <button className="btn" disabled={!sizesText.trim()} onClick={() => run(async () => {
              const { data } = await api.post(`/work-orders/${id}/sizes_bulk/`, { text: sizesText })
              setSizesText(''); alert(`Размеры: добавлено ${data.report.added}, обновлено ${data.report.updated}.`)
            })}>Добавить</button>
            <span className="muted" style={{ marginLeft: 10 }}>Если размер уже есть — у него обновится план.</span>
          </div>
          {o.sizes.length > 0 && <div className="tablewrap"><table>
            <thead><tr><th>Размер</th><th className="num">План, шт</th><th /></tr></thead>
            <tbody>
              {o.sizes.map(z => (
                <tr key={z.id}>
                  <td>{z.size}</td>
                  <td className="num"><input type="number" min="1" style={{ width: 90 }} defaultValue={z.planned}
                    onBlur={e => Number(e.target.value) !== z.planned && run(() => api.patch(`/work-sizes/${z.id}/`, { planned: e.target.value }))} /></td>
                  <td><button className="btn small ghost" onClick={() => del(`/work-sizes/${z.id}/`, `Удалить размер ${z.size}?`)}>Удл.</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>}
        </div>
      )}

      {tab === 'route' && mayEdit && (
        <div className="card">
          <p className="muted" style={{ marginBottom: 8 }}>Отметьте этапы, которые проходит этот заказ. Этап, по которому уже есть записи, убрать нельзя.</p>
          {templates.map(t => (
            <label key={t.id} className="check">
              <input type="checkbox" checked={route.includes(t.id)} onChange={e => run(() => api.post(`/work-orders/${id}/set_route/`,
                { template_ids: e.target.checked ? [...route, t.id] : route.filter(x => x !== t.id) }))} />
              {t.name} <span className="muted">— {t.kind_display}</span>
            </label>
          ))}
        </div>
      )}

      {tab === 'brigades' && (
        <div className="card" style={{ padding: 0 }}>
          <div className="tablewrap"><table>
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
          </table></div>
        </div>
      )}

      {tab === 'fabric' && (
        <div className="card" style={{ padding: 0 }}>
          <div className="tablewrap"><table>
            <thead><tr><th>Материал</th><th className="num">Метров</th><th className="num">Скроено, шт</th><th className="num">м/шт</th></tr></thead>
            <tbody>
              {o.materials.length === 0 && <tr><td colSpan={4} className="muted">Метраж в крое не вносили.</td></tr>}
              {o.materials.map(m => (
                <tr key={m.material}><td>{m.material}</td><td className="num">{fmtD(m.meters)}</td>
                  <td className="num">{m.cut_qty}</td><td className="num">{fmtD(m.per_unit)}</td></tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  )
}
