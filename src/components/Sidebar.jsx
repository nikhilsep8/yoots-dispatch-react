import { useApp } from '../lib/AppContext'
import { sb } from '../lib/supabase'

const NAV = [
  { id: 'dashboard',     icon: '📊', label: 'Dashboard'     },
  { id: 'dispatch',      icon: '🚚', label: 'Dispatch'      },
  { id: 'meesho-orders', icon: '🟣', label: 'Meesho Orders' },
  { id: 'inventory',     icon: '📦', label: 'Inventory'     },
  { id: 'returns',       icon: '↩️', label: 'Returns'       },
  { id: 'history',       icon: '📋', label: 'History'       },
  { id: 'settings',      icon: '⚙️', label: 'Settings'      },
]

export default function Sidebar({ page, setPage }) {
  const { user, rtStatus } = useApp()

  return (
    <aside style={{
      position: 'fixed', top: 0, left: 0, width: 220, height: '100vh',
      background: '#1a1a2e', zIndex: 200, display: 'flex', flexDirection: 'column',
    }}>
      {/* Logo */}
      <div style={{ padding: '1.25rem 1rem 1rem', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 900, letterSpacing: 7, color: '#fff', fontFamily: 'Arial Black, Impact, sans-serif' }}>YOOTS</div>
        <div style={{ fontSize: '.5rem', color: 'rgba(255,255,255,.35)', letterSpacing: 3, textTransform: 'uppercase', marginTop: '.2rem' }}>MOVE DIFFERENT</div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '.75rem 0', overflowY: 'auto' }}>
        {NAV.map(n => (
          <button key={n.id} onClick={() => setPage(n.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '.65rem',
              width: '100%', padding: '.65rem 1.1rem', fontSize: '.82rem', fontWeight: 600,
              background: page === n.id ? 'rgba(79,70,229,.25)' : 'none',
              color: page === n.id ? '#fff' : 'rgba(255,255,255,.6)',
              borderLeft: `3px solid ${page === n.id ? '#6366f1' : 'transparent'}`,
              cursor: 'pointer', transition: 'all .15s', textAlign: 'left', fontFamily: 'inherit',
            }}
          >
            <span style={{ fontSize: '1rem', width: 20, textAlign: 'center', flexShrink: 0 }}>{n.icon}</span>
            <span>{n.label}</span>
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: '.75rem 1rem', borderTop: '1px solid rgba(255,255,255,.08)' }}>
        {/* Realtime dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.5rem' }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: rtStatus === 'live' ? '#10b981' : '#d1d5db',
            boxShadow: rtStatus === 'live' ? '0 0 5px #10b981' : 'none',
          }} />
          <span style={{ fontSize: '.62rem', color: 'rgba(255,255,255,.4)' }}>{rtStatus === 'live' ? 'Live' : 'Connecting'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.75rem', color: '#fff', fontWeight: 700, flexShrink: 0 }}>
            {(user?.email || 'Y')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: '.7rem', color: 'rgba(255,255,255,.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>
          </div>
          <button onClick={() => sb.auth.signOut()}
            style={{ background: 'none', border: '1px solid rgba(255,255,255,.2)', color: 'rgba(255,255,255,.5)', borderRadius: 4, padding: '.15rem .4rem', fontSize: '.62rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            Out
          </button>
        </div>
      </div>
    </aside>
  )
}
