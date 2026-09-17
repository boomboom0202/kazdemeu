import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmt, fmtD, apiError, can, canEdit, today, dmy, pickOrCreate } from '../api'

// У каждой вкладки свой ключ доступа
const TABS = [
  ['materials', 'warehouse.materials', 'Материалы'],
  ['receipts', 'warehouse.receipts', 'Приход'],
  ['issues', 'warehouse.issues', 'Выдача в цех'],
  ['goods', 'warehouse.goods', 'Готовая продукция'],
  ['suppliers', 'warehouse.suppliers', 'Поставщики'],
]

/**
 * Склад: ткань и фурнитура — приход партиями, выдача в цех под заказ;
 * готовая продукция — то, что прошло последний этап заказа цеха, и отгрузка.
 */
export default function Warehouse({ user }) {
  const visible = TABS.filter(([, key]) => can(user, key))
  const [tab, setTab] = useState(visible[0]?.[0] || 'materials')
  const key = TABS.find(([t]) => t === tab)?.[1]
  const ro = !canEdit(user, key)
  const [materials, setMaterials] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [orders, setOrders] = useState([])

  const loadMaterials = () => can(user, 'warehouse.materials') &&
    api.get('/materials/?page_size=2000').then(r => setMaterials(r.data.results || []))
  const loadSuppliers = () => can(user, 'warehouse.suppliers') &&
    api.get('/suppliers/?page_size=1000').then(r => setSuppliers(r.data.results || []))
  useEffect(() => {
    loadMaterials(); loadSuppliers()
    if (can(user, 'workshop.orders')) api.get('/work-orders/?page_size=1000&status=in_work').then(r => setOrders(r.data.results || [])).catch(() => {})
  }, [])

  return (
    <div className={ro ? 'readonly' : ''}>
      <div className="pagehead"><h1>Склад</h1></div>
      {ro && <div className="ro-note"><b>Только просмотр.</b>&nbsp;Эта вкладка доступна вам без права изменения.</div>}
      <div className="tabs">
        {visible.map(([t, , label]) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{label}</button>)}
      </div>
      {tab === 'materials' && <Materials materials={materials} suppliers={suppliers} setSuppliers={setSuppliers} reload={loadMaterials} />}
      {tab === 'receipts' && <Receipts materials={materials} suppliers={suppliers} setSuppliers={setSuppliers} reload={loadMaterials} />}
      {tab === 'issues' && <Issues materials={materials} orders={orders} reload={loadMaterials} />}
      {tab === 'goods' && <Goods user={user} />}
      {tab === 'suppliers' && <Suppliers suppliers={suppliers} reload={loadSuppliers} />}
    </div>
  )
}

