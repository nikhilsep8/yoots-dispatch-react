import { useState } from 'react'
import { AppProvider, useApp } from './lib/AppContext'
import Login from './pages/Login'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Orders from './pages/Orders'
import Inventory from './pages/Inventory'
import Returns from './pages/Returns'
import { History, Settings } from './pages/HistorySettings'
import { Spinner } from './components/ui'
import { today } from './lib/constants'

function Shell() {
  const { user, loading } = useApp()
  const [page, setPage] = useState('dashboard')
  const [dispatchDate, setDispatchDate] = useState(today())

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f0f2f5' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: 8, color: '#4f46e5', marginBottom: '1rem', fontFamily: 'Arial Black, Impact, sans-serif' }}>YOOTS</div>
        <Spinner size={24} />
      </div>
    </div>
  )

  if (!user) return <Login />

  const titles = { dashboard: 'Dashboard', orders: 'Orders', inventory: 'Inventory', returns: 'Returns', history: 'Order History', settings: 'Settings' }

  function handleSetPage(p) {
    setPage(p)
    window.scrollTo(0, 0)
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f0f2f5' }}>
      {/* Sidebar */}
      <Sidebar page={page} setPage={handleSetPage} />

      {/* Main */}
      <div style={{ marginLeft: 220, flex: 1, minHeight: '100vh' }}>
        {/* Topbar */}
        <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '.75rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: '#111827' }}>{titles[page] || page}</div>
          <div style={{ fontSize: '.72rem', color: '#9ca3af', fontWeight: 500 }}>
            {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '1.5rem' }}>
          {page === 'dashboard' && <Dashboard setPage={handleSetPage} />}
          {page === 'orders' && <Orders initialDate={dispatchDate} setPage={handleSetPage} />}
          {page === 'inventory' && <Inventory />}
          {page === 'returns'   && <Returns />}
          {page === 'meesho-orders' && <MeeshoOrders />}
          {page === 'history'   && <History setPage={handleSetPage} setDispatchDate={setDispatchDate} />}
          {page === 'settings'  && <Settings />}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
