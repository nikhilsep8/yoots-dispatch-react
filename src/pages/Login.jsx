import { useState } from 'react'
import { sb } from '../lib/supabase'

export default function Login() {
  const [email, setEmail]   = useState('')
  const [pass, setPass]     = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { error } = await sb.auth.signInWithPassword({ email, password: pass })
    if (error) { setError(error.message); setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', position: 'fixed', inset: 0, background: 'linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '2.5rem 2rem', width: '92%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '2.2rem', fontWeight: 900, letterSpacing: 10, color: '#111827', fontFamily: 'Arial Black, Impact, sans-serif', marginBottom: '.3rem' }}>YOOTS</div>
          <div style={{ fontSize: '.72rem', fontWeight: 600, color: '#6b7280' }}>Seller Dashboard</div>
        </div>
        <form onSubmit={handleLogin}>
          <label style={lbl}>Email address</label>
          <input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seller@yoots.in" required />
          <label style={lbl}>Password</label>
          <input style={inp} type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="••••••••" required />
          {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: '.76rem', padding: '.5rem .75rem', borderRadius: 6, marginBottom: '.6rem' }}>{error}</div>}
          <button type="submit" disabled={loading}
            style={{ width: '100%', padding: '.72rem', background: loading ? '#9ca3af' : '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, fontSize: '.9rem', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

const lbl = { fontSize: '.72rem', fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: '.3rem' }
const inp = { width: '100%', padding: '.65rem .85rem', background: '#f9fafb', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: '.9rem', color: '#111827', marginBottom: '.85rem', fontFamily: 'inherit', boxSizing: 'border-box' }