function Materials({ materials, suppliers, setSuppliers, reload }) {
  const empty = { name: '', sku: '', unit: 'м', min_stock: '', supplier_name: '' }
  const [form, setForm] = useState(empty)
  const [editId, setEditId] = useState(null)
  const [show, setShow] = useState(false)
  const save = async () => {
    try {
      const { supplier_name, ...rest } = form
      const body = { ...rest, min_stock: form.min_stock || 0,
        default_supplier: await pickOrCreate(supplier_name, suppliers, '/suppliers/', setSuppliers) }
      if (editId) await api.patch(`/materials/${editId}/`, body)
      else await api.post('/materials/', body)
      setForm(empty); setEditId(null); setShow(false); reload()
    } catch (e) { alert(apiError(e)) }
  }
  const low = materials.filter(m => m.low_stock).length
  return (
    <>
      <div className="pagehead" style={{ marginTop: 0 }}>
        <span className="muted">{materials.length} материалов{low ? <> · <b className="neg">{low} заканчивается</b></> : ''}</span>
        <button className="btn small" onClick={() => { setShow(s => !s); setEditId(null); setForm(empty) }}>{show ? 'Закрыть' : '+ Материал'}</button>
      </div>
      {show && (
        <div className="card stitch">
          <h2>{editId ? 'Изменить материал' : 'Новый материал'}</h2>
          <div className="formrow">
            <div style={{ flex: 2 }}><label className="f">Название</label><input value={form.name} placeholder="Ткань оксфорд (основа)" onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="f">Артикул</label><input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} /></div>
            <div><label className="f">Ед. изм.</label><input value={form.unit} placeholder="м, шт, кг" onChange={e => setForm({ ...form, unit: e.target.value })} /></div>
            <div><label className="f">Мин. остаток</label><input type="number" value={form.min_stock} onChange={e => setForm({ ...form, min_stock: e.target.value })} /></div>
            <div><label className="f">Поставщик</label>
              <input list="wh-suppliers" value={form.supplier_name} placeholder="выбрать или вписать"
                onChange={e => setForm({ ...form, supplier_name: e.target.value })} />
              <datalist id="wh-suppliers">{suppliers.map(s => <option key={s.id} value={s.name} />)}</datalist></div>
            <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={save} disabled={!form.name}>Сохранить</button></div>
          </div>
          <p className="muted">Когда остаток опустится ниже минимума, придёт уведомление.</p>
        </div>
      )}
      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap"><table>
          <thead><tr><th>Материал</th><th className="num">Остаток</th><th className="num">Мин.</th><th className="num">Ср. цена</th><th>Поставщик</th><th /><th /></tr></thead>
          <tbody>
            {materials.length === 0 && <tr><td colSpan={7} className="muted">Материалов нет.</td></tr>}
            {materials.map(m => (
              <tr key={m.id}>
                <td><b>{m.name}</b>{m.sku && <div className="muted">{m.sku}</div>}</td>
                <td className="num">{fmtD(m.stock)} {m.unit}</td>
                <td className="num">{fmtD(m.min_stock)}</td>
                <td className="num">{fmt(m.avg_price)}</td>
                <td>{m.default_supplier_name || '—'}</td>
                <td>{m.low_stock ? <span className="pill low">мало</span> : <span className="pill ok">хватает</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn small ghost" onClick={() => { setEditId(m.id); setShow(true); setForm({ name: m.name, sku: m.sku, unit: m.unit, min_stock: m.min_stock, supplier_name: m.default_supplier_name || '' }) }}>Изм.</button>{' '}
                  <button className="btn small ghost" onClick={async () => { if (!confirm(`Удалить материал «${m.name}»? С ним удалится история движений.`)) return
                    try { await api.delete(`/materials/${m.id}/`); reload() } catch (e) { alert(apiError(e)) } }}>Удл.</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  )
}

function Receipts({ materials, suppliers, setSuppliers, reload }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState({ material: '', supplier_name: '', qty: '', unit_price: '', batch_no: '', received_at: today() })
  const load = () => api.get('/material-batches/?page_size=1000').then(r => setRows(r.data.results || []))
  useEffect(() => { load() }, [])
  const add = async () => {
    try {
      const { supplier_name, ...rest } = form
      await api.post('/material-batches/', { ...rest, unit_price: form.unit_price || 0,
        supplier: await pickOrCreate(supplier_name, suppliers, '/suppliers/', setSuppliers) })
      setForm({ ...form, qty: '', unit_price: '', batch_no: '' }); load(); reload()
    } catch (e) { alert(apiError(e)) }
  }
  return (
    <>
      <div className="card stitch">
        <h2>Приход партии</h2>
        <div className="formrow">
          <div style={{ flex: 2 }}><label className="f">Материал</label>
            <select value={form.material} onChange={e => setForm({ ...form, material: e.target.value })}>
              <option value="">—</option>{materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></div>
          <div><label className="f">Поставщик</label>
            <input list="wh-suppliers-in" value={form.supplier_name} placeholder="выбрать или вписать"
              onChange={e => setForm({ ...form, supplier_name: e.target.value })} />
            <datalist id="wh-suppliers-in">{suppliers.map(s => <option key={s.id} value={s.name} />)}</datalist></div>
          <div><label className="f">Кол-во</label><input type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /></div>
          <div><label className="f">Цена за ед.</label><input type="number" value={form.unit_price} onChange={e => setForm({ ...form, unit_price: e.target.value })} /></div>
          <div><label className="f">Партия №</label><input value={form.batch_no} onChange={e => setForm({ ...form, batch_no: e.target.value })} /></div>
          <div><label className="f">Дата</label><input type="date" value={form.received_at} onChange={e => setForm({ ...form, received_at: e.target.value })} /></div>
          <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={add} disabled={!form.material || !form.qty}>Принять</button></div>
        </div>
        {materials.length === 0 && <p className="neg">Материалов пока нет — сначала заведите ткань во вкладке «Материалы», потом принимайте партии.</p>}
        <p className="muted">Деньги за ткань пишутся расходом в договор, под который её купили. Здесь — сколько пришло на склад.</p>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap"><table>
          <thead><tr><th>Дата</th><th>Материал</th><th>Поставщик</th><th className="num">Кол-во</th><th className="num">Цена</th><th>Партия</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">Приходов нет.</td></tr>}
            {rows.map(b => (
              <tr key={b.id}>
                <td>{dmy(b.received_at)}</td><td>{b.material_name}</td><td>{b.supplier_name || '—'}</td>
                <td className="num">{fmtD(b.qty)} {b.material_unit}</td><td className="num">{fmt(b.unit_price)}</td><td>{b.batch_no || '—'}</td>
                <td><button className="btn small ghost" onClick={async () => {
                  if (!confirm(`Сторнировать приход ${fmtD(b.qty)} «${b.material_name}»?`)) return
                  try { await api.post(`/material-batches/${b.id}/reverse/`); load(); reload() } catch (e) { alert(apiError(e)) }
                }}>Сторно</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  )
}

function Issues({ materials, orders, reload }) {
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('')
  const [form, setForm] = useState({ material: '', reason: 'production', qty: '', work_order: '', note: '' })
  const load = () => {
    const p = new URLSearchParams({ page_size: 1000 })
    if (filter) p.set('material', filter)
    api.get('/stock-movements/?' + p).then(r => setRows(r.data.results || []))
  }
  useEffect(() => { load() }, [filter])
  const mat = materials.find(m => String(m.id) === String(form.material))
  const add = async () => {
    const n = Number(form.qty)
    const qty = form.reason === 'production' ? -Math.abs(n) : form.reason === 'return' ? Math.abs(n) : n
    try {
      await api.post('/stock-movements/', { material: form.material, reason: form.reason, qty,
        work_order: form.work_order || null, note: form.note })
      setForm({ ...form, qty: '', note: '' }); load(); reload()
    } catch (e) { alert(apiError(e)) }
  }
  return (
    <>
      <div className="card stitch">
        <h2>Выдать в цех или поправить остаток</h2>
        <div className="formrow">
          <div><label className="f">Операция</label>
            <select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}>
              <option value="production">Выдача в цех</option>
              <option value="return">Возврат из цеха</option>
              <option value="adjustment">Корректировка (+/−)</option>
            </select></div>
          <div style={{ flex: 2 }}><label className="f">Материал</label>
            <select value={form.material} onChange={e => setForm({ ...form, material: e.target.value })}>
              <option value="">—</option>{materials.map(m => <option key={m.id} value={m.id}>{m.name} · {fmtD(m.stock)} {m.unit}</option>)}
            </select></div>
          <div><label className="f">{form.reason === 'adjustment' ? 'Кол-во (минус — списать)' : 'Кол-во'}</label>
            <input type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /></div>
          {form.reason !== 'adjustment' && <div style={{ flex: 2 }}><label className="f">Заказ цеха</label>
            <select value={form.work_order} onChange={e => setForm({ ...form, work_order: e.target.value })}>
              <option value="">—</option>{orders.map(o => <option key={o.id} value={o.id}>{o.product}{o.contract_number ? ` · ${o.contract_number}` : ''}</option>)}
            </select></div>}
          <div><label className="f">Примечание</label><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
          <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={add} disabled={!form.material || !form.qty}>Провести</button></div>
        </div>
        {materials.length === 0 && <p className="neg">Материалов пока нет — заведите их во вкладке «Материалы» и оприходуйте во вкладке «Приход».</p>}
        {mat && <p className="muted">На складе {fmtD(mat.stock)} {mat.unit}.</p>}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="toolbar">
          <b>Движения материалов</b>
          <select style={{ width: 'auto', marginLeft: 'auto' }} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="">Все материалы</option>{materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="tablewrap"><table>
          <thead><tr><th>Когда</th><th>Материал</th><th className="num">Движение</th><th>Операция</th><th>Заказ цеха</th><th>Примечание</th><th>Кто</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">Движений нет.</td></tr>}
            {rows.map(mv => (
              <tr key={mv.id}>
                <td>{new Date(mv.created_at).toLocaleString('ru-RU')}</td>
                <td>{mv.material_name}</td>
                <td className={'num ' + (mv.qty > 0 ? 'pos' : 'neg')}>{mv.qty > 0 ? '+' : ''}{fmtD(mv.qty)} {mv.material_unit}</td>
                <td>{mv.reason_display}</td>
                <td>{mv.work_order ? <Link to={`/workshop/orders/${mv.work_order}`}>{mv.work_order_label}</Link> : '—'}</td>
                <td>{mv.note || '—'}</td>
                <td>{mv.created_by_name || 'система'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  )
}

function Goods({ user }) {
  const [lines, setLines] = useState([])
  const [moves, setMoves] = useState([])
  const [ship, setShip] = useState(null)
  const [shipForm, setShipForm] = useState({ qty: '', date: today(), note: '' })
  const [inForm, setInForm] = useState({ product: '', size: '', qty: '', note: 'Остаток при переходе на систему' })
  const [onlyStock, setOnlyStock] = useState(true)
  const load = () => {
    api.get('/goods-movements/stock/').then(r => setLines(r.data))
    api.get('/goods-movements/?page_size=500').then(r => setMoves(r.data.results || []))
  }
  useEffect(() => { load() }, [])
  const run = async (fn) => { try { await fn(); load() } catch (e) { alert(apiError(e)) } }
  const shown = lines.filter(l => !onlyStock || l.stock > 0)
  const total = shown.reduce((a, l) => a + l.stock, 0)

  return (
    <>
      <div className="card" style={{ padding: 0 }}>
        <div className="toolbar">
          <b>Готовая продукция</b><span className="muted">на складе {fmt(total)} шт</span>
          <label className="check" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={onlyStock} onChange={e => setOnlyStock(e.target.checked)} />только то, что лежит</label>
        </div>
        <div className="tablewrap"><table className="sheet">
          <thead><tr><th>Изделие</th><th>Размер</th><th>Договор</th><th className="num">Из цеха</th><th className="num">Внесено</th><th className="num">Отгружено</th><th className="num">На складе</th><th /></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={8} className="muted">Пусто. Изделия появляются здесь, когда проходят последний этап заказа в цехе.</td></tr>}
            {shown.map((l, i) => (
              <tr key={i}>
                <td>{l.order ? <Link to={`/workshop/orders/${l.order}`}>{l.product}</Link> : l.product}</td>
                <td>{l.size || '—'}</td>
                <td>{l.contract ? (can(user, 'contracts.contracts') ? <Link to={`/contracts/${l.contract}`}>{l.contract_number}</Link> : l.contract_number) : '—'}
                  {l.customer && <div className="muted">{l.customer}</div>}</td>
                <td className="num">{l.made}</td><td className="num">{l.received || ''}</td><td className="num">{l.shipped || ''}</td>
                <td className="num"><b>{l.stock}</b></td>
                <td>{l.stock > 0 && <button className="btn small ghost" onClick={() => { setShip(l); setShipForm({ qty: l.stock, date: today(), note: '' }) }}>Отгрузить</button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {ship && (
        <div className="card stitch">
          <h2>Отгрузка: {ship.product} {ship.size}</h2>
          <div className="formrow">
            <div><label className="f">Штук (на складе {ship.stock})</label><input type="number" min="1" value={shipForm.qty} onChange={e => setShipForm({ ...shipForm, qty: e.target.value })} /></div>
            <div><label className="f">Дата</label><input type="date" value={shipForm.date} onChange={e => setShipForm({ ...shipForm, date: e.target.value })} /></div>
            <div style={{ flex: 2 }}><label className="f">Примечание</label><input value={shipForm.note} placeholder="накладная №, куда" onChange={e => setShipForm({ ...shipForm, note: e.target.value })} /></div>
            <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 6 }}>
              <button className="btn" disabled={!shipForm.qty} onClick={() => run(async () => {
                await api.post('/goods-movements/', { kind: 'out', work_order: ship.order, product: ship.product, size: ship.size,
                  contract: ship.contract, qty: shipForm.qty, date: shipForm.date, note: shipForm.note })
                setShip(null)
              })}>Отгрузить</button>
              <button className="btn ghost" onClick={() => setShip(null)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid2">
        <div className="card stitch">
          <h2>Внести остаток</h2>
          <p className="muted" style={{ marginBottom: 8 }}>Для того, что уже лежало на складе до перехода на систему. Выпуск цеха вносить не нужно — он появляется сам.</p>
          <div className="formrow">
            <div style={{ flex: 2 }}><label className="f">Изделие</label><input value={inForm.product} onChange={e => setInForm({ ...inForm, product: e.target.value })} /></div>
            <div><label className="f">Размер</label><input value={inForm.size} placeholder="54/176, XL" title="Размер/рост по сетке: 54/176, 56-58/170-176, 50, XL — или пусто" onChange={e => setInForm({ ...inForm, size: e.target.value })} /></div>
            <div><label className="f">Штук</label><input type="number" value={inForm.qty} onChange={e => setInForm({ ...inForm, qty: e.target.value })} /></div>
          </div>
          <button className="btn" disabled={!inForm.product || !inForm.qty} onClick={() => run(async () => {
            await api.post('/goods-movements/', { kind: 'in', ...inForm }); setInForm({ ...inForm, product: '', size: '', qty: '' })
          })}>Внести</button>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <div className="toolbar"><b>Отгрузки и внесения</b></div>
          <div className="tablewrap" style={{ maxHeight: 340, overflowY: 'auto' }}><table>
            <tbody>
              {moves.length === 0 && <tr><td className="muted">Записей нет.</td></tr>}
              {moves.map(m => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{dmy(m.date)}</td>
                  <td>{m.kind === 'out' ? <span className="pill low">отгрузка</span> : <span className="pill ok">внесено</span>}</td>
                  <td>{m.product} {m.size}{m.contract_number && <div className="muted">договор {m.contract_number}</div>}</td>
                  <td className="num">{m.qty}</td>
                  <td><button className="btn small ghost" onClick={() => confirm('Удалить запись?') && run(() => api.delete(`/goods-movements/${m.id}/`))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>
    </>
  )
}

function Suppliers({ suppliers, reload }) {
  const empty = { name: '', phone: '', email: '', bin_iin: '' }
  const [form, setForm] = useState(empty)
  const [editId, setEditId] = useState(null)
  const save = async () => {
    try {
      if (editId) await api.patch(`/suppliers/${editId}/`, form)
      else await api.post('/suppliers/', form)
      setForm(empty); setEditId(null); reload()
    } catch (e) { alert(apiError(e)) }
  }
  return (
    <>
      <div className="card stitch">
        <h2>{editId ? 'Изменить поставщика' : 'Новый поставщик'}</h2>
        <div className="formrow">
          <div style={{ flex: 2 }}><label className="f">Название</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="f">Телефон</label><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
          <div><label className="f">Email</label><input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="f">БИН/ИИН</label><input value={form.bin_iin} onChange={e => setForm({ ...form, bin_iin: e.target.value })} /></div>
          <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 6 }}>
            <button className="btn" onClick={save} disabled={!form.name}>Сохранить</button>
            {editId && <button className="btn ghost" onClick={() => { setEditId(null); setForm(empty) }}>Отмена</button>}
          </div>
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap"><table>
          <thead><tr><th>Название</th><th>Телефон</th><th>Email</th><th>БИН/ИИН</th><th /></tr></thead>
          <tbody>
            {suppliers.length === 0 && <tr><td colSpan={5} className="muted">Поставщиков нет.</td></tr>}
            {suppliers.map(s => (
              <tr key={s.id}><td><b>{s.name}</b></td><td>{s.phone || '—'}</td><td>{s.email || '—'}</td><td>{s.bin_iin || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn small ghost" onClick={() => { setEditId(s.id); setForm({ name: s.name, phone: s.phone || '', email: s.email || '', bin_iin: s.bin_iin || '' }) }}>Изм.</button>{' '}
                  <button className="btn small ghost" onClick={async () => { if (!confirm(`Удалить «${s.name}»?`)) return
                    try { await api.delete(`/suppliers/${s.id}/`); reload() } catch (e) { alert(apiError(e)) } }}>Удл.</button>
                </td></tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
