import React, { useEffect, useState } from 'react'
import { api, fmt, fmtD, apiError, canEdit} from '../api'

const PO_ST = { draft: 'Черновик', sent: 'Отправлена', received: 'Получена', cancelled: 'Отменена' }

export default function Warehouse({ user }) {
  // склад некоторые роли только читают — тогда прячем всё, что пишет
  const ro = !canEdit(user, 'warehouse')
  const [tab, setTab] = useState('materials')
  const [materials, setMaterials] = useState([])
  const [batches, setBatches] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [pos, setPos] = useState([])
  const [fg, setFg] = useState([])
  const [products, setProducts] = useState([])
  const [contracts, setContracts] = useState([])
  const [batchForm, setBatchForm] = useState({ material: '', supplier: '', qty: '', unit_price: '', batch_no: '', received_at: new Date().toISOString().slice(0, 10) })
  const [shipForm, setShipForm] = useState({ product: '', qty: '', contract: '', note: '' })
  const [showMat, setShowMat] = useState(false)
  const [editMatId, setEditMatId] = useState(null)
  const [matForm, setMatForm] = useState({ name: '', sku: '', unit: 'м', min_stock: '', default_supplier: '' })
  const [showSup, setShowSup] = useState(false)
  const [editSupId, setEditSupId] = useState(null)
  const [supForm, setSupForm] = useState({ name: '', phone: '', email: '', bin_iin: '' })
  const [movements, setMovements] = useState([])
  const [moveMat, setMoveMat] = useState('')

  const loadMovements = () => {
    const p = new URLSearchParams({ page_size: '200' })
    if (moveMat) p.set('material', moveMat)
    api.get('/stock-movements/?' + p).then(r => setMovements(r.data.results || []))
  }
  useEffect(() => { if (tab === 'movements') loadMovements() }, [tab, moveMat])

  const openMovements = (mid) => { setMoveMat(String(mid)); setTab('movements') }

  const load = () => {
    api.get('/materials/?page_size=200').then(r => setMaterials(r.data.results || []))
    api.get('/material-batches/?page_size=200').then(r => setBatches(r.data.results || []))
    api.get('/purchase-orders/?page_size=100').then(r => setPos(r.data.results || []))
    api.get('/finished-goods/?page_size=100').then(r => setFg(r.data.results || []))
  }
  const loadSuppliers = () => api.get('/suppliers/?page_size=200').then(r => setSuppliers(r.data.results || []))
  useEffect(() => {
    load()
    loadSuppliers()
    api.get('/products/?page_size=200').then(r => setProducts(r.data.results || []))
    api.get('/contracts/?page_size=200').then(r => setContracts(r.data.results || []))
  }, [])

  const resetMat = () => { setShowMat(false); setEditMatId(null); setMatForm({ name: '', sku: '', unit: 'м', min_stock: '', default_supplier: '' }) }
  const saveMaterial = async () => {
    const body = { ...matForm, min_stock: matForm.min_stock || 0, default_supplier: matForm.default_supplier || null }
    try {
      if (editMatId) await api.patch(`/materials/${editMatId}/`, body)
      else await api.post('/materials/', body)
      resetMat(); load()
    } catch (e) { alert(apiError(e)) }
  }
  const editMaterial = (m) => {
    setEditMatId(m.id); setShowMat(true)
    setMatForm({ name: m.name, sku: m.sku, unit: m.unit, min_stock: m.min_stock, default_supplier: m.default_supplier || '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const deleteMaterial = async (m) => {
    if (!confirm(`Удалить материал «${m.name}»?`)) return
    try { await api.delete(`/materials/${m.id}/`); load() }
    catch (e) { alert(apiError(e, 'Не удалось удалить')) }
  }

  const resetSup = () => { setShowSup(false); setEditSupId(null); setSupForm({ name: '', phone: '', email: '', bin_iin: '' }) }
  const saveSupplier = async () => {
    try {
      if (editSupId) await api.patch(`/suppliers/${editSupId}/`, supForm)
      else await api.post('/suppliers/', supForm)
      resetSup(); loadSuppliers()
    } catch (e) { alert(apiError(e)) }
  }
  const editSupplier = (s) => {
    setEditSupId(s.id); setShowSup(true)
    setSupForm({ name: s.name, phone: s.phone || '', email: s.email || '', bin_iin: s.bin_iin || '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const deleteSupplier = async (s) => {
    if (!confirm(`Удалить поставщика «${s.name}»?`)) return
    try { await api.delete(`/suppliers/${s.id}/`); loadSuppliers() }
    catch (e) { alert(apiError(e, 'Не удалось удалить')) }
  }

  const addBatch = async () => {
    await api.post('/material-batches/', { ...batchForm, supplier: batchForm.supplier || null })
    setBatchForm({ ...batchForm, qty: '', unit_price: '', batch_no: '' }); load()
  }

  const ship = async () => {
    const qty = Number(shipForm.qty)
    if (!qty || qty <= 0) return
    await api.post('/finished-goods/', {
      product: shipForm.product, qty: -qty,
      contract: shipForm.contract || null,
      note: shipForm.note || 'Отгрузка клиенту',
    })
    setShipForm({ product: '', qty: '', contract: '', note: '' }); load()
  }

  const reverseBatch = async (b) => {
    if (!confirm(`Сторнировать приход партии «${b.batch_no || b.id}» (${b.material_name})? Остаток и средняя цена вернутся к состоянию до этого прихода.`)) return
    try { await api.post(`/material-batches/${b.id}/reverse/`); load() }
    catch (e) { alert(e.response?.data?.detail || 'Не удалось сторнировать') }
  }

  const receivePo = async (po) => {
    const price = prompt('Цена за единицу (₸):', '0')
    if (price == null) return
    await api.post(`/purchase-orders/${po.id}/receive/`, { unit_price: price }); load()
  }

  const checkStock = async () => { await api.post('/materials/check_stock/'); load(); alert('Проверка завершена: уведомления и авто-заявки обновлены.') }

  return (
    <div className={ro ? 'readonly' : ''}>
      <div className="pagehead">
        <h1>Склад</h1>
        <button className="btn ghost small" onClick={checkStock}>Проверить остатки (авто-заявка)</button>
      </div>
      {ro && <div className="ro-note"><b>Только просмотр.</b>&nbsp;Ваша роль видит склад, но не меняет его. За приход и списание отвечает кладовщик.</div>}
      <div className="tabs">
        <button className={tab === 'materials' ? 'active' : ''} onClick={() => setTab('materials')}>Материалы</button>
        <button className={tab === 'movements' ? 'active' : ''} onClick={() => setTab('movements')}>Движения материалов</button>
        <button className={tab === 'suppliers' ? 'active' : ''} onClick={() => setTab('suppliers')}>Поставщики</button>
        <button className={tab === 'batches' ? 'active' : ''} onClick={() => setTab('batches')}>Партии / Приход</button>
        <button className={tab === 'purchase' ? 'active' : ''} onClick={() => setTab('purchase')}>Заявки на закуп</button>
        <button className={tab === 'fg' ? 'active' : ''} onClick={() => setTab('fg')}>Готовая продукция</button>
      </div>

      {tab === 'materials' && (
        <>
          <div className="pagehead" style={{ marginTop: 0 }}>
            <span className="muted">Справочник материалов (сырьё). Остаток появляется после прихода партий.</span>
            <button className="btn small" onClick={() => showMat ? resetMat() : setShowMat(true)}>{showMat ? 'Закрыть' : '+ Новый материал'}</button>
          </div>
          {showMat && (
            <div className="card stitch">
              <h2>{editMatId ? 'Редактирование материала' : 'Новый материал'}</h2>
              <div className="formrow">
                <div><label className="f">Название</label><input value={matForm.name} onChange={e => setMatForm({ ...matForm, name: e.target.value })} /></div>
                <div><label className="f">SKU (артикул)</label><input value={matForm.sku} onChange={e => setMatForm({ ...matForm, sku: e.target.value })} /></div>
                <div><label className="f">Ед. изм.</label><input value={matForm.unit} onChange={e => setMatForm({ ...matForm, unit: e.target.value })} placeholder="м, шт, кг" /></div>
                <div><label className="f">Мин. остаток</label><input type="number" value={matForm.min_stock} onChange={e => setMatForm({ ...matForm, min_stock: e.target.value })} /></div>
                <div><label className="f">Осн. поставщик</label>
                  <select value={matForm.default_supplier} onChange={e => setMatForm({ ...matForm, default_supplier: e.target.value })}>
                    <option value="">—</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select></div>
                <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 6 }}>
                  <button className="btn" onClick={saveMaterial} disabled={!matForm.name || !matForm.sku}>Сохранить</button>
                  <button className="btn ghost" onClick={resetMat}>Отмена</button>
                </div>
              </div>
              <p className="muted">Мин. остаток — порог для авто-заявки; поставщик нужен, чтобы заявка создалась автоматически.</p>
            </div>
          )}
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Материал</th><th>SKU</th><th className="num">Остаток</th><th className="num">Мин.</th><th className="num">Ср. цена</th><th>Поставщик</th><th /><th /></tr></thead>
              <tbody>
                {materials.map(m => (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 700 }}>{m.name}</td>
                    <td>{m.sku}</td>
                    <td className="num">{fmtD(m.stock)} {m.unit}</td>
                    <td className="num">{fmtD(m.min_stock)}</td>
                    <td className="num">{fmt(m.avg_price)}</td>
                    <td>{m.default_supplier_name || '—'}</td>
                    <td>{m.low_stock ? <span className="pill low">мало</span> : <span className="pill ok">достаточно</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn small ghost btn-read" onClick={() => openMovements(m.id)}>История</button>{' '}
                      <button className="btn small ghost" onClick={() => editMaterial(m)}>Изм.</button>{' '}
                      <button className="btn small ghost" onClick={() => deleteMaterial(m)}>Удл.</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'movements' && (
        <>
          <div className="pagehead" style={{ marginTop: 0 }}>
            <span className="muted">Каждое изменение остатка: приход партий (+) и списание в производство (−). Ничего не пропадает бесследно.</span>
            <select style={{ width: 'auto' }} value={moveMat} onChange={e => setMoveMat(e.target.value)}>
              <option value="">Все материалы</option>
              {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Дата</th><th>Материал</th><th className="num">Движение</th><th>Причина</th><th>Примечание</th><th>Кто</th></tr></thead>
              <tbody>
                {movements.map(mv => (
                  <tr key={mv.id}>
                    <td>{new Date(mv.created_at).toLocaleString('ru-RU')}</td>
                    <td>{mv.material_name}</td>
                    <td className="num" style={{ fontWeight: 700, color: mv.qty > 0 ? 'var(--green)' : 'var(--red)' }}>
                      {mv.qty > 0 ? '+' : ''}{fmtD(mv.qty)} {mv.material_unit}
                    </td>
                    <td><span className={`pill ${mv.qty > 0 ? 'ok' : 'low'}`}>{mv.reason_display}</span></td>
                    <td>{mv.note || '—'}</td>
                    <td>{mv.created_by_name || 'система'}</td>
                  </tr>
                ))}
                {movements.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>Движений нет.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'suppliers' && (
        <>
          <div className="pagehead" style={{ marginTop: 0 }}>
            <span className="muted">Справочник поставщиков материалов.</span>
            <button className="btn small" onClick={() => showSup ? resetSup() : setShowSup(true)}>{showSup ? 'Закрыть' : '+ Новый поставщик'}</button>
          </div>
          {showSup && (
            <div className="card stitch">
              <h2>{editSupId ? 'Редактирование поставщика' : 'Новый поставщик'}</h2>
              <div className="formrow">
                <div><label className="f">Название</label><input value={supForm.name} onChange={e => setSupForm({ ...supForm, name: e.target.value })} /></div>
                <div><label className="f">Телефон</label><input value={supForm.phone} onChange={e => setSupForm({ ...supForm, phone: e.target.value })} /></div>
                <div><label className="f">Email</label><input value={supForm.email} onChange={e => setSupForm({ ...supForm, email: e.target.value })} /></div>
                <div><label className="f">БИН/ИИН</label><input value={supForm.bin_iin} onChange={e => setSupForm({ ...supForm, bin_iin: e.target.value })} /></div>
                <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 6 }}>
                  <button className="btn" onClick={saveSupplier} disabled={!supForm.name}>Сохранить</button>
                  <button className="btn ghost" onClick={resetSup}>Отмена</button>
                </div>
              </div>
            </div>
          )}
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Название</th><th>Телефон</th><th>Email</th><th>БИН/ИИН</th><th /></tr></thead>
              <tbody>
                {suppliers.map(s => (
                  <tr key={s.id}><td style={{ fontWeight: 700 }}>{s.name}</td><td>{s.phone || '—'}</td><td>{s.email || '—'}</td><td>{s.bin_iin || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn small ghost" onClick={() => editSupplier(s)}>Изм.</button>{' '}
                      <button className="btn small ghost" onClick={() => deleteSupplier(s)}>Удл.</button>
                    </td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'batches' && (
        <>
          <div className="card stitch">
            <h2>Приёмка партии (приход)</h2>
            <div className="formrow">
              <div><label className="f">Материал</label>
                <select value={batchForm.material} onChange={e => setBatchForm({ ...batchForm, material: e.target.value })}>
                  <option value="">—</option>{materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select></div>
              <div><label className="f">Поставщик</label>
                <select value={batchForm.supplier} onChange={e => setBatchForm({ ...batchForm, supplier: e.target.value })}>
                  <option value="">—</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></div>
              <div><label className="f">Кол-во</label><input type="number" value={batchForm.qty} onChange={e => setBatchForm({ ...batchForm, qty: e.target.value })} /></div>
              <div><label className="f">Цена за единицу</label><input type="number" value={batchForm.unit_price} onChange={e => setBatchForm({ ...batchForm, unit_price: e.target.value })} /></div>
              <div><label className="f">Партия №</label><input value={batchForm.batch_no} onChange={e => setBatchForm({ ...batchForm, batch_no: e.target.value })} /></div>
              <div><label className="f">Дата</label><input type="date" value={batchForm.received_at} onChange={e => setBatchForm({ ...batchForm, received_at: e.target.value })} /></div>
              <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={addBatch} disabled={!batchForm.material || !batchForm.qty}>Принять</button></div>
            </div>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Партия</th><th>Материал</th><th>Поставщик</th><th className="num">Кол-во</th><th className="num">Цена</th><th>Дата</th><th /></tr></thead>
              <tbody>
                {batches.map(b => (
                  <tr key={b.id}><td>{b.batch_no || b.id}</td><td>{b.material_name}</td><td>{b.supplier_name || '—'}</td>
                    <td className="num">{fmtD(b.qty)}</td><td className="num">{fmt(b.unit_price)}</td><td>{b.received_at}</td>
                    <td><button className="btn small ghost" onClick={() => reverseBatch(b)}>Сторно</button></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'purchase' && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>№</th><th>Поставщик</th><th>Материал</th><th className="num">Кол-во</th><th>Статус</th><th>Тип</th><th /></tr></thead>
            <tbody>
              {pos.map(p => (
                <tr key={p.id}>
                  <td>{p.id}</td><td>{p.supplier_name}</td><td>{p.material_name}</td>
                  <td className="num">{fmtD(p.qty)}</td>
                  <td><span className="pill imp">{PO_ST[p.status]}</span></td>
                  <td>{p.auto_created ? <span className="pill low">авто</span> : 'вручную'}</td>
                  <td>{['draft', 'sent'].includes(p.status) && <button className="btn small" onClick={() => receivePo(p)}>Принять</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'fg' && (
        <>
          <div className="card stitch">
            <h2>Отгрузка клиенту</h2>
            <div className="formrow">
              <div><label className="f">Изделие</label>
                <select value={shipForm.product} onChange={e => setShipForm({ ...shipForm, product: e.target.value })}>
                  <option value="">—</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} (на складе: {p.fg_stock})</option>)}
                </select></div>
              <div><label className="f">Кол-во</label><input type="number" min="1" value={shipForm.qty} onChange={e => setShipForm({ ...shipForm, qty: e.target.value })} /></div>
              <div><label className="f">Договор</label>
                <select value={shipForm.contract} onChange={e => setShipForm({ ...shipForm, contract: e.target.value })}>
                  <option value="">—</option>{contracts.map(c => <option key={c.id} value={c.id}>{c.number}</option>)}
                </select></div>
              <div><label className="f">Примечание</label><input value={shipForm.note} onChange={e => setShipForm({ ...shipForm, note: e.target.value })} /></div>
              <div style={{ alignSelf: 'flex-end' }}><button className="btn" onClick={ship} disabled={!shipForm.product || !shipForm.qty}>Отгрузить</button></div>
            </div>
            <p className="muted">Отгрузка уменьшает остаток готовой продукции и попадает в рейтинг продаж в «Аналитике».</p>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Изделие</th><th className="num">Движение</th><th>Примечание</th><th>Дата</th></tr></thead>
              <tbody>
                {fg.map(f => (
                  <tr key={f.id}><td>{f.product_name}</td>
                    <td className="num" style={{ color: f.qty > 0 ? 'var(--green)' : 'var(--red)' }}>{f.qty > 0 ? '+' : ''}{f.qty}</td>
                    <td>{f.note}</td><td>{new Date(f.created_at).toLocaleDateString('ru-RU')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
