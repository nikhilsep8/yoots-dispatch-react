import { useState, useEffect } from 'react'
import { useApp } from '../lib/AppContext'
import { sb } from '../lib/supabase'
import { today, fmtDate, COLOR_HEX, WH_ICONS } from '../lib/constants'
import { Card, Btn, PlatBadge, ColorDot, FormField, selectStyle, inputStyle, EmptyState, useToast, ToastContainer } from '../components/ui'

const PLATFORMS = ['Flipkart', 'Amazon', 'Meesho', 'Myntra']

// Delivery partners per platform
const COURIERS = {
  Flipkart: ['Ekart', 'Other'],
  Amazon:   ['Amazon Logistics', 'Blue Dart', 'Other'],
  Meesho:   ['Valmo', 'Delhivery', 'Xpress Bees', 'Shadowfax', 'Other'],
  Myntra:   ['Ekart', 'Delhivery', 'Other'],
}

export default function Returns() {
  const { warehouses, whInv, setWhInv, plans, setPlans } = useApp()
  const { toast, toasts } = useToast()

  // ── state ─────────────────────────────────────────
  const [retDate, setRetDate]     = useState(today())
  const [whId, setWhId]           = useState('')
  const [step, setStep]           = useState('idle')  // idle | filling | done
  const [qty, setQty]             = useState('')
  const [slots, setSlots]         = useState([])      // [{platform,model,color,size}]
  const [saving, setSaving]       = useState(false)

  useEffect(() => {
    if (warehouses.length && !whId) setWhId(String(warehouses[0].id))
  }, [warehouses])

  // ── derived ───────────────────────────────────────
  const models  = [...new Set(whInv.map(r => r.model))].sort()
  const colors  = (model) => [...new Set(whInv.filter(r => r.model === model).map(r => r.color))].sort()
  const sizes   = (model, color) => [...new Set(whInv.filter(r => r.model === model && r.color === color).map(r => r.size))].sort((a,b)=>a-b)

  // ── Step 1: start — enter qty ─────────────────────
  function handleStartEntry() {
    const n = parseInt(qty)
    if (!n || n < 1 || n > 200) { toast('Enter a valid qty (1–200)'); return }
    setSlots(Array.from({ length: n }, () => ({ platform: 'Flipkart', courier: 'Ekart', model: models[0] || '', color: '', size: '' })))
    setStep('filling')
  }

  function updateSlot(i, field, value) {
    setSlots(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: value }
      // cascade: when model changes, reset color & size
      if (field === 'platform') { next[i].courier = (COURIERS[value] || ['Other'])[0] }
      if (field === 'model') { next[i].color = ''; next[i].size = '' }
      if (field === 'color') { next[i].size = '' }
      // auto-fill color/size if only one option
      if (field === 'model' || field === 'color') {
        const m = next[i].model
        const c = field === 'model' ? '' : next[i].color
        if (field === 'model') {
          const cs = colors(m)
          if (cs.length === 1) { next[i].color = cs[0]; const ss = sizes(m, cs[0]); if (ss.length === 1) next[i].size = String(ss[0]) }
        }
        if (field === 'color') {
          const ss = sizes(m, value)
          if (ss.length === 1) next[i].size = String(ss[0])
        }
      }
      return next
    })
  }

  // copy slot values down
  function copyDown(i) {
    setSlots(prev => {
      const next = [...prev]
      const src = next[i]
      for (let j = i + 1; j < next.length; j++) next[j] = { ...src }
      return next
    })
    toast('Copied to all rows below')
  }

  // ── Step 2: save ──────────────────────────────────
  async function handleSave() {
    const incomplete = slots.filter(s => !s.model || !s.color || !s.size)
    if (incomplete.length) { toast(`⚠️ ${incomplete.length} rows incomplete`); return }
    setSaving(true)
    const wid = parseInt(whId)
    const taggedReturns = slots.map(s => ({ ...s, size: parseInt(s.size), warehouse_id: wid, courier: s.courier || 'Other' }))
    const existing = plans[retDate] || {}
    const newReturns = [...(existing.returns || []), ...taggedReturns]

    try {
      const { error: e1 } = await sb.from('dispatch_plans').upsert({
        date: retDate,
        orders: existing.orders || [],
        plan: existing.plan || {},
        total_orders: existing.total_orders || 0,
        status: existing.status || 'pending',
        returns: newReturns,
      }, { onConflict: 'date' })
      if (e1) throw new Error(e1.message)

      // Update inventory one by one
      for (const ret of taggedReturns) {
        const row = whInv.find(r => r.warehouse_id === wid && r.model === ret.model && r.color === ret.color && r.size === ret.size)
        const newStock = (row?.stock || 0) + 1
        const { error: e2 } = await sb.from('warehouse_inventory').upsert(
          { warehouse_id: wid, model: ret.model, color: ret.color, size: ret.size, stock: newStock, reorder_level: row?.reorder_level || 10 },
          { onConflict: 'warehouse_id,model,color,size' }
        )
        if (e2) throw new Error(e2.message)
        setWhInv(prev => {
          const next = [...prev]
          const idx = next.findIndex(r => r.warehouse_id === wid && r.model === ret.model && r.color === ret.color && r.size === ret.size)
          if (idx >= 0) next[idx] = { ...next[idx], stock: newStock }
          else next.push({ warehouse_id: wid, model: ret.model, color: ret.color, size: ret.size, stock: newStock, reorder_level: 10 })
          return next
        })
      }

      setPlans(prev => ({ ...prev, [retDate]: { ...existing, date: retDate, returns: newReturns } }))
      toast(`✅ ${taggedReturns.length} items restocked to ${warehouses.find(w => w.id === wid)?.name}`)
      setStep('idle'); setQty(''); setSlots([])
    } catch (err) {
      toast('⚠️ ' + err.message)
    }
    setSaving(false)
  }

  // ── History helpers ───────────────────────────────
  const retHistory = Object.entries(plans)
    .filter(([, p]) => (p.returns || []).length > 0)
    .sort((a, b) => b[0].localeCompare(a[0]))

  async function deleteOneReturn(date, idx) {
    if (!confirm('Delete this return? Stock will be deducted back.')) return
    const plan = plans[date]
    const rets = [...(plan.returns || [])]
    const removed = rets.splice(idx, 1)[0]
    const wid = removed.warehouse_id || warehouses[0]?.id
    const row = whInv.find(r => r.warehouse_id === wid && r.model === removed.model && r.color === removed.color && r.size === removed.size)
    const newStock = (row?.stock || 0) - 1
    const [r1, r2] = await Promise.all([
      sb.from('dispatch_plans').upsert({ ...plan, date, returns: rets }, { onConflict: 'date' }),
      row ? sb.from('warehouse_inventory').update({ stock: newStock }).eq('warehouse_id', wid).eq('model', removed.model).eq('color', removed.color).eq('size', removed.size) : Promise.resolve({ error: null }),
    ])
    if (r1.error) { toast('Error: ' + r1.error.message); return }
    if (row) setWhInv(prev => prev.map(r => r.warehouse_id === wid && r.model === removed.model && r.color === removed.color && r.size === removed.size ? { ...r, stock: newStock } : r))
    setPlans(prev => ({ ...prev, [date]: { ...prev[date], returns: rets } }))
    toast('✅ Return deleted')
  }

  async function deleteAllReturns(date) {
    if (!confirm(`Delete ALL returns for ${fmtDate(date)}?\nStock will be deducted back.`)) return
    const plan = plans[date]
    const rets = plan.returns || []
    const invUpdates = []
    const newWhInv = [...whInv]
    rets.forEach(r => {
      const wid = r.warehouse_id || warehouses[0]?.id
      const idx = newWhInv.findIndex(x => x.warehouse_id === wid && x.model === r.model && x.color === r.color && x.size === r.size)
      if (idx >= 0) {
        newWhInv[idx] = { ...newWhInv[idx], stock: newWhInv[idx].stock - 1 }
        const ex = invUpdates.find(u => u.warehouse_id === wid && u.model === r.model && u.color === r.color && u.size === r.size)
        if (ex) ex.stock -= 1
        else invUpdates.push({ ...newWhInv[idx] })
      }
    })
    const [r1] = await Promise.all([
      sb.from('dispatch_plans').upsert({ ...plan, date, returns: [] }, { onConflict: 'date' }),
      invUpdates.length ? sb.from('warehouse_inventory').upsert(invUpdates, { onConflict: 'warehouse_id,model,color,size' }) : Promise.resolve({ error: null }),
    ])
    if (r1.error) { toast('Error: ' + r1.error.message); return }
    setWhInv(newWhInv)
    setPlans(prev => ({ ...prev, [date]: { ...prev[date], returns: [] } }))
    toast(`✅ All returns for ${fmtDate(date)} deleted`)
  }

  // ── render ────────────────────────────────────────
  return (
    <div>
      <ToastContainer toasts={toasts} />

      {/* ── Top controls: date + warehouse ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '1rem' }}>
        <Card style={{ marginBottom: 0, padding: '.9rem 1rem' }}>
          <div style={ttl}>Return Date</div>
          <input type="date" value={retDate} onChange={e => setRetDate(e.target.value)}
            style={{ ...inputStyle, fontWeight: 600, fontSize: '.88rem' }} />
        </Card>
        <Card style={{ marginBottom: 0, padding: '.9rem 1rem' }}>
          <div style={ttl}>Restock to Warehouse</div>
          <select value={whId} onChange={e => setWhId(e.target.value)} style={{ ...selectStyle, fontWeight: 700 }}>
            {warehouses.map((w, i) => <option key={w.id} value={w.id}>{WH_ICONS[i]} {w.name}</option>)}
          </select>
        </Card>
      </div>

      {/* ── Log returns card ── */}
      <Card accent="#059669" style={{ marginBottom: '1rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '.95rem', fontWeight: 800, color: '#111827' }}>↩️ Log New Returns</div>
          <div style={{ fontSize: '.72rem', color: '#9ca3af', marginTop: '.15rem' }}>Enter total qty of returns received today, then fill details for each item</div>
        </div>

        {step === 'idle' && (
          <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={lbl}>How many items returned today?</div>
              <input type="number" min="1" max="200" value={qty}
                onChange={e => setQty(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleStartEntry()}
                placeholder="e.g. 12"
                style={{ ...inputStyle, fontSize: '1rem', fontWeight: 800, textAlign: 'center' }}
              />
            </div>
            <Btn variant="success" size="lg" onClick={handleStartEntry} disabled={!qty}>
              Start Entry →
            </Btn>
          </div>
        )}

        {step === 'filling' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.85rem', flexWrap: 'wrap', gap: '.5rem' }}>
              <div style={{ fontSize: '.85rem', fontWeight: 700, color: '#111827' }}>
                Fill details for all <span style={{ color: '#059669' }}>{slots.length}</span> returned items
              </div>
              <Btn variant="ghost" size="sm" onClick={() => { setStep('idle'); setSlots([]); setQty('') }}>✕ Cancel</Btn>
            </div>

            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '2rem 1fr 1fr 1fr 1fr 1fr 2.5rem 2rem', gap: '.4rem', padding: '.35rem .5rem', background: '#f8fafc', borderRadius: '8px 8px 0 0', fontSize: '.62rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.5px', border: '1px solid #e2e8f0', borderBottom: 'none' }}>
              <span>#</span><span>Platform</span><span>Courier</span><span>Model</span><span>Color</span><span>UK Size</span><span style={{ textAlign: 'center' }}>Copy↓</span><span></span>
            </div>

            {/* Slots */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '0 0 8px 8px', overflow: 'hidden', maxHeight: '60vh', overflowY: 'auto' }}>
              {slots.map((slot, i) => {
                const slotColors = colors(slot.model)
                const slotSizes  = sizes(slot.model, slot.color)
                const complete   = slot.model && slot.color && slot.size
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '2rem 1fr 1fr 1fr 1fr 1fr 2.5rem 2rem', gap: '.4rem', padding: '.45rem .5rem', borderBottom: '1px solid #f1f5f9', background: complete ? '#fff' : '#fffbeb', alignItems: 'center' }}>
                    {/* # */}
                    <span style={{ fontSize: '.68rem', fontWeight: 700, color: complete ? '#059669' : '#f59e0b', textAlign: 'center' }}>
                      {complete ? '✓' : i + 1}
                    </span>
                    {/* Platform */}
                    <select value={slot.platform} onChange={e => updateSlot(i, 'platform', e.target.value)}
                      style={{ ...slotSel }}>
                      {PLATFORMS.map(p => <option key={p}>{p}</option>)}
                    </select>
                    {/* Courier */}
                    <select value={slot.courier || ''} onChange={e => updateSlot(i, 'courier', e.target.value)}
                      style={{ ...slotSel }}>
                      {(COURIERS[slot.platform] || ['Other']).map(c => <option key={c}>{c}</option>)}
                    </select>
                    {/* Model */}
                    <select value={slot.model} onChange={e => updateSlot(i, 'model', e.target.value)}
                      style={{ ...slotSel }}>
                      {models.map(m => <option key={m}>{m}</option>)}
                    </select>
                    {/* Color */}
                    <select value={slot.color} onChange={e => updateSlot(i, 'color', e.target.value)}
                      style={{ ...slotSel, borderColor: !slot.color ? '#f59e0b' : '#e2e8f0' }}>
                      <option value="">Color</option>
                      {slotColors.map(c => <option key={c}>{c}</option>)}
                    </select>
                    {/* Size */}
                    <select value={slot.size} onChange={e => updateSlot(i, 'size', e.target.value)}
                      style={{ ...slotSel, borderColor: !slot.size ? '#f59e0b' : '#e2e8f0' }}>
                      <option value="">Size</option>
                      {slotSizes.map(s => <option key={s} value={s}>UK {s}</option>)}
                    </select>
                    {/* Copy down */}
                    <button onClick={() => copyDown(i)} title="Copy this row to all below"
                      style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: '.65rem', padding: '.2rem .3rem', cursor: 'pointer', color: '#4f46e5', fontWeight: 700 }}>
                      ↓All
                    </button>
                    {/* Remove */}
                    <button onClick={() => setSlots(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '.8rem', cursor: 'pointer', padding: 0 }}>
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Progress + Save */}
            <div style={{ marginTop: '.85rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
              <div style={{ fontSize: '.78rem', color: '#64748b' }}>
                <span style={{ color: '#059669', fontWeight: 700 }}>{slots.filter(s => s.model && s.color && s.size).length}</span>
                <span style={{ color: '#9ca3af' }}> / {slots.length} completed</span>
              </div>
              <Btn variant="success" size="lg" onClick={handleSave} disabled={saving || slots.some(s => !s.model || !s.color || !s.size)}>
                {saving ? '⏳ Saving…' : `📦 Save & Restock ${slots.length} Items`}
              </Btn>
            </div>
          </div>
        )}
      </Card>

      {/* ── Return Records ── */}
      <Card>
        <div style={{ fontSize: '.95rem', fontWeight: 800, color: '#111827', marginBottom: '.85rem' }}>Return Records</div>
        {retHistory.length === 0
          ? <EmptyState icon="↩️" message="No returns logged yet." />
          : retHistory.map(([date, plan]) => <ReturnDayCard key={date} date={date} plan={plan} warehouses={warehouses} onDeleteOne={deleteOneReturn} onDeleteAll={deleteAllReturns} />)
        }
      </Card>
    </div>
  )
}

