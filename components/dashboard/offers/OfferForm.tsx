'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { trackAction } from '@/lib/activity/track'

interface Product {
  id: string
  name: string
  price: number
  thumbnail_url: string | null
  stock_available: number | null
  category_id: string | null
}

interface Category { id: string; name: string }

interface OfferItemDraft {
  product_id: string
  offer_price: string
  max_quantity: string   // '' = غير محدود
  sold_quantity?: number // يُحافظ عليه عند إعادة بناء البنود في التعديل
}

interface OfferData {
  id?: string
  title: string
  description: string
  starts_at: string   // datetime-local format داخل النموذج، ISO عند القدوم من السيرفر
  ends_at: string
  is_active: boolean
  per_customer_limit: string   // '' = غير محدود
  items: OfferItemDraft[]
}

interface Props {
  storeId: string
  currencyCode: string
  products: Product[]
  categories: Category[]
  initialData?: OfferData
}

/** يحوّل ISO من قاعدة البيانات إلى صيغة datetime-local بالتوقيت المحلي */
function toLocalInput(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function OfferForm({ storeId, currencyCode, products, categories, initialData }: Props) {
  const router = useRouter()
  const isEditing = !!initialData?.id

  const [form, setForm] = useState<OfferData>(() =>
    initialData
      ? {
          ...initialData,
          starts_at: toLocalInput(initialData.starts_at),
          ends_at: toLocalInput(initialData.ends_at),
        }
      : {
          title: '', description: '',
          starts_at: toLocalInput(new Date().toISOString()),
          ends_at: toLocalInput(new Date(Date.now() + 7 * 86400000).toISOString()),
          is_active: true, per_customer_limit: '', items: [],
        }
  )
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [bulkDiscount, setBulkDiscount] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  const filtered = useMemo(() => {
    const q = search.trim()
    let list = products
    if (categoryFilter) list = list.filter(p => p.category_id === categoryFilter)
    if (q) list = list.filter(p => p.name.includes(q))
    return list
  }, [products, search, categoryFilter])

  function isSelected(productId: string) {
    return form.items.some(i => i.product_id === productId)
  }

  function toggleProduct(p: Product) {
    setError('')
    setForm(f => isSelected(p.id)
      ? { ...f, items: f.items.filter(i => i.product_id !== p.id) }
      : { ...f, items: [...f.items, { product_id: p.id, offer_price: '', max_quantity: '' }] }
    )
  }

  // إضافة كل المنتجات المعروضة حالياً (حسب الفئة/البحث) — لعروض "فئة كاملة"
  function selectAllFiltered() {
    setError('')
    setForm(f => {
      const existing = new Set(f.items.map(i => i.product_id))
      const additions = filtered
        .filter(p => !existing.has(p.id))
        .map(p => ({ product_id: p.id, offer_price: '', max_quantity: '' }))
      return { ...f, items: [...f.items, ...additions] }
    })
  }

  // إزالة كل المنتجات المعروضة حالياً
  function removeAllFiltered() {
    setError('')
    setForm(f => {
      const filteredIds = new Set(filtered.map(p => p.id))
      return { ...f, items: f.items.filter(i => !filteredIds.has(i.product_id)) }
    })
  }

  function setItemField(productId: string, field: 'offer_price' | 'max_quantity', value: string) {
    setError('')
    setForm(f => ({
      ...f,
      items: f.items.map(i => i.product_id === productId ? { ...i, [field]: value } : i),
    }))
  }

  function applyBulkDiscount() {
    const pct = parseFloat(bulkDiscount)
    if (isNaN(pct) || pct <= 0 || pct >= 100) {
      setError('أدخل نسبة خصم بين 1 و 99')
      return
    }
    setForm(f => ({
      ...f,
      items: f.items.map(i => {
        const product = productMap.get(i.product_id)
        if (!product) return i
        return { ...i, offer_price: (Math.round(product.price * (1 - pct / 100) * 100) / 100).toString() }
      }),
    }))
  }

  function discountPct(item: OfferItemDraft) {
    const product = productMap.get(item.product_id)
    const price = parseFloat(item.offer_price)
    if (!product || !product.price || isNaN(price)) return null
    return Math.round((1 - price / product.price) * 100)
  }

  async function handleSave() {
    setError('')
    if (!form.title.trim()) { setError('أدخل عنوان العرض'); return }
    if (!form.starts_at || !form.ends_at) { setError('حدد تاريخ البداية والنهاية'); return }
    if (new Date(form.ends_at) <= new Date(form.starts_at)) { setError('تاريخ النهاية يجب أن يكون بعد البداية'); return }
    if (!form.items.length) { setError('اختر منتجاً واحداً على الأقل'); return }

    for (const item of form.items) {
      const product = productMap.get(item.product_id)
      const price = parseFloat(item.offer_price)
      if (isNaN(price) || price <= 0) {
        setError(`أدخل سعر عرض صحيح لـ "${product?.name ?? 'منتج'}"`)
        return
      }
      if (product && price >= product.price) {
        setError(`سعر العرض لـ "${product.name}" يجب أن يكون أقل من السعر الأصلي (${product.price})`)
        return
      }
      if (item.max_quantity !== '' && (!Number.isInteger(Number(item.max_quantity)) || Number(item.max_quantity) <= 0)) {
        setError(`كمية العرض لـ "${product?.name ?? 'منتج'}" يجب أن تكون رقماً صحيحاً موجباً`)
        return
      }
    }

    if (form.per_customer_limit !== '' && (!Number.isInteger(Number(form.per_customer_limit)) || Number(form.per_customer_limit) <= 0)) {
      setError('حد الزبون يجب أن يكون رقماً صحيحاً موجباً')
      return
    }

    setSaving(true)
    const supabase = createClient()

    const offerPayload = {
      store_id: storeId,
      title: form.title.trim(),
      description: form.description.trim() || null,
      starts_at: new Date(form.starts_at).toISOString(),
      ends_at: new Date(form.ends_at).toISOString(),
      is_active: form.is_active,
      per_customer_limit: form.per_customer_limit === '' ? null : Number(form.per_customer_limit),
      updated_at: new Date().toISOString(),
    }

    let offerId = initialData?.id
    if (isEditing && offerId) {
      const { error: err } = await supabase.from('offers').update(offerPayload).eq('id', offerId)
      if (err) { setError(err.message); setSaving(false); return }
      // إعادة بناء البنود — أبسط وأضمن من المقارنة
      const { error: delErr } = await supabase.from('offer_items').delete().eq('offer_id', offerId)
      if (delErr) { setError(delErr.message); setSaving(false); return }
    } else {
      const { data, error: err } = await supabase.from('offers').insert(offerPayload).select('id').single()
      if (err || !data) { setError(err?.message ?? 'فشل إنشاء العرض'); setSaving(false); return }
      offerId = data.id
    }

    const { error: itemsErr } = await supabase.from('offer_items').insert(
      form.items.map(i => ({
        offer_id: offerId,
        product_id: i.product_id,
        offer_price: parseFloat(i.offer_price),
        max_quantity: i.max_quantity === '' ? null : Number(i.max_quantity),
        sold_quantity: i.sold_quantity ?? 0,
      }))
    )
    if (itemsErr) { setError(itemsErr.message); setSaving(false); return }

    trackAction(storeId, {
      action: isEditing ? 'update' : 'create', entityType: 'offer',
      entityId: offerId ?? null, entityLabel: offerPayload.title,
      details: { items: form.items.length, is_active: offerPayload.is_active },
    })

    router.push('/dashboard/offers')
    router.refresh()
  }

  async function handleDelete() {
    if (!initialData?.id) return
    if (!confirm('حذف هذا العرض نهائياً؟')) return
    setDeleting(true)
    const supabase = createClient()
    const { error: err } = await supabase.from('offers').delete().eq('id', initialData.id)
    if (err) { setError(err.message); setDeleting(false); return }
    trackAction(storeId, {
      action: 'delete', entityType: 'offer',
      entityId: initialData.id, entityLabel: form.title,
    })
    router.push('/dashboard/offers')
    router.refresh()
  }

  const selectedItems = form.items
    .map(i => ({ item: i, product: productMap.get(i.product_id) }))
    .filter((x): x is { item: OfferItemDraft; product: Product } => !!x.product)

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* بيانات العرض */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="mb-4 font-semibold text-white">بيانات العرض</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">عنوان العرض *</label>
            <input
              value={form.title}
              onChange={e => { setForm(f => ({ ...f, title: e.target.value })); setError('') }}
              placeholder="مثال: عروض نهاية الأسبوع 🔥"
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">وصف قصير</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              placeholder="خصومات تصل إلى 50% على منتجات مختارة"
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm text-slate-400">يبدأ في *</label>
              <input
                type="datetime-local"
                value={form.starts_at}
                onChange={e => { setForm(f => ({ ...f, starts_at: e.target.value })); setError('') }}
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-slate-400">ينتهي في *</label>
              <input
                type="datetime-local"
                value={form.ends_at}
                onChange={e => { setForm(f => ({ ...f, ends_at: e.target.value })); setError('') }}
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm text-slate-400">الحد الأقصى لكل زبون (اختياري)</label>
              <input
                type="number"
                min="1"
                value={form.per_customer_limit}
                onChange={e => { setForm(f => ({ ...f, per_customer_limit: e.target.value })); setError('') }}
                placeholder="غير محدود"
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500"
              />
              <p className="mt-1 text-xs text-slate-500">يمنع زبوناً واحداً من شراء كل الكمية المخفّضة</p>
            </div>
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                className="h-4 w-4 rounded border-white/20 bg-slate-950 accent-sky-500"
              />
              العرض مفعّل
            </label>
          </div>
        </div>
      </div>

      {/* المنتجات المختارة */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-white">
            منتجات العرض <span className="text-sm font-normal text-slate-500">({form.items.length})</span>
          </h2>
          {form.items.length > 0 && (
            <div className="flex items-center gap-2">
              <input
                value={bulkDiscount}
                onChange={e => setBulkDiscount(e.target.value)}
                type="number"
                min="1"
                max="99"
                placeholder="خصم %"
                className="w-24 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
              />
              <button
                type="button"
                onClick={applyBulkDiscount}
                className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5"
              >
                تطبيق على الكل
              </button>
            </div>
          )}
        </div>

        {selectedItems.length > 0 && (
          <div className="mb-5 space-y-2">
            {selectedItems.map(({ item, product }) => {
              const pct = discountPct(item)
              return (
                <div key={item.product_id} className="flex flex-col gap-3 rounded-xl border border-white/5 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    {product.thumbnail_url ? (
                      <img src={product.thumbnail_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-lg">🛍️</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-white">{product.name}</p>
                      <p className="text-xs text-slate-500">
                        السعر الأصلي: {product.price.toLocaleString('ar-u-nu-latn')} {currencyCode}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={item.offer_price}
                      onChange={e => setItemField(item.product_id, 'offer_price', e.target.value)}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="سعر العرض"
                      className="w-24 sm:w-28 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
                    />
                    <input
                      value={item.max_quantity}
                      onChange={e => setItemField(item.product_id, 'max_quantity', e.target.value)}
                      type="number"
                      min="1"
                      placeholder="الكمية"
                      title="كمية محدودة للعرض — اتركها فارغة لغير محدود"
                      className="flex-1 sm:w-20 sm:flex-none rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
                    />
                    {pct !== null && pct > 0 && pct < 100 && (
                      <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-400">
                        -{pct}%
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleProduct(product)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                      aria-label="إزالة"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* اختيار المنتجات */}
        {categories.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCategoryFilter(null)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                categoryFilter === null ? 'bg-sky-500 text-slate-950' : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              الكل
            </button>
            {categories.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryFilter(categoryFilter === c.id ? null : c.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  categoryFilter === c.id ? 'bg-sky-500 text-slate-950' : 'bg-white/5 text-slate-400 hover:bg-white/10'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        <div className="mb-3 flex gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث عن منتج لإضافته..."
            className="flex-1 rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500"
          />
          {filtered.length > 0 && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAllFiltered}
                title="إضافة كل المنتجات المعروضة"
                className="shrink-0 rounded-xl border border-white/10 px-3 py-2.5 text-xs text-slate-300 hover:bg-white/5"
              >
                + إضافة الكل ({filtered.length})
              </button>
              <button
                type="button"
                onClick={removeAllFiltered}
                title="إزالة كل المنتجات المعروضة من العرض"
                className="shrink-0 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-400 hover:bg-red-500/20"
              >
                - إزالة الكل
              </button>
            </div>
          )}
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">لا توجد منتجات مطابقة</p>
          ) : (
            filtered.map(p => {
              const selected = isSelected(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleProduct(p)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-right transition ${
                    selected
                      ? 'border-sky-500/40 bg-sky-500/10'
                      : 'border-transparent hover:bg-white/5'
                  }`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs ${
                    selected ? 'border-sky-500 bg-sky-500 text-slate-950' : 'border-white/20 text-transparent'
                  }`}>
                    ✓
                  </span>
                  {p.thumbnail_url ? (
                    <img src={p.thumbnail_url} alt="" className="h-9 w-9 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-base">🛍️</div>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{p.name}</span>
                  <span className="text-xs text-slate-500">{p.price.toLocaleString('ar-u-nu-latn')} {currencyCode}</span>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* الأزرار */}
      <div className="sticky bottom-4 z-10 flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow-2xl backdrop-blur-xl">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-xl bg-sky-500 px-6 py-2.5 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50"
        >
          {saving ? 'جارٍ الحفظ...' : isEditing ? 'حفظ التعديلات' : 'إنشاء العرض'}
        </button>
        {isEditing && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-xl border border-red-500/20 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
          >
            {deleting ? 'جارٍ الحذف...' : 'حذف العرض'}
          </button>
        )}
      </div>
    </div>
  )
}
