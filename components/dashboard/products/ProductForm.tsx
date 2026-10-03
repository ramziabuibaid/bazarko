'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import {validateProductForm} from '@/lib/products/form-validation'
import styles from './product-form.module.css'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { generateSlug } from '@/lib/utils/slug'
import { uploadProductImage } from '@/lib/supabase/storage'
import { trackAction, diffFields } from '@/lib/activity/track'

interface Category { id: string; name: string }


interface Spec { name: string; value: string }

interface ProductData {
  id?: string
  name: string
  slug: string
  description: string
  sku: string
  barcode: string
  brand_id: string
  category_id: string
  price: string
  compare_price: string
  cost_price: string
  price_secondary: string
  stock_quantity: string
  low_stock_alert: string
  track_stock: boolean
  allow_backorder: boolean
  status: string
  is_featured: boolean
  images: string[]
  tags: string
  video_url: string
  specifications: Spec[]
}

interface AttributeDef { id: string; name: string; values: { id: string; value: string }[] }

interface Props {
  storeId: string
  currencyCode: string
  secondaryCurrencyCode?: string | null
  exchangeRate?: number | null
  categories: Category[]
  brands?: {id:string;name:string;is_active:boolean}[]
  attributes?: AttributeDef[]
  preview?:boolean
  initialData?: Partial<ProductData> & { id?: string; attributeValueIds?: string[] }
}

const EMPTY: ProductData = {
  name: '', slug: '', description: '', sku: '', barcode: '',
  brand_id: '', category_id: '', price: '', compare_price: '', cost_price: '',
  price_secondary: '',
  stock_quantity: '0', low_stock_alert: '5',
  track_stock: true, allow_backorder: false,
  status: 'active', is_featured: false,
  images: [], tags: '', video_url: '',
  specifications: [],
}