function ReturnDayCard({ date, plan, warehouses, onDeleteOne, onDeleteAll }) {
  const [open, setOpen] = useState(false)
  const rets = plan.returns || []
  const whMap = Object.fromEntries(warehouses.map(w => [w.id, w.name]))

  const fk = rets.filter(r => r.platform === 'Flipkart').length
  const az = rets.filter(r => r.platform === 'Amazon').length
  const ms = rets.filter(r => r.platform === 'Meesho').length
  const mn = rets.filter(r => r.platform === 'Myntra').length
  const platStr = [fk?`FK:${fk}`:'', az?`AZ:${az}`:'', ms?`MS:${ms}`:'', mn?`MN:${mn}`:''].filter(Boolean).join(' · ')

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: '.75rem', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
      <div style={{ padding: '.7rem 1rem', background: '#f0fdf4', borderBottom: '1px solid #dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', cursor: 'pointer', flex: 1 }} onClick={() => setOpen(o => !o)}>
          <span style={{ fontSize: '.9rem', fontWeight: 800, color: '#166534' }}>{fmtDate(date)}</span>
          <span style={{ background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 999, padding: '.1rem .5rem', fontSize: '.68rem', fontWeight: 700 }}>↩️ {rets.length} returned</span>
          <span style={{ fontSize: '.7rem', color: '#94a3b8' }}>{platStr}</span>
          <span style={{ color: '#cbd5e1', fontSize: '.7rem', marginLeft: 'auto' }}>{open ? '▴' : '▾'}</span>
        </div>
        <Btn variant="danger" size="sm" onClick={() => onDeleteAll(date)}>🗑 Delete All</Btn>
      </div>
      {open && (
        <div>
          {rets.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.45rem .75rem', borderBottom: '1px solid #f8fafc', fontSize: '.78rem' }}>
              <span style={{ color: '#cbd5e1', width: 20, fontSize: '.65rem', fontWeight: 600 }}>{i + 1}</span>
              <PlatBadge platform={r.platform} />
              <span style={{ fontWeight: 700, color: '#1e293b', flex: 1 }}>{r.model}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <ColorDot color={r.color} />
                <span style={{ color: '#475569' }}>{r.color}</span>
              </span>
              <span style={{ background: '#eff6ff', color: '#3730a3', border: '1px solid #c7d7f8', borderRadius: 5, padding: '.1rem .45rem', fontSize: '.72rem', fontWeight: 800 }}>UK{r.size}</span>
              <span style={{ background: '#f0fdf4', color: '#065f46', borderRadius: 5, padding: '.1rem .4rem', fontSize: '.65rem', fontWeight: 600 }}>{whMap[r.warehouse_id] || '—'}</span>
              {r.courier && <span style={{ background: '#f1f5f9', color: '#475569', borderRadius: 5, padding: '.1rem .4rem', fontSize: '.65rem', fontWeight: 600 }}>🚚 {r.courier}</span>}
              <button onClick={() => onDeleteOne(date, i)}
                style={{ background: '#fff1f2', border: '1px solid #fecaca', color: '#ef4444', borderRadius: 4, padding: '.1rem .4rem', fontSize: '.7rem', cursor: 'pointer', flexShrink: 0 }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── styles ─────────────────────────────────────────────
const ttl = { fontSize: '.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.3rem' }
const lbl = { fontSize: '.72rem', fontWeight: 700, color: '#374151', display: 'block', marginBottom: '.3rem' }
const slotSel = { width: '100%', padding: '.32rem .4rem', border: '1.5px solid #e2e8f0', borderRadius: 6, fontSize: '.75rem', fontWeight: 600, color: '#1e293b', background: '#fff', fontFamily: 'inherit', cursor: 'pointer' }
