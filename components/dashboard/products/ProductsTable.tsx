'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface Product {
  id: string
  name: string
  slug: string
  price: number
  compare_price: number | null
  cost_price: number | null
  stock_quantity: number
  stock_available: number
  is_active: boolean
  is_featured: boolean
  thumbnail_url: string | null
  sku: string | null
  created_at: string
  categories: { id: string; name: string } | null
}

interface Props {
  products: Product[]
  categories: { id: string; name: string }[]
  storeId: string
  currencyCode: string
  filters: { q?: string; category?: string; status?: string }
}

export default function ProductsTable({ products: initial, categories, storeId, currencyCode, filters }: Props) {
  const router = useRouter()
  const [products, setProducts] = useState(initial)
  const [search, setSearch]     = useState(filters.q ?? '')
  const [category, setCategory] = useState(filters.category ?? '')
  const [status, setStatus]     = useState(filters.status ?? '')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  function applyFilters() {
    const params = new URLSearchParams()
    if (search)   params.set('q', search)
    if (category) params.set('category', category)
    if (status)   params.set('status', status)
    router.push(`/dashboard/products?${params.toString()}`)
  }

  async function toggleActive(product: Product) {
    const supabase = createClient()
    await supabase.from('products').update({ is_active: !product.is_active }).eq('id', product.id)
    setProducts(ps => ps.map(p => p.id === product.id ? { ...p, is_active: !p.is_active } : p))
  }

  async function confirmDelete(id: string) {
    setDeleting(true)
    const supabase = createClient()
    await supabase.from('products').delete().eq('id', id)
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
      {/* ── Filters ── */}
      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyFilters()}
            placeholder="بحث باسم المنتج..."
            className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-right text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500"
          />
          <select
            value={category}
            onChange={e => { setCategory(e.target.value); setTimeout(applyFilters, 0) }}
            className="rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500"
          >
            <option value="">كل الفئات</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={e => { setStatus(e.target.value); setTimeout(applyFilters, 0) }}
            className="rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500"
          >
            <option value="">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="inactive">مخفي</option>
            <option value="low_stock">مخزون منخفض</option>
            <option value="out_of_stock">نفد المخزون</option>
          </select>
        </div>
        <button
          onClick={applyFilters}
          className="w-full rounded-xl bg-slate-700 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-600"
        >
          بحث
        </button>
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
                      {product.price.toLocaleString('ar')}
                      <span className="mr-1 text-xs font-normal text-slate-500">{currencyCode}</span>
                    </span>
                    {product.compare_price && (
                      <p className="whitespace-nowrap text-xs text-slate-500 line-through">
                        {product.compare_price.toLocaleString('ar')}
                      </p>
                    )}
                  </td>

                  {/* المخزون */}
                  <td className="px-4 py-3">
                    {stockBadge(product.stock_available ?? product.stock_quantity)}
                  </td>

                  {/* الحالة */}
                  <td className="px-4 py-3">
                    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${
                      product.is_active
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-slate-700 text-slate-400'
                    }`}>
                      {product.is_active ? 'نشط' : 'مخفي'}
                    </span>
                  </td>

                  {/* الإجراءات */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => toggleActive(product)}
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                        title={product.is_active ? 'إخفاء' : 'تفعيل'}
                      >
                        {product.is_active ? '👁️' : '🙈'}
                      </button>
                      <Link
                        href={`/dashboard/products/${product.id}`}
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                        title="تعديل"
                      >
                        ✏️
                      </Link>
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
    </>
  )
}
