'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { generateSlug } from '@/lib/utils/slug'
import { uploadProductImage, deleteProductImage } from '@/lib/supabase/storage'

interface Category { id: string; name: string }

interface ProductData {
  id?: string
  name: string
  slug: string
  description: string
  sku: string
  barcode: string
  category_id: string
  price: string
  compare_price: string
  cost_price: string
  stock_quantity: string
  low_stock_alert: string
  track_stock: boolean
  allow_backorder: boolean
  is_active: boolean
  is_featured: boolean
  images: string[]
  tags: string
}

interface Props {
  storeId: string
  currencyCode: string
  categories: Category[]
  initialData?: Partial<ProductData> & { id?: string }
}

const EMPTY: ProductData = {
  name: '', slug: '', description: '', sku: '', barcode: '',
  category_id: '', price: '', compare_price: '', cost_price: '',
  stock_quantity: '0', low_stock_alert: '5',
  track_stock: true, allow_backorder: false,
  is_active: true, is_featured: false,
  images: [], tags: '',
}

export default function ProductForm({ storeId, currencyCode, categories, initialData }: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const isEditing = !!initialData?.id

  const [form, setForm] = useState<ProductData>({ ...EMPTY, ...initialData })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  function set(field: keyof ProductData, value: string | boolean | string[]) {
    setForm(f => ({ ...f, [field]: value }))
    setError('')
  }

  function handleName(name: string) {
    setForm(f => ({
      ...f,
      name,
      slug: isEditing ? f.slug : generateSlug(name),
    }))
  }

  async function handleImageUpload(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    const urls: string[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > 5 * 1024 * 1024) {
        setError(`الصورة ${file.name} أكبر من 5MB`)
        continue
      }
      try {
        const url = await uploadProductImage(storeId, file)
        urls.push(url)
      } catch {
        setError('فشل رفع الصورة، تأكد من إنشاء bucket بسم product-images في Supabase Storage')
      }
    }
    if (urls.length) {
      setForm(f => ({
        ...f,
        images: [...f.images, ...urls],
        thumbnail_url: f.images[0] ?? urls[0],
      } as ProductData))
    }
    setUploading(false)
  }

  async function removeImage(url: string) {
    await deleteProductImage(url)
    setForm(f => ({ ...f, images: f.images.filter(i => i !== url) }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('اسم المنتج مطلوب'); return }
    if (!form.price) { setError('السعر مطلوب'); return }

    setSaving(true)
    setError('')
    const supabase = createClient()

    const payload = {
      store_id: storeId,
      name: form.name.trim(),
      slug: form.slug || generateSlug(form.name),
      description: form.description || null,
      sku: form.sku || null,
      barcode: form.barcode || null,
      category_id: form.category_id || null,
      price: parseFloat(form.price),
      compare_price: form.compare_price ? parseFloat(form.compare_price) : null,
      cost_price: form.cost_price ? parseFloat(form.cost_price) : null,
      stock_quantity: parseInt(form.stock_quantity) || 0,
      low_stock_alert: parseInt(form.low_stock_alert) || 5,
      track_stock: form.track_stock,
      allow_backorder: form.allow_backorder,
      is_active: form.is_active,
      is_featured: form.is_featured,
      images: form.images,
      thumbnail_url: form.images[0] ?? null,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    }

    if (isEditing) {
      const { error: err } = await supabase
        .from('products')
        .update(payload)
        .eq('id', initialData!.id!)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await supabase.from('products').insert(payload)
      if (err) {
        setError(err.message.includes('duplicate') ? 'يوجد منتج بنفس الرابط (slug)' : err.message)
        setSaving(false)
        return
      }
    }

    router.push('/dashboard/products')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-6">

      {/* ── المعلومات الأساسية ── */}
      <Section title="المعلومات الأساسية">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>اسم المنتج <Required /></Label>
            <input
              value={form.name}
              onChange={e => handleName(e.target.value)}
              placeholder="مثال: قميص قطني أبيض"
              className={input()}
            />
          </div>

          <div className="sm:col-span-2">
            <Label>الوصف</Label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={3}
              placeholder="وصف تفصيلي للمنتج..."
              className={input('resize-none')}
            />
          </div>

          <div>
            <Label>رمز SKU</Label>
            <input value={form.sku} onChange={e => set('sku', e.target.value)}
              placeholder="SHIRT-WHT-M" dir="ltr" className={input()} />
          </div>

          <div>
            <Label>الباركود</Label>
            <input value={form.barcode} onChange={e => set('barcode', e.target.value)}
              placeholder="1234567890" dir="ltr" className={input()} />
          </div>

          <div>
            <Label>الرابط (slug)</Label>
            <input
              value={form.slug}
              onChange={e => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              dir="ltr"
              className={input()}
            />
          </div>

          <div>
            <Label>الفئة</Label>
            <select value={form.category_id} onChange={e => set('category_id', e.target.value)} className={input()}>
              <option value="">— بدون فئة —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </Section>

      {/* ── التسعير ── */}
      <Section title="التسعير">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label>السعر <Required /></Label>
            <div className="relative">
              <input
                type="number" min="0" step="0.01"
                value={form.price} onChange={e => set('price', e.target.value)}
                placeholder="0.00" dir="ltr"
                className={input('pl-16')}
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{currencyCode}</span>
            </div>
          </div>
          <div>
            <Label>السعر قبل الخصم</Label>
            <div className="relative">
              <input
                type="number" min="0" step="0.01"
                value={form.compare_price} onChange={e => set('compare_price', e.target.value)}
                placeholder="0.00" dir="ltr"
                className={input('pl-16')}
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{currencyCode}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">يظهر مشطوباً في المتجر</p>
          </div>
          <div>
            <Label>سعر التكلفة</Label>
            <div className="relative">
              <input
                type="number" min="0" step="0.01"
                value={form.cost_price} onChange={e => set('cost_price', e.target.value)}
                placeholder="0.00" dir="ltr"
                className={input('pl-16')}
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{currencyCode}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">مخفي عن الزبائن — لحساب الأرباح</p>
          </div>
        </div>
      </Section>

      {/* ── المخزون ── */}
      <Section title="المخزون">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>الكمية المتوفرة</Label>
            <input
              type="number" min="0"
              value={form.stock_quantity} onChange={e => set('stock_quantity', e.target.value)}
              dir="ltr" className={input()}
            />
          </div>
          <div>
            <Label>حد تنبيه المخزون المنخفض</Label>
            <input
              type="number" min="0"
              value={form.low_stock_alert} onChange={e => set('low_stock_alert', e.target.value)}
              dir="ltr" className={input()}
            />
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <Toggle
            label="تتبع المخزون"
            description="يمنع البيع تلقائياً عند نفاد الكمية"
            checked={form.track_stock}
            onChange={v => set('track_stock', v)}
          />
          <Toggle
            label="السماح بالطلب عند النفاد"
            description="الزبون يطلب حتى لو نفد المخزون"
            checked={form.allow_backorder}
            onChange={v => set('allow_backorder', v)}
          />
        </div>
      </Section>

      {/* ── الصور ── */}
      <Section title="صور المنتج">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => handleImageUpload(e.target.files)}
        />

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {form.images.map((url, i) => (
            <div key={url} className="group relative aspect-square">
              <img src={url} alt="" className="h-full w-full rounded-xl object-cover" />
              {i === 0 && (
                <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">رئيسية</span>
              )}
              <button
                type="button"
                onClick={() => removeImage(url)}
                className="absolute left-1 top-1 hidden rounded-full bg-red-500 p-0.5 text-white group-hover:flex"
              >
                ✕
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex aspect-square flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/10 text-slate-400 hover:border-sky-500 hover:text-sky-400 disabled:opacity-50"
          >
            {uploading ? (
              <span className="text-xs">جاري الرفع...</span>
            ) : (
              <>
                <span className="text-2xl">+</span>
                <span className="mt-1 text-xs">رفع صورة</span>
              </>
            )}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">الصورة الأولى ستكون الصورة الرئيسية — حد 5MB للصورة الواحدة</p>
      </Section>

      {/* ── الوسوم والحالة ── */}
      <Section title="الوسوم والحالة">
        <div className="mb-4">
          <Label>الوسوم (tags)</Label>
          <input
            value={form.tags}
            onChange={e => set('tags', e.target.value)}
            placeholder="قمصان, رجالي, صيف (مفصولة بفاصلة)"
            className={input()}
          />
        </div>
        <div className="space-y-3">
          <Toggle
            label="منتج نشط"
            description="يظهر في المتجر للزبائن"
            checked={form.is_active}
            onChange={v => set('is_active', v)}
          />
          <Toggle
            label="منتج مميز"
            description="يظهر في قسم المنتجات المميزة"
            checked={form.is_featured}
            onChange={v => set('is_featured', v)}
          />
        </div>
      </Section>

      {error && (
        <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* ── أزرار الحفظ ── */}
      <div className="flex justify-end gap-3 pb-8">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-xl border border-white/10 px-6 py-2.5 text-sm text-slate-400 hover:text-white"
        >
          إلغاء
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-sky-500 px-8 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
        >
          {saving ? 'جاري الحفظ...' : isEditing ? 'حفظ التغييرات' : 'إضافة المنتج'}
        </button>
      </div>
    </form>
  )
}

// ── مكونات مساعدة صغيرة ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/5 bg-slate-900 p-5">
      <h2 className="mb-4 text-sm font-medium text-slate-400 uppercase tracking-wide">{title}</h2>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-sm text-slate-300">{children}</label>
}

function Required() {
  return <span className="text-red-400"> *</span>
}

function input(extra = '') {
  return `w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-right text-white placeholder-slate-500 outline-none focus:border-sky-500 ${extra}`
}

function Toggle({
  label, description, checked, onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <div>
        <p className="text-sm text-white">{label}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${checked ? 'bg-sky-500' : 'bg-slate-700'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </label>
  )
}
