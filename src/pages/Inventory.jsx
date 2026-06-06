import { useState, useMemo } from 'react'
import { useApp } from '../lib/AppContext'
import { sb } from '../lib/supabase'
import { WH_ICONS, WH_COLORS, COLOR_HEX } from '../lib/constants'
import { Btn, ColorDot, useToast, ToastContainer, EmptyState } from '../components/ui'

export default function Inventory() {
  const { warehouses, whInv, setWhInv } = useApp()
  const { toast, toasts } = useToast()

  const [activeWh, setActiveWh] = useState('all')
  const [search, setSearch]     = useState('')
  const [filterModel, setFModel] = useState('')
  const [filterColor, setFColor] = useState('')
  const [filterStock, setFStock] = useState('')
  const [changes, setChanges]   = useState({}) // key → new stock value

  const models = useMemo(() => [...new Set(whInv.map(r => r.model))].sort(), [whInv])
  const allColors = useMemo(() => [...new Set(whInv.map(r => r.color))].sort(), [whInv])

  const skus = useMemo(() => {
    return [...new Map(whInv.map(r => [`${r.model}|${r.color}|${r.size}`, { model: r.model, color: r.color, size: r.size, reorder_level: r.reorder_level }])).values()]
      .sort((a, b) => a.model.localeCompare(b.model) || a.color.localeCompare(b.color) || a.size - b.size)
  }, [whInv])

  function getStock(whId, model, color, size) {
    const key = `${whId}|${model}|${color}|${size}`
    if (changes[key] !== undefined) return changes[key]
    const r = whInv.find(x => x.warehouse_id === whId && x.model === model && x.color === color && x.size === size)
    return r?.stock ?? 0
  }

  const filtered = useMemo(() => skus.filter(s => {
    if (filterModel && s.model !== filterModel) return false
    if (filterColor && s.color !== filterColor) return false
    if (search && !`${s.model} ${s.color} uk${s.size}`.toLowerCase().includes(search.toLowerCase())) return false
    const tot = warehouses.reduce((t, wh) => t + getStock(wh.id, s.model, s.color, s.size), 0)
    if (filterStock === 'low' && (tot < 0 || tot > s.reorder_level)) return false
    if (filterStock === 'neg' && tot >= 0) return false
    if (filterStock === 'ok' && tot <= 0) return false
    if (activeWh !== 'all') {
      const whId = parseInt(activeWh)
      if (getStock(whId, s.model, s.color, s.size) === 0 && !filterStock) return false
    }
    return true
  }), [skus, filterModel, filterColor, search, filterStock, activeWh, changes, warehouses, whInv])

  function handleStockChange(whId, model, color, size, val) {
    setChanges(prev => ({ ...prev, [`${whId}|${model}|${color}|${size}`]: parseInt(val) || 0 }))
  }

  async function saveAll() {
    const keys = Object.keys(changes)
    if (!keys.length) { toast('No changes to save'); return }
    const rows = keys.map(k => {
      const [whId, model, color, size] = k.split('|')
      const ex = whInv.find(r => r.warehouse_id === parseInt(whId) && r.model === model && r.color === color && r.size === parseInt(size))
      return { warehouse_id: parseInt(whId), model, color, size: parseInt(size), stock: changes[k], reorder_level: ex?.reorder_level || 10, in_transit: ex?.in_transit || 0 }
    })
    const { error } = await sb.from('warehouse_inventory').upsert(rows, { onConflict: 'warehouse_id,model,color,size' })
    if (error) { toast('Save failed: ' + error.message); return }
    setWhInv(prev => {
      const next = [...prev]
      rows.forEach(r => {
        const idx = next.findIndex(x => x.warehouse_id === r.warehouse_id && x.model === r.model && x.color === r.color && x.size === r.size)
        if (idx >= 0) next[idx] = { ...next[idx], stock: r.stock }
        else next.push(r)
      })
      return next
    })
    setChanges({})
    toast(`✅ ${rows.length} SKU${rows.length > 1 ? 's' : ''} saved`)
  }

  const wh1 = warehouses[0], wh2 = warehouses[1], wh3 = warehouses[2]

  return (
    <div>
      <ToastContainer toasts={toasts} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.85rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#111827' }}>📦 Inventory</h2>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          <Btn variant="ghost" size="sm">+ Add Model</Btn>
          <Btn variant="warning" size="sm">± Adjust Stock</Btn>
          <Btn variant="success" size="sm" onClick={saveAll} disabled={!Object.keys(changes).length}>
            💾 Save {Object.keys(changes).length > 0 ? `(${Object.keys(changes).length})` : 'Changes'}
          </Btn>
        </div>
      </div>

      {/* WH Tabs */}
      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.85rem', flexWrap: 'wrap' }}>
        {[{ id: 'all', label: '🏢 All' }, ...warehouses.map((wh, i) => ({ id: String(wh.id), label: `${WH_ICONS[i]} ${wh.name}` }))].map(tab => (
          <button key={tab.id} onClick={() => setActiveWh(tab.id)}
            style={{ padding: '.38rem .85rem', borderRadius: 6, fontSize: '.74rem', fontWeight: 600, border: '1.5px solid', cursor: 'pointer', transition: 'all .15s', fontFamily: 'inherit', borderColor: activeWh === tab.id ? '#4f46e5' : '#e5e7eb', background: activeWh === tab.id ? '#4f46e5' : '#fff', color: activeWh === tab.id ? '#fff' : '#6b7280' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
        {[
          <input key="s" type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={fInp} />,
          <select key="m" value={filterModel} onChange={e => setFModel(e.target.value)} style={fInp}>
            <option value="">All Models</option>{models.map(m => <option key={m}>{m}</option>)}
          </select>,
          <select key="c" value={filterColor} onChange={e => setFColor(e.target.value)} style={fInp}>
            <option value="">All Colors</option>{allColors.map(c => <option key={c}>{c}</option>)}
          </select>,
          <select key="st" value={filterStock} onChange={e => setFStock(e.target.value)} style={fInp}>
            <option value="">All Stock</option><option value="low">Low</option><option value="neg">Negative</option><option value="ok">In Stock</option>
          </select>,
        ]}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,.06)', border: '1px solid #f3f4f6', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: '65vh' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
            <thead>
              <tr>
                {['Model', 'Color', 'Size', wh1?.name || 'WH1', wh2?.name || 'WH2', wh3?.name || 'WH3', '🚛 Transit', 'Total'].map(h => (
                  <th key={h} style={{ background: '#f9fafb', padding: '.55rem .75rem', fontSize: '.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: '#6b7280', borderBottom: '2px solid #e5e7eb', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>No SKUs match filters</td></tr>
              ) : filtered.map(s => {
                const s1 = getStock(wh1?.id, s.model, s.color, s.size)
                const s2 = getStock(wh2?.id, s.model, s.color, s.size)
                const s3 = getStock(wh3?.id, s.model, s.color, s.size)
                const tot = s1 + s2 + s3
                const isNeg = tot < 0, isLow = tot >= 0 && tot <= (s.reorder_level || 10)
                const transit = whInv.filter(r => r.model === s.model && r.color === s.color && r.size === s.size).reduce((acc, r) => acc + (r.in_transit || 0), 0)
                return (
                  <tr key={`${s.model}|${s.color}|${s.size}`} style={{ background: isNeg ? '#1f0a0a' : isLow ? '#fffbeb' : undefined }}>
                    <td style={{ padding: '.5rem .75rem', borderBottom: '1px solid #f3f4f6' }}>
                      <span style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: 4, padding: '.08rem .4rem', fontSize: '.68rem', fontWeight: 700 }}>{s.model}</span>
                    </td>
                    <td style={{ padding: '.5rem .75rem', borderBottom: '1px solid #f3f4f6' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <ColorDot color={s.color} />
                        {s.color}
                        {isNeg && <span style={{ background: '#dc2626', color: '#fff', fontSize: '.52rem', fontWeight: 700, padding: '.08rem .3rem', borderRadius: 3, marginLeft: 4 }}>BACK</span>}
                      </span>
                    </td>
                    <td style={{ padding: '.5rem .75rem', borderBottom: '1px solid #f3f4f6', fontWeight: 800, color: '#4f46e5' }}>UK{s.size}</td>
                    {[{ whId: wh1?.id, val: s1 }, { whId: wh2?.id, val: s2 }, { whId: wh3?.id, val: s3 }].map(({ whId, val }, ci) => (
                      <td key={ci} style={{ padding: '.5rem .75rem', borderBottom: '1px solid #f3f4f6' }}>
                        <input type="number" value={changes[`${whId}|${s.model}|${s.color}|${s.size}`] ?? val}
                          onChange={e => handleStockChange(whId, s.model, s.color, s.size, e.target.value)}
                          style={{ width: 58, textAlign: 'center', padding: '.28rem', border: `1.5px solid ${changes[`${whId}|${s.model}|${s.color}|${s.size}`] !== undefined ? '#4f46e5' : '#e5e7eb'}`, borderRadius: 5, fontSize: '.82rem', fontWeight: 700, background: val < 0 ? '#1f0a0a' : val <= (s.reorder_level || 10) ? '#fffbeb' : '#f9fafb', color: val < 0 ? '#f87171' : '#111827', fontFamily: 'inherit' }}
                        />
                      </td>
                    ))}
                    <td style={{ padding: '.5rem .75rem', borderBottom: '1px solid #f3f4f6', textAlign: 'center', fontSize: '.78rem', color: '#92400e', fontWeight: 700 }}>{transit || '—'}</td>
                    <td style={{ padding: '.5rem .75rem', borderBottom: '1px solid #f3f4f6', fontWeight: 900, color: isNeg ? '#ef4444' : isLow ? '#f59e0b' : '#1e293b' }}>{tot}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const fInp = { background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 7, padding: '.38rem .65rem', fontSize: '.76rem', color: '#111827', fontFamily: 'inherit' }
