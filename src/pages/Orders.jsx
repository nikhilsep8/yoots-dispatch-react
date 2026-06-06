import { useState, useRef } from 'react'
import { useApp } from '../lib/AppContext'
import { sb } from '../lib/supabase'
import { today, fmtDate, WH_COLORS, WH_ICONS, COLOR_HEX } from '../lib/constants'
import { parseYootsSKU, parseYootsFromName, parseIndSize } from '../lib/constants'
import { Btn, Card, PlatBadge, ColorDot, Badge, useToast, ToastContainer, EmptyState } from '../components/ui'
import * as XLSX from 'xlsx'

const PLATFORMS = ['Flipkart', 'Amazon', 'Myntra']

// ── Platform tab config ───────────────────────────
const TAB_CONFIG = {
  flipkart: { label: 'Flipkart', color: '#2874f0', bg: '#eef2ff', border: '#c7d7f8', icon: 'F' },
  meesho:   { label: 'Meesho',   color: '#7e22ce', bg: '#fdf4ff', border: '#e9d5ff', icon: 'M' },
  amazon:   { label: 'Amazon',   color: '#FF9900', bg: '#fff8ee', border: '#fcd34d', icon: 'A' },
  myntra:   { label: 'Myntra',   color: '#be123c', bg: '#fff1f2', border: '#fecdd3', icon: 'MY' },
}

