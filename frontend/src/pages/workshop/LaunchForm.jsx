import React, { useEffect, useState } from 'react'
import { api, apiError, can } from '../../api'
import SizesInput from '../../components/SizesInput'

/**
 * Запуск в цех: изделие, размеры по сетке, какие этапы проходит заказ.
 * Из договора подставляются предмет, срок и количество — чтобы сверить,
 * что сетка размеров сходится с договором.
 */
export default function LaunchForm({ user, contract, noContract, onDone, onCancel }) {
  const [templates, setTemplates] = useState([])
  const [contracts, setContracts] = useState([])
  const [form, setForm] = useState({
    product: contract?.title || '', contract: contract?.id || '', client: '',
    deadline: contract?.deadline || '', sizes_text: '',
  })
  const [chosen, setChosen] = useState([])
  const [sizesOk, setSizesOk] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/stage-templates/?page_size=100').then(r => {
      const list = r.data.results || []
      setTemplates(list)
      setChosen(list.filter(t => t.is_active).map(t => t.id))
    })
    if (!contract && !noContract && can(user, 'contracts.contracts'))
      api.get('/contracts/?page_size=5000&status__in=new,negotiation,in_progress').then(r => setContracts(r.data.results || []))
  }, [])

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
        deadline: form.deadline || null,
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
        {!contract && !noContract && <div style={{ flex: 2 }}><label className="f">Договор</label>
          <select value={form.contract} onChange={e => pickContract(e.target.value)}>
            <option value="">— без договора —</option>
            {contracts.map(c => <option key={c.id} value={c.id}>{c.purchase_no || c.number} · {c.customer_name} · {c.title}</option>)}
          </select></div>}
        {!form.contract && <div><label className="f">Для кого</label>
          <input value={form.client} placeholder="частный заказ" onChange={e => setForm({ ...form, client: e.target.value })} /></div>}
        <div><label className="f">Срок</label>
          <input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} /></div>
      </div>

      <label className="f">Размеры</label>
      <SizesInput onChange={v => setForm(f => ({ ...f, sizes_text: v }))}
        contractQty={contractQty} onValidity={ok => setSizesOk(ok)} />

      <div style={{ margin: '12px 0 4px' }}>
        <label className="f">Этапы заказа</label>
        <div className="chips">
          {templates.map(t => (
            <label key={t.id} className="check" style={{ marginRight: 12 }}>
              <input type="checkbox" checked={chosen.includes(t.id)}
                onChange={e => setChosen(e.target.checked ? [...chosen, t.id] : chosen.filter(x => x !== t.id))} />
              {t.name}
            </label>
          ))}
        </div>
        <div className="muted">Порядок этапов — из настроек цеха. Нет вышивки — снимите галочку.</div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn" onClick={submit} disabled={busy || !form.product || !chosen.length || !sizesOk}>Создать заказ цеха</button>
        {onCancel && <button className="btn ghost" onClick={onCancel}>Отмена</button>}
      </div>
    </div>
  )
}
