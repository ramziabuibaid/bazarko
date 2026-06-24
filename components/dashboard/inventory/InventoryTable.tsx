'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface Product {
  id: string
  name: string
  sku: string | null
  price: number
  cost_price: number | null
  thumbnail_url: string | null
  stock_quantity: number
  stock_available: number
  track_stock: boolean
  low_stock_alert: number | null
  is_active: boolean
  updated_at: string
}

interface Props {
  products: Product[]
  currencyCode: string
  storeId: string
  userId: string
  searchQuery: string
  statusFilter: string
}

const MOVEMENT_TYPES = [
  { value: 'purchase',    label: 'استلام بضاعة',  sign: +1, icon: '📥' },
  { value: 'return',      label: 'إرجاع من زبون', sign: +1, icon: '↩️' },
  { value: 'adjustment',  label: 'تعديل يدوي',    sign:  0, icon: '✏️' },
  { value: 'damage',      label: 'تالف/مفقود',    sign: -1, icon: '🗑️' },
]

function stockBadge(available: number, alert: number | null): { label: string; cls: string } {
  if (available <= 0) return { label: 'نفد', cls: 'bg-red-500/15 text-red-400' }
  if (alert != null && alert > 0 && available <= alert) return { label: `⚠️ ${available}`, cls: 'bg-yellow-500/15 text-yellow-400' }
  return { label: String(available), cls: 'bg-emerald-500/15 text-emerald-400' }
}

