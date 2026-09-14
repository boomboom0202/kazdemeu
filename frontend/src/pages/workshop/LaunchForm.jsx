import React, { useEffect, useMemo, useState } from 'react'
import { api, apiError, fmt, can } from '../../api'

const SIZE_LINE = /^(.*\S)\s+[-–—:]?\s*(\d+)\s*(?:шт\.?|ш|комп\.?|компл\.?|пар)?\s*$/i

/**
 * Запуск в цех: изделие, размеры столбиком, какие этапы проходит заказ.
 * Из договора подставляются предмет, срок и количество — чтобы сверить,
 * что сетка размеров сходится с договором.
 */
export default function LaunchForm({ user, contract, onDone, onCancel }) {
  const [templates, setTemplates] = useState([])
  const [contracts, setContracts] = useState([])
  const [form, setForm] = useState({
    product: contract?.title || '', contract: contract?.id || '', client: '',
    deadline: contract?.deadline || '', sewing_rate: '', sizes_text: '',
  })
  const [chosen, setChosen] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/stage-templates/?page_size=100').then(r => {
      const list = r.data.results || []
      setTemplates(list)
      setChosen(list.filter(t => t.is_active).map(t => t.id))
    })
    if (!contract && can(user, 'contracts.contracts'))
      api.get('/contracts/?page_size=5000&status__in=new,negotiation,in_progress').then(r => setContracts(r.data.results || []))
  }, [])

  const sizesTotal = useMemo(() => form.sizes_text.split('\n').reduce((a, l) => {
    const m = l.trim().match(SIZE_LINE)
    return a + (m ? Number(m[2]) : 0)
  }, 0), [form.sizes_text])

  const picked = contract || contracts.find(c => String(c.id) === String(form.contract))
  const contractQty = picked?.qty ? Number(picked.qty) : null

  const pickContract = (id) => {
    const c = contracts.find(x => String(x.id) === String(id))
    setForm(f => ({ ...f, contract: id, product: f.product || c?.title || '', deadline: f.deadline || c?.deadline || '' }))
  }

  const submit = async () => {
    setBusy(true)
    try {
      const { data } = await api.post('/work-orders/', {
        product: form.product, contract: form.contract || null, client: form.client,
        deadline: form.deadline || null, sewing_rate: form.sewing_rate || 0,
        sizes_text: form.sizes_text, template_ids: templates.filter(t => chosen.includes(t.id)).map(t => t.id),
      })
      onDone(data)
    } catch (e) { alert(apiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="card stitch">
      <h2>{contract ? 'Запустить в цех' : 'Новый заказ цеха'}</h2>
      <div className="formrow">
        <div style={{ flex: 2 }}><label className="f">Изделие</label>
          <input value={form.product} placeholder="Куртка АУП" onChange={e => setForm({ ...form, product: e.target.value })} /></div>
        {!contract && <div style={{ flex: 2 }}><label className="f">Договор</label>
          <select value={form.contract} onChange={e => pickContract(e.target.value)}>
            <option value="">— без договора —</option>
            {contracts.map(c => <option key={c.id} value={c.id}>{c.purchase_no || c.number} · {c.customer_name} · {c.title}</option>)}
          </select></div>}
        {!form.contract && <div><label className="f">Для кого</label>
          <input value={form.client} placeholder="частный заказ" onChange={e => setForm({ ...form, client: e.target.value })} /></div>}
        <div><label className="f">Срок</label>
          <input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} /></div>
        <div><label className="f">Расценка пошива, ₸/шт</label>
          <input type="number" value={form.sewing_rate} placeholder="3000" onChange={e => setForm({ ...form, sewing_rate: e.target.value })} /></div>
      </div>
      <div className="formrow">
        <div style={{ flex: 2 }}>
          <label className="f">Размеры — столбиком, как в отчёте цеха</label>
          <textarea rows={7} value={form.sizes_text} placeholder={'54/176 - 27 шт\n54/182 - 35 шт\n56-58/170-176 116'}
            onChange={e => setForm({ ...form, sizes_text: e.target.value })} />
          <div className="muted" style={{ marginTop: 4 }}>
            По размерам: <b>{fmt(sizesTotal)}</b> шт
            {contractQty !== null && <> из {fmt(contractQty)} по договору
              {sizesTotal !== contractQty && sizesTotal > 0 && <span className="neg"> — не сходится на {fmt(Math.abs(contractQty - sizesTotal))}</span>}</>}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label className="f">Этапы заказа</label>
          {templates.map(t => (
            <label key={t.id} className="check">
              <input type="checkbox" checked={chosen.includes(t.id)}
                onChange={e => setChosen(e.target.checked ? [...chosen, t.id] : chosen.filter(x => x !== t.id))} />
              {t.name}
            </label>
          ))}
          <div className="muted" style={{ marginTop: 4 }}>Порядок этапов — из настроек цеха. Нет вышивки — снимите галочку.</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={submit} disabled={busy || !form.product || !chosen.length}>Создать заказ цеха</button>
        {onCancel && <button className="btn ghost" onClick={onCancel}>Отмена</button>}
      </div>
    </div>
  )
}