export default function Orders({ initialDate, setPage }) {
  const { warehouses, whInv, setWhInv, plans, setPlans, settings, user } = useApp()
  const { toast, toasts } = useToast()

  const [date, setDate]             = useState(initialDate || today())
  const [activeTab, setActiveTab]   = useState('flipkart')
  const [showEntry, setShowEntry]   = useState(false)

  // Flipkart state
  const [fkOrders, setFkOrders]     = useState([])
  const [fkHint, setFkHint]         = useState('')
  const fkFileRef = useRef()

  // Meesho state
  const [msOrders, setMsOrders]     = useState([])
  const [msHint, setMsHint]         = useState('')
  const msFileRef = useRef()
  // Meesho CSV stock deduction state
  const msCsvRef = useRef()
  const [msCsvRows, setMsCsvRows]   = useState([])
  const [msCsvHint, setMsCsvHint]   = useState('')
  const [msCsvSaving, setMsCsvSaving] = useState(false)

  // Manual entry state (Amazon/Myntra)
  const [manPlat,  setManPlat]      = useState('Amazon')
  const [manModel, setManModel]     = useState('')
  const [manColor, setManColor]     = useState('')
  const [manSize,  setManSize]      = useState('')
  const [manQty,   setManQty]       = useState(1)
  const [manOrders, setManOrders]   = useState([])

  const [generating, setGenerating] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const plan = plans[date]

  // All pending orders combined
  const allPending = [...fkOrders, ...msOrders, ...manOrders]

  // ── CSV helpers ───────────────────────────────────
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

  // ── Flipkart CSV parser ───────────────────────────
  function handleFKFile(file) {
    if (!file) return
    setFkHint('Parsing ' + file.name + '…')
    const ext = file.name.split('.').pop().toLowerCase()
    const reader = new FileReader()
    if (ext === 'csv' || ext === 'txt') {
      reader.onload = e => finalizeFKOrders(parseFKCSV(e.target.result), file.name)
      reader.readAsText(file)
    } else {
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' })
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
          finalizeFKOrders(parseFKExcel(rows), file.name)
        } catch (err) { setFkHint('Error: ' + err.message) }
      }
      reader.readAsArrayBuffer(file)
    }
  }

  function parseFKCSV(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l)
    if (!lines.length) return []
    const headers = csvSplit(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''))
    const col = (...nn) => { for (const n of nn) { const i = headers.findIndex(h => h.includes(n)); if (i >= 0) return i } return -1 }
    const iSku = col('sku'), iQty = col('quantity', 'qty')
    const rows = []
    for (let i = 1; i < lines.length; i++) {
      const c = csvSplit(lines[i])
      const p = parseYootsSKU(c[iSku] || '', whInv)
      const q = parseInt(c[iQty]) || 1
      if (p) for (let j = 0; j < q; j++) rows.push({ platform: 'Flipkart', ...p })
    }
    return rows
  }

  function parseFKExcel(rows) {
    const nk = k => k.toLowerCase().replace(/[^a-z0-9]/g, '')
    const fv = (row, ...nn) => { for (const n of nn) { const k = Object.keys(row).find(k => nk(k).includes(n)); if (k !== undefined && String(row[k]).trim()) return String(row[k]).trim() } return '' }
    return rows.flatMap(row => {
      const sku = fv(row, 'sku', 'sellersku', 'productsku')
      const qty = parseInt(fv(row, 'quantity', 'qty')) || 1
      const p = parseYootsSKU(sku, whInv) || parseYootsFromName(fv(row, 'productname', 'title', 'name'), whInv)
      return p ? Array.from({ length: qty }, () => ({ platform: 'Flipkart', ...p })) : []
    })
  }

  function finalizeFKOrders(rows, fname) {
    if (!rows.length) { setFkHint('No valid orders found in ' + fname); return }
    setFkHint(`✓ ${rows.length} Flipkart orders parsed`)
    setFkOrders(rows)
  }

  // ── Meesho Manifest PDF parser ────────────────────
  function handleMSFile(file) {
    if (!file) return
    setMsHint('Reading Meesho manifest…')
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script')
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
            script.onload = resolve; script.onerror = reject
            document.head.appendChild(script)
          })
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        }
        const pdf = await window.pdfjsLib.getDocument({ data: e.target.result }).promise
        let fullText = ''
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const content = await page.getTextContent()
          fullText += content.items.map(item => item.str).join(' ') + '\n'
        }
        const rows = parseMeeshoManifestText(fullText)
        if (!rows.length) { setMsHint('No valid SKUs found in manifest'); return }
        setMsHint(`✓ ${rows.length} Meesho orders from manifest`)
        setMsOrders(rows)
      } catch (err) { setMsHint('Error: ' + err.message) }
    }
    reader.readAsArrayBuffer(file)
  }

  function parseMeeshoManifestText(text) {
    const rows = []
    const tokens = text.split(/\s+/).filter(t => t.length > 0)
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      const isSKU = /^(San|Flip|Floater|Slipper|Sandal)-?(Yoots)?\d+/i.test(token) || /^Yoots-?\d+/i.test(token)
      if (!isSKU) continue
      let sizeStr = '', qty = 1
      for (let j = i + 1; j < Math.min(i + 6, tokens.length); j++) {
        if (/^IND-?\d+$/i.test(tokens[j])) {
          sizeStr = tokens[j]
          if (j + 1 < tokens.length && /^\d+$/.test(tokens[j + 1])) qty = parseInt(tokens[j + 1]) || 1
          break
        }
      }
      if (!sizeStr) continue
      const parsed = parseYootsSKU(token, whInv, sizeStr)
      if (parsed) for (let q = 0; q < qty; q++) rows.push({ platform: 'Meesho', ...parsed })
    }
    return rows
  }

  // ── Meesho Orders CSV parser (stock deduction) ───
  function handleMsCsvFile(file) {
    if (!file) return
    setMsCsvHint('Parsing ' + file.name + '…')
    const reader = new FileReader()
    reader.onload = e => {
      try { parseMsCsv(e.target.result, file.name) }
      catch (err) { setMsCsvHint('Error: ' + err.message) }
    }
    reader.readAsText(file, 'utf-8')
  }

  function parseMsCsv(text, fname) {
    const lines = text.replace(/^﻿/,'').split('\n').map(l=>l.trim()).filter(l=>l)
    if (!lines.length) { setMsCsvHint('File is empty'); return }
    const headers = csvSplit(lines[0]).map(h=>h.trim())
    const idx = name => headers.findIndex(h=>h.toLowerCase().includes(name.toLowerCase()))
    const iSKU = idx('SKU'), iSize = idx('Size'), iQty = idx('Quantity'), iStatus = idx('Reason for Credit')
    if (iSKU < 0) { setMsCsvHint('Not a valid Meesho orders CSV'); return }
    const rows = []
    for (let i = 1; i < lines.length; i++) {
      const cols = csvSplit(lines[i])
      if (cols.length < 3) continue
      const sku = cols[iSKU]?.trim() || ''
      const sizeStr = iSize >= 0 ? cols[iSize]?.trim() : ''
      const qty = iQty >= 0 ? (parseInt(cols[iQty]) || 1) : 1
      const status = iStatus >= 0 ? cols[iStatus]?.trim().toUpperCase().replace(/\s+/g,'_') : 'SHIPPED'
      const parsed = parseYootsSKU(sku, whInv, sizeStr)
      if (!parsed) continue
      for (let q = 0; q < qty; q++) rows.push({ ...parsed, platform: 'Meesho', status })
    }
    if (!rows.length) { setMsCsvHint('No valid SKUs found'); return }
    setMsCsvHint(`✓ ${rows.length} orders parsed — all will deduct stock`)
    setMsCsvRows(rows)
  }

  async function confirmMsCsvDeduct() {
    if (!msCsvRows.length) return
    if (!confirm(`Deduct stock for ${msCsvRows.length} Meesho orders?\nThis cannot be undone.`)) return
    setMsCsvSaving(true)
    try {
      const priority = (settings.dispatch_priority||'huda_complex,aggarsain,huda_new').split(',')
      const whByCode = {}; warehouses.forEach(w => { whByCode[w.code] = w })
      const whPrio = [...priority.map(c=>whByCode[c]).filter(Boolean), ...warehouses.filter(w=>!priority.includes(w.code))]
      const newWhInv = whInv.map(r => ({ ...r }))
      const updates = {}
      for (const row of msCsvRows) {
        let rem = 1
        for (const wh of whPrio) {
          if (rem <= 0) break
          const idx = newWhInv.findIndex(r => r.warehouse_id===wh.id && r.model===row.model && r.color===row.color && r.size===row.size)
          if (idx >= 0 && newWhInv[idx].stock > 0) {
            newWhInv[idx] = { ...newWhInv[idx], stock: newWhInv[idx].stock - 1 }
            rem--
            const k = `${wh.id}|${row.model}|${row.color}|${row.size}`
            updates[k] = { warehouse_id: wh.id, model: row.model, color: row.color, size: row.size, stock: newWhInv[idx].stock, reorder_level: newWhInv[idx].reorder_level || 10 }
          }
        }
        if (rem > 0) {
          const wh = whPrio[0]
          if (wh) {
            const idx = newWhInv.findIndex(r => r.warehouse_id===wh.id && r.model===row.model && r.color===row.color && r.size===row.size)
            if (idx >= 0) {
              newWhInv[idx] = { ...newWhInv[idx], stock: newWhInv[idx].stock - 1 }
              const k = `${wh.id}|${row.model}|${row.color}|${row.size}`
              updates[k] = { warehouse_id: wh.id, model: row.model, color: row.color, size: row.size, stock: newWhInv[idx].stock, reorder_level: newWhInv[idx].reorder_level || 10 }
            }
          }
        }
      }
      const updateRows = Object.values(updates)
      if (updateRows.length) {
        const { error } = await sb.from('warehouse_inventory').upsert(updateRows, { onConflict: 'warehouse_id,model,color,size' })
        if (error) throw new Error(error.message)
      }
      setWhInv(newWhInv)
      toast(`✅ ${msCsvRows.length} Meesho orders deducted from stock`)
      setMsCsvRows([]); setMsCsvHint('')
    } catch (err) { toast('⚠️ ' + err.message) }
    setMsCsvSaving(false)
  }

  // ── Generate plan ─────────────────────────────────
  async function generatePlan() {
    if (!allPending.length) { toast('No orders to plan'); return }
    setGenerating(true)
    const simInv = {}
    whInv.forEach(r => { simInv[`${r.warehouse_id}|${r.model}|${r.color}|${r.size}`] = { ...r } })
    const priority = (settings.dispatch_priority || 'huda_complex,aggarsain,huda_new').split(',')
    const whByCode = {}; warehouses.forEach(w => { whByCode[w.code] = w })
    const whPrioMapped = priority.map(c => whByCode[c]).filter(Boolean)
    const whPrioIds = new Set(whPrioMapped.map(w => w.id))
    const whPrio = [...whPrioMapped, ...warehouses.filter(w => !whPrioIds.has(w.id))]
    const newPlan = {}; const oos = []
    warehouses.forEach(w => { newPlan[w.code] = [] })

    // Only Flipkart + manual orders go through warehouse assignment
    // Meesho orders are added to plan but marked as meesho (no stock deduction)
    const skus = {}
    allPending.forEach(o => {
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

    const { error } = await sb.from('dispatch_plans').upsert({
      date, orders: allPending, plan: newPlan,
      total_orders: allPending.length, status: 'pending',
      created_by: user?.email, created_at: new Date().toISOString()
    }, { onConflict: 'date' })
    if (error) { toast('Save error: ' + error.message); setGenerating(false); return }
    setPlans(prev => ({ ...prev, [date]: { date, orders: allPending, plan: newPlan, oos, total_orders: allPending.length, status: 'pending' } }))
    setShowEntry(false)
    setFkOrders([]); setMsOrders([]); setManOrders([])
    toast('✅ Plan generated for ' + fmtDate(date))
    setGenerating(false)
  }

  // ── Confirm dispatch — only deducts Flipkart + manual, NOT Meesho ──
  async function confirmDispatch() {
    if (!plan) return
    const { data: fresh } = await sb.from('dispatch_plans').select('status').eq('date', date).single()
    if (fresh?.status === 'dispatched') { toast('⚠️ Already dispatched'); return }
    if (!confirm('Confirm dispatch?\nThis will deduct Flipkart & manual orders from stock.\n\nMeesho stock will be deducted separately when you upload the orders CSV.')) return
    setConfirming(true)

    // Only deduct non-Meesho orders
    const deductItems = []
    warehouses.forEach(wh => {
      ;(plan.plan[wh.code] || []).forEach(item => {
        if (item.platform !== 'Meesho') deductItems.push({ wh, item })
      })
    })

    let updates = []
    const newWhInv = [...whInv]
    deductItems.forEach(({ wh, item }) => {
      const idx = newWhInv.findIndex(r => r.warehouse_id === wh.id && r.model === item.model && r.color === item.color && r.size === item.size)
      if (idx >= 0) {
        newWhInv[idx] = { ...newWhInv[idx], stock: newWhInv[idx].stock - item.qty }
        updates.push({ warehouse_id: wh.id, model: item.model, color: item.color, size: item.size, stock: newWhInv[idx].stock, reorder_level: newWhInv[idx].reorder_level })
      } else {
        const nr = { warehouse_id: wh.id, model: item.model, color: item.color, size: item.size, stock: -item.qty, reorder_level: 10 }
        newWhInv.push(nr); updates.push(nr)
      }
    })

    // Dedup
    const seen = {}
    updates = updates.filter(u => { const k = `${u.warehouse_id}|${u.model}|${u.color}|${u.size}`; if (seen[k]) return false; seen[k] = true; return true })

    if (updates.length) {
      const { error: e1 } = await sb.from('warehouse_inventory').upsert(updates, { onConflict: 'warehouse_id,model,color,size' })
      if (e1) { toast('Stock update failed: ' + e1.message); setConfirming(false); return }
    }

    await sb.from('dispatch_plans').update({ status: 'dispatched' }).eq('date', date)
    setWhInv(newWhInv)
    setPlans(prev => ({ ...prev, [date]: { ...prev[date], status: 'dispatched' } }))

    const fkCount = deductItems.filter(d => d.item.platform !== 'Meesho').reduce((s, d) => s + d.item.qty, 0)
    const msCount = (plan.orders || []).filter(o => o.platform === 'Meesho').length
    toast(`✅ ${fkCount} Flipkart/manual items deducted. ${msCount} Meesho orders recorded (deduct via CSV later).`)
    setConfirming(false)
  }

  // ── Delete plan ───────────────────────────────────
  async function deletePlan() {
    if (!plan) return
    const dispatched = plan.status === 'dispatched'
    if (!confirm(`Delete plan for ${fmtDate(date)}?${dispatched ? '\n\n⚠️ Flipkart stock will be restored. Meesho stock unchanged.' : ''}`)) return
    try {
      if (dispatched && plan.plan) {
        let restore = []
        const newWhInv = [...whInv]
        warehouses.forEach(wh => {
          ;(plan.plan[wh.code] || []).forEach(item => {
            if (item.platform === 'Meesho') return // don't restore Meesho
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
      toast(dispatched ? '✅ Plan deleted — Flipkart stock restored' : '✅ Plan deleted')
    } catch (err) { toast('⚠️ ' + err.message) }
  }

  // ── WhatsApp to packer — ALL orders ──────────────
  function sendWhatsApp() {
    if (!plan) return
    const packer = settings.packer_whatsapp || ''
    const orders = plan.orders || []
    const fkC = orders.filter(o => o.platform === 'Flipkart').length
    const msC = orders.filter(o => o.platform === 'Meesho').length
    const azC = orders.filter(o => o.platform === 'Amazon').length
    const mnC = orders.filter(o => o.platform === 'Myntra').length
    let msg = `🚚 *YOOTS DISPATCH*\n📅 ${fmtDate(date)}\n${'━'.repeat(20)}\n\n📦 *TOTAL: ${plan.total_orders} orders*\n`
    if (fkC) msg += `   Flipkart: ${fkC}\n`
    if (msC) msg += `   Meesho: ${msC}\n`
    if (azC) msg += `   Amazon: ${azC}\n`
    if (mnC) msg += `   Myntra: ${mnC}\n`
    msg += '\n'
    warehouses.forEach((wh, i) => {
      const items = (plan.plan || {})[wh.code] || []
      if (!items.length) return
      const total = items.reduce((s, r) => s + r.qty, 0)
      msg += `${WH_ICONS[i]} *${wh.name.toUpperCase()}* (${total} items)\n${'─'.repeat(20)}\n`
      const grouped = {}
      items.forEach(it => {
        const k = `${it.model}|${it.color}|${it.platform}`
        if (!grouped[k]) grouped[k] = { model: it.model, color: it.color, platform: it.platform, sizes: [] }
        for (let q = 0; q < it.qty; q++) grouped[k].sizes.push(it.size)
      })
      Object.values(grouped).forEach(g => {
        const platTag = g.platform === 'Meesho' ? ' [M]' : g.platform === 'Amazon' ? ' [AZ]' : ''
        msg += `  • ${g.model} ${g.color}${platTag} → ${g.sizes.sort((a,b)=>a-b).map(s=>`UK ${s}`).join(', ')}\n`
      })
      msg += '\n'
    })
    if ((plan.oos || []).length > 0) {
      msg += `⚠️ *BACK-ORDERS*\n`
      plan.oos.forEach(o => { msg += `  • ${o.model} ${o.color} UK${o.size} ×${o.missing}\n` })
    }
    msg += `${'━'.repeat(20)}\n✅ *Pack & Ship Today!*`
    window.open(`https://wa.me/${packer}?text=${encodeURIComponent(msg)}`, '_blank')
    toast('📱 Opening WhatsApp…')
  }

  // ── render ────────────────────────────────────────
  const fkCount = fkOrders.length
  const msCount = msOrders.length
  const manCount = manOrders.length

  return (
    <div>
      <ToastContainer toasts={toasts} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.85rem', gap: '.5rem', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800 }}>📦 Orders</h2>
        <div style={{ display: 'flex', gap: '.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: '.38rem .65rem', fontSize: '.78rem' }} />
          <Btn size="sm" onClick={() => setShowEntry(e => !e)}>
            {showEntry ? '✕ Close' : '+ Add Orders'}
          </Btn>
        </div>
      </div>

      {/* Quick links */}
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '.72rem', fontWeight: 700, color: '#64748b' }}>Quick open:</span>
        {[
          { href: 'https://seller.flipkart.com/index.html#/orders', label: 'Flipkart', bg: '#2874f0' },
          { href: 'https://sell.amazon.in/seller-services/manage-orders', label: 'Amazon', bg: '#FF9900' },
          { href: 'https://supplier.meesho.com', label: 'Meesho', bg: '#7e22ce' },
          { href: 'https://sellerportal.myntra.com', label: 'MYNTRA', bg: '#be123c' },
        ].map(l => (
          <a key={l.href} href={l.href} target="_blank" rel="noreferrer"
            style={{ background: l.bg, color: '#fff', padding: '.35rem .75rem', borderRadius: 7, fontSize: '.73rem', fontWeight: 700, textDecoration: 'none' }}>
            {l.label}
          </a>
        ))}
      </div>

      {/* Entry panel */}
      {showEntry && (
        <Card style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '.88rem', fontWeight: 700, color: '#111827', marginBottom: '.85rem' }}>
            Add Orders — {fmtDate(date)}
          </div>

          {/* Platform tabs */}
          <div style={{ display: 'flex', borderBottom: '2px solid #f1f5f9', marginBottom: '1rem', gap: 0, overflowX: 'auto' }}>
            {Object.entries(TAB_CONFIG).map(([key, cfg]) => (
              <button key={key} onClick={() => setActiveTab(key)}
                style={{ padding: '.5rem 1rem', fontSize: '.78rem', fontWeight: 700, border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
                  color: activeTab === key ? cfg.color : '#9ca3af',
                  borderBottom: activeTab === key ? `2.5px solid ${cfg.color}` : '2.5px solid transparent',
                  marginBottom: -2 }}>
                <span style={{ background: cfg.color, color: '#fff', borderRadius: 3, padding: '0 5px', fontSize: '.65rem', fontWeight: 900, marginRight: 5 }}>{cfg.icon}</span>
                {cfg.label}
                {key === 'flipkart' && fkCount > 0 && <span style={{ marginLeft: 5, background: '#2874f0', color: '#fff', borderRadius: 999, padding: '0 5px', fontSize: '.65rem' }}>{fkCount}</span>}
                {key === 'meesho' && msCount > 0 && <span style={{ marginLeft: 5, background: '#7e22ce', color: '#fff', borderRadius: 999, padding: '0 5px', fontSize: '.65rem' }}>{msCount}</span>}
                {(key === 'amazon' || key === 'myntra') && manOrders.filter(o => o.platform === cfg.label).length > 0 && <span style={{ marginLeft: 5, background: cfg.color, color: '#fff', borderRadius: 999, padding: '0 5px', fontSize: '.65rem' }}>{manOrders.filter(o => o.platform === cfg.label).length}</span>}
              </button>
            ))}
          </div>

          {/* Flipkart tab */}
          {activeTab === 'flipkart' && (
            <div>
              <div style={{ fontSize: '.75rem', color: '#64748b', marginBottom: '.75rem' }}>
                Download from Flipkart → Orders → Ready to Dispatch → Export CSV
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', border: '2px dashed #c7d7f8', borderRadius: 10, padding: '1.5rem', background: '#f8faff', cursor: 'pointer', position: 'relative', textAlign: 'center' }}>
                <input ref={fkFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={e => handleFKFile(e.target.files[0])}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                <div style={{ fontSize: '1.6rem', marginBottom: '.4rem' }}>📂</div>
                <div style={{ fontWeight: 700, color: '#1e293b' }}>Drop Flipkart CSV here</div>
                <div style={{ fontSize: '.72rem', color: '#64748b', marginTop: '.2rem' }}>Ready to Dispatch orders</div>
              </label>
              {fkHint && <div style={{ marginTop: '.5rem', fontSize: '.75rem', fontWeight: 600, color: fkHint.startsWith('✓') ? '#059669' : '#64748b', textAlign: 'center' }}>{fkHint}</div>}
              {fkOrders.length > 0 && (
                <div style={{ marginTop: '.65rem' }}>
                  <OrderList orders={fkOrders} onRemove={i => setFkOrders(prev => prev.filter((_, j) => j !== i))} />
                  <Btn variant="ghost" size="sm" style={{ marginTop: '.4rem' }} onClick={() => { setFkOrders([]); setFkHint('') }}>✕ Clear Flipkart orders</Btn>
                </div>
              )}
            </div>
          )}

          {/* Meesho tab */}
          {activeTab === 'meesho' && (
            <div>
              <div style={{ fontSize: '.75rem', color: '#64748b', marginBottom: '.75rem' }}>
                Download Manifest PDF from Meesho → Orders → Ready to Ship → Download Manifest
              </div>
              <div style={{ background: '#fdf4ff', border: '1px solid #e9d5ff', borderRadius: 8, padding: '.6rem .85rem', marginBottom: '.75rem', fontSize: '.73rem', color: '#7e22ce', fontWeight: 600 }}>
                ℹ️ Meesho orders are added to today's plan for packing. Stock will <strong>not</strong> be deducted here — use Meesho Orders CSV upload to deduct stock later.
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', border: '2px dashed #e9d5ff', borderRadius: 10, padding: '1.5rem', background: '#fdf4ff', cursor: 'pointer', position: 'relative', textAlign: 'center' }}>
                <input ref={msFileRef} type="file" accept=".pdf" onChange={e => handleMSFile(e.target.files[0])}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                <div style={{ fontSize: '1.6rem', marginBottom: '.4rem' }}>📋</div>
                <div style={{ fontWeight: 700, color: '#7e22ce' }}>Drop Meesho Manifest PDF here</div>
              </label>
              {msHint && <div style={{ marginTop: '.5rem', fontSize: '.75rem', fontWeight: 600, color: msHint.startsWith('✓') ? '#059669' : '#64748b', textAlign: 'center' }}>{msHint}</div>}
              {msOrders.length > 0 && (
                <div style={{ marginTop: '.65rem' }}>
                  <OrderList orders={msOrders} onRemove={i => setMsOrders(prev => prev.filter((_, j) => j !== i))} />
                  <Btn variant="ghost" size="sm" style={{ marginTop: '.4rem' }} onClick={() => { setMsOrders([]); setMsHint('') }}>✕ Clear Meesho orders</Btn>
                </div>
              )}

              {/* Divider */}
              <div style={{ height: 1, background: '#e9d5ff', margin: '1.25rem 0' }} />

              {/* Meesho CSV — stock deduction */}
              <div style={{ fontSize: '.82rem', fontWeight: 800, color: '#7e22ce', marginBottom: '.35rem' }}>📊 Meesho Orders CSV — Deduct Stock</div>
              <div style={{ fontSize: '.72rem', color: '#9ca3af', marginBottom: '.65rem' }}>
                Upload the Meesho orders report CSV to deduct stock for all shipped/delivered/cancelled orders.
                Download from: Meesho Supplier Panel → <strong>Reports</strong> → Orders Report
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', border: '2px dashed #e9d5ff', borderRadius: 10, padding: '1.25rem', background: '#faf5ff', cursor: 'pointer', position: 'relative', textAlign: 'center' }}>
                <input ref={msCsvRef} type="file" accept=".csv,.xlsx,.xls" onChange={e => handleMsCsvFile(e.target.files[0])}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                <div style={{ fontSize: '1.4rem', marginBottom: '.35rem' }}>📊</div>
                <div style={{ fontWeight: 700, color: '#7e22ce', fontSize: '.82rem' }}>Drop Meesho Orders CSV here</div>
                <div style={{ fontSize: '.7rem', color: '#94a3b8', marginTop: '.2rem' }}>All statuses deduct stock (Shipped, Delivered, Cancelled, RTO)</div>
              </label>
              {msCsvHint && <div style={{ marginTop: '.5rem', fontSize: '.75rem', fontWeight: 600, color: msCsvHint.startsWith('✓') ? '#059669' : '#64748b', textAlign: 'center' }}>{msCsvHint}</div>}
              {msCsvRows.length > 0 && (
                <div style={{ marginTop: '.75rem' }}>
                  {/* SKU summary */}
                  <div style={{ border: '1px solid #e9d5ff', borderRadius: 8, overflow: 'hidden', marginBottom: '.65rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 60px 70px', padding: '.38rem .65rem', background: '#fdf4ff', fontSize: '.62rem', fontWeight: 700, color: '#7e22ce', textTransform: 'uppercase', letterSpacing: '.5px', borderBottom: '1px solid #e9d5ff' }}>
                      <span>Model</span><span>Color</span><span>Size</span><span>Qty</span>
                    </div>
                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                      {Object.values(msCsvRows.reduce((acc, r) => {
                        const k = `${r.model}|${r.color}|${r.size}`
                        if (!acc[k]) acc[k] = { model: r.model, color: r.color, size: r.size, qty: 0 }
                        acc[k].qty++
                        return acc
                      }, {})).sort((a,b)=>a.model.localeCompare(b.model)).map((s,i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 60px 70px', padding: '.38rem .65rem', borderBottom: '1px solid #f3f4f6', fontSize: '.78rem', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700 }}><span style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: 4, padding: '1px 6px', fontSize: '.68rem', fontWeight: 700 }}>{s.model}</span></span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ColorDot color={s.color} />{s.color}</span>
                          <span style={{ color: '#4f46e5', fontWeight: 700 }}>UK{s.size}</span>
                          <span style={{ fontWeight: 800, color: '#dc2626' }}>−{s.qty}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Btn variant="ghost" size="sm" onClick={() => { setMsCsvRows([]); setMsCsvHint('') }}>✕ Clear</Btn>
                    <Btn variant="meesho" size="md" onClick={confirmMsCsvDeduct} disabled={msCsvSaving}>
                      {msCsvSaving ? '⏳ Saving…' : `✅ Deduct ${msCsvRows.length} Orders from Stock`}
                    </Btn>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Amazon / Myntra manual entry */}
          {(activeTab === 'amazon' || activeTab === 'myntra') && (
            <div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '1rem', marginBottom: '.75rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '.65rem', marginBottom: '.75rem' }}>
                  <div>
                    <div style={lbl}>Platform</div>
                    <select value={manPlat} onChange={e => setManPlat(e.target.value)} style={sel}>
                      <option>Amazon</option><option>Myntra</option>
                    </select>
                  </div>
                  <div>
                    <div style={lbl}>Model</div>
                    <select value={manModel} onChange={e => { setManModel(e.target.value); setManColor(''); setManSize('') }} style={sel}>
                      <option value="">Select</option>
                      {[...new Set(whInv.map(r => r.model))].sort().map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={lbl}>Color</div>
                    <select value={manColor} onChange={e => { setManColor(e.target.value); setManSize('') }} style={sel} disabled={!manModel}>
                      <option value="">Select</option>
                      {[...new Set(whInv.filter(r => r.model === manModel).map(r => r.color))].sort().map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={lbl}>UK Size</div>
                    <select value={manSize} onChange={e => setManSize(e.target.value)} style={sel} disabled={!manColor}>
                      <option value="">Select</option>
                      {[...new Set(whInv.filter(r => r.model === manModel && r.color === manColor).map(r => r.size))].sort((a,b)=>a-b).map(s => <option key={s} value={s}>UK {s}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={lbl}>Qty</div>
                    <input type="number" min="1" max="99" value={manQty} onChange={e => setManQty(parseInt(e.target.value)||1)}
                      style={{ ...sel, textAlign: 'center', fontWeight: 800 }} />
                  </div>
                </div>
                <Btn variant="success" size="sm" style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => {
                    if (!manModel || !manColor || !manSize) { toast('Select model, color and size'); return }
                    const newRows = Array.from({ length: manQty }, () => ({ platform: manPlat, model: manModel, color: manColor, size: parseInt(manSize) }))
                    setManOrders(prev => [...prev, ...newRows])
                    setManQty(1)
                    toast(`✓ Added ${manQty} × ${manModel} ${manColor} UK${manSize}`)
                  }}>
                  + Add to Queue
                </Btn>
              </div>
              {manOrders.filter(o => o.platform === manPlat).length > 0 && (
                <div>
                  <OrderList orders={manOrders.filter(o => o.platform === manPlat)}
                    onRemove={i => {
                      const filtered = manOrders.filter(o => o.platform === manPlat)
                      const toRemove = filtered[i]
                      const idx = manOrders.indexOf(toRemove)
                      setManOrders(prev => prev.filter((_, j) => j !== idx))
                    }} />
                </div>
              )}
            </div>
          )}

          {/* Summary + Generate */}
          {allPending.length > 0 && (
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '.82rem', fontWeight: 700 }}>Total: {allPending.length} orders</span>
                {fkCount > 0 && <Badge color="#eef2ff" textColor="#2874f0" border="#c7d7f8">FK: {fkCount}</Badge>}
                {msCount > 0 && <Badge color="#fdf4ff" textColor="#7e22ce" border="#e9d5ff">MS: {msCount}</Badge>}
                {manOrders.filter(o=>o.platform==='Amazon').length > 0 && <Badge color="#fff8ee" textColor="#92400e" border="#fcd34d">AZ: {manOrders.filter(o=>o.platform==='Amazon').length}</Badge>}
                {manOrders.filter(o=>o.platform==='Myntra').length > 0 && <Badge color="#fff1f2" textColor="#be123c" border="#fecdd3">MN: {manOrders.filter(o=>o.platform==='Myntra').length}</Badge>}
              </div>
              <Btn variant="success" onClick={generatePlan} disabled={generating}>
                {generating ? '⏳ Generating…' : '⚡ Generate Plan'}
              </Btn>
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
              {/* Platform breakdown */}
              <div style={{ display: 'flex', gap: '.35rem', marginTop: '.35rem', flexWrap: 'wrap' }}>
                {Object.entries(
                  (plan.orders || []).reduce((acc, o) => { acc[o.platform] = (acc[o.platform]||0)+1; return acc }, {})
                ).map(([plat, cnt]) => {
                  const cfg = Object.values(TAB_CONFIG).find(c => c.label === plat) || { color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' }
                  return <span key={plat} style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, borderRadius: 4, padding: '1px 7px', fontSize: '.68rem', fontWeight: 700 }}>{plat}: {cnt}</span>
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
              <Btn variant="wa" size="sm" onClick={sendWhatsApp}>📱 WhatsApp Packer</Btn>
              {plan.status !== 'dispatched' && (
                <Btn variant="success" size="sm" onClick={confirmDispatch} disabled={confirming}>
                  {confirming ? '⏳…' : '✅ Confirm & Update Stock'}
                </Btn>
              )}
              <Btn variant="ghost" size="sm" onClick={() => { setShowEntry(true); setFkOrders(plan.orders?.filter(o=>o.platform==='Flipkart')||[]); setMsOrders(plan.orders?.filter(o=>o.platform==='Meesho')||[]); setManOrders(plan.orders?.filter(o=>o.platform!=='Flipkart'&&o.platform!=='Meesho')||[]) }}>✏️ Edit</Btn>
              <Btn variant="danger" size="sm" onClick={deletePlan}>🗑 Delete</Btn>
            </div>
          </div>

          {/* Warehouse sections */}
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
                    const cfg = Object.values(TAB_CONFIG).find(c => c.label === item.platform) || { color: '#6b7280', bg: '#f9fafb' }
                    return (
                      <div key={j} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', alignItems: 'center', gap: '.4rem', padding: '.35rem .4rem', borderRadius: 6, fontSize: '.78rem', marginBottom: '.15rem' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.28rem', fontWeight: 600 }}>
                          <ColorDot color={item.color} />
                          <span style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: 4, padding: '.08rem .4rem', fontSize: '.68rem', fontWeight: 700 }}>{item.model}</span>
                          {item.color} · UK{item.size}
                          {item.backorder && <span style={{ background: '#dc2626', color: '#fff', fontSize: '.52rem', fontWeight: 700, padding: '.08rem .3rem', borderRadius: 3 }}>BACK</span>}
                        </div>
                        <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 4, padding: '1px 5px', fontSize: '.62rem', fontWeight: 700 }}>{item.platform}</span>
                        <span style={{ fontSize: '.65rem', color: stk < 0 ? '#ef4444' : '#9ca3af' }}>stk:{stk}</span>
                        <span style={{ background: '#eff6ff', border: '1px solid #c7d7f8', borderRadius: 5, padding: '.12rem .5rem', fontWeight: 700, fontSize: '.75rem', color: '#3730a3' }}>×{item.qty}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Back-orders */}
          {(plan.oos || []).length > 0 && (
            <div style={{ background: '#fff1f2', border: '1px solid #fecaca', borderRadius: 8, padding: '.7rem 1rem', marginTop: '.5rem' }}>
              <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: '.35rem', fontSize: '.82rem' }}>⚠️ Back-Orders ({plan.oos.length} SKUs)</div>
              {plan.oos.map((o, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78rem', padding: '.15rem 0' }}>
                  <span>{o.model} {o.color} UK{o.size}</span><strong>×{o.missing}</strong>
                </div>
              ))}
            </div>
          )}

          {plan.status === 'dispatched' && (
            <div style={{ textAlign: 'center', padding: '.65rem', fontSize: '.78rem', fontWeight: 700, color: '#059669', background: '#f0fdf4', borderRadius: 7, marginTop: '.65rem' }}>
              ✅ Dispatched — Flipkart stock updated · Meesho stock managed via CSV
            </div>
          )}
        </Card>
      ) : !showEntry && (
        <EmptyState icon="📋" message={`No orders plan for ${fmtDate(date)}.\nClick + Add Orders to create one.`} />
      )}
    </div>
  )
}

// ── Reusable order list ────────────────────────────
function OrderList({ orders, onRemove }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, maxHeight: 200, overflowY: 'auto' }}>
      {orders.map((o, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.45rem', padding: '.35rem .5rem', borderBottom: '1px solid #f1f5f9', fontSize: '.75rem' }}>
          <span style={{ color: '#94a3b8', width: 20, fontSize: '.63rem' }}>{i+1}</span>
          <PlatBadge platform={o.platform} />
          <span style={{ fontWeight: 700, flex: 1 }}>{o.model}</span>
          <ColorDot color={o.color} /><span style={{ color: '#475569' }}>{o.color}</span>
          <span style={{ color: '#4f46e5', fontWeight: 700 }}>UK{o.size}</span>
          <button onClick={() => onRemove(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0 .25rem' }}>✕</button>
        </div>
      ))}
    </div>
  )
}

const lbl = { fontSize: '.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '.3rem' }
const sel = { width: '100%', padding: '.5rem .65rem', border: '1.5px solid #e5e7eb', borderRadius: 7, fontSize: '.82rem', fontWeight: 600, color: '#1e293b', background: '#fff', fontFamily: 'inherit', cursor: 'pointer' }
