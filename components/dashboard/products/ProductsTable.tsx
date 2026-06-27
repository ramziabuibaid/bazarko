'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { uniqueSlug } from '@/lib/utils/slug'
import { trackAction } from '@/lib/activity/track'

interface Product {
  id: string
  name: string
  slug: string
  price: number
  compare_price: number | null
  cost_price: number | null
  stock_quantity: number
  stock_available: number
  status: string
  is_active: boolean
  is_featured: boolean
  thumbnail_url: string | null
  sku: string | null
  created_at: string
  categories: { id: string; name: string } | null
}

const STATUS_META: Record<string, { label: string; icon: string; badgeCls: string }> = {
  active:   { label: 'فعال',   icon: '✅', badgeCls: 'bg-emerald-500/10 text-emerald-400' },
  draft:    { label: 'مسودة',  icon: '✏️', badgeCls: 'bg-sky-500/10 text-sky-400'         },
  hidden:   { label: 'مخفي',   icon: '🙈', badgeCls: 'bg-amber-500/10 text-amber-400'     },
  archived: { label: 'مؤرشف',  icon: '📦', badgeCls: 'bg-slate-700 text-slate-400'        },
}

interface Props {
  products: Product[]
  categories: { id: string; name: string }[]
  storeId: string
  currencyCode: string
  filters: { q?: string; category?: string; status?: string; sort?: string }
}

