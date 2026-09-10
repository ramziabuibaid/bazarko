'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Brand {
  id: string
  store_id: string
  name: string
  slug: string
  logo_url: string | null
  description: string | null
  is_active: boolean
  sort_order: number
}

interface Props {
  store: { id: string; name: string; currency_code: string }
  initialBrands: Brand[]
}

export default function BrandsClient({ store, initialBrands }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [brands, setBrands] = useState<Brand[]>(initialBrands)
  const [showAddModal, setShowAddModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
  })

  const handleNameChange = (name: string) => {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\u0621-\u064A-]/g, '')
      .slice(0, 40)
    setFormData(prev => ({ ...prev, name, slug }))
  }

  const handleCreateBrand = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      setError('يرجى إدخال اسم الماركة')
      return
    }

    setLoading(true)
    setError('')

    try {
      const { data: newBrand, error: insertErr } = await supabase
        .from('brands')
        .insert({
          store_id: store.id,
          name: formData.name.trim(),
          slug: formData.slug || `brand-${Date.now()}`,
          description: formData.description.trim() || null,
          is_active: true,
        })
        .select('*')
        .single()

      if (insertErr) throw insertErr

      setBrands(prev => [...prev, newBrand])
      setShowAddModal(false)
      setFormData({ name: '', slug: '', description: '' })
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'فشل حفظ الماركة')
    } finally {
      setLoading(false)
    }
  }

  const filteredBrands = brands.filter(b => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return b.name.toLowerCase().includes(q) || (b.description || '').toLowerCase().includes(q)
  })

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>🏷️</span> دليل الماركات والبراندات (Brands)
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            تصنيف المنتجات حسب الشركات والماركات العالمية والمحلية
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/inventory"
            className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
          >
            ← العودة للمخزون
          </Link>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-400 transition"
          >
            ➕ إضافة ماركة جديدة
          </button>
        </div>
      </div>

      {/* ── Search Bar ── */}
      <div className="relative w-full sm:w-80">
        <input
          type="text"
          placeholder="بحث باسم الماركة..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-right text-xs text-white placeholder-slate-500 outline-none focus:border-sky-500"
        />
      </div>

      {/* ── Brands Grid ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {filteredBrands.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-white/10 bg-slate-900 p-12 text-center text-slate-500">
            <p className="text-4xl mb-3">🏷️</p>
            <p className="text-base font-bold text-white">لا توجد ماركات معرفة</p>
            <p className="mt-1 text-xs text-slate-400">أضف الماركات لربط المنتجات بها واستخدامها في فلترة المتجر والـ POS</p>
          </div>
        ) : (
          filteredBrands.map(brand => (
            <div
              key={brand.id}
              className="flex flex-col justify-between rounded-2xl border border-white/10 bg-slate-900 p-5 hover:border-sky-500/40 transition shadow-lg"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-sky-500/10 px-2.5 py-0.5 text-[10px] font-bold text-sky-400 border border-sky-500/20">
                    ماركة معتمدة
                  </span>
                  <span className="text-slate-500 text-xs">#{brand.slug}</span>
                </div>

                <h3 className="mt-3 text-lg font-bold text-white">{brand.name}</h3>
                {brand.description && (
                  <p className="mt-1 text-xs text-slate-400 line-clamp-2">{brand.description}</p>
                )}
              </div>

              <div className="mt-4 border-t border-white/5 pt-3 flex justify-between items-center text-xs">
                <span className="text-emerald-400 font-bold">✅ مفعلة</span>
                <Link
                  href={`/dashboard/products?brand_id=${brand.id}`}
                  className="text-sky-400 hover:underline font-medium"
                >
                  عرض الأصناف ←
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Modal: إضافة ماركة جديدة ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>🏷️</span> إضافة ماركة جديدة
            </h2>

            {error && <div className="mt-3 rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">{error}</div>}

            <form onSubmit={handleCreateBrand} className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">اسم الماركة / البراند *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => handleNameChange(e.target.value)}
                  placeholder="مثال: Apple, Samsung, Bosch, Zara"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">الرابط الفرعي (Slug)</label>
                <input
                  type="text"
                  value={formData.slug}
                  onChange={e => setFormData({ ...formData, slug: e.target.value })}
                  placeholder="apple"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">الوصف (اختياري)</label>
                <textarea
                  rows={2}
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-bold text-slate-400 hover:bg-slate-800 transition"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded-xl bg-sky-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-sky-400 transition disabled:opacity-50"
                >
                  {loading ? 'جارٍ الحفظ...' : 'حفظ الماركة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
