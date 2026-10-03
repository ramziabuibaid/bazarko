export interface DirectoryProduct {
  id: string
  name: string
  slug: string
  price: number
  compare_price: number | null
  cost_price?: number | null
  stock_quantity: number
  stock_available: number | null
  track_stock: boolean
  low_stock_alert: number | null
  status: string
  is_active: boolean
  is_featured: boolean
  thumbnail_url: string | null
  images?: string[] | null
  sku: string | null
  shamel_code?: string | null
  barcode: string | null
  category_id: string | null
  created_at: string
  categories: { id: string; name: string } | null
  brand_id?: string | null
  brands?: { id: string; name: string } | null
  specifications?: Array<{ key: string; value: string }> | null
}

export function normalizeArabicText(text: string): string {
  if (!text) return ''
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\-_/\\,.]/g, ' ')
}

export function matchesSmartProductSearch(p: DirectoryProduct, query: string): boolean {
  const q = (query || '').trim()
  if (!q) return true

  const tokens = normalizeArabicText(q)
    .split(/\s+/)
    .filter(Boolean)

  if (tokens.length === 0) return true

  const target = normalizeArabicText(
    `${p.name} ${p.sku || ''} ${p.barcode || ''} ${p.shamel_code || ''} ${p.categories?.name || ''}`
  )

  return tokens.every(token => target.includes(token))
}

export function productStock(p: DirectoryProduct) {
  if (!p.track_stock) return 'untracked'
  if (p.stock_available === null) return 'unknown'
  const q = Number(p.stock_available)
  return q <= 0
    ? 'out_of_stock'
    : q <= Math.max(0, Number(p.low_stock_alert ?? 5))
    ? 'low_stock'
    : 'available'
}

export function productDirectory(
  rows: DirectoryProduct[],
  f: {
    brand_id?: string
    q?: string
    category?: string
    status?: string
    stock?: string
    sort?: string
    page?: number
    size?: number
  },
  sales: Record<string, number> = {}
) {
  const base = rows.filter(
    p =>
      (!f.brand_id || p.brand_id === f.brand_id) &&
      (!f.category || p.category_id === f.category) &&
      matchesSmartProductSearch(p, f.q || '')
  )

  const stats = {
    total: base.length,
    active: base.filter(p => p.status === 'active' && p.is_active).length,
    hidden: base.filter(p => p.status === 'hidden' || (p.status === 'active' && !p.is_active)).length,
    draft: base.filter(p => p.status === 'draft').length,
  }

  const filtered = base
    .filter(
      p =>
        (!f.status || p.status === f.status) &&
        (!f.stock || productStock(p) === f.stock)
    )
    .sort((a, b) => {
      const tie = a.id.localeCompare(b.id)
      if (f.sort === 'price_low') return Number(a.price) - Number(b.price) || tie
      if (f.sort === 'price_high') return Number(b.price) - Number(a.price) || tie
      if (f.sort === 'best_selling') return (sales[b.id] || 0) - (sales[a.id] || 0) || tie
      const date = a.created_at.localeCompare(b.created_at) || tie
      return f.sort === 'oldest' ? date : -date
    })

  const size = [5, 10, 20, 25, 50, 100].includes(Number(f.size)) ? Number(f.size) : 20
  const pages = Math.max(1, Math.ceil(filtered.length / size))
  const page = Math.max(1, Math.min(pages, Math.floor(Number(f.page)) || 1))

  return {
    stats,
    filtered,
    visible: filtered.slice((page - 1) * size, page * size),
    page,
    pages,
    size,
  }
}