export default function InventoryTable({ products, currencyCode, storeId, userId, searchQuery, statusFilter }: Props) {
  const router = useRouter()
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null)
  const [adjType, setAdjType]           = useState('purchase')
  const [adjQty, setAdjQty]             = useState('')
  const [adjDir, setAdjDir]             = useState('+')
  const [adjNotes, setAdjNotes]         = useState('')
  const [adjAlert, setAdjAlert]         = useState('')
  const [saving, setSaving]             = useState(false)
  const [adjError, setAdjError]         = useState('')

  // تعديل inline
  const [inlineEdits, setInlineEdits]   = useState<Record<string, string>>({})
  const [savingInline, setSavingInline] = useState<Record<string, boolean>>({})

  function startInline(p: Product) {
    setInlineEdits(prev => ({ ...prev, [p.id]: String(p.stock_quantity) }))
  }

  function cancelInline(id: string) {
    setInlineEdits(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  async function saveInline(p: Product) {
    const newQty = parseInt(inlineEdits[p.id] ?? '')
    if (isNaN(newQty) || newQty < 0) return
    if (newQty === p.stock_quantity) { cancelInline(p.id); return }

    setSavingInline(prev => ({ ...prev, [p.id]: true }))
    const supabase = createClient()
    const diff = newQty - p.stock_quantity

    await supabase.from('stock_movements').insert({
      store_id: storeId,
      product_id: p.id,
      type: 'adjustment',
      quantity: diff,
      quantity_before: p.stock_quantity,
      quantity_after: newQty,
      notes: 'تعديل مباشر من جدول المخزون',
      created_by: userId,
    })
    await supabase.from('products').update({
      stock_quantity: newQty,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id)

    setSavingInline(prev => { const n = { ...prev }; delete n[p.id]; return n })
    cancelInline(p.id)
    router.refresh()
  }

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (statusFilter) sp.set('status', statusFilter)
    router.push(`/dashboard/inventory?${sp.toString()}`)
  }

  function openAdj(p: Product) {
    setAdjustProduct(p)
    setAdjType('purchase')
    setAdjQty('')
    setAdjDir('+')
    setAdjNotes('')
    setAdjAlert(p.low_stock_alert != null ? String(p.low_stock_alert) : '')
    setAdjError('')
  }

  async function submitAdj(e: React.FormEvent) {
    e.preventDefault()
    if (!adjustProduct) return

    const hasQty   = adjQty.trim() !== ''
    const hasAlert = adjAlert.trim() !== ''

    if (!hasQty && !hasAlert) {
      setAdjError('أدخل كمية للتعديل أو حدد حد إعادة الطلب')
      return
    }

    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const productUpdate: Record<string, any> = { updated_at: new Date().toISOString() }
    let hasError = false

    // تعديل الكمية
    if (hasQty) {
      const qty = parseInt(adjQty)
      if (!qty || qty <= 0) { setAdjError('أدخل كمية صحيحة أكبر من صفر'); return }

      const mt = MOVEMENT_TYPES.find(m => m.value === adjType)!
      const signedQty = mt.sign === 0 ? (adjDir === '+' ? qty : -qty) : mt.sign * qty
      const qBefore   = adjustProduct.stock_quantity
      const qAfter    = qBefore + signedQty

      if (qAfter < 0) { setAdjError('المخزون لا يمكن أن يصبح سالباً'); return }

      setSaving(true)
      const { error: mvErr } = await supabase.from('stock_movements').insert({
        store_id: storeId,
        product_id: adjustProduct.id,
        type: adjType,
        quantity: signedQty,
        quantity_before: qBefore,
        quantity_after: qAfter,
        notes: adjNotes.trim() || null,
        created_by: userId,
      })
      if (mvErr) hasError = true
      productUpdate.stock_quantity = qAfter
    } else {
      setSaving(true)
    }

    // تعديل حد إعادة الطلب: 0 يعني "لا تنبيه" (يُحفظ كـ null)
    if (hasAlert) {
      const alertVal = parseInt(adjAlert)
      productUpdate.low_stock_alert = (!alertVal || alertVal <= 0) ? null : alertVal
    }

    const { error: pErr } = await supabase
      .from('products')
      .update(productUpdate)
      .eq('id', adjustProduct.id)
    if (pErr) hasError = true

    setSaving(false)
    if (hasError) { setAdjError('حدث خطأ أثناء الحفظ'); return }

    setAdjustProduct(null)
    router.refresh()
  }

  const STATUS_TABS = [
    { key: '',    label: 'الكل' },
    { key: 'low', label: '⚠️ قارب النفاد' },
    { key: 'out', label: '🔴 نفد' },
  ]

  return (
    <div className="space-y-4">
      {/* البحث والفلتر */}
      <div className="flex flex-wrap gap-3">
        <form onSubmit={handleSearch} className="flex flex-1 gap-2">
          <input
            name="q"
            defaultValue={searchQuery}
            placeholder="ابحث بالاسم أو SKU..."
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
          />
          <button type="submit" className="rounded-xl bg-white/5 px-4 text-sm text-slate-300 hover:bg-white/10">بحث</button>
        </form>
        <div className="flex gap-1">
          {STATUS_TABS.map(t => (
            <Link
              key={t.key}
              href={`/dashboard/inventory?${searchQuery ? `q=${searchQuery}&` : ''}${t.key ? `status=${t.key}` : ''}`}
              className={`rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
                statusFilter === t.key
                  ? 'bg-sky-500/15 text-sky-400'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      {/* الجدول */}
      {products.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-white/3 py-16 text-center">
          <p className="text-4xl">📦</p>
          <p className="mt-3 text-slate-400">لا توجد منتجات</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/5">
          <table className="min-w-[680px] w-full">
            <thead>
              <tr className="border-b border-white/5 bg-white/3">
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">المنتج</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">SKU</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">في المخزن</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">متاح للبيع</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">سعر التكلفة</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">قيمة المخزون</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {products.map(p => {
                const badge = stockBadge(p.stock_available, p.low_stock_alert)
                const value = (p.stock_quantity ?? 0) * (p.cost_price ?? 0)
                return (
                  <tr key={p.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-white/5">
                          {p.thumbnail_url
                            ? <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
                            : <div className="flex h-full items-center justify-center text-sm">🛍️</div>
                          }
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">{p.name}</p>
                          <Link href={`/dashboard/products/${p.id}`} className="text-xs text-slate-500 hover:text-sky-400">
                            تعديل المنتج ↗
                          </Link>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400" dir="ltr">{p.sku ?? '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {inlineEdits[p.id] !== undefined ? (
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="number" min="0" step="1"
                            value={inlineEdits[p.id]}
                            onChange={e => setInlineEdits(prev => ({ ...prev, [p.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') saveInline(p); if (e.key === 'Escape') cancelInline(p.id) }}
                            autoFocus
                            className="w-16 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-center text-sm text-white outline-none"
                          />
                          <button
                            onClick={() => saveInline(p)}
                            disabled={savingInline[p.id]}
                            className="rounded-md bg-emerald-600/80 px-1.5 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            {savingInline[p.id] ? '…' : '✓'}
                          </button>
                          <button
                            onClick={() => cancelInline(p.id)}
                            className="rounded-md bg-white/5 px-1.5 py-1 text-xs text-slate-400 hover:bg-white/10"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startInline(p)}
                          className="group inline-flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-sky-500/10 transition-colors"
                          title="انقر لتعديل الكمية"
                        >
                          <span className="text-sm font-semibold text-white group-hover:text-sky-400">{p.stock_quantity}</span>
                          <span className="text-xs text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300" dir="ltr">
                      {p.cost_price ? `${p.cost_price.toLocaleString('ar-u-nu-latn')} ${currencyCode}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-white" dir="ltr">
                      {value > 0 ? `${value.toLocaleString('ar-u-nu-latn')} ${currencyCode}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openAdj(p)}
                        className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-sky-500/15 hover:text-sky-400"
                      >
                        تعديل
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal تعديل المخزون */}
      {adjustProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setAdjustProduct(null)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-semibold text-white">تعديل المخزون</h2>
            <p className="mb-1 text-sm text-slate-300">{adjustProduct.name}</p>
            <p className="mb-5 text-xs text-slate-500">
              الكمية الحالية: <span className="font-bold text-white">{adjustProduct.stock_quantity}</span> قطعة
            </p>

            <form onSubmit={submitAdj} className="space-y-4">
              {/* نوع الحركة */}
              <div>
                <label className="mb-2 block text-sm text-slate-400">نوع الحركة</label>
                <div className="grid grid-cols-2 gap-2">
                  {MOVEMENT_TYPES.map(m => (
                    <label
                      key={m.value}
                      className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 transition ${
                        adjType === m.value ? 'border-sky-500/40 bg-sky-500/10' : 'border-white/5 hover:border-white/10'
                      }`}
                    >
                      <input type="radio" name="mtype" value={m.value}
                        checked={adjType === m.value}
                        onChange={() => setAdjType(m.value)}
                        className="accent-sky-500" />
                      <span>{m.icon}</span>
                      <span className="text-sm text-white">{m.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* اتجاه التعديل (للتعديل اليدوي فقط) */}
              {adjType === 'adjustment' && (
                <div className="flex gap-2">
                  <label className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border p-3 ${adjDir === '+' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-white/5 text-slate-400'}`}>
                    <input type="radio" name="dir" value="+" checked={adjDir === '+'} onChange={() => setAdjDir('+')} className="hidden" />
                    ↑ زيادة
                  </label>
                  <label className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border p-3 ${adjDir === '-' ? 'border-red-500/40 bg-red-500/10 text-red-400' : 'border-white/5 text-slate-400'}`}>
                    <input type="radio" name="dir" value="-" checked={adjDir === '-'} onChange={() => setAdjDir('-')} className="hidden" />
                    ↓ تخفيض
                  </label>
                </div>
              )}

              {/* الكمية */}
              <div>
                <label className="mb-1 block text-sm text-slate-400">الكمية *</label>
                <input
                  type="number" min="1" step="1"
                  value={adjQty}
                  onChange={e => setAdjQty(e.target.value)}
                  placeholder="0"
                  dir="ltr"
                  required
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50"
                />
                {adjQty && (
                  <p className="mt-1 text-xs text-slate-500">
                    المخزون بعد التعديل:{' '}
                    <span className={
                      (() => {
                        const mt = MOVEMENT_TYPES.find(m => m.value === adjType)!
                        const sign = mt.sign === 0 ? (adjDir === '+' ? 1 : -1) : mt.sign
                        const result = adjustProduct.stock_quantity + sign * parseInt(adjQty || '0')
                        return result < 0 ? 'text-red-400' : 'font-bold text-white'
                      })()
                    }>
                      {(() => {
                        const mt = MOVEMENT_TYPES.find(m => m.value === adjType)!
                        const sign = mt.sign === 0 ? (adjDir === '+' ? 1 : -1) : mt.sign
                        return adjustProduct.stock_quantity + sign * parseInt(adjQty || '0')
                      })()} قطعة
                    </span>
                  </p>
                )}
              </div>

              {/* ملاحظة */}
              <div>
                <label className="mb-1 block text-sm text-slate-400">سبب / ملاحظة</label>
                <input
                  value={adjNotes}
                  onChange={e => setAdjNotes(e.target.value)}
                  placeholder="فاتورة شراء رقم 42 / تالف..."
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                />
              </div>

              {/* حد إعادة الطلب */}
              <div className="rounded-xl border border-white/5 bg-white/3 p-4">
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  ⚙️ حد إعادة الطلب
                </label>
                <p className="mb-2 text-xs text-slate-500">
                  عند وصول الكمية المتاحة لهذا العدد يظهر تنبيه أصفر — اكتب 0 لتعطيل التنبيه
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="number" min="0" step="1"
                    value={adjAlert}
                    onChange={e => setAdjAlert(e.target.value)}
                    placeholder={adjustProduct?.low_stock_alert != null ? String(adjustProduct.low_stock_alert) : 'غير محدد'}
                    dir="ltr"
                    className="w-32 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none focus:border-sky-500/50"
                  />
                  {adjustProduct?.low_stock_alert != null && adjustProduct.low_stock_alert > 0 && (
                    <span className="text-xs text-yellow-400">
                      الحالي: {adjustProduct.low_stock_alert} قطعة
                    </span>
                  )}
                  {(adjustProduct?.low_stock_alert == null || adjustProduct.low_stock_alert === 0) && (
                    <span className="text-xs text-slate-500">لا يوجد حد مضبوط</span>
                  )}
                </div>
              </div>

              {adjError && <p className="text-sm text-red-400">{adjError}</p>}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setAdjustProduct(null)}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400 hover:text-white">
                  إلغاء
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                  {saving ? 'جاري الحفظ...' : adjQty ? 'تأكيد التعديل' : 'حفظ الإعدادات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
