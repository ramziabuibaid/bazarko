'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { uniqueSlug } from '@/lib/utils/slug'
import { trackAction } from '@/lib/activity/track'
import { productStock, matchesSmartProductSearch, type DirectoryProduct as Product } from '@/lib/products/directory'
import ProductAttributePillFilters, {
  type ProductAttributeFilters,
  getProductType,
  getProductBrand,
  getProductSize,
  getProductColor,
} from './ProductAttributePillFilters'
import styles from '../customers/directory.module.css'

const STATUS_META: Record<string, { label: string; icon: string; badgeCls: string }> = {
  active:   { label: 'فعال',   icon: '✅', badgeCls: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' },
  draft:    { label: 'مسودة',  icon: '✏️', badgeCls: 'bg-sky-500/10 text-sky-400 border border-sky-500/20'         },
  hidden:   { label: 'مخفي',   icon: '🙈', badgeCls: 'bg-amber-500/10 text-amber-400 border border-amber-500/20'     },
  archived: { label: 'مؤرشف',  icon: '📦', badgeCls: 'bg-slate-700 text-slate-400 border border-slate-600'        },
}

interface ColumnDef {
  id: string
  label: string
  defaultVisible: boolean
}

const ALL_COLUMNS: ColumnDef[] = [
  { id: 'image', label: 'الصورة', defaultVisible: true },
  { id: 'name', label: 'اسم الصنف', defaultVisible: true },
  { id: 'sku', label: 'رقم الشامل (SKU)', defaultVisible: true },
  { id: 'barcode', label: 'الباركود', defaultVisible: true },
  { id: 'category', label: 'الفئة', defaultVisible: true },
  { id: 'price', label: 'سعر البيع', defaultVisible: true },
  { id: 'cost_price', label: 'سعر التكلفة', defaultVisible: true },
  { id: 'compare_price', label: 'السعر قبل الخصم', defaultVisible: false },
  { id: 'margin', label: 'الربح المتوقع', defaultVisible: true },
  { id: 'stock', label: 'المخزون المتوفر', defaultVisible: true },
  { id: 'sold_count', label: 'المبيعات', defaultVisible: true },
  { id: 'status', label: 'حالة الظهور', defaultVisible: true },
  { id: 'created_at', label: 'تاريخ الإضافة', defaultVisible: false },
]

const DEFAULT_VISIBLE_COLUMNS = ALL_COLUMNS.reduce((acc, col) => {
  acc[col.id] = col.defaultVisible
  return acc
}, {} as Record<string, boolean>)

interface Props {
  products: Product[]
  categories: { id: string; name: string }[]
  storeId: string
  currencyCode: string
  filters: {
    brand_id?: string
    q?: string
    category?: string
    status?: string
    stock?: string
    sort?: string
    page?: string
    size?: string
  }
  sales?: Record<string, number>
  loadError?: boolean
  categoryError?: boolean
  salesError?: boolean
  preview?: boolean
}

function exportProductsCSV(products: Product[], currencyCode: string, hideCost: boolean = false) {
  const headers = ['اسم الصنف', 'رقم الشامل (SKU)', 'الباركود', 'الفئة', 'سعر البيع', 'سعر التكلفة', 'المخزون المتوفر', 'الحالة']
  const rows = products.map(p => [
    p.name,
    p.sku || p.shamel_code || '',
    p.barcode || '',
    p.categories?.name || 'غير مصنف',
    `${p.price} ${currencyCode}`,
    hideCost ? '••••' : (p.cost_price ? `${p.cost_price} ${currencyCode}` : '0'),
    p.stock_available ?? p.stock_quantity ?? 0,
    STATUS_META[p.status]?.label || p.status,
  ])
  const csv = [headers, ...rows]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `منتجات-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function ProductsTable({
  products: initial,
  categories,
  storeId,
  currencyCode,
  filters,
  sales = {},
  loadError = false,
  categoryError = false,
  salesError = false,
  preview = false,
}: Props) {
  const router = useRouter()
  const [products, setProducts] = useState(initial)
  const [search, setSearch] = useState(filters.q ?? '')
  const [category, setCategory] = useState(filters.category ?? '')
  const [status, setStatus] = useState(['low_stock', 'out_of_stock'].includes(filters.status || '') ? '' : filters.status ?? '')
  const [stock, setStock] = useState(filters.stock || (['low_stock', 'out_of_stock'].includes(filters.status || '') ? filters.status : ''))
  const [sortField, setSortField] = useState<string>(filters.sort ?? 'created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(Number(filters.page) || 1)
  const [size, setSize] = useState<number>(Number(filters.size) || 20)
  const [actionError, setActionError] = useState('')
  const [copiedSku, setCopiedSku] = useState<string | null>(null)
  const [hideCost, setHideCost] = useState(false)

  // Attribute Pill Filters (النوع، العلامة التجارية، الحجم، اللون)
  const [attrFilters, setAttrFilters] = useState<ProductAttributeFilters>({
    type: null,
    brand: null,
    size: null,
    color: null,
  })

  // Modals & UI States
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [duplicating, setDuplicating] = useState<Record<string, boolean>>({})
  const [showColSettings, setShowColSettings] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(DEFAULT_VISIBLE_COLUMNS)

  // Lightbox State for Image Carousel
  const [lightboxProduct, setLightboxProduct] = useState<Product | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const openLightbox = (product: Product, index = 0) => {
    setLightboxProduct(product)
    setLightboxIndex(index)
  }

  const closeLightbox = () => {
    setLightboxProduct(null)
    setLightboxIndex(0)
  }

  const getProductImages = (product: Product | null): string[] => {
    if (!product) return []
    const rawList: string[] = []
    if (Array.isArray(product.images)) {
      rawList.push(...product.images)
    }
    if (product.thumbnail_url) {
      rawList.push(product.thumbnail_url)
    }
    const seen = new Set<string>()
    const res: string[] = []
    for (const img of rawList) {
      if (img && typeof img === 'string' && img.trim() && !seen.has(img.trim())) {
        seen.add(img.trim())
        res.push(img.trim())
      }
    }
    return res
  }

  const currentLightboxImages = getProductImages(lightboxProduct)

  useEffect(() => {
    if (!lightboxProduct || currentLightboxImages.length === 0) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeLightbox()
      } else if (e.key === 'ArrowLeft' && currentLightboxImages.length > 1) {
        // In RTL, left arrow goes to next image
        setLightboxIndex(prev => (prev === currentLightboxImages.length - 1 ? 0 : prev + 1))
      } else if (e.key === 'ArrowRight' && currentLightboxImages.length > 1) {
        // In RTL, right arrow goes to previous image
        setLightboxIndex(prev => (prev === 0 ? currentLightboxImages.length - 1 : prev - 1))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [lightboxProduct, currentLightboxImages.length])

  useEffect(() => {
    setProducts(initial)
  }, [initial])

  // Load custom columns preferences
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`bazarko_prod_cols_${storeId}`)
      if (saved) {
        const parsed = JSON.parse(saved)
        setVisibleColumns(prev => ({ ...prev, ...parsed }))
      }
    } catch {}
  }, [storeId])

  // Load hideCost preference from localStorage
  useEffect(() => {
    try {
      const savedHideCost = localStorage.getItem(`bazarko_hide_cost_${storeId}`)
      if (savedHideCost !== null) {
        setHideCost(savedHideCost === 'true')
      }
    } catch {}
  }, [storeId])

  function toggleHideCost() {
    setHideCost(prev => {
      const next = !prev
      try {
        localStorage.setItem(`bazarko_hide_cost_${storeId}`, String(next))
      } catch {}
      return next
    })
  }

  function toggleColumn(colId: string) {
    setVisibleColumns(prev => {
      const next = { ...prev, [colId]: !prev[colId] }
      try {
        localStorage.setItem(`bazarko_prod_cols_${storeId}`, JSON.stringify(next))
      } catch {}
      return next
    })
  }

  function handleSort(columnId: string) {
    if (sortField === columnId) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(columnId)
      setSortOrder('desc')
    }
  }

  function copySku(skuText: string) {
    if (!skuText) return
    navigator.clipboard?.writeText(skuText)
    setCopiedSku(skuText)
    setTimeout(() => setCopiedSku(null), 2000)
  }

  // 1. Smart Multi-token Arabic & Latin Filtering + Attribute Filters
  const base = products.filter(p => {
    if (filters.brand_id && p.brand_id !== filters.brand_id) return false
    if (category && p.category_id !== category) return false
    if (!matchesSmartProductSearch(p, search)) return false

    // Attribute Pill Filters (النوع، العلامة التجارية، الحجم، اللون)
    if (attrFilters.type && getProductType(p) !== attrFilters.type) return false
    if (attrFilters.brand && getProductBrand(p) !== attrFilters.brand) return false
    if (attrFilters.size && getProductSize(p) !== attrFilters.size) return false
    if (attrFilters.color && getProductColor(p) !== attrFilters.color) return false

    return true
  })

  const stats = {
    total: base.length,
    active: base.filter(p => p.status === 'active' && p.is_active).length,
    hidden: base.filter(p => p.status === 'hidden' || (p.status === 'active' && !p.is_active)).length,
    draft: base.filter(p => p.status === 'draft').length,
    outOfStock: base.filter(p => productStock(p) === 'out_of_stock').length,
  }

  const filtered = base.filter(p =>
    (!status || p.status === status) &&
    (!stock || productStock(p) === stock)
  )

  // 2. Sorting
  const sorted = [...filtered].sort((a, b) => {
    let comp = 0
    switch (sortField) {
      case 'name':
        comp = a.name.localeCompare(b.name, 'ar')
        break
      case 'sku':
        comp = (a.sku || a.shamel_code || '').localeCompare(b.sku || b.shamel_code || '')
        break
      case 'barcode':
        comp = (a.barcode || '').localeCompare(b.barcode || '')
        break
      case 'category':
        comp = (a.categories?.name || '').localeCompare(b.categories?.name || '', 'ar')
        break
      case 'price':
        comp = Number(a.price) - Number(b.price)
        break
      case 'cost_price':
        comp = Number(a.cost_price || 0) - Number(b.cost_price || 0)
        break
      case 'compare_price':
        comp = Number(a.compare_price || 0) - Number(b.compare_price || 0)
        break
      case 'margin': {
        const marginA = Number(a.price) - Number(a.cost_price || 0)
        const marginB = Number(b.price) - Number(b.cost_price || 0)
        comp = marginA - marginB
        break
      }
      case 'stock':
        comp = Number(a.stock_available ?? a.stock_quantity ?? 0) - Number(b.stock_available ?? b.stock_quantity ?? 0)
        break
      case 'sold_count':
        comp = (sales[a.id] || 0) - (sales[b.id] || 0)
        break
      case 'status':
        comp = a.status.localeCompare(b.status)
        break
      case 'created_at':
      default:
        comp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        break
    }
    return sortOrder === 'asc' ? comp : -comp
  })

  // 3. Pagination
  const pages = Math.max(1, Math.ceil(sorted.length / size))
  const currentPage = Math.max(1, Math.min(pages, page))
  const visible = sorted.slice((currentPage - 1) * size, currentPage * size)

  // Sync URL state
  useEffect(() => {
    const p = new URLSearchParams()
    if (filters.brand_id) p.set('brand_id', filters.brand_id)
    if (search) p.set('q', search)
    if (category) p.set('category', category)
    if (status) p.set('status', status)
    if (stock) p.set('stock', stock)
    if (sortField !== 'created_at') p.set('sort', sortField)
    if (currentPage > 1) p.set('page', String(currentPage))
    if (size !== 20) p.set('size', String(size))
    window.history.replaceState(null, '', window.location.pathname + (p.size ? '?' + p.toString() : ''))
  }, [search, category, status, stock, sortField, currentPage, size, filters.brand_id])

  async function toggleActive(product: Product) {
    const next = product.status === 'active' ? 'hidden' : 'active'
    const supabase = createClient()
    if (preview) return
    setActionError('')
    const { data: updated, error } = await supabase
      .from('products')
      .update({ status: next, is_active: next === 'active' })
      .eq('id', product.id)
      .eq('store_id', storeId)
      .select('id')
      .maybeSingle()

    if (error || !updated) {
      setActionError('تعذر تغيير ظهور المنتج')
      return
    }
    trackAction(storeId, {
      action: 'status_change',
      entityType: 'product',
      entityId: product.id,
      entityLabel: product.name,
      details: { from: product.status, to: next },
    })
    setProducts(ps => ps.map(p => p.id === product.id ? { ...p, status: next, is_active: next === 'active' } : p))
  }

  async function duplicateProduct(product: Product) {
    if (preview) return
    setActionError('')
    setDuplicating(prev => ({ ...prev, [product.id]: true }))
    const supabase = createClient()

    const { data: full, error: fullError } = await supabase
      .from('products')
      .select('description, track_stock, allow_backorder, low_stock_alert, weight, dimensions, images, tags, metadata, barcode, cost_price, compare_price, category_id, video_url, secondary_price, secondary_currency_code')
      .eq('id', product.id)
      .eq('store_id', storeId)
      .single()

    if (fullError || !full) {
      setDuplicating(prev => ({ ...prev, [product.id]: false }))
      setActionError('تعذر تحميل المنتج لنسخه')
      return
    }

    const { data: copy, error } = await supabase
      .from('products')
      .insert({
        store_id: storeId,
        name: `نسخة - ${product.name}`,
        slug: uniqueSlug(product.name),
        price: product.price,
        compare_price: full?.compare_price ?? product.compare_price ?? null,
        cost_price: full?.cost_price ?? product.cost_price ?? null,
        category_id: full?.category_id ?? null,
        description: full?.description ?? null,
        sku: null,
        barcode: null,
        stock_quantity: 0,
        track_stock: full?.track_stock ?? true,
        allow_backorder: full?.allow_backorder ?? false,
        low_stock_alert: full?.low_stock_alert ?? 5,
        weight: full?.weight ?? null,
        dimensions: full?.dimensions ?? null,
        images: full?.images ?? [],
        thumbnail_url: product.thumbnail_url,
        tags: full?.tags ?? [],
        status: 'draft',
        is_featured: false,
        metadata: full?.metadata ?? {},
        video_url: full?.video_url ?? null,
      })
      .select('id')
      .single()

    setDuplicating(prev => { const n = { ...prev }; delete n[product.id]; return n })

    if (error) setActionError('تعذر نسخ المنتج')
    if (!error && copy) {
      trackAction(storeId, {
        action: 'create',
        entityType: 'product',
        entityId: copy.id,
        entityLabel: `نسخة - ${product.name}`,
        details: { duplicatedFrom: product.id },
      })
      router.push(`/dashboard/products/${copy.id}`)
    }
  }

  async function confirmDelete(id: string) {
    setDeleting(true)
    const supabase = createClient()
    const deleted = products.find(p => p.id === id)
    if (preview) {
      setDeleting(false)
      return
    }
    setActionError('')
    const { data: removed, error } = await supabase
      .from('products')
      .delete()
      .eq('id', id)
      .eq('store_id', storeId)
      .select('id')
      .maybeSingle()

    if (error || !removed) {
      setActionError('تعذر حذف المنتج؛ قد يكون مرتبطاً بمعاملات أو فواتير مسجلة.')
      setDeleting(false)
      return
    }
    trackAction(storeId, {
      action: 'delete',
      entityType: 'product',
      entityId: id,
      entityLabel: deleted?.name ?? null,
    })
    setProducts(ps => ps.filter(p => p.id !== id))
    setDeleteId(null)
    setDeleting(false)
  }

  function stockBadge(p: Product) {
    const kind = productStock(p)
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        kind === 'out_of_stock'
          ? 'bg-rose-500/15 text-rose-300 border border-rose-500/20'
          : kind === 'low_stock'
          ? 'bg-amber-500/15 text-amber-300 border border-amber-500/20'
          : kind === 'untracked'
          ? 'bg-slate-800 text-slate-400'
          : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
      }`}>
        {kind === 'untracked'
          ? 'غير متتبع'
          : kind === 'unknown'
          ? 'غير متاح'
          : kind === 'out_of_stock'
          ? 'نفد'
          : `${p.stock_available ?? p.stock_quantity ?? 0} ${kind === 'low_stock' ? 'متبقي' : 'متوفر'}`}
      </span>
    )
  }

  return (
    <div className={styles.page} dir="rtl">
      {filters.brand_id && (
        <p className="mb-4 rounded-xl border border-sky-800 bg-sky-950/40 p-3 text-sm text-sky-300">
          القائمة مقيدة بالماركة المختارة · <Link href="/dashboard/products" className="underline font-bold">عرض جميع المنتجات</Link>
        </p>
      )}

      {/* بطاقات الإحصائيات السريعة */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <span className="text-xs text-slate-400 block">إجمالي المنتجات</span>
          <strong className="text-2xl font-black text-white mt-1 block">
            {loadError ? '—' : stats.total.toLocaleString('ar-u-nu-latn')}
          </strong>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <span className="text-xs text-emerald-400 block">فعال بالمتجر</span>
          <strong className="text-2xl font-black text-emerald-400 mt-1 block">
            {loadError ? '—' : stats.active.toLocaleString('ar-u-nu-latn')}
          </strong>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <span className="text-xs text-amber-400 block">مخفي</span>
          <strong className="text-2xl font-black text-amber-400 mt-1 block">
            {loadError ? '—' : stats.hidden.toLocaleString('ar-u-nu-latn')}
          </strong>
        </div>
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4">
          <span className="text-xs text-sky-400 block">مسودة</span>
          <strong className="text-2xl font-black text-sky-400 mt-1 block">
            {loadError ? '—' : stats.draft.toLocaleString('ar-u-nu-latn')}
          </strong>
        </div>
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4">
          <span className="text-xs text-rose-400 block">نفد من المخزون</span>
          <strong className="text-2xl font-black text-rose-400 mt-1 block">
            {loadError ? '—' : stats.outOfStock.toLocaleString('ar-u-nu-latn')}
          </strong>
        </div>
      </div>

      {(loadError || categoryError || salesError || actionError) && (
        <div role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {loadError ? 'تعذر تحميل المنتجات من الخادم. ' : ''}
          {categoryError ? 'تعذر تحميل الفئات. ' : ''}
          {salesError ? 'ترتيب الأكثر مبيعاً غير متاح حالياً. ' : ''}
          {actionError}
        </div>
      )}

      {/* شريط الأدوات والبحث */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex-1 min-w-[240px]">
          <input
            aria-label="البحث في المنتجات"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
            placeholder="ابحث بالاسم أو رقم الشامل (SKU) أو الباركود…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>

        {/* فئة المنتج */}
        <select
          aria-label="الفئة"
          className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-slate-300 outline-none"
          disabled={categoryError}
          value={category}
          onChange={e => { setCategory(e.target.value); setPage(1) }}
        >
          <option value="">كل الفئات</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {/* حالة الظهور */}
        <select
          aria-label="حالة الظهور"
          className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-slate-300 outline-none"
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1) }}
        >
          <option value="">كل حالات الظهور</option>
          {Object.entries(STATUS_META).map(([key, m]) => (
            <option key={key} value={key}>{m.label}</option>
          ))}
        </select>

        {/* حالة المخزون */}
        <select
          aria-label="حالة المخزون"
          className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-slate-300 outline-none"
          value={stock}
          onChange={e => { setStock(e.target.value); setPage(1) }}
        >
          <option value="">كل حالات المخزون</option>
          <option value="available">متوفر</option>
          <option value="low_stock">منخفض</option>
          <option value="out_of_stock">نفد</option>
          <option value="untracked">غير متتبع</option>
          <option value="unknown">غير متاح</option>
        </select>

        {/* زر العين لإخفاء / إظهار عمود سعر التكلفة */}
        <button
          type="button"
          onClick={toggleHideCost}
          className={`shrink-0 flex items-center justify-center rounded-xl border p-2.5 text-base transition-colors ${
            hideCost
              ? 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
              : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
          }`}
          title={hideCost ? 'إظهار عمود سعر التكلفة' : 'إخفاء عمود سعر التكلفة'}
          aria-label={hideCost ? 'إظهار عمود سعر التكلفة' : 'إخفاء عمود سعر التكلفة'}
        >
          <span>{hideCost ? '🙈' : '👁️'}</span>
        </button>

        {/* تخصيص الأعمدة */}
        <button
          type="button"
          onClick={() => setShowColSettings(true)}
          className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
          title="تخصيص أعمدة الجدول"
        >
          <span>⚙️</span>
          <span>الأعمدة</span>
        </button>

        {/* تصدير CSV */}
        <button
          type="button"
          onClick={() => exportProductsCSV(sorted, currencyCode, hideCost)}
          title="تصدير ملف CSV"
          className="rounded-xl border border-white/10 px-3 py-2.5 text-sm text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
        >
          ↓ CSV
        </button>

        {/* مسح الفلاتر */}
        {(search || category || status || stock || sortField !== 'created_at' || attrFilters.type || attrFilters.brand || attrFilters.size || attrFilters.color) && (
          <button
            type="button"
            className="text-xs text-sky-400 hover:underline px-2 py-2"
            onClick={() => {
              setSearch('')
              setCategory('')
              setStatus('')
              setStock('')
              setAttrFilters({ type: null, brand: null, size: null, color: null })
              setSortField('created_at')
              setSortOrder('desc')
              setPage(1)
            }}
          >
            مسح الفلاتر
          </button>
        )}
      </div>

      {/* شريط فلترة الخصائص (النوع، العلامة التجارية، الحجم، اللون) على نهج نظام المنار */}
      <div className="mb-4 bg-white/3 border border-white/5 rounded-2xl p-3">
        <ProductAttributePillFilters
          products={products}
          filters={attrFilters}
          onChange={next => {
            setAttrFilters(next)
            setPage(1)
          }}
        />
      </div>

      {/* نافذة تخصيص الأعمدة */}
      {showColSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowColSettings(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="تخصيص أعمدة جدول الأصناف"
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-white mb-1">تخصيص أعمدة الأصناف</h3>
            <p className="text-xs text-slate-400 mb-4">اختر الأعمدة التي ترغب بعرضها (يتم حفظ اختياراتك دائماً)</p>
            <div className="space-y-1.5 max-h-[60vh] overflow-y-auto mb-6">
              {ALL_COLUMNS.map(col => (
                <label key={col.id} className="flex items-center justify-between p-2 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
                  <span className="text-sm text-slate-200">{col.label}</span>
                  <input
                    type="checkbox"
                    checked={visibleColumns[col.id] ?? true}
                    onChange={() => toggleColumn(col.id)}
                    className="h-4 w-4 rounded accent-sky-500"
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setVisibleColumns(DEFAULT_VISIBLE_COLUMNS)
                  try { localStorage.removeItem(`bazarko_prod_cols_${storeId}`) } catch {}
                }}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-400 hover:text-white"
              >
                استعادة الافتراضي
              </button>
              <button
                type="button"
                onClick={() => setShowColSettings(false)}
                className="rounded-xl bg-sky-600 px-5 py-2 text-xs font-semibold text-white hover:bg-sky-500"
              >
                تم
              </button>
            </div>
          </div>
        </div>
      )}

      {/* جدول المنتجات */}
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-white/3 py-16 text-center">
          <p className="text-4xl">📦</p>
          <p className="mt-3 text-slate-400">
            {loadError ? 'البيانات غير متاحة حالياً' : products.length ? 'لا توجد منتجات تطابق البحث والفلاتر' : 'أضف أول منتج لتبدأ البيع وتنظيم المخزون'}
          </p>
          <Link
            href="/dashboard/products/new"
            className="mt-4 inline-block rounded-xl bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500"
          >
            ＋ إضافة منتج جديد
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/5 bg-slate-950/40">
          <table className="min-w-full divide-y divide-white/5 text-right text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                {visibleColumns.image && (
                  <th className="px-3 py-3 text-xs font-medium text-slate-400">الصورة</th>
                )}
                {visibleColumns.name && (
                  <th onClick={() => handleSort('name')} className="px-4 py-3 text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>اسم الصنف</span>
                      {sortField === 'name' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.sku && (
                  <th onClick={() => handleSort('sku')} className="px-4 py-3 text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>رقم الشامل (SKU)</span>
                      {sortField === 'sku' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.barcode && (
                  <th onClick={() => handleSort('barcode')} className="hidden sm:table-cell px-4 py-3 text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>الباركود</span>
                      {sortField === 'barcode' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.category && (
                  <th onClick={() => handleSort('category')} className="px-4 py-3 text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>الفئة</span>
                      {sortField === 'category' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.price && (
                  <th onClick={() => handleSort('price')} className="px-4 py-3 text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>سعر البيع</span>
                      {sortField === 'price' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.cost_price && !hideCost && (
                  <th onClick={() => handleSort('cost_price')} className="px-4 py-3 text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>سعر التكلفة</span>
                      {sortField === 'cost_price' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.compare_price && (
                  <th onClick={() => handleSort('compare_price')} className="hidden lg:table-cell px-4 py-3 text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>قبل الخصم</span>
                      {sortField === 'compare_price' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.margin && (
                  <th onClick={() => handleSort('margin')} className="hidden md:table-cell px-4 py-3 text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>الربح المتوقع</span>
                      {sortField === 'margin' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.stock && (
                  <th onClick={() => handleSort('stock')} className="px-4 py-3 text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>المخزون</span>
                      {sortField === 'stock' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.sold_count && (
                  <th onClick={() => handleSort('sold_count')} className="hidden xl:table-cell px-4 py-3 text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>المبيعات</span>
                      {sortField === 'sold_count' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.status && (
                  <th onClick={() => handleSort('status')} className="px-4 py-3 text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>الظهور</span>
                      {sortField === 'status' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.created_at && (
                  <th onClick={() => handleSort('created_at')} className="hidden xl:table-cell px-4 py-3 text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>تاريخ الإضافة</span>
                      {sortField === 'created_at' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visible.map(p => {
                const skuCode = p.sku || p.shamel_code || ''
                const cost = Number(p.cost_price || 0)
                const price = Number(p.price || 0)
                const margin = price - cost
                const marginPercent = cost > 0 ? Math.round((margin / cost) * 100) : null
                const sold = sales[p.id] || 0

                return (
                  <tr key={p.id} className="hover:bg-white/3 transition-colors">
                    {visibleColumns.image && (
                      <td className="px-3 py-3 w-14">
                        {(() => {
                          const pImages = getProductImages(p)
                          const hasImages = pImages.length > 0
                          const thumb = pImages[0] || p.thumbnail_url

                          if (hasImages && thumb) {
                            return (
                              <button
                                type="button"
                                onClick={() => openLightbox(p, 0)}
                                className="group relative h-10 w-10 rounded-xl overflow-hidden border border-white/10 hover:border-sky-400 hover:ring-2 hover:ring-sky-400/30 transition-all focus:outline-none flex items-center justify-center bg-slate-900"
                                title={pImages.length > 1 ? `عرض الصور (${pImages.length} صور)` : 'عرض الصورة'}
                              >
                                <img
                                  src={thumb}
                                  alt={p.name}
                                  className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                                />
                                {pImages.length > 1 && (
                                  <span className="absolute bottom-0 right-0 bg-slate-950/80 px-1 py-0.2 rounded-tl text-[9px] font-bold text-sky-300 leading-tight">
                                    {pImages.length}
                                  </span>
                                )}
                              </button>
                            )
                          }

                          return (
                            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-slate-800 text-slate-500 font-mono text-sm border border-white/5">
                              📦
                            </div>
                          )
                        })()}
                      </td>
                    )}

                    {visibleColumns.name && (
                      <td className="px-4 py-3">
                        <div>
                          <Link
                            href={`/dashboard/products/${p.id}`}
                            className="font-semibold text-white hover:text-sky-400 transition-colors line-clamp-2"
                            title={p.name}
                          >
                            {p.name}
                          </Link>
                          {/* في الشاشات الصغيرة نظهر رقم الشامل تحت الاسم إن لم يكن العمود مفعلاً */}
                          {!visibleColumns.sku && skuCode && (
                            <span className="text-[11px] font-mono text-sky-400 mt-0.5 block">
                              شامل: {skuCode}
                            </span>
                          )}
                        </div>
                      </td>
                    )}

                    {visibleColumns.sku && (
                      <td className="px-4 py-3">
                        {skuCode ? (
                          <button
                            type="button"
                            onClick={() => copySku(skuCode)}
                            className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-2 py-0.5 text-xs font-mono font-bold text-sky-400 border border-sky-500/30 hover:bg-sky-500/25 transition-colors"
                            title="انقر لنسخ رقم الشامل"
                          >
                            <span className="text-[10px] text-sky-400/70">شامل</span>
                            <span>{skuCode}</span>
                            {copiedSku === skuCode && <span className="text-[10px] text-emerald-300 mr-1">✓ تم</span>}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
                    )}

                    {visibleColumns.barcode && (
                      <td className="hidden sm:table-cell px-4 py-3">
                        {p.barcode ? (
                          <span className="font-mono text-xs text-slate-400" dir="ltr">{p.barcode}</span>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </td>
                    )}

                    {visibleColumns.category && (
                      <td className="px-4 py-3 text-xs text-slate-300">
                        {p.categories?.name || <span className="text-slate-500">غير مصنف</span>}
                      </td>
                    )}

                    {visibleColumns.price && (
                      <td className="px-4 py-3 font-semibold text-white text-sm" dir="ltr">
                        {price.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyCode}
                      </td>
                    )}

                    {visibleColumns.cost_price && !hideCost && (
                      <td className="px-4 py-3 text-xs text-slate-300" dir="ltr">
                        {cost > 0 ? (
                          <span>{cost.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyCode}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    )}

                    {visibleColumns.compare_price && (
                      <td className="hidden lg:table-cell px-4 py-3 text-xs text-slate-400" dir="ltr">
                        {p.compare_price && Number(p.compare_price) > price ? (
                          <s className="text-rose-400/80">{Number(p.compare_price).toLocaleString('en-GB')} {currencyCode}</s>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    )}

                    {visibleColumns.margin && (
                      <td className="hidden md:table-cell px-4 py-3 text-xs" dir="ltr">
                        {hideCost ? (
                          <span className="font-mono tracking-widest text-slate-500 select-none text-xs" title="هامش الربح محجوب">
                            ••••••
                          </span>
                        ) : cost > 0 && price > 0 ? (
                          <span className={`font-medium ${margin >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {margin.toFixed(2)} {currencyCode}
                            {marginPercent !== null && <span className="text-[10px] text-slate-400 ml-1">({marginPercent}%)</span>}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    )}

                    {visibleColumns.stock && (
                      <td className="px-4 py-3">
                        {stockBadge(p)}
                      </td>
                    )}

                    {visibleColumns.sold_count && (
                      <td className="hidden xl:table-cell px-4 py-3 text-xs text-slate-300">
                        {sold > 0 ? (
                          <span className="text-sky-400 font-semibold">{sold.toLocaleString('ar-u-nu-latn')} قطعة</span>
                        ) : (
                          <span className="text-slate-500">0</span>
                        )}
                      </td>
                    )}

                    {visibleColumns.status && (
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${(STATUS_META[p.status] || STATUS_META.draft).badgeCls}`}>
                          {(STATUS_META[p.status] || STATUS_META.draft).label}
                        </span>
                        {p.status === 'active' && !p.is_active && (
                          <small className="block text-[10px] text-amber-400 mt-0.5">غير منشور</small>
                        )}
                      </td>
                    )}

                    {visibleColumns.created_at && (
                      <td className="hidden xl:table-cell px-4 py-3 text-xs text-slate-400">
                        {new Date(p.created_at).toLocaleDateString('ar-u-nu-latn')}
                      </td>
                    )}

                    {/* إجراءات الصنف */}
                    <td className="px-4 py-3 text-left">
                      <div className="flex items-center gap-1.5 justify-end">
                        <Link
                          href={`/dashboard/products/${p.id}`}
                          className="rounded-lg bg-sky-500/10 border border-sky-500/20 px-2.5 py-1 text-xs font-medium text-sky-400 hover:bg-sky-500/20 transition-colors"
                        >
                          تعديل
                        </Link>
                        <details className={styles.actions}>
                          <summary aria-label={`إجراءات ${p.name}`}>•••</summary>
                          <div>
                            <Link
                              href={`/dashboard/products/${p.id}`}
                              className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                            >
                              تفاصيل وتعديل
                            </Link>
                            <button
                              type="button"
                              disabled={preview || p.status === 'archived'}
                              onClick={() => toggleActive(p)}
                              className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors text-right"
                            >
                              {p.status === 'active' ? 'إخفاء من المتجر' : 'تفعيل بالمتجر'}
                            </button>
                            <button
                              type="button"
                              disabled={preview || !!duplicating[p.id]}
                              onClick={() => duplicateProduct(p)}
                              className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors text-right"
                            >
                              {duplicating[p.id] ? 'جاري النسخ…' : 'نسخ المنتج'}
                            </button>
                            <button
                              type="button"
                              disabled={preview}
                              onClick={() => setDeleteId(p.id)}
                              className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors text-right"
                            >
                              حذف الصنف
                            </button>
                          </div>
                        </details>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* شريط ترقيم الصفحات (20 صنف افتراضياً) */}
      {sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 mt-4 px-2 text-sm text-slate-400">
          <div className="flex items-center gap-2">
            <span>لكل صفحة:</span>
            <select
              aria-label="عدد الأصناف لكل صفحة"
              value={size}
              onChange={e => {
                setSize(Number(e.target.value))
                setPage(1)
              }}
              className="rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 outline-none"
            >
              {[10, 20, 50, 100].map(n => (
                <option key={n} value={n}>{n} صنف</option>
              ))}
            </select>
            <span>
              عرض {(currentPage - 1) * size + 1}–{Math.min(currentPage * size, sorted.length)} من {sorted.length.toLocaleString('ar-u-nu-latn')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              disabled={loadError || currentPage === 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
            >
              السابق
            </button>
            <span className="text-xs text-slate-300">
              {currentPage} / {pages}
            </span>
            <button
              disabled={loadError || currentPage === pages}
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
            >
              التالي
            </button>
          </div>
        </div>
      )}

      {/* نافذة تأكيد حذف صنف */}
      {deleteId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="حذف المنتج"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setDeleteId(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 text-center"
            onClick={e => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-2xl text-red-400">
              ⚠️
            </div>
            <h2 className="text-lg font-bold text-white">حذف المنتج نهائياً؟</h2>
            <p className="my-4 text-xs text-slate-400 leading-relaxed">
              لا يمكن التراجع عن هذا الإجراء بعد الحذف. يمكنك إخفاء المنتج بدلاً من ذلك للاحتفاظ بسجلاته ومعاملاته السابقة.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs text-slate-400 hover:text-white"
                onClick={() => setDeleteId(null)}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-xs font-semibold text-white hover:bg-red-400 disabled:opacity-50"
                disabled={deleting}
                onClick={() => confirmDelete(deleteId)}
              >
                {deleting ? 'جاري الحذف…' : 'تأكيد الحذف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة عرض وتصفح صور المنتج (Lightbox) */}
      {lightboxProduct && currentLightboxImages.length > 0 && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="معاينة صور المنتج"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 select-none animate-fadeIn"
          onClick={closeLightbox}
        >
          {/* شريط علوي: اسم المنتج، رقم الشامل، وزر الإغلاق */}
          <div
            className="absolute top-0 inset-x-0 p-4 sm:p-6 flex items-center justify-between z-20 bg-gradient-to-b from-black/80 via-black/40 to-transparent"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-col">
              <h2 className="text-base sm:text-lg font-bold text-white drop-shadow-md">
                {lightboxProduct.name}
              </h2>
              {(lightboxProduct.sku || lightboxProduct.shamel_code) && (
                <span className="text-xs font-mono text-sky-400 mt-0.5">
                  رقم الشامل: {lightboxProduct.sku || lightboxProduct.shamel_code}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={closeLightbox}
              className="flex items-center justify-center h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="إغلاق (Esc)"
              aria-label="إغلاق المعاينة"
            >
              <span className="text-xl leading-none">✕</span>
            </button>
          </div>

          {/* أزرار التنقل (يمين ويسار) إذا وُجدت أكثر من صورة */}
          {currentLightboxImages.length > 1 && (
            <>
              {/* زر الصورة السابقة (على اليمين في واجهات RTL) */}
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation()
                  setLightboxIndex(prev => (prev === 0 ? currentLightboxImages.length - 1 : prev - 1))
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center h-12 w-12 rounded-full bg-white/10 hover:bg-white/25 text-white shadow-xl transition-all border border-white/10 active:scale-95"
                title="الصورة السابقة (→)"
                aria-label="الصورة السابقة"
              >
                <span className="text-2xl font-bold">›</span>
              </button>

              {/* زر الصورة التالية (على اليسار في واجهات RTL) */}
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation()
                  setLightboxIndex(prev => (prev === currentLightboxImages.length - 1 ? 0 : prev + 1))
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center h-12 w-12 rounded-full bg-white/10 hover:bg-white/25 text-white shadow-xl transition-all border border-white/10 active:scale-95"
                title="الصورة التالية (←)"
                aria-label="الصورة التالية"
              >
                <span className="text-2xl font-bold">‹</span>
              </button>
            </>
          )}

          {/* حاوية الصورة المعروضة */}
          <div
            className="relative max-w-[90vw] max-h-[75vh] flex items-center justify-center my-auto"
            onClick={e => e.stopPropagation()}
          >
            <img
              src={currentLightboxImages[lightboxIndex]}
              alt={`${lightboxProduct.name} - صورة ${lightboxIndex + 1}`}
              className="max-w-full max-h-[75vh] object-contain rounded-2xl shadow-2xl transition-all"
            />

            {/* مؤشر ترقيم الصور */}
            {currentLightboxImages.length > 1 && (
              <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-slate-900/90 border border-white/10 text-white px-3 py-1 rounded-full text-xs font-mono font-medium shadow-lg">
                {lightboxIndex + 1} / {currentLightboxImages.length}
              </div>
            )}
          </div>

          {/* شريط مصغرات الصور في الأسفل عند توفر أكثر من صورة */}
          {currentLightboxImages.length > 1 && (
            <div
              className="absolute bottom-4 inset-x-0 flex items-center justify-center gap-2 z-20 px-4 overflow-x-auto py-2"
              onClick={e => e.stopPropagation()}
            >
              {currentLightboxImages.map((img, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setLightboxIndex(idx)}
                  className={`h-14 w-14 rounded-xl overflow-hidden border-2 transition-all shrink-0 bg-slate-900 ${
                    lightboxIndex === idx
                      ? 'border-sky-400 scale-105 shadow-lg shadow-sky-500/20 opacity-100 ring-2 ring-sky-400/30'
                      : 'border-white/20 opacity-60 hover:opacity-100'
                  }`}
                  aria-label={`الانتقال إلى الصورة ${idx + 1}`}
                >
                  <img src={img} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
