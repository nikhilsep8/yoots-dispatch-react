import { useState, useEffect, useRef } from 'react'
import { useApp } from '../lib/AppContext'
import { sb } from '../lib/supabase'
import { today, fmtDate, WH_COLORS, WH_ICONS, COLOR_HEX } from '../lib/constants'

const manLbl = { fontSize: '.65rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.3rem' }
const manSel = { width: '100%', padding: '.5rem .65rem', border: '1.5px solid #bbf7d0', borderRadius: 7, fontSize: '.82rem', fontWeight: 600, color: '#1e293b', background: '#fff', fontFamily: 'inherit', cursor: 'pointer' }
import { parseYootsSKU, parseYootsFromName, parseIndSize } from '../lib/constants'
import { Btn, Card, PlatBadge, ColorDot, Badge, useToast, ToastContainer, EmptyState } from '../components/ui'
import * as XLSX from 'xlsx'

export default function Dispatch({ initialDate, setPage }) {
  const { warehouses, whInv, setWhInv, plans, setPlans, settings, user } = useApp()
  const { toast, toasts } = useToast()

  const [date, setDate]           = useState(initialDate || today())
  const [pendingOrders, setPending] = useState([])
  const [showEntry, setShowEntry] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [fileHint, setFileHint]   = useState('')
  const fileRef = useRef()
  const pdfRef  = useRef()
  const [entryTab, setEntryTab] = useState('csv')
  // Manual entry state
  const [manPlat,  setManPlat]  = useState('Flipkart')
  const [manModel, setManModel] = useState('')
  const [manColor, setManColor] = useState('')
  const [manSize,  setManSize]  = useState('')
  const [manQty,   setManQty]   = useState(1)

  useEffect(() => { if (initialDate) setDate(initialDate) }, [initialDate])

  const plan = plans[date]

  // ── File upload ───────────────────────────────────
  function handleFile(file) {
    if (!file) return
    setFileHint('Parsing ' + file.name + '…')
    const ext = file.name.split('.').pop().toLowerCase()
    const reader = new FileReader()
    if (ext === 'csv' || ext === 'txt') {
      reader.onload = e => finalizeParsed(parseCSV(e.target.result), file.name)
      reader.readAsText(file)
    } else {
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' })
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
          finalizeParsed(parseExcel(rows), file.name)
        } catch (err) { setFileHint('Error: ' + err.message) }
      }
      reader.readAsArrayBuffer(file)
    }
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

  function parseCSV(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l)
    if (!lines.length) return []
    const headers = csvSplit(lines[0])
    const hdr = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''))
    const col = (...nn) => { for (const n of nn) { const i = hdr.findIndex(h => h.includes(n)); if (i >= 0) return i }; return -1 }
    const hasFK = hdr.some(h => h.includes('shipmentid'))
    const hasMeesho = hdr.some(h => h.includes('suborderid'))
    const hasAz = hdr.some(h => h.includes('asin'))
    const rows = []
    if (hasFK) {
      const iSku = col('sku'), iQty = col('quantity', 'qty')
      for (let i = 1; i < lines.length; i++) {
        const c = csvSplit(lines[i])
        const p = parseYootsSKU(c[iSku], whInv)
        const q = parseInt(c[iQty]) || 1
        if (p) for (let j = 0; j < q; j++) rows.push({ platform: 'Flipkart', ...p })
      }
    } else if (hasMeesho) {
      const iSku = col('sku', 'productsku'), iQty = col('quantity', 'qty'), iName = col('productname', 'name')
      for (let i = 1; i < lines.length; i++) {
        const c = csvSplit(lines[i])
        const q = parseInt(c[iQty]) || 1
        const p = parseYootsSKU(c[iSku], whInv) || parseYootsFromName(c[iName], whInv)
        if (p) for (let j = 0; j < q; j++) rows.push({ platform: 'Meesho', ...p })
      }
    } else {
      const iSku = col('sku', 'product', 'item'), iQty = col('quantity', 'qty'), iName = col('productname', 'name', 'title')
      for (let i = 1; i < lines.length; i++) {
        const c = csvSplit(lines[i])
        const q = parseInt(c[iQty]) || 1
        const p = parseYootsSKU(c[iSku], whInv) || parseYootsFromName(c[iName], whInv) || parseYootsFromName(c[iSku], whInv)
        if (p) for (let j = 0; j < q; j++) rows.push({ platform: 'Flipkart', ...p })
      }
    }
    return rows
  }

  function parseExcel(rows) {
    const nk = k => k.toLowerCase().replace(/[^a-z0-9]/g, '')
    const fv = (row, ...nn) => { for (const n of nn) { const k = Object.keys(row).find(k => nk(k).includes(n)); if (k !== undefined && String(row[k]).trim()) return String(row[k]).trim() }; return '' }
    const allK = Object.keys(rows[0] || {}).map(k => nk(k))
    let plat = 'Flipkart'
    if (allK.some(k => k.includes('suborderid'))) plat = 'Meesho'
    else if (allK.some(k => k.includes('asin'))) plat = 'Amazon'
    return rows.flatMap(row => {
      const sku = fv(row, 'sku', 'sellersku', 'productsku', 'variantsku')
      const name = fv(row, 'productname', 'title', 'product', 'name')
      const qty = parseInt(fv(row, 'quantity', 'qty')) || 1
      const p = parseYootsSKU(sku, whInv) || parseYootsFromName(name, whInv) || parseYootsFromName(sku, whInv)
      return p ? Array.from({ length: qty }, () => ({ platform: plat, ...p })) : []
    })
  }

  function finalizeParsed(rows, fname) {
    if (!rows.length) { setFileHint('No valid rows found in ' + fname); return }
    setFileHint(`✓ Parsed ${rows.length} orders from ${fname}`)
    setPending(rows)
  }

  // ── Meesho PDF Manifest Parser ────────────────────
  function handleMeeshoPDF(file) {
    if (!file) return
    setFileHint('Reading Meesho manifest…')
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        // Load PDF.js from CDN
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script')
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
            script.onload = resolve
            script.onerror = reject
            document.head.appendChild(script)
          })
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        }
        const pdfLib = window.pdfjsLib
        const pdf = await pdfLib.getDocument({ data: e.target.result }).promise
        let fullText = ''
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const content = await page.getTextContent()
          const pageText = content.items.map(item => item.str).join(' ')
          fullText += pageText + '\n'
        }
        parseMeeshoManifestText(fullText, file.name)
      } catch (err) {
        setFileHint('Error reading PDF: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function parseMeeshoManifestText(text, fname) {
    const rows = []
    // Match lines from the picklist: SKU Color Size Qty pattern
    // e.g. "San-005-Navy Navy Blue IND-8 1"
    // Also from courier pages: "1 29340656... AWB Flip-Yoots001-Blue 1 IND-9"
    
    // Strategy: find all SKU-like tokens and their adjacent IND-X sizes
    // Split text into tokens
    const tokens = text.split(/\s+/).filter(t => t.length > 0)
    
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      // Check if this looks like a Yoots SKU
      const isSKU = (
        /^(San|Flip|Floater|Slipper|Sandal)-?(Yoots)?\d+/i.test(token) ||
        /^Yoots-?\d+/i.test(token)
      )
      if (!isSKU) continue

      // Look ahead for IND-X size (within next 5 tokens)
      let sizeStr = ''
      let qty = 1
      for (let j = i + 1; j < Math.min(i + 6, tokens.length); j++) {
        if (/^IND-?\d+$/i.test(tokens[j])) {
          sizeStr = tokens[j]
          // qty is usually next token after size
          if (j + 1 < tokens.length && /^\d+$/.test(tokens[j + 1])) {
            qty = parseInt(tokens[j + 1]) || 1
          }
          break
        }
      }

      if (!sizeStr) continue

      const parsed = parseYootsSKU(token, whInv, sizeStr)
      if (parsed) {
        for (let q = 0; q < qty; q++) {
          rows.push({ platform: 'Meesho', ...parsed })
        }
      }
    }

    if (!rows.length) {
      setFileHint('No valid SKUs found in manifest. Check the PDF format.')
      return
    }
    setFileHint(`✓ Parsed ${rows.length} Meesho orders from ${fname}`)
    setPending(rows)
  }

  // ── Generate plan ─────────────────────────────────
  async function generatePlan() {
    if (!pendingOrders.length) { toast('No orders'); return }
    setGenerating(true)
    const simInv = {}
    whInv.forEach(r => { simInv[`${r.warehouse_id}|${r.model}|${r.color}|${r.size}`] = { ...r } })
    const priority = (settings.dispatch_priority || 'huda_complex,aggarsain,huda_new').split(',')
    const whByCode = {}; warehouses.forEach(w => { whByCode[w.code] = w })
    const whPrioMapped = priority.map(c => whByCode[c]).filter(Boolean)
    const whPrioIds = new Set(whPrioMapped.map(w => w.id))
    const whRemaining = warehouses.filter(w => !whPrioIds.has(w.id))
    const whPrio = [...whPrioMapped, ...whRemaining]
    const newPlan = {}; const oos = []
    warehouses.forEach(w => { newPlan[w.code] = [] })
    const skus = {}
    pendingOrders.forEach(o => {
      const k = `${o.platform}|${o.model}|${o.color}|${o.size}`
      if (!skus[k]) skus[k] = { ...o, qty: 0 }
      skus[k].qty++
    })
    Object.values(skus).forEach(sku => {
      let rem = sku.qty
      for (const wh of whPrio) {
        if (rem <= 0) break
        const key = `${wh.id}|${sku.model}|${sku.color}|${sku.size}`
        const inv = simInv[key]
        if (!inv || inv.stock <= 0) continue
        const take = Math.min(rem, inv.stock)
        newPlan[wh.code].push({ model: sku.model, color: sku.color, size: sku.size, qty: take, platform: sku.platform })
        simInv[key].stock -= take; rem -= take
      }
      if (rem > 0) {
        const fw = whPrio[0]
        if (fw) newPlan[fw.code].push({ model: sku.model, color: sku.color, size: sku.size, qty: rem, platform: sku.platform, backorder: true })
        oos.push({ ...sku, missing: rem })
      }
    })
    const { error } = await sb.from('dispatch_plans').upsert({ date, orders: pendingOrders, plan: newPlan, total_orders: pendingOrders.length, status: 'pending', created_by: user?.email, created_at: new Date().toISOString() }, { onConflict: 'date' })
    if (error) { toast('Save error: ' + error.message); setGenerating(false); return }
    setPlans(prev => ({ ...prev, [date]: { date, orders: pendingOrders, plan: newPlan, oos, total_orders: pendingOrders.length, status: 'pending' } }))
    setShowEntry(false); setPending([])
    toast('✅ Plan generated for ' + fmtDate(date))
    setGenerating(false)
  }

  // ── Confirm dispatch ──────────────────────────────
  async function confirmDispatch() {
    if (!plan) return
    const { data: fresh } = await sb.from('dispatch_plans').select('status').eq('date', date).single()
    if (fresh?.status === 'dispatched') { toast('⚠️ Already dispatched'); return }
    if (!confirm('Confirm dispatch?\nThis will deduct ALL items from stock.')) return
    setConfirming(true)
    let updates = []
    const newWhInv = [...whInv]
    warehouses.forEach(wh => {
      ;(plan.plan[wh.code] || []).forEach(item => {
        const idx = newWhInv.findIndex(r => r.warehouse_id === wh.id && r.model === item.model && r.color === item.color && r.size === item.size)
        if (idx >= 0) {
          newWhInv[idx] = { ...newWhInv[idx], stock: newWhInv[idx].stock - item.qty }
          updates.push({ warehouse_id: wh.id, model: item.model, color: item.color, size: item.size, stock: newWhInv[idx].stock, reorder_level: newWhInv[idx].reorder_level })
        } else {
          const nr = { warehouse_id: wh.id, model: item.model, color: item.color, size: item.size, stock: -item.qty, reorder_level: 10 }
          newWhInv.push(nr); updates.push(nr)
        }
      })
    })
    // Dedup
    const seen = {}
    updates = updates.filter(u => { const k = `${u.warehouse_id}|${u.model}|${u.color}|${u.size}`; if (seen[k]) return false; seen[k] = true; return true })
    const { error: e1 } = await sb.from('warehouse_inventory').upsert(updates, { onConflict: 'warehouse_id,model,color,size' })
    if (e1) { toast('Stock update failed: ' + e1.message); setConfirming(false); return }
    await sb.from('dispatch_plans').update({ status: 'dispatched' }).eq('date', date)
    setWhInv(newWhInv)
    setPlans(prev => ({ ...prev, [date]: { ...prev[date], status: 'dispatched' } }))
    toast(`✅ ${updates.length} SKUs deducted`)
    setConfirming(false)
  }

  // ── Delete plan ───────────────────────────────────
  async function deletePlan() {
    if (!plan) return
    const dispatched = plan.status === 'dispatched'
    const msg = dispatched
      ? `Delete plan for ${fmtDate(date)}?\n\n⚠️ Stock WAS already deducted.\nDeleting will ADD BACK stock for all dispatched items.`
      : `Delete plan for ${fmtDate(date)}?\n\nThis plan was never confirmed — stock will NOT be changed.`
    if (!confirm(msg)) return
    try {
      if (dispatched && plan.plan) {
        let restore = []
        const newWhInv = [...whInv]
        warehouses.forEach(wh => {
          ;(plan.plan[wh.code] || []).forEach(item => {
            const idx = newWhInv.findIndex(r => r.warehouse_id === wh.id && r.model === item.model && r.color === item.color && r.size === item.size)
            if (idx >= 0) {
              newWhInv[idx] = { ...newWhInv[idx], stock: newWhInv[idx].stock + item.qty }
              restore.push({ warehouse_id: wh.id, model: item.model, color: item.color, size: item.size, stock: newWhInv[idx].stock, reorder_level: newWhInv[idx].reorder_level })
            }
          })
        })
        const seen = {}
        restore = restore.filter(u => { const k = `${u.warehouse_id}|${u.model}|${u.color}|${u.size}`; if (seen[k]) return false; seen[k] = true; return true })
        if (restore.length) {
          const { error } = await sb.from('warehouse_inventory').upsert(restore, { onConflict: 'warehouse_id,model,color,size' })
          if (error) throw new Error(error.message)
          setWhInv(newWhInv)
        }
      }
      await sb.from('dispatch_plans').delete().eq('date', date)
      setPlans(prev => { const next = { ...prev }; delete next[date]; return next })
      toast(dispatched ? '✅ Plan deleted — stock restored' : '✅ Plan deleted')
    } catch (err) { toast('⚠️ ' + err.message) }
  }

  // ── WhatsApp ──────────────────────────────────────
  function sendWhatsApp() {
    if (!plan) return
    const packer = settings.packer_whatsapp || ''
    const orders = plan.orders || []
    const fkC = orders.filter(o => o.platform === 'Flipkart').length
    const azC = orders.filter(o => o.platform === 'Amazon').length
    let msg = `🚚 *YOOTS DISPATCH*\n📅 ${fmtDate(date)}\n${'━'.repeat(20)}\n\n📦 *TOTAL: ${plan.total_orders} orders*\n`
    if (fkC) msg += `   Flipkart: ${fkC}\n`
    if (azC) msg += `   Amazon: ${azC}\n`
    msg += '\n'
    warehouses.forEach((wh, i) => {
      const items = (plan.plan || {})[wh.code] || []
      if (!items.length) return
      const total = items.reduce((s, r) => s + r.qty, 0)
      msg += `${WH_ICONS[i]} *${wh.name.toUpperCase()}* (${total} items)\n${'─'.repeat(20)}\n`
      const grouped = {}
      items.forEach(it => { const k = `${it.model}|${it.color}`; if (!grouped[k]) grouped[k] = { model: it.model, color: it.color, sizes: [] }; for (let q = 0; q < it.qty; q++) grouped[k].sizes.push(it.size) })
      Object.values(grouped).forEach(g => { msg += `  • ${g.model} ${g.color} → ${g.sizes.sort((a,b)=>a-b).map(s=>`UK ${s}`).join(', ')}\n` })
      msg += '\n'
    })
    msg += `${'━'.repeat(20)}\n✅ *Pack & Ship Today!*`
    window.open(`https://wa.me/${packer}?text=${encodeURIComponent(msg)}`, '_blank')
    toast('📱 Opening WhatsApp…')
  }

  // ── render ────────────────────────────────────────
  return (
    <div>
      <ToastContainer toasts={toasts} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.85rem', gap: '.5rem', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800 }}>🚚 Dispatch Plan</h2>
        <div style={{ display: 'flex', gap: '.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: '.38rem .65rem', fontSize: '.78rem' }} />
          <Btn size="sm" onClick={() => { setShowEntry(true); setPending([]) }}>+ New Orders</Btn>
        </div>
      </div>

      {/* Quick links */}
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '.72rem', fontWeight: 700, color: '#64748b' }}>Quick open:</span>
        {[
          { href: 'https://seller.flipkart.com/index.html#/orders', label: 'Flipkart', bg: '#2874f0', color: '#fff' },
          { href: 'https://sell.amazon.in/seller-services/manage-orders', label: 'Amazon', bg: '#FF9900', color: '#fff' },
          { href: 'https://supplier.meesho.com', label: 'Meesho ✓', bg: '#7e22ce', color: '#fff' },
          { href: 'https://sellerportal.myntra.com', label: 'MYNTRA', bg: '#be123c', color: '#fff' },
        ].map(l => (
          <a key={l.href} href={l.href} target="_blank" rel="noreferrer"
            style={{ background: l.bg, color: l.color, padding: '.35rem .75rem', borderRadius: 7, fontSize: '.73rem', fontWeight: 700, textDecoration: 'none' }}>
            {l.label}
          </a>
        ))}
      </div>

      {/* Entry panel */}
      {showEntry && (
        <Card style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.85rem' }}>
            <div style={{ fontSize: '.9rem', fontWeight: 700 }}>Upload Order File — {fmtDate(date)}</div>
            <Btn variant="ghost" size="sm" onClick={() => setShowEntry(false)}>✕</Btn>
          </div>
          {/* Upload tabs */}
          <div style={{ display: 'flex', borderBottom: '2px solid #f1f5f9', marginBottom: '1rem', gap: 0 }}>
            <button id="dtabCsv" onClick={() => setEntryTab('csv')}
              style={{ padding: '.5rem 1rem', fontSize: '.78rem', fontWeight: 700, border: 'none', background: 'none', cursor: 'pointer', color: entryTab==='csv'?'#4f46e5':'#9ca3af', borderBottom: entryTab==='csv'?'2.5px solid #4f46e5':'2.5px solid transparent', marginBottom: -2, fontFamily: 'inherit' }}>
              📂 Flipkart / Amazon CSV
            </button>
            <button id="dtabPdf" onClick={() => setEntryTab('pdf')}
              style={{ padding: '.5rem 1rem', fontSize: '.78rem', fontWeight: 700, border: 'none', background: 'none', cursor: 'pointer', color: entryTab==='pdf'?'#7e22ce':'#9ca3af', borderBottom: entryTab==='pdf'?'2.5px solid #7e22ce':'2.5px solid transparent', marginBottom: -2, fontFamily: 'inherit' }}>
              <span style={{ background: '#7e22ce', color: '#fff', borderRadius: 3, padding: '0 4px', fontSize: '.65rem', fontWeight: 900, marginRight: 4 }}>M</span>
              Meesho Manifest PDF
            </button>
            <button id="dtabManual" onClick={() => setEntryTab('manual')}
              style={{ padding: '.5rem 1rem', fontSize: '.78rem', fontWeight: 700, border: 'none', background: 'none', cursor: 'pointer', color: entryTab==='manual'?'#059669':'#9ca3af', borderBottom: entryTab==='manual'?'2.5px solid #059669':'2.5px solid transparent', marginBottom: -2, fontFamily: 'inherit' }}>
              ✍️ Manual Entry
            </button>
          </div>

          {/* CSV upload */}
          {entryTab === 'csv' && (
            <div>
              <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px dashed #c7d7f8', borderRadius: 10, padding: '2rem', background: '#f8faff', cursor: 'pointer', position: 'relative', textAlign: 'center' }}>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt" onChange={e => handleFile(e.target.files[0])}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                <div style={{ fontSize: '1.8rem', marginBottom: '.5rem' }}>📂</div>
                <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: '.25rem' }}>Drop order CSV here or click to browse</div>
                <div style={{ fontSize: '.75rem', color: '#64748b' }}>Flipkart / Amazon / Meesho — Excel or CSV</div>
              </label>
            </div>
          )}

          {/* Meesho PDF upload */}
          {entryTab === 'pdf' && (
            <div>
              <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px dashed #e9d5ff', borderRadius: 10, padding: '2rem', background: '#fdf4ff', cursor: 'pointer', position: 'relative', textAlign: 'center' }}>
                <input ref={pdfRef} type="file" accept=".pdf" onChange={e => handleMeeshoPDF(e.target.files[0])}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                <div style={{ fontSize: '1.8rem', marginBottom: '.5rem' }}>📋</div>
                <div style={{ fontWeight: 700, color: '#7e22ce', marginBottom: '.25rem' }}>Drop Meesho Manifest PDF here</div>
                <div style={{ fontSize: '.75rem', color: '#94a3b8' }}>Upload the Picklist / Manifest PDF from Meesho Supplier Panel</div>
              </label>
              <div style={{ marginTop: '.65rem', background: '#f5f3ff', border: '1px solid #e9d5ff', borderRadius: 8, padding: '.65rem .85rem', fontSize: '.75rem', color: '#6d28d9' }}>
                <strong>How to get this file:</strong> Meesho Supplier Panel → Orders → Ready to Ship → Download Manifest PDF
              </div>
            </div>
          )}

          {fileHint && <div style={{ fontSize: '.75rem', color: fileHint.startsWith('✓') ? '#059669' : '#64748b', textAlign: 'center', marginTop: '.5rem' }}>{fileHint}</div>}

          {/* Manual Entry tab */}
          {entryTab === 'manual' && (
            <div>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '1rem' }}>
                {/* Row 1: Platform + Model */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.65rem', marginBottom: '.65rem' }}>
                  <div>
                    <div style={manLbl}>Platform</div>
                    <select value={manPlat} onChange={e => setManPlat(e.target.value)} style={manSel}>
                      {['Flipkart','Amazon','Meesho','Myntra'].map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={manLbl}>Model</div>
                    <select value={manModel} onChange={e => { setManModel(e.target.value); setManColor(''); setManSize('') }} style={manSel}>
                      <option value="">Select model</option>
                      {[...new Set(whInv.map(r => r.model))].sort().map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                {/* Row 2: Color + Size + Qty */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: '.65rem', marginBottom: '.85rem' }}>
                  <div>
                    <div style={manLbl}>Color</div>
                    <select value={manColor} onChange={e => { setManColor(e.target.value); setManSize('') }} style={manSel} disabled={!manModel}>
                      <option value="">Select color</option>
                      {[...new Set(whInv.filter(r => r.model === manModel).map(r => r.color))].sort().map(c => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={manLbl}>UK Size</div>
                    <select value={manSize} onChange={e => setManSize(e.target.value)} style={manSel} disabled={!manColor}>
                      <option value="">Size</option>
                      {[...new Set(whInv.filter(r => r.model === manModel && r.color === manColor).map(r => r.size))].sort((a,b)=>a-b).map(s => (
                        <option key={s} value={s}>UK {s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={manLbl}>Qty</div>
                    <input type="number" min="1" max="99" value={manQty}
                      onChange={e => setManQty(parseInt(e.target.value) || 1)}
                      style={{ ...manSel, textAlign: 'center', fontWeight: 800, padding: '.48rem .4rem' }} />
                  </div>
                </div>
                {/* Stock preview */}
                {manModel && manColor && manSize && (
                  <div style={{ marginBottom: '.75rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                    {warehouses.map((wh, i) => {
                      const stk = whInv.find(r => r.warehouse_id === wh.id && r.model === manModel && r.color === manColor && r.size === parseInt(manSize))?.stock ?? 0
                      return (
                        <span key={wh.id} style={{ background: stk > 0 ? '#dcfce7' : '#fff1f2', color: stk > 0 ? '#166534' : '#dc2626', border: `1px solid ${stk > 0 ? '#bbf7d0' : '#fecaca'}`, borderRadius: 6, padding: '.2rem .55rem', fontSize: '.72rem', fontWeight: 700 }}>
                          {WH_ICONS[i]} {stk} in stock
                        </span>
                      )
                    })}
                  </div>
                )}
                <button
                  onClick={() => {
                    if (!manModel || !manColor || !manSize) { toast('Select model, color and size'); return }
                    const newOrders = Array.from({ length: manQty }, () => ({ platform: manPlat, model: manModel, color: manColor, size: parseInt(manSize) }))
                    setPending(prev => [...prev, ...newOrders])
                    setManQty(1)
                    toast(`✓ Added ${manQty} × ${manModel} ${manColor} UK${manSize}`)
                  }}
                  style={{ width: '100%', padding: '.6rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 8, fontSize: '.85rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  + Add to Order Queue
                </button>
              </div>
              {pendingOrders.length > 0 && (
                <div style={{ marginTop: '.65rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '.5rem .75rem', fontSize: '.78rem', color: '#166534', fontWeight: 600 }}>
                  ✓ {pendingOrders.length} orders in queue — scroll down to Generate Plan
                </div>
              )}
            </div>
          )}

          {pendingOrders.length > 0 && (
            <div style={{ marginTop: '.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.5rem' }}>
                <span style={{ fontWeight: 700 }}>{pendingOrders.length} orders parsed</span>
                <div style={{ display: 'flex', gap: '.4rem' }}>
                  <Btn variant="ghost" size="sm" onClick={() => setPending([])}>Clear</Btn>
                  <Btn variant="success" size="sm" onClick={generatePlan} disabled={generating}>{generating ? 'Generating…' : '⚡ Generate Plan'}</Btn>
                </div>
              </div>
              <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                {pendingOrders.map((o, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.45rem', padding: '.35rem .5rem', borderBottom: '1px solid #f1f5f9', fontSize: '.75rem' }}>
                    <span style={{ color: '#94a3b8', width: 20, fontSize: '.63rem' }}>{i + 1}</span>
                    <PlatBadge platform={o.platform} />
                    <span style={{ fontWeight: 700, flex: 1 }}>{o.model}</span>
                    <ColorDot color={o.color} /><span style={{ color: '#475569' }}>{o.color}</span>
                    <span style={{ color: '#4f46e5', fontWeight: 700 }}>UK{o.size}</span>
                    <button onClick={() => setPending(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0 .25rem' }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Plan display */}
      {plan && plan.plan && Object.keys(plan.plan).length > 0 ? (
        <Card style={{ border: '2px solid #4f46e5' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.85rem', flexWrap: 'wrap', gap: '.4rem' }}>
            <div>
              <div style={{ fontSize: '.65rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: '.15rem' }}>Dispatch Plan</div>
              <div style={{ fontSize: '1rem', fontWeight: 800 }}>{fmtDate(date)} — {plan.total_orders} Orders</div>
            </div>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
              <Btn variant="wa" size="sm" onClick={sendWhatsApp}>📱 WhatsApp</Btn>
              {plan.status !== 'dispatched' && <Btn variant="success" size="sm" onClick={confirmDispatch} disabled={confirming}>{confirming ? '⏳…' : '✅ Confirm & Update Stock'}</Btn>}
              <Btn variant="ghost" size="sm" onClick={() => { setShowEntry(true); setPending(plan.orders || []) }}>✏️ Edit</Btn>
              <Btn variant="danger" size="sm" onClick={deletePlan}>🗑 Delete</Btn>
            </div>
          </div>

          {warehouses.map((wh, i) => {
            const items = (plan.plan || {})[wh.code] || []
            if (!items.length) return null
            const cnt = items.reduce((s, r) => s + r.qty, 0)
            return (
              <div key={wh.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: '.65rem', overflow: 'hidden' }}>
                <div style={{ padding: '.65rem 1rem', background: WH_COLORS[i] + '12', borderBottom: `1px solid ${WH_COLORS[i]}25`, display: 'flex', alignItems: 'center', gap: '.45rem', fontSize: '.82rem', fontWeight: 700 }}>
                  <span>{WH_ICONS[i]}</span>
                  <span style={{ color: WH_COLORS[i] }}>{wh.name}</span>
                  <span style={{ background: WH_COLORS[i], color: '#fff', borderRadius: 999, padding: '.1rem .5rem', fontSize: '.68rem', fontWeight: 700 }}>{cnt} items</span>
                </div>
                <div style={{ padding: '.4rem .75rem .75rem' }}>
                  {items.map((item, j) => {
                    const stk = whInv.find(r => r.warehouse_id === wh.id && r.model === item.model && r.color === item.color && r.size === item.size)?.stock ?? 0
                    return (
                      <div key={j} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: '.4rem', padding: '.35rem .4rem', borderRadius: 6, fontSize: '.78rem', marginBottom: '.15rem' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.28rem', fontWeight: 600 }}>
                          <ColorDot color={item.color} />
                          <span style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: 4, padding: '.08rem .4rem', fontSize: '.68rem', fontWeight: 700 }}>{item.model}</span>
                          {item.color} · UK{item.size}
                          {item.backorder && <span style={{ background: '#dc2626', color: '#fff', fontSize: '.52rem', fontWeight: 700, padding: '.08rem .3rem', borderRadius: 3 }}>BACK</span>}
                        </div>
                        <span style={{ fontSize: '.65rem', color: stk < 0 ? '#ef4444' : '#9ca3af' }}>stk:{stk}</span>
                        <span style={{ background: '#eff6ff', border: '1px solid #c7d7f8', borderRadius: 5, padding: '.12rem .5rem', fontWeight: 700, fontSize: '.75rem', color: '#3730a3' }}>×{item.qty}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {(plan.oos || []).length > 0 && (
            <div style={{ background: '#fff1f2', border: '1px solid #fecaca', borderRadius: 8, padding: '.7rem 1rem' }}>
              <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: '.35rem', fontSize: '.82rem' }}>⚠️ Back-Orders ({plan.oos.length} SKUs)</div>
              {plan.oos.map((o, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78rem', padding: '.15rem 0' }}>
                  <span>{o.model} {o.color} UK{o.size}</span>
                  <strong>×{o.missing}</strong>
                </div>
              ))}
            </div>
          )}

          {plan.status === 'dispatched' && (
            <div style={{ textAlign: 'center', padding: '.65rem', fontSize: '.78rem', fontWeight: 700, color: '#059669', background: '#f0fdf4', borderRadius: 7, marginTop: '.45rem' }}>
              ✅ Dispatched — Stock Updated
            </div>
          )}
        </Card>
      ) : !showEntry && (
        <EmptyState icon="📋" message={`No dispatch plan for ${fmtDate(date)}.\nClick + New Orders to create one.`} />
      )}
    </div>
  )
}