export default function ProductForm({ storeId, currencyCode, secondaryCurrencyCode, exchangeRate, categories, brands = [], attributes = [], initialData, preview=false }: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const isEditing = !!initialData?.id
  const persistedId = useRef(initialData?.id || null)
  const submitLock = useRef(false)
  const [uncertain,setUncertain]=useState(false)

  const [form, setForm] = useState<ProductData>({ ...EMPTY, ...initialData })
  const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set(initialData?.attributeValueIds ?? []))

  function toggleValue(id: string) {
    setSelectedValues(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  // إدارة الفئات بشكل محلي للسماح بالإضافة الفورية
  const [cats, setCats] = useState<Category[]>(categories)
  const [addingCat, setAddingCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [addingCatLoading, setAddingCatLoading] = useState(false)

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

  function handleGenerateSku() {
    const catName = cats.find(c => c.id === form.category_id)?.name
    const catCode = catName
      ? generateSlug(catName).replace(/-/g, '').slice(0, 4).toUpperCase()
      : 'PRD'
    const nameCode = generateSlug(form.name).replace(/-/g, '').slice(0, 6).toUpperCase()
    const num = Math.floor(Math.random() * 900 + 100)
    set('sku', `${catCode}-${nameCode || 'ITEM'}-${num}`)
  }

  async function handleAddCategory() {
    const trimmed = newCatName.trim()
    if (!trimmed) return
    if(preview){setError('إضافة الفئة معطلة في المعاينة');return}
    setAddingCatLoading(true)
    setError('')
    const supabase = createClient()
    const slug = generateSlug(trimmed) || `cat-${Date.now()}`
    const { data, error: err } = await supabase
      .from('categories')
      .insert({ store_id: storeId, name: trimmed, slug, is_active: true })
      .select('id, name')
      .single()
    setAddingCatLoading(false)
    if (err || !data) {
      setError(err?.message.includes('duplicate') ? 'توجد فئة بنفس الاسم' : (err?.message ?? 'فشل إضافة الفئة'))
      return
    }
    setCats(c => [...c, data])
    set('category_id', data.id)
    setAddingCat(false)
    setNewCatName('')
  }

  async function handleImageUpload(files: FileList | null) {
    if (!files?.length) return
    if(preview){setError('رفع الصور معطل في المعاينة');return}
    setUploading(true)
    const urls: string[] = []
    for (const file of Array.from(files)) {
      if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)){setError('اختر صورة JPG أو PNG أو WebP أو GIF');continue}
      if (file.size > 5 * 1024 * 1024) {
        setError(`الصورة ${file.name} أكبر من 5MB`)
        continue
      }
      try {
        const url = await uploadProductImage(storeId, file)
        urls.push(url)
      } catch {
        setError('تعذر رفع الصورة. حاول مرة أخرى.')
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
    // إزالة الصورة من النموذج فقط؛ لا نحذف ملفاً قد يستخدمه منتج آخر.
    setForm(f => ({ ...f, images: f.images.filter(i => i !== url) }))
  }

  function addSpec() {
    setForm(f => ({ ...f, specifications: [...f.specifications, { name: '', value: '' }] }))
  }
  function updateSpec(idx: number, field: keyof Spec, value: string) {
    setForm(f => {
      const specs = [...f.specifications]
      specs[idx] = { ...specs[idx], [field]: value }
      return { ...f, specifications: specs }
    })
  }
  function removeSpec(idx: number) {
    setForm(f => ({ ...f, specifications: f.specifications.filter((_, i) => i !== idx) }))
  }

  async function handleSubmit(e: React.FormEvent,statusOverride?:string) {
    e.preventDefault()
    if(submitLock.current||uploading||uncertain)return
    const validation=validateProductForm({...form,status:statusOverride||form.status},!!persistedId.current)
    if(validation){setError(validation);return}
    if(preview){setError('الحفظ معطل في المعاينة؛ لم تُعدّل بيانات.');return}
    submitLock.current=true
    try {

    setSaving(true)
    setError('')
    const supabase = createClient()

    if(form.brand_id){const {data:brand,error:brandError}=await supabase.from('brands').select('id,is_active').eq('id',form.brand_id).eq('store_id',storeId).maybeSingle();if(brandError||!brand||(!brand.is_active&&form.brand_id!==initialData?.brand_id)){setError('اختر ماركة مفعلة من هذا المتجر، أو أزل الربط.');return}}

    const payload = {
      store_id: storeId,
      name: form.name.trim(),
      slug: form.slug || generateSlug(form.name),
      description: form.description || null,
      sku: form.sku || null,
      barcode: form.barcode || null,
      brand_id: form.brand_id || null,
      category_id: form.category_id || null,
      price: parseFloat(form.price),
      compare_price: form.compare_price ? parseFloat(form.compare_price) : null,
      cost_price: form.cost_price ? parseFloat(form.cost_price) : null,
      price_secondary: form.price_secondary ? parseFloat(form.price_secondary) : null,
      ...(!persistedId.current ? {stock_quantity:Number(form.stock_quantity)} : {}),
      low_stock_alert: Number(form.low_stock_alert),
      track_stock: form.track_stock,
      allow_backorder: form.allow_backorder,
      status: statusOverride||form.status,
      is_active: (statusOverride||form.status)==='active',
      is_featured: form.is_featured,
      images: form.images,
      thumbnail_url: form.images[0] ?? null,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      video_url: form.video_url.trim() || null,
      specifications: form.specifications.filter(s => s.name.trim()),
    }

    let productId = persistedId.current

    if (productId) {
      const {data:updated,error:err}=await supabase.from('products').update(payload)
        .eq('id', productId).eq('store_id',storeId).select('id').maybeSingle()
      if (err||!updated) { setError(err?.message || 'تعذر حفظ المنتج'); setSaving(false); return }
      const changed = diffFields((initialData||{}) as unknown as Record<string, unknown>, payload)
      trackAction(storeId, {
        action: 'update', entityType: 'product',
        entityId: productId, entityLabel: payload.name,
        details: { changed, changedCount: changed.length },
      })
    } else {
      const { data: created, error: err } = await supabase
        .from('products').insert(payload).select('id').single()
      if (err) {
        if(!err.code||!/^\d{5}$/.test(err.code)){setUncertain(true);setError('تعذر التأكد من اكتمال الإنشاء. راجع قائمة المنتجات قبل إعادة المحاولة.');return}
        setError(err.message.includes('duplicate') ? 'يوجد منتج بنفس الرابط (slug)' : err.message)
        setSaving(false)
        return
      }
      productId = created?.id ?? null
      persistedId.current=productId
      trackAction(storeId, {
        action: 'create', entityType: 'product',
        entityId: created?.id ?? null, entityLabel: payload.name,
        details: { price: payload.price },
      })
    }

    // أدخل الخصائص الجديدة قبل فصل القديمة حتى لا تفقد الروابط عند فشل الإدراج.
    if(productId && attributes.length>0){
      const {data:currentLinks,error:readError}=await supabase.from('product_attribute_links').select('value_id').eq('product_id',productId).eq('store_id',storeId)
      if(readError){setError('حُفظ المنتج لكن تعذر تحميل خصائصه للمزامنة. أعد المحاولة بنفس النموذج.');return}
      const existing=new Set((currentLinks||[]).map(l=>l.value_id))
      const rows=Array.from(selectedValues).filter(id=>!existing.has(id)).map(value_id=>({product_id:productId!,value_id,store_id:storeId}))
      if(rows.length){const {error:linkError}=await supabase.from('product_attribute_links').insert(rows);if(linkError){setError('حُفظ المنتج لكن تعذر حفظ خصائصه الجديدة. أعد المحاولة بنفس النموذج.');return}}
      const removed=Array.from(existing).filter(id=>!selectedValues.has(id))
      if(removed.length){const {error:removeError}=await supabase.from('product_attribute_links').delete().eq('product_id',productId).eq('store_id',storeId).in('value_id',removed);if(removeError){setError('حُفظ المنتج لكن تعذر فصل بعض الخصائص القديمة. أعد المحاولة بنفس النموذج.');return}}
    }

    router.push('/dashboard/products')
    router.refresh()
    }catch{if(!persistedId.current)setUncertain(true);setError('تعذر التأكد من اكتمال الحفظ. راجع قائمة المنتجات قبل إعادة إنشاء المنتج.')}finally{setSaving(false);submitLock.current=false}
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form} dir="rtl">

      {/* ── المعلومات الأساسية ── */}
      <Section title="المعلومات الأساسية">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>اسم المنتج <Required /></Label>
            <input
              aria-label="اسم المنتج" value={form.name}
              onChange={e => handleName(e.target.value)}
              placeholder="مثال: قميص قطني أبيض"
              className={input()}
            />
          </div>

          <div className="sm:col-span-2">
            <Label>الوصف</Label>
            <textarea
              aria-label="وصف المنتج" value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={3}
              placeholder="وصف تفصيلي للمنتج..."
              className={input('resize-none')}
            />
          </div>

          <div>
            <Label>رمز SKU</Label>
            <div className="flex gap-2">
              <input aria-label="رمز SKU" value={form.sku} onChange={e => set('sku', e.target.value)}
                placeholder="SHIRT-WHT-M" dir="ltr" className={`${input()} flex-1`} />
              <button
                type="button"
                onClick={handleGenerateSku}
                disabled={!form.name.trim()}
                title="توليد رمز SKU تلقائياً"
                className="shrink-0 rounded-xl border border-white/10 bg-slate-800 px-3 py-2.5 text-xs text-sky-400 transition-colors hover:border-sky-500/40 hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                توليد
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">أو اضغط "توليد" لإنشاء رمز تلقائي من اسم المنتج والفئة</p>
          </div>

          <div>
            <Label>الباركود</Label>
            <input aria-label="الباركود" value={form.barcode} onChange={e => set('barcode', e.target.value)}
              placeholder="1234567890" dir="ltr" className={input()} />
          </div>

          <div>
            <Label>الرابط (slug)</Label>
            <input
              aria-label="رابط المنتج" value={form.slug}
              onChange={e => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              dir="ltr"
              className={input()}
            />
          </div>

          <div><Label>الماركة</Label><select aria-label="ماركة المنتج" value={form.brand_id} onChange={e=>set('brand_id',e.target.value)} className={input()}><option value="">— بدون ماركة —</option>{brands.filter(b=>b.is_active||b.id===form.brand_id).map(b=><option key={b.id} value={b.id}>{b.name}{!b.is_active?' (غير مفعلة)':''}</option>)}</select><Link href="/dashboard/inventory/brands" className="text-xs text-sky-400">إدارة الماركات</Link></div>
          <div>
            <Label>الفئة</Label>

            {/* اختيار الفئة أو إضافة جديدة */}
            {cats.length > 0 ? (
              <div className="flex items-stretch gap-2">
                <select
                  aria-label="فئة المنتج" value={form.category_id}
                  onChange={e => set('category_id', e.target.value)}
                  className={`${input()} flex-1`}
                >
                  <option value="">— بدون فئة —</option>
                  {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => setAddingCat(v => !v)}
                  title="إضافة فئة جديدة"
                  className={`flex shrink-0 items-center justify-center rounded-xl border px-3 text-lg transition-colors ${
                    addingCat
                      ? 'border-sky-500/40 bg-sky-500/10 text-sky-400'
                      : 'border-white/10 bg-slate-800 text-slate-400 hover:border-sky-500/40 hover:text-sky-400'
                  }`}
                >
                  +
                </button>
              </div>
            ) : !addingCat ? (
              <button
                type="button"
                onClick={() => setAddingCat(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-sky-500/30 bg-sky-500/5 px-4 py-3 text-sm text-sky-400 transition-colors hover:border-sky-500/50 hover:bg-sky-500/10"
              >
                <span className="text-base leading-none">+</span>
                إضافة فئة جديدة
              </button>
            ) : null}

            {/* نموذج الإضافة السريعة */}
            {addingCat && (
              <div className="mt-2 flex gap-2">
                <input
                  autoFocus
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); handleAddCategory() }
                    if (e.key === 'Escape') { setAddingCat(false); setNewCatName('') }
                  }}
                  placeholder="اسم الفئة الجديدة"
                  className={`${input()} flex-1`}
                />
                <button
                  type="button"
                  onClick={handleAddCategory}
                  disabled={addingCatLoading || !newCatName.trim()}
                  className="shrink-0 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50"
                >
                  {addingCatLoading ? '...' : 'إضافة'}
                </button>
                <button
                  type="button"
                  onClick={() => { setAddingCat(false); setNewCatName('') }}
                  className="shrink-0 rounded-xl border border-white/10 px-3 py-2.5 text-sm text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ── التسعير ── */}
      <Section title="التسعير">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label>سعر البيع <Required /></Label>
            <div className="relative">
              <input
                type="number" min="0" step="0.01"
                aria-label="سعر البيع" value={form.price} onChange={e => set('price', e.target.value)}
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
                aria-label="السعر قبل الخصم" value={form.compare_price} onChange={e => set('compare_price', e.target.value)}
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
                aria-label="سعر التكلفة" value={form.cost_price} onChange={e => set('cost_price', e.target.value)}
                placeholder="0.00" dir="ltr"
                className={input('pl-16')}
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{currencyCode}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">مخفي عن الزبائن — لحساب الأرباح</p>
          </div>
        </div>

        {/* حقل السعر بالعملة الثانية — يظهر فقط إذا كانت العملة الثانية مفعّلة */}
        {secondaryCurrencyCode && (
          <div className="mt-4 border-t border-white/5 pt-4">
            <div className="max-w-xs">
              <Label>
                السعر بـ{secondaryCurrencyCode}
                <span className="mr-1 text-xs font-normal text-slate-500">(اختياري)</span>
              </Label>
              <div className="relative">
                <input
                  type="number" min="0" step="0.01"
                  aria-label="سعر العملة الثانية" value={form.price_secondary}
                  onChange={e => set('price_secondary', e.target.value)}
                  placeholder={
                    form.price && exchangeRate
                      ? (parseFloat(form.price) * exchangeRate).toFixed(2)
                      : '0.00'
                  }
                  dir="ltr"
                  className={input('pl-16')}
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{secondaryCurrencyCode}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {form.price && exchangeRate && !form.price_secondary
                  ? `إذا تُرك فارغاً سيُحسب تلقائياً: ${(parseFloat(form.price) * exchangeRate).toFixed(2)} ${secondaryCurrencyCode}`
                  : 'إذا تُرك فارغاً يُحسب تلقائياً من سعر الصرف في إعدادات المتجر'}
              </p>
            </div>
          </div>
        )}
      </Section>

      {/* ── المخزون ── */}
      <Section title="المخزون">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>{isEditing?'كمية المخزون الحالية (للقراءة)':'الكمية الافتتاحية'}</Label>
            <input
              type="number" min="0"
              disabled={isEditing} aria-label={isEditing?'كمية المخزون الحالية':'الكمية الافتتاحية'} value={form.stock_quantity} onChange={e => set('stock_quantity', e.target.value)}
              dir="ltr" className={input()}
            />
          </div>
          <div>
            <Label>حد تنبيه المخزون المنخفض</Label>
            <input
              type="number" min="0"
              aria-label="حد التنبيه" value={form.low_stock_alert} onChange={e => set('low_stock_alert', e.target.value)}
              dir="ltr" className={input()}
            />
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">{isEditing?'الكميات اللاحقة تُعدّل من حركات المخزون؛ حفظ بيانات المنتج لا يغيّرها.':'أدخل الكمية الافتتاحية مرة واحدة؛ الكميات اللاحقة من حركات المخزون.'}</p><div className="mt-4 space-y-3">
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
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={e => handleImageUpload(e.target.files)}
        />

        <div onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();handleImageUpload(e.dataTransfer.files)}} aria-label="منطقة صور المنتج" className="grid grid-cols-3 gap-3 rounded-xl border border-dashed border-slate-600 p-3">
          {form.images.map((url, i) => (
            <div key={url} className="group relative aspect-square">
              <img src={url} alt="" className="h-full w-full rounded-xl object-cover" />
              {i > 0 && <button type="button" onClick={()=>setForm(f=>({...f,images:[url,...f.images.filter(image=>image!==url)]}))} className="absolute bottom-1 right-1 rounded bg-slate-900/90 px-2 py-1 text-xs text-sky-300">تعيين رئيسية</button>}
              {i === 0 && (
                <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">رئيسية</span>
              )}
              <button
                type="button"
                onClick={() => removeImage(url)}
                aria-label={`إزالة الصورة ${i+1} من المنتج`} className="absolute left-1 top-1 flex rounded-full bg-red-500 p-1 text-white"
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
        <p className="mt-2 text-xs text-slate-500">اسحب الصور هنا أو اختر الملفات. الصورة الأولى هي الرئيسية — JPG / PNG / WebP / GIF، حد 5MB للصورة</p>
      </Section>

      {/* ── فيديو المنتج ── */}
      <Section title="فيديو المنتج (اختياري)">
        <Label>رابط الفيديو</Label>
        <input
          aria-label="رابط الفيديو" value={form.video_url}
          onChange={e => set('video_url', e.target.value)}
          placeholder="https://www.tiktok.com/... أو YouTube أو Instagram Reels"
          dir="ltr"
          type="url"
          className={input()}
        />
        <p className="mt-1.5 text-xs text-slate-500">
          رابط فيديو اختياري لعرض المنتج؛ أدخل رابطاً كاملاً يبدأ بـ https.
        </p>
      </Section>

      {/* ── المواصفات الفنية ── */}
      <Section title="المواصفات الفنية">
        <p className="mb-3 text-xs text-slate-500">
          أضف أي مواصفة تريدها — مثال: اللون، الأبعاد، نوع الخشب، مدة التوصيل...
        </p>

        {form.specifications.length > 0 && (
          <div className="mb-3 space-y-2">
            {/* رأس الجدول */}
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-1">
              <span className="text-xs text-slate-500">اسم المواصفة</span>
              <span className="text-xs text-slate-500">القيمة</span>
            </div>
            {form.specifications.map((spec, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                <input
                  value={spec.name}
                  onChange={e => updateSpec(idx, 'name', e.target.value)}
                  placeholder="مثال: اللون"
                  className={input()}
                />
                <input
                  value={spec.value}
                  onChange={e => updateSpec(idx, 'value', e.target.value)}
                  placeholder="مثال: أبيض"
                  className={input()}
                />
                <button
                  type="button"
                  onClick={() => removeSpec(idx)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-slate-800 text-slate-400 transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={addSpec}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 py-2.5 text-sm text-slate-400 transition hover:border-sky-500/40 hover:text-sky-400"
        >
          <span className="text-base leading-none">+</span>
          إضافة مواصفة
        </button>
      </Section>

      {/* ── الخصائص (للفلترة) ── */}
      {attributes.length > 0 && (
        <Section title="الخصائص (تظهر كفلاتر في المتجر)">
          <p className="mb-3 text-xs text-slate-500">
            اختر القيم المناسبة لهذا المنتج. تُدار الخصائص من صفحة «الخصائص والفلاتر».
          </p>
          <div className="space-y-4">
            {attributes.map(attr => (
              <div key={attr.id}>
                <p className="mb-2 text-sm text-slate-300">{attr.name}</p>
                {attr.values.length === 0 ? (
                  <p className="text-xs text-slate-600">لا قيم لهذه الخاصية بعد</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {attr.values.map(v => {
                      const active = selectedValues.has(v.id)
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => toggleValue(v.id)}
                          className={`rounded-full px-3 py-1.5 text-sm transition ${
                            active
                              ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40'
                              : 'bg-white/5 text-slate-300 hover:bg-white/10'
                          }`}
                        >
                          {active && '✓ '}{v.value}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── الوسوم والحالة ── */}
      <Section title="الوسوم والحالة">
        <div className="mb-4">
          <Label>الوسوم (tags)</Label>
          <input
            aria-label="وسوم المنتج" value={form.tags}
            onChange={e => set('tags', e.target.value)}
            placeholder="قمصان, رجالي, صيف (مفصولة بفاصلة)"
            className={input()}
          />
        </div>
        <div className="space-y-4">
          {/* حالة المنتج */}
          <div>
            <p className="mb-2 text-sm text-slate-300">حالة المنتج</p>
            <div className="grid grid-cols-2 gap-2">
              {PRODUCT_STATUSES.map(s => (
                <label
                  key={s.value}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition ${
                    form.status === s.value ? s.activeCls : 'border-white/5 hover:border-white/10'
                  }`}
                >
                  <input
                    type="radio"
                    name="product_status"
                    value={s.value}
                    checked={form.status === s.value}
                    onChange={() => set('status', s.value)}
                    className="mt-0.5 accent-sky-500"
                  />
                  <div>
                    <p className={`text-sm font-medium ${form.status === s.value ? s.color : 'text-slate-300'}`}>
                      {s.icon} {s.label}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{s.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <Toggle
            label="منتج مميز"
            description="يظهر في قسم المنتجات المميزة"
            checked={form.is_featured}
            onChange={v => set('is_featured', v)}
          />
        </div>
      </Section>

      {error && (
        <div role="alert" className={styles.alert}>{error}</div>
      )}

      {/* ── أزرار الحفظ ── */}
      <div className={styles.toolbar}>
        <Link href="/dashboard/products">← العودة للمنتجات</Link>
        <button type="button" disabled={saving||uploading||uncertain} onClick={e=>handleSubmit(e,'draft')}>حفظ كمسودة</button>
        <button
          type="button"
          onClick={() => router.back()}
          className="w-full rounded-xl border border-white/10 px-6 py-3 text-sm text-slate-400 hover:text-white sm:w-auto sm:py-2.5"
        >
          إلغاء
        </button>
        <button
          type="submit"
          disabled={saving||uploading||uncertain}
          className="w-full rounded-xl bg-sky-500 px-8 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 sm:w-auto sm:py-2.5"
        >
          {saving ? 'جاري الحفظ...' : isEditing ? 'حفظ التغييرات' : 'حفظ المنتج'}
        </button>
      </div>
    </form>
  )
}

// ── ثوابت وأدوات ──

const PRODUCT_STATUSES = [
  { value: 'active',   icon: '✅', label: 'فعال',   desc: 'يظهر للزبائن في المتجر',    color: 'text-emerald-400', activeCls: 'border-emerald-500/40 bg-emerald-500/8' },
  { value: 'draft',    icon: '✏️', label: 'مسودة',  desc: 'غير منشور، قيد الإعداد',    color: 'text-sky-400',     activeCls: 'border-sky-500/40 bg-sky-500/8'         },
  { value: 'hidden',   icon: '🙈', label: 'مخفي',   desc: 'مخفي مؤقتاً، لا يُباع',    color: 'text-amber-400',   activeCls: 'border-amber-500/40 bg-amber-500/8'     },
  { value: 'archived', icon: '📦', label: 'مؤرشف',  desc: 'متوقف عن البيع نهائياً',   color: 'text-slate-400',   activeCls: 'border-slate-500/40 bg-slate-500/8'     },
] as const

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section} data-section={title}>
      <h2 className="mb-4 text-sm font-medium text-slate-400 uppercase tracking-wide">{title}</h2>
      {children}
    </section>
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
      <div className="flex flex-shrink-0 items-center gap-2">
        <span className={`text-xs font-medium transition-colors ${checked ? 'text-sky-400' : 'text-slate-500'}`}>
          {checked ? 'مفعّل' : 'معطّل'}
        </span>
        <button
          type="button"
          onClick={() => onChange(!checked)}
          className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-sky-500' : 'bg-slate-700'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
    </label>
  )
}
