import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { sb } from '../lib/supabase'

const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

export function AppProvider({ children }) {
  const [user, setUser]           = useState(null)
  const [warehouses, setWarehouses] = useState([])
  const [whInv, setWhInv]         = useState([])
  const [plans, setPlans]         = useState({})   // keyed by date
  const [settings, setSettings]   = useState({})
  const [loading, setLoading]     = useState(true)
  const [rtStatus, setRtStatus]   = useState('connecting')

  // ── Auth ──────────────────────────────────────────
  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session) setUser(session.user)
      else setLoading(false)
    })
    const { data: { subscription } } = sb.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // ── Load all data when user logs in ───────────────
  useEffect(() => {
    if (user) loadAll()
  }, [user])

  async function loadAll() {
    setLoading(true)
    const [whRes, invRes, plansRes, settRes] = await Promise.all([
      sb.from('warehouses').select('*').order('sort_order'),
      sb.from('warehouse_inventory').select('*'),
      sb.from('dispatch_plans').select('*').order('date', { ascending: false }).limit(120),
      sb.from('settings').select('*'),
    ])
    if (whRes.data)    setWarehouses(whRes.data)
    if (invRes.data)   setWhInv(invRes.data)
    if (plansRes.data) {
      const map = {}
      plansRes.data.forEach(p => { map[p.date] = p })
      setPlans(map)
    }
    if (settRes.data) {
      const map = {}
      settRes.data.forEach(r => { map[r.key] = r.value })
      setSettings(map)
    }
    setLoading(false)
    setupRealtime()
  }

  // ── Realtime ──────────────────────────────────────
  const channelsRef = useRef([])
  function setupRealtime() {
    channelsRef.current.forEach(c => sb.removeChannel(c))
    const ch1 = sb.channel('wi-react')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_inventory' }, () => {
        sb.from('warehouse_inventory').select('*').then(({ data }) => { if (data) setWhInv(data) })
      })
      .subscribe(s => setRtStatus(s === 'SUBSCRIBED' ? 'live' : 'connecting'))
    const ch2 = sb.channel('dp-react')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatch_plans' }, () => {
        sb.from('dispatch_plans').select('*').order('date', { ascending: false }).limit(120)
          .then(({ data }) => {
            if (data) {
              const map = {}
              data.forEach(p => { map[p.date] = p })
              setPlans(map)
            }
          })
      })
      .subscribe()
    channelsRef.current = [ch1, ch2]
  }

  // ── Helpers ───────────────────────────────────────
  const getStock = useCallback((whId, model, color, size) => {
    const r = whInv.find(x => x.warehouse_id === whId && x.model === model && x.color === color && x.size === size)
    return r ? r.stock : 0
  }, [whInv])

  const getTransit = useCallback((model, color, size) => {
    return whInv.filter(r => r.model === model && r.color === color && r.size === size)
      .reduce((s, r) => s + (r.in_transit || 0), 0)
  }, [whInv])

  const saveSetting = useCallback(async (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    await sb.from('settings').upsert({ key, value }, { onConflict: 'key' })
  }, [])

  const refreshInv = useCallback(async () => {
    const { data } = await sb.from('warehouse_inventory').select('*')
    if (data) setWhInv(data)
  }, [])

  const refreshPlans = useCallback(async () => {
    const { data } = await sb.from('dispatch_plans').select('*').order('date', { ascending: false }).limit(120)
    if (data) {
      const map = {}
      data.forEach(p => { map[p.date] = p })
      setPlans(map)
    }
  }, [])

  return (
    <AppCtx.Provider value={{
      user, warehouses, whInv, setWhInv, plans, setPlans,
      settings, loading, rtStatus,
      getStock, getTransit, saveSetting,
      refreshInv, refreshPlans,
      reload: loadAll,
    }}>
      {children}
    </AppCtx.Provider>
  )
}
