import React, { useEffect, useState } from 'react'
import { api, fmt, fmtD, apiError, canEdit, can} from '../api'

const PO_STATUS = { planned: 'Запланирован', in_progress: 'В работе', done: 'Завершён', cancelled: 'Отменён' }

export default function Production({ user }) {
  // Вкладки принадлежат разным разделам прав: изделия и конструктор этапов —
  // это каталог, производственные заказы — производство. Кладовщик и цех
  // могут вести заказы, но не менять изделия, поэтому флага на всю
  // страницу мало.
  const roOrders = !canEdit(user, 'production.orders')
  const roProducts = !canEdit(user, 'catalog.products')
  const roStages = !canEdit(user, 'catalog.stages')
  const roBom = !canEdit(user, 'catalog.bom')
  const roRoutes = !canEdit(user, 'catalog.routes')
  // видимость вкладок — по чтению их ключей
  const seeOrders = can(user, 'production.orders')
  const seeProducts = can(user, 'catalog.products')
  const seeStages = can(user, 'catalog.stages')
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [materials, setMaterials] = useState([])
  const [contracts, setContracts] = useState([])
  const [users, setUsers] = useState([])
  const [tab, setTab] = useState(
    can(user, 'production.orders') ? 'orders'
      : can(user, 'catalog.products') ? 'products' : 'stages')
  const [form, setForm] = useState({ number: '', product: '', qty: '', contract: '' })
  const [detail, setDetail] = useState(null) // product detail with QR/BOM
  const [routeForm, setRouteForm] = useState({ template: '', norm_hours: '' })
  const [showProd, setShowProd] = useState(false)
  const [editProdId, setEditProdId] = useState(null)
  const [prodForm, setProdForm] = useState({ name: '', sku: '', base_price: '', labor_cost: '', norm_hours: '', overhead_cost: '', overhead_override: false })
  const [bomForm, setBomForm] = useState({ material: '', qty: '' })
  const [stages, setStages] = useState([])
  const [stageForm, setStageForm] = useState({ code: '', name: '', position: '', default_norm_hours: '' })

  const loadStages = () => api.get('/stage-templates/?page_size=100').then(r => setStages(r.data.results || []))
  // справочник нужен и во вкладке изделий — для выпадающего списка маршрута
  useEffect(() => { loadStages() }, [])

  const saveStage = async () => {
    try {
      await api.post('/stage-templates/', {
        ...stageForm,
        position: stageForm.position || stages.length,
        default_norm_hours: stageForm.default_norm_hours || 0,
      })
      setStageForm({ code: '', name: '', position: '', default_norm_hours: '' }); loadStages()
    } catch (e) { alert(apiError(e)) }
  }
  const patchStage = async (id, body) => { await api.patch(`/stage-templates/${id}/`, body); loadStages() }
  const delStage = async (s) => {
    if (!confirm(`Удалить этап «${s.name}»? Он исчезнет из новых производственных заказов.`)) return
    try { await api.delete(`/stage-templates/${s.id}/`); loadStages() }
    catch (e) { alert(apiError(e, 'Не удалось удалить')) }
  }

  const load = () => {
    api.get('/production-orders/').then(r => setOrders(r.data.results || []))
    api.get('/products/?page_size=200').then(r => setProducts(r.data.results || []))
  }
  useEffect(() => {
    load()
    api.get('/materials/?page_size=200').then(r => setMaterials(r.data.results || []))
    api.get('/contracts/?page_size=200').then(r => setContracts(r.data.results || []))
    api.get('/users/?page_size=200').then(r => setUsers(r.data.results || []))
  }, [])

  const create = async () => {
    await api.post('/production-orders/', { ...form, contract: form.contract || null })
    setForm({ number: '', product: '', qty: '', contract: '' }); load()
  }

  const resetProd = () => { setShowProd(false); setEditProdId(null); setProdForm({ name: '', sku: '', base_price: '', labor_cost: '', norm_hours: '', overhead_cost: '', overhead_override: false }) }
  const saveProduct = async () => {
    const body = {
      ...prodForm, base_price: prodForm.base_price || 0,
      labor_cost: prodForm.labor_cost || 0, norm_hours: prodForm.norm_hours || 0,
      overhead_cost: prodForm.overhead_cost || 0,
    }
    try {
      if (editProdId) await api.patch(`/products/${editProdId}/`, body)
      else await api.post('/products/', body)
      resetProd(); load()
      if (editProdId && detail?.id === editProdId) openProduct(editProdId)
    } catch (e) { alert(apiError(e)) }
  }
  const editProduct = (p, e) => {
    e.stopPropagation()
    setEditProdId(p.id); setShowProd(true)
    setProdForm({ name: p.name, sku: p.sku, base_price: p.base_price, labor_cost: p.labor_cost, norm_hours: p.norm_hours, overhead_cost: p.overhead_cost, overhead_override: p.overhead_override })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const deleteProduct = async (p, e) => {
    e.stopPropagation()
    if (!confirm(`Удалить изделие «${p.name}»?`)) return
    try { await api.delete(`/products/${p.id}/`); if (detail?.id === p.id) setDetail(null); load() }
    catch (e) { alert(apiError(e, 'Не удалось удалить')) }
  }

  const addBom = async () => {
    try {
      await api.post('/bom-items/', { product: detail.id, material: bomForm.material, qty: bomForm.qty })
      setBomForm({ material: '', qty: '' })
      openProduct(detail.id); load()
    } catch (e) { alert(apiError(e)) }
  }
  const addRoute = async () => {
    const next = (detail.route || []).length
    try {
      await api.post('/product-route/', {
        product: detail.id, template: routeForm.template,
        position: next, norm_hours: routeForm.norm_hours || 0,
      })
      setRouteForm({ template: '', norm_hours: '' }); openProduct(detail.id)
    } catch (e) { alert(apiError(e)) }
  }
  const patchRoute = async (id, body) => { await api.patch(`/product-route/${id}/`, body); openProduct(detail.id) }
  const delRoute = async (r) => {
    // кнопка стоит вплотную к стрелкам — без подтверждения легко промахнуться
    if (!confirm(`Убрать этап «${r.stage_name}» из маршрута изделия?`)) return
    await api.delete(`/product-route/${r.id}/`); openProduct(detail.id)
  }
  const moveRoute = async (i, dir) => {
    const list = [...(detail.route || [])]
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const t = list[i]; list[i] = list[j]; list[j] = t
    await api.post(`/products/${detail.id}/reorder_route/`, { order: list.map(r => r.id) })
    openProduct(detail.id)
  }
  const fillRoute = async () => {
    await api.post(`/products/${detail.id}/route_from_default/`); openProduct(detail.id)
  }

  const deleteBom = async (bid) => {
    if (!confirm('Убрать материал из состава?')) return
    try { await api.delete(`/bom-items/${bid}/`); openProduct(detail.id); load() }
    catch (e) { alert(apiError(e, 'Не удалось удалить')) }
  }

  const act = async (id, action) => {
    try { await api.post(`/production-orders/${id}/${action}/`); load() }
    catch (e) { alert(apiError(e)) }
  }

  const deleteOrder = async (o) => {
    if (!confirm(`Удалить производственный заказ ПЗ №${o.number}?`)) return
    try { await api.delete(`/production-orders/${o.id}/`); load() }
    catch (e) { alert(apiError(e, 'Не удалось удалить')) }
  }

  const stageAct = async (sid, action) => { await api.post(`/production-stages/${sid}/${action}/`); load() }
  const assign = async (sid, uid) => { await api.patch(`/production-stages/${sid}/`, { assignee: uid || null }); load() }
  const setNorm = async (sid, v) => { await api.patch(`/production-stages/${sid}/`, { norm_hours: v || 0 }); load() }

  const openProduct = async (id) => { const { data } = await api.get(`/products/${id}/`); setDetail(data) }

  return (
    <div>
      <div className="pagehead"><h1>Производство / Швейный цех</h1></div>
      <div className="tabs">
        {seeOrders && <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>Производственные заказы</button>}
        {seeProducts && <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>Изделия / BOM</button>}
        {seeStages && <button className={tab === 'stages' ? 'active' : ''} onClick={() => setTab('stages')}>Этапы цеха (конструктор)</button>}
      </div>

      {tab === 'stages' && (
        <div className={roStages ? 'readonly' : ''}>
          {roStages && <div className="ro-note"><b>Только просмотр.</b>&nbsp;Изделия и этапы настраивает технолог.</div>}
          <div className="card stitch">
            <h2>Конструктор этапов производства</h2>
            <p className="muted">Технолог собирает маршрут цеха с нуля: этапы, их порядок и нормы времени.
              Новые производственные заказы создаются по активным этапам этого списка.</p>
            <div className="formrow">
              <div><label className="f">Код (лат.)</label><input value={stageForm.code} onChange={e => setStageForm({ ...stageForm, code: e.target.value })} placeholder="embroidery" /></div>
              <div><label className="f">Название этапа</label><input value={stageForm.name} onChange={e => setStageForm({ ...stageForm, name: e.target.value })} placeholder="Вышивка логотипа" /></div>
              <div><label className="f">Порядок</label><input type="number" value={stageForm.position} onChange={e => setStageForm({ ...stageForm, position: e.target.value })} /></div>
              <div><label className="f">Норма часов</label><input type="number" value={stageForm.default_norm_hours} onChange={e => setStageForm({ ...stageForm, default_norm_hours: e.target.value })} /></div>
              <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={saveStage} disabled={!stageForm.code || !stageForm.name}>+ Добавить этап</button></div>
            </div>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th className="num">Порядок</th><th>Код</th><th>Название</th><th className="num">Норма, ч</th><th>Активен</th><th /></tr></thead>
              <tbody>
                {stages.map(s => (
                  <tr key={s.id}>
                    <td className="num"><input type="number" style={{ width: 60 }} defaultValue={s.position} onBlur={e => patchStage(s.id, { position: e.target.value || 0 })} /></td>
                    <td>{s.code}</td>
                    <td><input defaultValue={s.name} onBlur={e => patchStage(s.id, { name: e.target.value })} /></td>
                    <td className="num"><input type="number" style={{ width: 70 }} defaultValue={s.default_norm_hours} onBlur={e => patchStage(s.id, { default_norm_hours: e.target.value || 0 })} /></td>
                    <td><input type="checkbox" style={{ width: 'auto' }} checked={s.is_active} onChange={e => patchStage(s.id, { is_active: e.target.checked })} /></td>
                    <td><button className="btn small ghost" onClick={() => delStage(s)}>Удл.</button></td>
                  </tr>
                ))}
                {stages.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>Этапов нет — добавьте первый.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'orders' && (
        <div className={roOrders ? 'readonly' : ''}>
          {roOrders && <div className="ro-note"><b>Только просмотр.</b>&nbsp;Запускать заказы и отмечать этапы может цех, кладовщик или технолог.</div>}
          <div className="card stitch">
            <h2>Новый производственный заказ</h2>
            <div className="formrow">
              <div><label className="f">Номер <span className="muted">(можно не заполнять)</span></label>
                <input value={form.number} placeholder="присвоится сам"
                  onChange={e => setForm({ ...form, number: e.target.value })} /></div>
              <div><label className="f">Изделие</label>
                <select value={form.product} onChange={e => setForm({ ...form, product: e.target.value })}>
                  <option value="">—</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></div>
              <div><label className="f">Кол-во</label><input type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /></div>
              <div><label className="f">Договор</label>
                <select value={form.contract} onChange={e => setForm({ ...form, contract: e.target.value })}>
                  <option value="">—</option>
                  {contracts.map(c => <option key={c.id} value={c.id}>{c.number}</option>)}
                </select></div>
              <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={create} disabled={!form.product || !form.qty}>Создать</button></div>
            </div>
            <p className="muted">Запуск заказа автоматически списывает материалы по BOM; завершение — приходует готовую продукцию на склад.</p>
          </div>

          {orders.map(o => (
            <div key={o.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <div>
                  <b>ПЗ №{o.number}</b> — {o.product_name} × {o.qty} шт
                  {o.contract_number && <span className="muted"> · договор {o.contract_number}</span>}
                  <span className="pill imp" style={{ marginLeft: 8 }}>{PO_STATUS[o.status]}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {o.status === 'planned' && <button className="btn small orange" onClick={() => act(o.id, 'start')}>Запуск (списать материалы)</button>}
                  {o.status === 'in_progress' && <button className="btn small" onClick={() => act(o.id, 'finish')}>Завершить (на склад)</button>}
                  {o.status === 'planned' && <button className="btn small ghost" onClick={() => deleteOrder(o)}>Удалить</button>}
                </div>
              </div>
              <div className="stageflow">
                {o.stages.map(s => (
                  <div key={s.id} className={`stage ${s.status}`}>
                    <div className="n">{s.stage_label}</div>
                    <div className="m">
                      Ответственный:{' '}
                      <select style={{ padding: '2px 4px', fontSize: 11, width: 'auto' }} value={s.assignee || ''} onChange={e => assign(s.id, e.target.value)}>
                        <option value="">—</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.first_name || u.username}</option>)}
                      </select>
                    </div>
                    <div className="m">Норма: <input type="number" style={{ width: 52, padding: '1px 4px', fontSize: 11 }} defaultValue={s.norm_hours} onBlur={e => setNorm(s.id, e.target.value)} /> ч · Факт: {fmtD(s.actual_hours)} ч
                      {s.status === 'done' && <span style={{ color: s.deviation_hours > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}> ({s.deviation_hours > 0 ? '+' : ''}{fmtD(s.deviation_hours)})</span>}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      {s.status === 'pending' && <button className="btn small ghost" onClick={() => stageAct(s.id, 'start')}>Начать</button>}
                      {s.status === 'in_progress' && <button className="btn small" onClick={() => stageAct(s.id, 'done')}>Готово</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'products' && (
        <div className={roProducts ? 'readonly' : ''}>
          {roProducts && <div className="ro-note"><b>Только просмотр.</b>&nbsp;Изделия и этапы настраивает технолог.</div>}
          <div className="pagehead" style={{ marginTop: 0 }}>
            <span className="muted">Справочник изделий. Себестоимость и маржа считаются автоматически из BOM и цен материалов.</span>
            <button className="btn small" onClick={() => showProd ? resetProd() : setShowProd(true)}>{showProd ? 'Закрыть' : '+ Новое изделие'}</button>
          </div>
          {showProd && (
            <div className="card stitch">
              <h2>{editProdId ? 'Редактирование изделия' : 'Новое изделие'}</h2>
              <div className="formrow">
                <div><label className="f">Название</label><input value={prodForm.name} onChange={e => setProdForm({ ...prodForm, name: e.target.value })} /></div>
                <div><label className="f">SKU (артикул)</label><input value={prodForm.sku} onChange={e => setProdForm({ ...prodForm, sku: e.target.value })} /></div>
                <div><label className="f">Цена продажи, ₸</label><input type="number" value={prodForm.base_price} onChange={e => setProdForm({ ...prodForm, base_price: e.target.value })} /></div>
                <div><label className="f">Труд на 1 шт., ₸ <span className="muted">(переменный)</span></label><input type="number" value={prodForm.labor_cost} onChange={e => setProdForm({ ...prodForm, labor_cost: e.target.value })} /></div>
                <div><label className="f">Норма времени, ч</label><input type="number" step="0.1" value={prodForm.norm_hours} onChange={e => setProdForm({ ...prodForm, norm_hours: e.target.value })} /></div>
                <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 6 }}>
                  <button className="btn" onClick={saveProduct} disabled={!prodForm.name || !prodForm.sku}>Сохранить</button>
                  <button className="btn ghost" onClick={resetProd}>Отмена</button>
                </div>
              </div>
              <div className="formrow">
                <div style={{ alignSelf: 'center' }}>
                  <label style={{ fontSize: 13 }}>
                    <input type="checkbox" style={{ width: 'auto', marginRight: 6 }}
                      checked={prodForm.overhead_override}
                      onChange={e => setProdForm({ ...prodForm, overhead_override: e.target.checked })} />
                    Задать накладные вручную
                  </label></div>
                {prodForm.overhead_override && (
                  <div><label className="f">Накладные на 1 шт., ₸</label><input type="number" value={prodForm.overhead_cost} onChange={e => setProdForm({ ...prodForm, overhead_cost: e.target.value })} /></div>
                )}
              </div>
              <p className="muted">Накладные по умолчанию считаются автоматически из постоянных расходов
                (раздел «Финансы» → «Постоянные расходы») и нормы времени. Материалы берутся из BOM.</p>
            </div>
          )}
          <div className="grid2">
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead><tr><th>Изделие</th><th>SKU</th><th className="num">Цена</th><th className="num">Себестоимость</th><th className="num">Маржа %</th><th className="num">На складе</th><th /></tr></thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => openProduct(p.id)}>
                      <td style={{ fontWeight: 700, color: 'var(--indigo)' }}>{p.name}</td>
                      <td>{p.sku}</td>
                      <td className="num">{fmt(p.base_price)}</td>
                      <td className="num">{fmt(p.cost_price)}</td>
                      <td className="num">{p.margin_percent.toFixed(1)}%</td>
                      <td className="num">{p.fg_stock}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn small ghost" onClick={(e) => editProduct(p, e)}>Изм.</button>{' '}
                        <button className="btn small ghost" onClick={(e) => deleteProduct(p, e)}>Удл.</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              {detail ? (
                <div className="card stitch">
                  <h2>{detail.name}</h2>
                  <img src={detail.qr} alt="QR" width={110} style={{ float: 'right', border: '1px solid var(--line)', borderRadius: 8 }} />
                  <p className="muted">SKU: {detail.sku} · штрих/QR-код готов к сканированию</p>
                  <p style={{ margin: '8px 0' }}>
                    Материалы: <b>{fmt(detail.material_cost)} ₸</b> · Труд: <b>{fmt(detail.labor_cost)} ₸</b> · Накладные: <b>{fmt(detail.overhead_cost)} ₸</b><br />
                    Себестоимость: <b>{fmt(detail.cost_price)} ₸</b> → Цена: <b>{fmt(detail.base_price)} ₸</b> (маржа {detail.margin_percent.toFixed(1)}%)
                  </p>
                  <div className={roBom ? 'readonly' : ''}>
                  <h2 style={{ marginTop: 12 }}>Спецификация (BOM) — на 1 шт.</h2>
                  <table>
                    <thead><tr><th>Материал</th><th className="num">Норма</th><th className="num">Цена</th><th /></tr></thead>
                    <tbody>
                      {detail.bom_items.map(b => (
                        <tr key={b.id}><td>{b.material_name}</td><td className="num">{fmtD(b.qty)} {b.material_unit}</td><td className="num">{fmt(b.material_price)}</td>
                          <td><button className="btn small ghost" onClick={() => deleteBom(b.id)}>✕</button></td></tr>
                      ))}
                      {detail.bom_items.length === 0 && <tr><td colSpan={4} className="muted">Состав пуст — добавьте материалы ниже.</td></tr>}
                    </tbody>
                  </table>
                  <div className="formrow" style={{ marginTop: 10 }}>
                    <div><label className="f">Материал</label>
                      <select value={bomForm.material} onChange={e => setBomForm({ ...bomForm, material: e.target.value })}>
                        <option value="">—</option>{materials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                      </select></div>
                    <div><label className="f">Норма на 1 шт.</label><input type="number" step="0.001" value={bomForm.qty} onChange={e => setBomForm({ ...bomForm, qty: e.target.value })} /></div>
                    <div style={{ alignSelf: 'flex-end' }}><button className="btn small" onClick={addBom} disabled={!bomForm.material || !bomForm.qty}>+ В состав</button></div>
                  </div>
                  </div>

                  <div className={roRoutes ? 'readonly' : ''}>
                  <h2 style={{ marginTop: 18 }}>Маршрут по цеху</h2>
                  <p className="muted">Через какие этапы проходит именно это изделие.
                    {(detail.route || []).length === 0
                      ? ' Пока маршрут пуст, заказы собираются по общему справочнику — одинаково для всех изделий.'
                      : ' Новые заказы по этому изделию пойдут ровно по этим этапам, в этом порядке.'}</p>
                  <table>
                    <thead><tr><th>#</th><th>Этап</th><th className="num">Норма, ч</th><th /></tr></thead>
                    <tbody>
                      {(detail.route || []).map((r, i) => (
                        <tr key={r.id}>
                          <td className="num">{i + 1}</td>
                          <td>{r.stage_name}</td>
                          <td className="num">
                            <input type="number" step="0.01" style={{ width: 90 }} defaultValue={r.norm_hours}
                              onBlur={e => patchRoute(r.id, { norm_hours: e.target.value || 0 })} />
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button className="btn small ghost" onClick={() => moveRoute(i, -1)}
                              disabled={i === 0} title="Выше">↑</button>{' '}
                            <button className="btn small ghost" onClick={() => moveRoute(i, 1)}
                              disabled={i === (detail.route || []).length - 1} title="Ниже">↓</button>{' '}
                            <button className="btn small ghost" onClick={() => delRoute(r)} title="Убрать">✕</button>
                          </td>
                        </tr>
                      ))}
                      {(detail.route || []).length === 0 && (
                        <tr><td colSpan={4} className="muted">
                          Своего маршрута нет — используется общий справочник этапов.
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                  <div className="formrow" style={{ marginTop: 10 }}>
                    <div><label className="f">Добавить этап</label>
                      <select value={routeForm.template} onChange={e => setRouteForm({ ...routeForm, template: e.target.value })}>
                        <option value="">—</option>
                        {stages.filter(st => !(detail.route || []).some(r => r.template === st.id))
                               .map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                      </select></div>
                    <div><label className="f">Норма, ч</label>
                      <input type="number" step="0.01" value={routeForm.norm_hours}
                        onChange={e => setRouteForm({ ...routeForm, norm_hours: e.target.value })} placeholder="0" /></div>
                    <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 6 }}>
                      <button className="btn small" onClick={addRoute} disabled={!routeForm.template}>+ В маршрут</button>
                      {(detail.route || []).length === 0 &&
                        <button className="btn small ghost" onClick={fillRoute}>Взять стандартный</button>}
                    </div>
                  </div>
                  </div>
                </div>
              ) : <div className="card muted">Выберите изделие — откроются BOM, себестоимость и QR-код.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
