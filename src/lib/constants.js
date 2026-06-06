export const WH_COLORS = ['#4f46e5', '#059669', '#d97706']
export const WH_ICONS  = ['🏪', '🏠', '🆕']

export const COLOR_HEX = {
  Blue: '#3b82f6', Black: '#334155', Green: '#22c55e', Beige: '#d4b896',
  White: '#94a3b8', Grey: '#6b7280', Red: '#ef4444', Brown: '#92400e',
  Navy: '#1e40af', 'Orange-Grey': '#f97316', 'Black-Grey': '#475569',
  'Navy-Grey': '#3b4d8f', 'Offwhite-Brown': '#c8a882', 'Navy Blue': '#1e40af',
  'Olive Green': '#84cc16',
}

// SKU color word → exact DB color, per model
export const SKU_COLOR_MAP = {
  Yoots004: {
    blue: 'Navy Blue', navy: 'Navy Blue', navyblue: 'Navy Blue',
    black: 'Black',
    grey: 'Grey', gray: 'Grey',
    white: 'White',
    olive: 'Olive Green', green: 'Olive Green', olivegreen: 'Olive Green',
    beige: 'Beige',
  },
  Yoots005: {
    grey: 'Orange-Grey', gray: 'Orange-Grey',
    orange: 'Orange-Grey', orangegrey: 'Orange-Grey',
    navy: 'Navy-Grey', navyblue: 'Navy-Grey', navygrey: 'Navy-Grey', blue: 'Navy-Grey',
    black: 'Black-Grey', blackgrey: 'Black-Grey',
    white: 'Offwhite-Brown', offwhite: 'Offwhite-Brown',
    offwhitebrown: 'Offwhite-Brown', brown: 'Offwhite-Brown', cream: 'Offwhite-Brown',
  },
  Yoots006: {
    orange: 'Orange-Grey', orangegrey: 'Orange-Grey',
    grey: 'Orange-Grey', gray: 'Orange-Grey',
    navy: 'Navy-Grey', navyblue: 'Navy-Grey', navygrey: 'Navy-Grey', blue: 'Navy-Grey',
    black: 'Black-Grey', blackgrey: 'Black-Grey',
  },
  Yoots007: {
    black: 'Black',
    navy: 'Navy Blue', navyblue: 'Navy Blue', blue: 'Navy Blue',
    grey: 'Grey', gray: 'Grey',
  },
  // Yoots001 - Flip Flops
  Yoots001: {
    blue: 'Navy Blue', navy: 'Navy Blue', navyblue: 'Navy Blue',
    black: 'Black',
    grey: 'Grey', gray: 'Grey',
    white: 'White',
    beige: 'Beige',
  },
  // Yoots003 - Floaters
  Yoots003: {
    grey: 'Grey', gray: 'Grey',
    beige: 'Beige',
    white: 'White',
    blue: 'Navy Blue', navy: 'Navy Blue', navyblue: 'Navy Blue',
    black: 'Black',
  },
}

export function resolveColor(model, rawColor, whInv = []) {
  const key = String(rawColor).toLowerCase().replace(/[-_\s]/g, '')
  const map = SKU_COLOR_MAP[model]
  if (map?.[key]) return map[key]
  // fuzzy fallback against DB
  const dbColors = [...new Set(whInv.filter(r => r.model === model).map(r => r.color))]
  for (const c of dbColors) if (c.toLowerCase() === rawColor.toLowerCase()) return c
  for (const c of dbColors) if (c.toLowerCase().replace(/[-_\s]/g, '').includes(key)) return c
  return rawColor
}

export function normalizeColor(c) {
  if (!c) return c
  return String(c).replace(/[-_]/g, ' ').trim()
    .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

// Parse IND-X size format from Meesho (IND-8 = UK 8, same number)
export function parseIndSize(sizeStr) {
  if (!sizeStr) return 0
  const m = String(sizeStr).match(/IND-?(\d+)/i)
  if (m) return parseInt(m[1])
  const n = parseInt(sizeStr)
  return isNaN(n) ? 0 : n
}

export function parseYootsSKU(sku, whInv = [], sizeStr = '') {
  if (!sku) return null
  const s = String(sku).trim()

  // Pattern 1: Prefix-YootsNNN-Color (Meesho) e.g. Flip-Yoots003-Beige
  const m1 = s.match(/^[A-Za-z]+-Yoots0*([1-9]\d{0,2})-([A-Za-z][A-Za-z0-9-]*)$/i)
  if (m1) {
    const num = parseInt(m1[1])
    const model = 'Yoots' + String(num).padStart(3, '0')
    const size = parseIndSize(sizeStr)
    if (num >= 1 && num <= 999 && size >= 3 && size <= 15)
      return { model, color: resolveColor(model, m1[2], whInv), size }
  }

  // Pattern 2: Prefix-NNN-Color (Meesho) e.g. San-005-Navy, Flip-006-Orange
  const m2 = s.match(/^[A-Za-z]+-0*([1-9]\d{0,2})-([A-Za-z][A-Za-z0-9-]*)$/i)
  if (m2) {
    const num = parseInt(m2[1])
    const model = 'Yoots' + String(num).padStart(3, '0')
    const size = parseIndSize(sizeStr)
    if (num >= 1 && num <= 999 && size >= 3 && size <= 15)
      return { model, color: resolveColor(model, m2[2], whInv), size }
  }

  // Pattern 3: Prefix-NNN-Color-Size (Flipkart) e.g. Yoots-004-Blue-06
  const m3 = s.match(/^[A-Za-z]+-0*([1-9]\d{0,2})-([A-Za-z][A-Za-z0-9-]*)-0*(\d{1,2})$/i)
  if (m3) {
    const num = parseInt(m3[1]), size = parseInt(m3[3])
    if (num >= 1 && num <= 999 && size >= 3 && size <= 15) {
      const model = 'Yoots' + String(num).padStart(3, '0')
      return { model, color: resolveColor(model, m3[2], whInv), size }
    }
  }

  // Pattern 4: PrefixNNN-Color-Size e.g. Yoots004-Blue-8
  const m4 = s.match(/^[A-Za-z]+0*([1-9]\d{0,2})-([A-Za-z][A-Za-z0-9-]*)-0*(\d{1,2})$/i)
  if (m4) {
    const num = parseInt(m4[1]), size = parseInt(m4[3])
    if (num >= 1 && num <= 999 && size >= 3 && size <= 15) {
      const model = 'Yoots' + String(num).padStart(3, '0')
      return { model, color: resolveColor(model, m4[2], whInv), size }
    }
  }

  return null
}

export function parseYootsFromName(name, whInv = []) {
  if (!name) return null
  const s = String(name)
  const numM = s.match(/\b0*([1-9]\d{0,2})\b/)
  const colorM = s.match(/\b(Off[- ]?white|Olive[- ]?green|Navy[- ]?blue|Navy[- ]?grey|Black[- ]?grey|Orange[- ]?grey|Blue|Black|Green|Grey|Beige|White|Olive|Brown|Red|Navy|Orange)\b/i)
  const sizeM = s.match(/\b(?:UK\s*)?(\d{1,2})\b/)
  if (numM && colorM && sizeM) {
    const num = parseInt(numM[1]), sz = parseInt(sizeM[1])
    if (num >= 1 && num <= 999 && sz >= 3 && sz <= 15) {
      const model = 'Yoots' + String(num).padStart(3, '0')
      return { model, color: resolveColor(model, colorM[1], whInv), size: sz }
    }
  }
  return null
}

export function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export function today() {
  return new Date().toISOString().split('T')[0]
}
