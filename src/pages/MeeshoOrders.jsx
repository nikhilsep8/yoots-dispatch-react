import { useState } from 'react'
import { useApp } from '../lib/AppContext'
import { sb } from '../lib/supabase'
import { today, fmtDate, COLOR_HEX, WH_ICONS } from '../lib/constants'
import { parseYootsSKU, parseIndSize } from '../lib/constants'
import { Card, Btn, PlatBadge, ColorDot, Badge, useToast, ToastContainer, EmptyState } from '../components/ui'

const STATUS_CONFIG = {
  READY_TO_SHIP: { label: 'Ready to Ship', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', deduct: true  },
  SHIPPED:       { label: 'Shipped',        bg: '#f0fdf4', color: '#166534', border: '#bbf7d0', deduct: true  },
  DELIVERED:     { label: 'Delivered',      bg: '#dcfce7', color: '#166534', border: '#86efac', deduct: true  },
  CANCELLED:     { label: 'Cancelled',      bg: '#fff7ed', color: '#c2410c', border: '#fed7aa', deduct: true  },
  RTO_LOCKED:    { label: 'RTO Locked',     bg: '#fdf4ff', color: '#7e22ce', border: '#e9d5ff', deduct: true  },
  RTO_DELIVERED: { label: 'RTO Delivered',  bg: '#fff1f2', color: '#be123c', border: '#fecdd3', deduct: false },
}

export default function MeeshoOrders() {
  const { warehouses, whInv, setWhInv } = useApp()
  const { toast, toasts } = useToast()

  const [uploadDate, setUploadDate] = useState(today())
  const [parsed,     setParsed]     = useState([])   // all parsed rows
  const [fileHint,   setFileHint]   = useState('')
  const [saving,     setSaving]     = useState(false)
  const [savedLogs,  setSavedLogs]  = useState([])   // history of uploads

  // ── CSV Parser ────────────────────────────────────
  function handleFile(file) {
    if (!file) return
    setFileHint('Parsing ' + file.name + '…')
    const reader = new FileReader()
    reader.onload = e => {
      try {
        parseCSV(e.target.result, file.name)
      } catch (err) {
        setFileHint('Error: ' + err.message)
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  function csvSplit(line) {
    const out = []; let cur = '', inQ = false
    for (const c of line) {
      if (c === '"') inQ = !inQ
      else if (c === ',' && !inQ) { out.push(cur.trim().replace(/^"|"$/g, '')); cur = '' }
      else cur += c
    }
    out.push(cur.trim().replace(/^"|"$/g, ''))
    return out
  }

  function parseCSV(text, fname) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l)
    if (!lines.length) { setFileHint('File is empty'); return }

    // Handle BOM
    const firstLine = lines[0].replace(/^\uFEFF/, '')
    const headers = csvSplit(firstLine).map(h => h.trim())
    const idx = name => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()))

    const iStatus = idx('Reason for Credit')
    const iSKU    = idx('SKU')
    const iSize   = idx('Size')
    const iQty    = idx('Quantity')
    const iDate   = idx('Order Date')
    const iName   = idx('Product Name')
    const iOrder  = idx('Sub Order')

    if (iSKU < 0) { setFileHint('Could not find SKU column. Is this a Meesho orders CSV?'); return }

    const rows = []
    for (let i = 1; i < lines.length; i++) {
      const cols = csvSplit(lines[i])
      if (cols.length < 3) continue

      const statusRaw = iStatus >= 0 ? (cols[iStatus] || '').trim().toUpperCase().replace(/\s+/g, '_') : 'SHIPPED'
      const sku       = iSKU  >= 0 ? cols[iSKU].trim()  : ''
      const sizeStr   = iSize >= 0 ? cols[iSize].trim()  : ''
      const qty       = iQty  >= 0 ? parseInt(cols[iQty]) || 1 : 1
      const orderDate = iDate >= 0 ? cols[iDate].trim()  : ''
      const orderNo   = iOrder >= 0 ? cols[iOrder].trim() : ''

      const parsed = parseYootsSKU(sku, whInv, sizeStr)
      if (!parsed) continue

      const cfg = STATUS_CONFIG[statusRaw] || { label: statusRaw, bg: '#f9fafb', color: '#6b7280', border: '#e5e7eb', deduct: true }

      for (let q = 0; q < qty; q++) {
        rows.push({
          ...parsed,
          status:    statusRaw,
          cfg,
          sku,
          orderDate,
          orderNo:   q === 0 ? orderNo : orderNo + `_${q}`,
          platform:  'Meesho',
        })
      }
    }

    if (!rows.length) { setFileHint('No valid Yoots SKUs found. Check the file.'); return }

    const deductCount = rows.filter(r => r.cfg.deduct).length
    setFileHint(`✓ Parsed ${rows.length} orders (${deductCount} will deduct stock)`)
    setParsed(rows)
  }

  // ── Summary stats ─────────────────────────────────
  const statusGroups = parsed.reduce((acc, r) => {
    if (!acc[r.status]) acc[r.status] = 0
    acc[r.status]++
    return acc
  }, {})

  const deductRows = parsed.filter(r => r.cfg.deduct)

  // Stock preview per SKU
  const skuDeductions = deductRows.reduce((acc, r) => {
    const k = `${r.model}|${r.color}|${r.size}`
    if (!acc[k]) acc[k] = { model: r.model, color: r.color, size: r.size, qty: 0 }
    acc[k].qty++
    return acc
  }, {})

  function getStockAfter(model, color, size) {
    const total = warehouses.reduce((s, wh) => {
      const row = whInv.find(r => r.warehouse_id === wh.id && r.model === model && r.color === color && r.size === size)
      return s + (row?.stock || 0)
    }, 0)
    const deduct = skuDeductions[`${model}|${color}|${size}`]?.qty || 0
    return { before: total, after: total - deduct, deduct }
  }

  // ── Confirm & deduct ──────────────────────────────
  async function confirmAndDeduct() {
    if (!deductRows.length) { toast('Nothing to deduct'); return }
    if (!confirm(`Deduct stock for ${deductRows.length} Meesho orders?\nThis cannot be undone.`)) return

    setSaving(true)
    try {
      // Build deduction map: find best warehouse (priority order) for each unit
      const priority = ['huda_complex', 'aggarsain', 'huda_new']
      const whByCode = {}; warehouses.forEach(w => { whByCode[w.code] = w })
      const whPrio = [...priority.map(c => whByCode[c]).filter(Boolean), ...warehouses.filter(w => !priority.includes(w.code))]

      // Simulate stock deductions
      const newWhInv = whInv.map(r => ({ ...r }))
      const updates = {}

      for (const row of deductRows) {
        let rem = 1
        for (const wh of whPrio) {
          if (rem <= 0) break
          const idx = newWhInv.findIndex(r => r.warehouse_id === wh.id && r.model === row.model && r.color === row.color && r.size === row.size)
          if (idx >= 0 && newWhInv[idx].stock > 0) {
            newWhInv[idx].stock -= 1
            rem -= 1
            const k = `${wh.id}|${row.model}|${row.color}|${row.size}`
            updates[k] = { warehouse_id: wh.id, model: row.model, color: row.color, size: row.size, stock: newWhInv[idx].stock, reorder_level: newWhInv[idx].reorder_level || 10 }
          }
        }
        // If still rem > 0, deduct from first warehouse anyway (negative stock)
        if (rem > 0) {
          const wh = whPrio[0]
          if (wh) {
            const idx = newWhInv.findIndex(r => r.warehouse_id === wh.id && r.model === row.model && r.color === row.color && r.size === row.size)
            if (idx >= 0) {
              newWhInv[idx].stock -= 1
              const k = `${wh.id}|${row.model}|${row.color}|${row.size}`
              updates[k] = { warehouse_id: wh.id, model: row.model, color: row.color, size: row.size, stock: newWhInv[idx].stock, reorder_level: newWhInv[idx].reorder_level || 10 }
            }
          }
        }
      }

      // Save to DB
      const updateRows = Object.values(updates)
      if (updateRows.length) {
        const { error } = await sb.from('warehouse_inventory').upsert(updateRows, { onConflict: 'warehouse_id,model,color,size' })
        if (error) throw new Error(error.message)
      }

      // Save order log to settings table
      const logKey = `meesho_upload_${Date.now()}`
      await sb.from('settings').upsert({
        key: logKey,
        value: JSON.stringify({
          date: uploadDate,
          uploadedAt: new Date().toISOString(),
          totalOrders: parsed.length,
          deducted: deductRows.length,
          skuCount: updateRows.length,
          statusBreakdown: statusGroups,
        })
      }, { onConflict: 'key' })

      setWhInv(newWhInv)
      setSavedLogs(prev => [{
        date: uploadDate,
        total: parsed.length,
        deducted: deductRows.length,
        breakdown: statusGroups,
      }, ...prev])

      toast(`✅ ${deductRows.length} orders deducted from inventory`)
      setParsed([])
      setFileHint('')
    } catch (err) {
      toast('⚠️ ' + err.message)
    }
    setSaving(false)
  }

  // ── render ────────────────────────────────────────
  return (
    <div>
      <ToastContainer toasts={toasts} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#111827' }}>
            <span style={{ background: '#7e22ce', color: '#fff', borderRadius: 4, padding: '2px 7px', fontSize: '.75rem', fontWeight: 900, marginRight: 6 }}>M</span>
            Meesho Orders
          </h2>
          <div style={{ fontSize: '.72rem', color: '#9ca3af', marginTop: '.15rem' }}>Upload Meesho orders CSV to deduct stock</div>
        </div>
        <input type="date" value={uploadDate} onChange={e => setUploadDate(e.target.value)}
          style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 7, padding: '.38rem .65rem', fontSize: '.78rem', color: '#111827' }} />
      </div>

      {/* Upload card */}
      <Card style={{ marginBottom: '1rem' }}>
        <div style={{ marginBottom: '.85rem' }}>
          <div style={{ fontSize: '.82rem', fontWeight: 700, color: '#111827', marginBottom: '.25rem' }}>Upload Orders CSV</div>
          <div style={{ fontSize: '.72rem', color: '#9ca3af' }}>
            Download from: Meesho Supplier Panel → <strong>Orders</strong> → set date range → <strong>Download Report</strong>
          </div>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px dashed #e9d5ff', borderRadius: 10, padding: '2rem', background: '#fdf4ff', cursor: 'pointer', position: 'relative', textAlign: 'center' }}>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={e => handleFile(e.target.files[0])}
            style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
          <div style={{ fontSize: '1.8rem', marginBottom: '.5rem' }}>📊</div>
          <div style={{ fontWeight: 700, color: '#7e22ce', marginBottom: '.25rem' }}>Drop Meesho Orders CSV here</div>
          <div style={{ fontSize: '.75rem', color: '#94a3b8' }}>Supports the standard Meesho order report CSV</div>
        </label>
        {fileHint && (
          <div style={{ marginTop: '.6rem', textAlign: 'center', fontSize: '.75rem', fontWeight: 600, color: fileHint.startsWith('✓') ? '#059669' : fileHint.startsWith('Error') ? '#dc2626' : '#64748b' }}>
            {fileHint}
          </div>
        )}
      </Card>

      {/* Preview */}
      {parsed.length > 0 && (
        <Card style={{ marginBottom: '1rem' }}>
          {/* Status breakdown */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '.82rem', fontWeight: 700, color: '#111827', marginBottom: '.65rem' }}>Order Summary</div>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              {Object.entries(statusGroups).map(([status, count]) => {
                const cfg = STATUS_CONFIG[status] || { label: status, bg: '#f9fafb', color: '#6b7280', border: '#e5e7eb', deduct: true }
                return (
                  <div key={status} style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 8, padding: '.5rem .85rem', minWidth: 100 }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 900, color: cfg.color }}>{count}</div>
                    <div style={{ fontSize: '.65rem', fontWeight: 700, color: cfg.color, textTransform: 'uppercase', letterSpacing: '.5px' }}>{cfg.label}</div>
                    <div style={{ fontSize: '.62rem', color: cfg.deduct ? '#059669' : '#9ca3af', marginTop: '.15rem' }}>{cfg.deduct ? '✓ deduct stock' : '— no change'}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Stock impact preview */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '.82rem', fontWeight: 700, color: '#111827', marginBottom: '.65rem' }}>
              Stock Impact Preview — {Object.keys(skuDeductions).length} SKUs
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 60px 80px 80px 80px', padding: '.4rem .65rem', background: '#f9fafb', fontSize: '.62rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.5px', borderBottom: '1px solid #e5e7eb' }}>
                <span>Model</span><span>Color</span><span>Size</span><span>Current</span><span>Deduct</span><span>After</span>
              </div>
              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                {Object.values(skuDeductions).sort((a,b) => a.model.localeCompare(b.model)).map(sku => {
                  const { before, after, deduct } = getStockAfter(sku.model, sku.color, sku.size)
                  return (
                    <div key={`${sku.model}|${sku.color}|${sku.size}`}
                      style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 60px 80px 80px 80px', padding: '.45rem .65rem', borderBottom: '1px solid #f3f4f6', fontSize: '.78rem', alignItems: 'center', background: after < 0 ? '#fff1f2' : '#fff' }}>
                      <span style={{ fontWeight: 700 }}>
                        <span style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: 4, padding: '1px 6px', fontSize: '.68rem', fontWeight: 700 }}>{sku.model}</span>
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <ColorDot color={sku.color} />{sku.color}
                      </span>
                      <span style={{ color: '#4f46e5', fontWeight: 700 }}>UK{sku.size}</span>
                      <span style={{ fontWeight: 700, color: '#374151' }}>{before}</span>
                      <span style={{ fontWeight: 700, color: '#dc2626' }}>−{deduct}</span>
                      <span style={{ fontWeight: 900, color: after < 0 ? '#dc2626' : after <= 5 ? '#f59e0b' : '#059669' }}>
                        {after} {after < 0 ? '⚠️' : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
            <div style={{ fontSize: '.78rem', color: '#64748b' }}>
              <span style={{ fontWeight: 700, color: '#dc2626' }}>{deductRows.length}</span> orders will deduct stock ·
              <span style={{ fontWeight: 700, color: '#374151' }}> {Object.keys(skuDeductions).length}</span> unique SKUs
            </div>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <Btn variant="ghost" size="sm" onClick={() => { setParsed([]); setFileHint('') }}>✕ Clear</Btn>
              <Btn variant="meesho" size="md" onClick={confirmAndDeduct} disabled={saving}>
                {saving ? '⏳ Saving…' : `✅ Confirm & Deduct Stock`}
              </Btn>
            </div>
          </div>
        </Card>
      )}

      {/* All orders list */}
      {parsed.length > 0 && (
        <Card>
          <div style={{ fontSize: '.82rem', fontWeight: 700, color: '#111827', marginBottom: '.65rem' }}>
            All Orders ({parsed.length})
          </div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', maxHeight: 400, overflowY: 'auto' }}>
            {parsed.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.4rem .65rem', borderBottom: '1px solid #f3f4f6', fontSize: '.75rem' }}>
                <span style={{ color: '#cbd5e1', width: 22, fontSize: '.65rem', fontWeight: 600, flexShrink: 0 }}>{i + 1}</span>
                <span style={{ background: r.cfg.bg, color: r.cfg.color, border: `1px solid ${r.cfg.border}`, borderRadius: 4, padding: '1px 5px', fontSize: '.62rem', fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
                  {r.cfg.label}
                </span>
                <span style={{ fontWeight: 700, color: '#1e293b' }}>{r.model}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <ColorDot color={r.color} /><span style={{ color: '#475569' }}>{r.color}</span>
                </span>
                <span style={{ background: '#eff6ff', color: '#3730a3', border: '1px solid #c7d7f8', borderRadius: 4, padding: '1px 5px', fontSize: '.7rem', fontWeight: 800 }}>UK{r.size}</span>
                {r.orderDate && <span style={{ color: '#94a3b8', fontSize: '.65rem', marginLeft: 'auto' }}>{r.orderDate}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {parsed.length === 0 && savedLogs.length === 0 && (
        <EmptyState icon="📊" message="Upload a Meesho orders CSV to get started." />
      )}

      {/* Upload history */}
      {savedLogs.length > 0 && (
        <Card>
          <div style={{ fontSize: '.82rem', fontWeight: 700, color: '#111827', marginBottom: '.65rem' }}>Recent Uploads</div>
          {savedLogs.map((log, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.6rem 0', borderBottom: '1px solid #f3f4f6', fontSize: '.78rem' }}>
              <span style={{ fontWeight: 700, color: '#1e293b' }}>{fmtDate(log.date)}</span>
              <span style={{ color: '#6b7280' }}>{log.total} orders</span>
              <span style={{ color: '#dc2626', fontWeight: 600 }}>−{log.deducted} deducted</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
                {Object.entries(log.breakdown).map(([s, c]) => {
                  const cfg = STATUS_CONFIG[s] || { label: s, bg: '#f9fafb', color: '#6b7280', border: '#e5e7eb' }
                  return <span key={s} style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, borderRadius: 4, padding: '1px 5px', fontSize: '.62rem', fontWeight: 700 }}>{cfg.label}: {c}</span>
                })}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
