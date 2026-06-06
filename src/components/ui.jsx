import { COLOR_HEX } from '../lib/constants'
import { useState, useCallback } from 'react'

// ── Platform badge ────────────────────────────────────
export function PlatBadge({ platform }) {
  if (platform === 'Flipkart') return (
    <span style={{ background: '#eef2ff', border: '1px solid #c7d7f8', color: '#3730a3', borderRadius: 4, padding: '2px 6px', fontSize: '.67rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <span style={{ background: '#2874f0', color: '#ffd100', borderRadius: 2, padding: '0 3px', fontWeight: 900, fontSize: '.65rem' }}>F</span>lipkart
    </span>
  )
  if (platform === 'Amazon') return (
    <span style={{ background: '#fff8ee', border: '1px solid #fcd34d', color: '#92400e', borderRadius: 4, padding: '2px 6px', fontSize: '.67rem', fontWeight: 700 }}>
      amazon<span style={{ color: '#FF9900', fontWeight: 900, marginLeft: 1 }}>↗</span>
    </span>
  )
  if (platform === 'Meesho') return (
    <span style={{ background: '#fdf4ff', border: '1px solid #e9d5ff', color: '#7e22ce', borderRadius: 4, padding: '2px 6px', fontSize: '.67rem', fontWeight: 700 }}>meesho</span>
  )
  if (platform === 'Myntra') return (
    <span style={{ background: '#fff1f2', border: '1px solid #fecdd3', color: '#be123c', borderRadius: 4, padding: '2px 6px', fontSize: '.67rem', fontWeight: 700, letterSpacing: '.5px' }}>MYNTRA</span>
  )
  return <span style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 6px', fontSize: '.67rem', fontWeight: 700 }}>{platform}</span>
}

// ── Color dot ─────────────────────────────────────────
export function ColorDot({ color, size = 9 }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: COLOR_HEX[color] || '#94a3b8',
      border: '1px solid rgba(0,0,0,.1)', flexShrink: 0,
    }} />
  )
}

// ── Card ──────────────────────────────────────────────
export function Card({ children, style, accent }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 10, padding: '1.25rem',
      marginBottom: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,.06)',
      border: `1px solid ${accent || '#f3f4f6'}`,
      borderLeft: accent ? `4px solid ${accent}` : undefined,
      ...style,
    }}>
      {children}
    </div>
  )
}

// ── Section header ────────────────────────────────────
export function SectionHeader({ title, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.85rem', gap: '.5rem', flexWrap: 'wrap' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#111827' }}>{title}</h2>
      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>
    </div>
  )
}

// ── Btn ───────────────────────────────────────────────
export function Btn({ children, onClick, variant = 'primary', size = 'md', disabled, style, type }) {
  const variants = {
    primary:  { background: '#4f46e5', color: '#fff' },
    success:  { background: '#059669', color: '#fff' },
    warning:  { background: '#d97706', color: '#fff' },
    danger:   { background: '#dc2626', color: '#fff' },
    ghost:    { background: '#f9fafb', color: '#374151', border: '1px solid #e5e7eb' },
    wa:       { background: '#25d366', color: '#fff' },
    meesho:   { background: '#7e22ce', color: '#fff' },
  }
  const sizes = {
    sm: { padding: '.35rem .75rem', fontSize: '.73rem' },
    md: { padding: '.5rem 1rem',    fontSize: '.8rem'  },
    lg: { padding: '.65rem 1.25rem',fontSize: '.88rem' },
  }
  return (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '.35rem',
        border: 'none', borderRadius: 7, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? .45 : 1, whiteSpace: 'nowrap', fontFamily: 'inherit',
        transition: 'all .15s',
        ...variants[variant], ...sizes[size], ...style,
      }}
    >
      {children}
    </button>
  )
}

// ── Badge ─────────────────────────────────────────────
export function Badge({ children, color = '#eff6ff', textColor = '#3730a3', border = '#c7d7f8' }) {
  return (
    <span style={{
      background: color, color: textColor, border: `1px solid ${border}`,
      borderRadius: 999, padding: '.1rem .5rem', fontSize: '.65rem', fontWeight: 700,
      display: 'inline-block',
    }}>
      {children}
    </span>
  )
}

// ── Spinner ───────────────────────────────────────────
export function Spinner({ size = 14, color = '#4f46e5' }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size,
      border: `2px solid rgba(0,0,0,.08)`, borderTopColor: color,
      borderRadius: '50%', animation: 'spin .7s linear infinite',
      verticalAlign: 'middle',
    }} />
  )
}

// ── Empty state ───────────────────────────────────────
export function EmptyState({ icon, message }) {
  return (
    <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: '#9ca3af' }}>
      <div style={{ fontSize: '2.2rem', marginBottom: '.45rem' }}>{icon}</div>
      <p style={{ fontSize: '.82rem' }}>{message}</p>
    </div>
  )
}

// ── Toast hook ────────────────────────────────────────
export function useToast() {
  const [toasts, setToasts] = useState([])
  const toast = useCallback((msg, ms = 2500) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, msg }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), ms)
  }, [])
  return { toast, toasts }
}

export function ToastContainer({ toasts }) {
  return (
    <div style={{ position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '.4rem', alignItems: 'center' }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: '#111827', color: '#fff', padding: '.55rem 1.2rem',
          borderRadius: 999, fontSize: '.78rem', fontWeight: 600,
          whiteSpace: 'nowrap', animation: 'fadeInUp .25s ease',
        }}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}

// ── FormField ─────────────────────────────────────────
export function FormField({ label, children }) {
  return (
    <div style={{ marginBottom: '.75rem' }}>
      <label style={{ fontSize: '.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.5px', display: 'block', marginBottom: '.3rem' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

export const inputStyle = {
  width: '100%', padding: '.52rem .75rem', border: '1.5px solid #e5e7eb',
  borderRadius: 7, fontSize: '.85rem', color: '#111827', background: '#f9fafb',
  fontFamily: 'inherit', boxSizing: 'border-box',
}

export const selectStyle = {
  ...inputStyle, cursor: 'pointer',
}