export default function ProductsTable({ products: initial, categories, storeId, currencyCode, filters }: Props) {
  const router = useRouter()
  const [products, setProducts] = useState(initial)
  const [search, setSearch]     = useState(filters.q ?? '')
  const [category, setCategory] = useState(filters.category ?? '')
  const [status, setStatus]     = useState(filters.status ?? '')
  const [sort, setSort]         = useState(filters.sort ?? 'newest')
  const [deleteId, setDeleteId]   = useState<string | null>(null)
  const [deleting, setDeleting]   = useState(false)
  const [duplicating, setDuplicating] = useState<Record<string, boolean>>({})

  function applyFilters() {
    const params = new URLSearchParams()
    if (search)                params.set('q', search)
    if (category)              params.set('category', category)
    if (status)                params.set('status', status)
    if (sort && sort !== 'newest') params.set('sort', sort)
    router.push(`/dashboard/products?${params.toString()}`)
  }

  async function toggleActive(product: Product) {
    const next = product.status === 'active' ? 'hidden' : 'active'
    const supabase = createClient()
    await supabase.from('products').update({ status: next }).eq('id', product.id)
    trackAction(storeId, {
      action: 'status_change', entityType: 'product',
      entityId: product.id, entityLabel: product.name,
      details: { from: product.status, to: next },
    })
    setProducts(ps => ps.map(p => p.id === product.id ? { ...p, status: next, is_active: next === 'active' } : p))
  }

  async function duplicateProduct(product: Product) {
    setDuplicating(prev => ({ ...prev, [product.id]: true }))
    const supabase = createClient()

    const { data: full } = await supabase
      .from('products')
      .select('description, track_stock, allow_backorder, low_stock_alert, weight, dimensions, images, tags, metadata, barcode, cost_price, compare_price, category_id, video_url, secondary_price, secondary_currency_code')
      .eq('id', product.id)
      .single()

    const { data: copy, error } = await supabase
      .from('products')
      .insert({
        store_id:       storeId,
        name:           `نسخة - ${product.name}`,
        slug:           uniqueSlug(product.name),
        price:          product.price,
        compare_price:  full?.compare_price ?? product.compare_price ?? null,
        cost_price:     full?.cost_price ?? product.cost_price ?? null,
        category_id:    full?.category_id ?? null,
        description:    full?.description ?? null,
        sku:            null,
        barcode:        null,
        stock_quantity: 0,
        track_stock:    full?.track_stock ?? true,
        allow_backorder: full?.allow_backorder ?? false,
        low_stock_alert: full?.low_stock_alert ?? 5,
        weight:         full?.weight ?? null,
        dimensions:     full?.dimensions ?? null,
        images:         full?.images ?? [],
        thumbnail_url:  product.thumbnail_url,
        tags:           full?.tags ?? [],
        status:         'draft',
        is_featured:    false,
        metadata:       full?.metadata ?? {},
        video_url:      full?.video_url ?? null,
        secondary_price: full?.secondary_price ?? null,
        secondary_currency_code: full?.secondary_currency_code ?? null,
      })
      .select('id')
      .single()

    setDuplicating(prev => { const n = { ...prev }; delete n[product.id]; return n })

    if (!error && copy) {
      trackAction(storeId, {
        action: 'create', entityType: 'product',
        entityId: copy.id, entityLabel: `نسخة - ${product.name}`,
        details: { duplicatedFrom: product.id },
      })
      router.push(`/dashboard/products/${copy.id}`)
    }
  }

  async function confirmDelete(id: string) {
    setDeleting(true)
    const supabase = createClient()
    const deleted = products.find(p => p.id === id)
    await supabase.from('products').delete().eq('id', id)
    trackAction(storeId, {
      action: 'delete', entityType: 'product',
      entityId: id, entityLabel: deleted?.name ?? null,
    })
    setProducts(ps => ps.filter(p => p.id !== id))
    setDeleteId(null)
    setDeleting(false)
  }

  function stockBadge(qty: number) {
    if (qty <= 0) return <span className="whitespace-nowrap rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-400">نفد</span>
    if (qty < 5)  return <span className="whitespace-nowrap rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">{qty} متبقي</span>
    return <span className="text-sm text-slate-300">{qty}</span>
  }

  return (
    <>
      {/* ── Filters (ثابتة أعلى الصفحة عند التمرير) ── */}
      <div className="sticky top-0 z-20 mb-4 -mx-4 space-y-2 border-b border-white/5 bg-slate-950/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-slate-950/70 sm:-mx-6 sm:px-6">
        {/* سطر البحث + الزر */}
        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyFilters()}
            placeholder="بحث باسم المنتج..."
            className="flex-1 rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-right text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500"
          />
          <button
            onClick={applyFilters}
            className="shrink-0 rounded-xl bg-slate-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-600"
          >
            بحث
          </button>
        </div>
        {/* سطر الفلاتر */}
        <div className="flex gap-2">
          <select
            value={category}
            onChange={e => { setCategory(e.target.value); setTimeout(applyFilters, 0) }}
            className="flex-1 rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-right text-sm text-white outline-none focus:border-sky-500"
          >
            <option value="">كل الفئات</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={e => { setStatus(e.target.value); setTimeout(applyFilters, 0) }}
            className="flex-1 rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-right text-sm text-white outline-none focus:border-sky-500"
          >
            <option value="">كل الحالات</option>
            <option value="active">✅ فعال</option>
            <option value="draft">✏️ مسودة</option>
            <option value="hidden">🙈 مخفي</option>
            <option value="archived">📦 مؤرشف</option>
            <option value="low_stock">⚠️ مخزون منخفض</option>
            <option value="out_of_stock">🔴 نفد المخزون</option>
          </select>
          <select
            value={sort}
            onChange={e => { setSort(e.target.value); setTimeout(applyFilters, 0) }}
            className="flex-1 rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-right text-sm text-white outline-none focus:border-sky-500"
          >
            <option value="newest">الأحدث</option>
            <option value="oldest">الأقدم</option>
            <option value="price_high">الأعلى سعراً</option>
            <option value="price_low">الأقل سعراً</option>
            <option value="best_selling">الأكثر مبيعاً</option>
          </select>
        </div>
      </div>

      {/* ── Table ── */}
      {products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-12 text-center">
          <p className="text-slate-400">لا توجد منتجات</p>
          <Link href="/dashboard/products/new" className="mt-3 inline-block text-sm text-sky-400 hover:text-sky-300">
            أضف أول منتج
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full min-w-[680px] table-fixed text-right text-sm">
            <colgroup>
              <col className="w-[38%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead className="border-b border-white/5 bg-slate-900">
              <tr>
                <th className="px-4 py-3 text-right font-medium text-slate-400">المنتج</th>
                <th className="px-4 py-3 text-right font-medium text-slate-400">الفئة</th>
                <th className="px-4 py-3 text-right font-medium text-slate-400">السعر</th>
                <th className="px-4 py-3 text-right font-medium text-slate-400">المخزون</th>
                <th className="px-4 py-3 text-right font-medium text-slate-400">الحالة</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-slate-900/50">
              {products.map(product => (
                <tr key={product.id} className="hover:bg-white/[0.02]">

                  {/* المنتج: صورة + اسم */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 overflow-hidden">
                      {product.thumbnail_url ? (
                        <img
                          src={product.thumbnail_url}
                          alt={product.name}
                          className="h-10 w-10 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-lg">
                          🛍️
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-white">{product.name}</p>
                        {product.sku && (
                          <p className="truncate text-xs text-slate-500" dir="ltr">SKU: {product.sku}</p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* الفئة */}
                  <td className="px-4 py-3">
                    <span className="block truncate text-slate-400">
                      {product.categories?.name ?? '—'}
                    </span>
                  </td>

                  {/* السعر */}
                  <td className="px-4 py-3">
                    <span className="whitespace-nowrap font-medium text-white">
                      {product.price.toLocaleString('ar-u-nu-latn')}
                      <span className="mr-1 text-xs font-normal text-slate-500">{currencyCode}</span>
                    </span>
                    {product.compare_price && (
                      <p className="whitespace-nowrap text-xs text-slate-500 line-through">
                        {product.compare_price.toLocaleString('ar-u-nu-latn')}
                      </p>
                    )}
                  </td>

                  {/* المخزون */}
                  <td className="px-4 py-3">
                    {stockBadge(product.stock_available ?? product.stock_quantity)}
                  </td>

                  {/* الحالة */}
                  <td className="px-4 py-3">
                    {(() => {
                      const m = STATUS_META[product.status] ?? STATUS_META.draft
                      return (
                        <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${m.badgeCls}`}>
                          {m.icon} {m.label}
                        </span>
                      )
                    })()}
                  </td>

                  {/* الإجراءات */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {/* toggle: يعمل فقط بين active ↔ hidden */}
                      {product.status !== 'archived' && (
                        <button
                          onClick={() => toggleActive(product)}
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                          title={product.status === 'active' ? 'إخفاء مؤقت' : 'تفعيل'}
                        >
                          {product.status === 'active' ? '👁️' : '🙈'}
                        </button>
                      )}
                      <Link
                        href={`/dashboard/products/${product.id}`}
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                        title="تعديل"
                      >
                        ✏️
                      </Link>
                      <button
                        onClick={() => duplicateProduct(product)}
                        disabled={!!duplicating[product.id]}
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-violet-500/10 hover:text-violet-400 disabled:opacity-40"
                        title="نسخ المنتج"
                      >
                        {duplicating[product.id] ? (
                          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
                        ) : '⧉'}
                      </button>
                      <button
                        onClick={() => setDeleteId(product.id)}
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                        title="حذف"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Confirm Delete ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 text-center">
            <p className="text-white">هل تريد حذف هذا المنتج؟</p>
            <p className="mt-1 text-sm text-slate-400">هذا الإجراء لا يمكن التراجع عنه</p>
            <div className="mt-5 flex justify-center gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="rounded-xl border border-white/10 px-5 py-2 text-sm text-slate-400 hover:text-white"
              >
                إلغاء
              </button>
              <button
                onClick={() => confirmDelete(deleteId)}
                disabled={deleting}
                className="rounded-xl bg-red-500 px-5 py-2 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-50"
              >
                {deleting ? 'جاري الحذف...' : 'حذف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── زر إضافة عائم ── */}
      <Link
        href="/dashboard/products/new"
        title="منتج جديد"
        aria-label="إضافة منتج جديد"
        className="fixed bottom-6 left-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-sky-500 text-slate-950 shadow-lg shadow-sky-500/30 transition-transform hover:scale-105 hover:bg-sky-400"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </Link>
    </>
  )
}
