import React, { useRef, useState } from 'react'
import { api, fmt, apiError } from '../api'

/**
 * Загрузка «Расходы.xlsx» в два шага. В таблице колонки названы по-своему
 * («Павлодар 741 шт ДИНА»), а расходы теперь живут в договорах — поэтому
 * сначала показываем колонки файла и к каждой предлагаем договор,
 * а записываем только после того, как человек проверил сопоставление.
 */
export default function ExpenseImport({ contracts, onClose, onDone }) {
  const fileRef = useRef()
  const [file, setFile] = useState(null)
  const [blocks, setBlocks] = useState(null)
  const [map, setMap] = useState({})
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState(null)

  const preview = async (f) => {
    if (!f) return
    setFile(f); setBusy(true); setReport(null)
    const fd = new FormData(); fd.append('file', f)
    try {
      const { data } = await api.post('/contract-expenses/import_preview/', fd)
      setBlocks(data.blocks)
      setMap(Object.fromEntries(data.blocks.map(b => [b.index, b.suggestion ? String(b.suggestion) : ''])))
    } catch (e) { alert(apiError(e)) }
    finally { setBusy(false) }
  }

  const apply = async () => {
    const fd = new FormData(); fd.append('file', file)
    fd.append('mapping', JSON.stringify(Object.fromEntries(Object.entries(map).filter(([, v]) => v))))
    setBusy(true)
    try {
      const { data } = await api.post('/contract-expenses/import_apply/', fd)
      setReport(data); onDone && onDone()
    } catch (e) { alert(apiError(e)) }
    finally { setBusy(false) }
  }

  const chosen = Object.values(map).filter(Boolean).length

  return (
    <div className="card stitch">
      <div className="pagehead" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Загрузка «Расходы.xlsx» в договоры</h2>
        <button className="btn small ghost" onClick={onClose}>Закрыть</button>
      </div>
      <p className="muted" style={{ marginBottom: 10 }}>
        Каждая пара колонок файла — расходы одного заказа. Выберите, к какому договору она относится.
        Строки «приход» станут оплатами договора, строки «расход» и «остаток» — итоги таблицы, их сверим, но не запишем.
        При повторной загрузке у договора заменятся только строки из Excel — внесённое руками останется.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <button className="btn" disabled={busy} onClick={() => fileRef.current.click()}>
          {file ? 'Другой файл' : 'Выбрать файл'}</button>
        <input type="file" ref={fileRef} accept=".xlsx" style={{ display: 'none' }}
          onChange={e => { preview(e.target.files[0]); e.target.value = '' }} />
        {file && <span className="muted">{file.name}</span>}
        {busy && <span className="muted">Обработка…</span>}
      </div>

      {blocks && !report && (
        <>
          <div className="tablewrap"><table>
            <thead><tr><th>Колонка файла</th><th className="num">Расходы</th><th className="num">Приход</th><th>Договор</th></tr></thead>
            <tbody>
              {blocks.map(b => (
                <tr key={b.index}>
                  <td><b>{b.name}</b>
                    {b.warnings.length > 0 && <div className="muted" style={{ color: 'var(--amber)' }}>
                      {b.warnings.slice(0, 2).join('; ')}{b.warnings.length > 2 ? ` и ещё ${b.warnings.length - 2}` : ''}</div>}</td>
                  <td className="num">{fmt(b.expenses_total)}<div className="muted">{b.expenses_count} строк</div></td>
                  <td className="num">{b.incomes_total ? fmt(b.incomes_total) : '—'}</td>
                  <td style={{ minWidth: 280 }}>
                    <select value={map[b.index] || ''} onChange={e => setMap({ ...map, [b.index]: e.target.value })}>
                      <option value="">— не загружать —</option>
                      {contracts.map(c => <option key={c.id} value={c.id}>
                        {c.purchase_no || c.number} · {c.customer_name} · {c.title}</option>)}
                    </select>
                    {b.suggestion && String(b.suggestion) === map[b.index] && <div className="muted">подобрано по названию — проверьте</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn" disabled={busy || !chosen} onClick={apply}>Загрузить в {chosen} договор(ов)</button>
            <span className="muted">Колонки без договора пропускаются.</span>
          </div>
        </>
      )}

      {report && (
        <div className="ro-note" style={{ display: 'block' }}>
          <b>Загружено.</b> Договоров: {report.contracts}, строк расходов: {report.expenses}, оплат: {report.incomes},
          пропущено колонок: {report.skipped}.
          {report.warnings.length > 0 && <ul style={{ margin: '6px 0 0 18px' }}>
            {report.warnings.slice(0, 12).map((w, i) => <li key={i}>{w}</li>)}
          </ul>}
        </div>
      )}
    </div>
  )
}
