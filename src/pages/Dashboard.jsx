import { useApp } from '../lib/AppContext'
import { WH_COLORS, WH_ICONS, today, fmtDate } from '../lib/constants'
import { Card, Badge, Btn } from '../components/ui'

export default function Dashboard({ setPage }) {
  const { warehouses, whInv, plans } = useApp()

  const tot  = whInv.reduce((s, r) => s + (r.stock || 0), 0)
  const neg  = whInv.filter(r => r.stock < 0).length
  const low  = whInv.filter(r => r.stock >= 0 && r.stock <= (r.reorder_level || 10)).length
  const tp   = plans[today()]
  const todO = tp?.total_orders || 0
  const disp = Object.values(plans).filter(p => p.status === 'dispatched').length

  const stats = [
    { n: tot,  l: 'Total Stock',      bg: '#eff6ff', color: '#1d4ed8', icon: '📦' },
    { n: todO, l: "Today's Orders",   bg: '#fff7ed', color: '#c2410c', icon: '🚚' },
    { n: disp, l: 'Dispatched Days',  bg: '#f0fdf4', color: '#166534', icon: '✅' },
    { n: neg,  l: 'Back-Orders',      bg: '#fff1f2', color: '#be123c', icon: '⚠️' },
    { n: low,  l: 'Low Stock SKUs',   bg: '#f5f3ff', color: '#6d28d9', icon: '🔻' },
  ]

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '.75rem', marginBottom: '1rem' }}>
        {stats.map(s => (
          <div key={s.l} style={{ background: '#fff', borderRadius: 10, padding: '1.1rem 1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,.06)', border: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: '.85rem' }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: '1.6rem', fontWeight: 900, lineHeight: 1, color: '#111827' }}>{s.n}</div>
              <div style={{ fontSize: '.65rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: '.2rem' }}>{s.l}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Warehouse bars */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '.75rem', marginBottom: '1rem' }}>
        {warehouses.map((wh, i) => {
          const wt = whInv.filter(r => r.warehouse_id === wh.id).reduce((s, r) => s + (r.stock || 0), 0)
          const pct = tot ? Math.round((wt / tot) * 100) : 0
          return (
            <div key={wh.id} style={{ background: '#fff', borderRadius: 10, padding: '1rem 1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,.06)', border: '1px solid #f3f4f6' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.65rem' }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: WH_COLORS[i] + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>{WH_ICONS[i]}</div>
                <div>
                  <div style={{ fontSize: '.82rem', fontWeight: 700, color: '#111827' }}>{wh.name}</div>
                  <div style={{ fontSize: '.62rem', color: '#9ca3af' }}>Warehouse {i + 1}</div>
                </div>
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#111827' }}>{wt} <span style={{ fontSize: '.85rem', fontWeight: 400, color: '#94a3b8' }}>units</span></div>
              <div style={{ height: 4, background: '#f3f4f6', borderRadius: 2, overflow: 'hidden', marginTop: '.5rem' }}>
                <div style={{ height: '100%', width: pct + '%', background: WH_COLORS[i], borderRadius: 2, transition: 'width .4s' }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Today's dispatch */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.65rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#111827' }}>Today's Dispatch</h2>
          <Btn size="sm" onClick={() => setPage('dispatch')}>Open →</Btn>
        </div>
        {tp && tp.plan && Object.keys(tp.plan).length ? (
          <div>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
              <Badge>{todO} orders</Badge>
              <Badge color={tp.status === 'dispatched' ? '#d1fae5' : '#fef9c3'} textColor={tp.status === 'dispatched' ? '#065f46' : '#854d0e'} border={tp.status === 'dispatched' ? '#bbf7d0' : '#fde047'}>
                {tp.status === 'dispatched' ? '✅ Dispatched' : '⏳ Pending'}
              </Badge>
            </div>
            {warehouses.map((wh, i) => {
              const cnt = ((tp.plan || {})[wh.code] || []).reduce((s, r) => s + r.qty, 0)
              if (!cnt) return null
              return <div key={wh.id} style={{ fontSize: '.77rem', fontWeight: 700, color: '#64748b', margin: '.25rem 0' }}>{WH_ICONS[i]} {wh.name} — {cnt} items</div>
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '.85rem', color: '#9ca3af', fontSize: '.82rem' }}>No dispatch plan yet for today.</div>
        )}
      </Card>
    </div>
  )
}
