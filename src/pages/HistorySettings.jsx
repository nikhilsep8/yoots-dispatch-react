import { useState } from 'react'
import { useApp } from '../lib/AppContext'
import { fmtDate, WH_ICONS } from '../lib/constants'
import { Card, PlatBadge, ColorDot, Badge, Btn, EmptyState } from '../components/ui'
import { sb } from '../lib/supabase'

export function History({ setPage, setDispatchDate }) {
  const { plans, warehouses } = useApp()
  const [view, setView] = useState('month')
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [openDay, setOpenDay] = useState(null)

  const entries = Object.entries(plans)
    .filter(([d]) => view === 'all' || d.startsWith(month))
    .sort((a, b) => b[0].localeCompare(a[0]))

  let totOrders = 0, totRet = 0, totFk = 0, totAz = 0, totMs = 0, totMn = 0
  entries.forEach(([, p]) => {
    ;(p.orders || []).forEach(o => {
      totOrders++
      if (o.platform === 'Flipkart') totFk++
      else if (o.platform === 'Amazon') totAz++
      else if (o.platform === 'Meesho') totMs++
      else if (o.platform === 'Myntra') totMn++
    })
    totRet += (p.returns || []).length
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.85rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800 }}>📋 Order History</h2>
        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
          <select value={view} onChange={e => setView(e.target.value)} style={sel}>
            <option value="month">This Month</option>
            <option value="all">All Time</option>
          </select>
          {view === 'month' && <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={sel} />}
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(100px,1fr))', gap: '.5rem', marginBottom: '.85rem' }}>
        {[
          { n: totOrders, l: 'Orders',   bg: '#eff6ff', c: '#1d4ed8' },
          { n: totRet,    l: 'Returns',  bg: '#fff1f2', c: '#be123c' },
          { n: totFk,     l: 'Flipkart', bg: '#eef2ff', c: '#2874f0' },
          { n: totAz,     l: 'Amazon',   bg: '#fff8ee', c: '#FF9900' },
          totMs ? { n: totMs, l: 'Meesho', bg: '#fdf4ff', c: '#7e22ce' } : null,
          totMn ? { n: totMn, l: 'Myntra', bg: '#fff1f2', c: '#be123c' } : null,
        ].filter(Boolean).map(s => (
          <div key={s.l} style={{ background: s.bg, borderRadius: 8, padding: '.65rem .75rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 900, color: s.c }}>{s.n}</div>
            <div style={{ fontSize: '.62rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>{s.l}</div>
          </div>
        ))}
      </div>

      {entries.length === 0 ? <EmptyState icon="📋" message="No orders for this period." /> : entries.map(([date, plan]) => {
        const orders = plan.orders || [], returns = plan.returns || []
        const dispatched = plan.status === 'dispatched'
        const fk = orders.filter(o => o.platform === 'Flipkart').length
        const az = orders.filter(o => o.platform === 'Amazon').length
        const ms = orders.filter(o => o.platform === 'Meesho').length
        const mn = orders.filter(o => o.platform === 'Myntra').length
        const isOpen = openDay === date

        return (
          <div key={date} style={{ border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: '.65rem', overflow: 'hidden' }}>
            <div style={{ padding: '.65rem .9rem', background: dispatched ? '#f0fdf4' : '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', cursor: 'pointer', flex: 1 }} onClick={() => setOpenDay(isOpen ? null : date)}>
                <span style={{ fontSize: '.88rem', fontWeight: 800 }}>{fmtDate(date)}</span>
                <Badge color={dispatched ? '#d1fae5' : '#fef9c3'} textColor={dispatched ? '#065f46' : '#854d0e'} border={dispatched ? '#bbf7d0' : '#fde047'}>{dispatched ? '✅ Dispatched' : '⏳ Pending'}</Badge>
                {[fk?`FK:${fk}`:'',az?`AZ:${az}`:'',ms?`MS:${ms}`:'',mn?`MN:${mn}`:''].filter(Boolean).map(s => <span key={s} style={{ fontSize: '.65rem', color: '#6b7280' }}>{s}</span>)}
                {returns.length > 0 && <Badge color="#fff1f2" textColor="#be123c" border="#fecdd3">↩️ {returns.length}</Badge>}
              </div>
              <Btn size="sm" variant="ghost" onClick={() => { setDispatchDate(date); setPage('dispatch') }}>View Plan →</Btn>
            </div>
            {isOpen && (
              <div style={{ padding: '.6rem .85rem', maxHeight: 280, overflowY: 'auto' }}>
                {orders.map((o, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.45rem', padding: '.3rem .4rem', borderBottom: '1px solid #f1f5f9', fontSize: '.75rem' }}>
                    <span style={{ color: '#94a3b8', width: 20, fontSize: '.63rem' }}>{i + 1}</span>
                    <PlatBadge platform={o.platform} />
                    <span style={{ fontWeight: 700, flex: 1 }}>{o.model}</span>
                    <ColorDot color={o.color} /><span style={{ color: '#475569' }}>{o.color}</span>
                    <span style={{ color: '#4f46e5', fontWeight: 700 }}>UK{o.size}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function Settings() {
  const { settings, saveSetting, warehouses } = useApp()
  const [saved, setSaved] = useState(false)

  async function save(key, val) {
    await saveSetting(key, val)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const prio = (settings.dispatch_priority || 'huda_complex,aggarsain,huda_new').split(',')

  return (
    <div>
      <h2 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '.85rem' }}>⚙️ Settings</h2>
      {saved && <div style={{ background: '#d1fae5', color: '#065f46', borderRadius: 7, padding: '.5rem .85rem', marginBottom: '.75rem', fontSize: '.78rem', fontWeight: 600 }}>✓ Saved</div>}

      <Card>
        <div style={{ fontSize: '.65rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: '.65rem' }}>Contacts</div>
        <Row label="Packer WhatsApp" sub="With country code e.g. 919876543210">
          <Input defaultValue={settings.packer_whatsapp || ''} onBlur={e => save('packer_whatsapp', e.target.value)} placeholder="91XXXXXXXXXX" />
        </Row>
        <Row label="Report Email" sub="For stock report emails">
          <Input defaultValue={settings.report_email || ''} onBlur={e => save('report_email', e.target.value)} placeholder="manager@example.com" />
        </Row>
      </Card>

      <Card>
        <div style={{ fontSize: '.65rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: '.65rem' }}>Warehouses</div>
        {['wh1_name', 'wh2_name', 'wh3_name'].map((key, i) => (
          <Row key={key} label={`${WH_ICONS[i]} Warehouse ${i + 1}`}>
            <Input defaultValue={settings[key] || warehouses[i]?.name || ''} onBlur={e => save(key, e.target.value)} />
          </Row>
        ))}
      </Card>

      <Card>
        <div style={{ fontSize: '.65rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: '.65rem' }}>Dispatch Priority</div>
        <p style={{ fontSize: '.78rem', color: '#64748b', marginBottom: '.65rem' }}>Orders assigned to warehouses in this order</p>
        {prio.map((code, i) => {
          const wh = warehouses.find(w => w.code === code)
          return (
            <div key={code} style={{ display: 'flex', alignItems: 'center', gap: '.45rem', padding: '.45rem .65rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 7, marginBottom: '.35rem' }}>
              <span style={{ color: '#94a3b8', fontWeight: 700, width: 18, fontSize: '.75rem' }}>{i + 1}.</span>
              <span style={{ fontSize: '.8rem' }}>{WH_ICONS[i] || '📦'} {wh?.name || code}</span>
            </div>
          )
        })}
      </Card>

      <Card>
        <div style={{ fontSize: '.65rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: '.65rem' }}>Seller Portals</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem' }}>
          {[
            { href: 'https://seller.flipkart.com', label: 'Flipkart Seller Hub', bg: '#eef2ff', c: '#1d4ed8' },
            { href: 'https://sell.amazon.in', label: 'Amazon Seller Central', bg: '#fff8ee', c: '#92400e' },
            { href: 'https://supplier.meesho.com', label: 'Meesho Supplier', bg: '#fdf4ff', c: '#7e22ce' },
            { href: 'https://sellerportal.myntra.com', label: 'Myntra Seller', bg: '#fff1f2', c: '#be123c' },
          ].map(p => (
            <a key={p.href} href={p.href} target="_blank" rel="noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.65rem .85rem', background: p.bg, borderRadius: 8, textDecoration: 'none' }}>
              <span style={{ fontSize: '.8rem', fontWeight: 700, color: p.c }}>{p.label}</span>
            </a>
          ))}
        </div>
      </Card>
    </div>
  )
}

function Row({ label, sub, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.8rem 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '.82rem', fontWeight: 600, color: '#374151' }}>{label}</div>
        {sub && <div style={{ fontSize: '.65rem', color: '#9ca3af', marginTop: '.12rem' }}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

function Input({ defaultValue, onBlur, placeholder }) {
  return (
    <input defaultValue={defaultValue} onBlur={onBlur} placeholder={placeholder}
      style={{ background: '#f9fafb', border: '1.5px solid #e5e7eb', borderRadius: 7, padding: '.42rem .7rem', fontSize: '.8rem', color: '#111827', width: 210, fontFamily: 'inherit' }} />
  )
}

const sel = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: '.38rem .65rem', fontSize: '.78rem', fontFamily: 'inherit' }
