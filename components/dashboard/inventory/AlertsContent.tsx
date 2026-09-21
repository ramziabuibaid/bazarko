'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface AlertProduct {
  id: string
  name: string
  sku: string | null
  thumbnail_url: string | null
  stock_quantity: number
  stock_available: number
  low_stock_alert: number | null
  price: number
  cost_price?: number | null
  is_active: boolean
  monthlySold: number
  lastSaleAt: string | null
}

interface Props {
  outOfStock: AlertProduct[]
  lowStock: AlertProduct[]
  currencyCode: string
  storeId: string
  userId: string
}

export default function AlertsContent({ outOfStock, lowStock, currencyCode, storeId, userId }: Props) {
  const router = useRouter()
  const [toggling, setToggling]       = useState<Record<string, boolean>>({})
  const [localActive, setLocalActive] = useState<Record<string, boolean>>({})
  const [localStock, setLocalStock]   = useState<Record<string, number>>({})

  // restock modal state
  const [restockProduct, setRestockProduct] = useState<AlertProduct | null>(null)
  const [restockQty, setRestockQty]         = useState('')
  const [restockNotes, setRestockNotes]     = useState('')
  const [restocking, setRestocking]         = useState(false)
  const [restockError, setRestockError]     = useState('')

  function isActive(p: AlertProduct) {
    return localActive[p.id] !== undefined ? localActive[p.id] : p.is_active
  }

  function currentStock(p: AlertProduct) {
    return localStock[p.id] !== undefined ? localStock[p.id] : p.stock_available
  }

  async function toggleVisibility(p: AlertProduct) {
    setToggling(prev => ({ ...prev, [p.id]: true }))
    const newVal = !isActive(p)
    await createClient().from('products').update({ status: newVal ? 'active' : 'hidden' }).eq('id', p.id)
    setLocalActive(prev => ({ ...prev, [p.id]: newVal }))
    setToggling(prev => { const n = { ...prev }; delete n[p.id]; return n })
    router.refresh()
  }

  function openRestock(p: AlertProduct) {
    setRestockProduct(p)
    setRestockQty('')
    setRestockNotes('')
    setRestockError('')
  }

  async function submitRestock(e: React.FormEvent) {
    e.preventDefault()
    if (!restockProduct) return

    const qty = parseInt(restockQty)
    if (!qty || qty <= 0) { setRestockError('أدخل كمية أكبر من صفر'); return }

    setRestocking(true)
    const supabase = createClient()
    const qBefore  = restockProduct.stock_quantity
    const qAfter   = qBefore + qty

    const { error: mvErr } = await supabase.from('stock_movements').insert({
      store_id:        storeId,
      product_id:      restockProduct.id,
      type:            'purchase',
      quantity:        qty,
      quantity_before: qBefore,
      quantity_after:  qAfter,
      notes:           restockNotes.trim() || 'إعادة تعبئة من تنبيهات المخزون',
      created_by:      userId,
    })

    await supabase.from('inventory_movements').insert({
      store_id: storeId,
      product_id: restockProduct.id,
      movement_type: 'purchase',
      document_type: 'إعادة تعبئة مخزون',
      entity_name: 'تنبيهات المخزون',
      quantity_in: qty,
      quantity_out: 0,
      balance_after: qAfter,
      unit_price: Number(restockProduct.cost_price || 0),
      notes: restockNotes.trim() || 'إعادة تعبئة من تنبيهات المخزون',
      movement_date: new Date().toISOString().slice(0, 10),
      created_by: userId,
    })

    const { error: pErr } = await supabase
      .from('products')
      .update({ stock_quantity: qAfter, updated_at: new Date().toISOString() })
      .eq('id', restockProduct.id)

    setRestocking(false)

    if (mvErr || pErr) { setRestockError('حدث خطأ أثناء الحفظ'); return }

    setLocalStock(prev => ({ ...prev, [restockProduct.id]: (restockProduct.stock_available) + qty }))
    setRestockProduct(null)
    router.refresh()
  }

  function salesHint(p: AlertProduct) {
    if (p.monthlySold > 0) {
      return <span className="text-xs text-slate-400">~{p.monthlySold} قطعة/شهر</span>
    }
    if (p.lastSaleAt) {
      const days = Math.round((Date.now() - new Date(p.lastSaleAt).getTime()) / 86400000)
      return <span className="text-xs text-slate-400">آخر بيع منذ {days} يوم</span>
    }
    return <span className="text-xs text-slate-500">لا مبيعات مسجّلة</span>
  }

  function HideButton({ p }: { p: AlertProduct }) {
    const active = isActive(p)
    const busy   = toggling[p.id]
    return (
      <button
        onClick={() => toggleVisibility(p)}
        disabled={busy}
        title={active ? 'إخفاء مؤقت من المتجر' : 'إعادة إظهار في المتجر'}
        className={`w-full sm:w-auto rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
          active
            ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
            : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
        }`}
      >
        {busy ? '…' : active ? '🙈 إخفاء' : '👁️ إظهار'}
      </button>
    )
  }

  function ProductRow({ p, i, borderColor }: { p: AlertProduct; i: number; borderColor: string }) {
    const active    = isActive(p)
    const available = currentStock(p)
    return (
      <div className={`flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 ${i > 0 ? `border-t ${borderColor}` : ''} ${!active ? 'opacity-60' : ''}`}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
            {p.thumbnail_url
              ? <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
              : <div className="flex h-full items-center justify-center">🛍️</div>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{p.name}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5 min-w-0">
              {p.sku && <span className="text-xs text-slate-400 truncate max-w-[120px]" dir="ltr">{p.sku}</span>}
              {(p.sku && (p.monthlySold > 0 || p.lastSaleAt)) ? <span className="text-slate-600 shrink-0">·</span> : null}
              <div className="shrink-0">{salesHint(p)}</div>
            </div>
            {!active && (
              <span className="mt-0.5 inline-block rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">مخفي من المتجر</span>
            )}
          </div>
          <div className="shrink-0 pl-1">
            {available <= 0 ? (
              <span className="inline-flex rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-bold text-red-400">نفد</span>
            ) : (
              <div className="text-center">
                <span className="text-sm font-bold text-yellow-400">{available}</span>
                <p className="text-[10px] text-slate-400">متبقي</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 shrink-0 border-t border-white/5 sm:border-0 pt-3 sm:pt-0">
          <button
            onClick={() => openRestock(p)}
            className="flex-1 sm:flex-none rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors text-center"
          >
            📥 تعبئة
          </button>
          <div className="flex-1 sm:flex-none">
            <HideButton p={p} />
          </div>
          <Link
            href={`/dashboard/inventory?q=${encodeURIComponent(p.name)}`}
            className="flex-1 sm:flex-none block rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-sky-500/15 hover:text-sky-400 text-center"
          >
            تعديل
          </Link>
        </div>
      </div>
    )
  }

  const allEmpty = outOfStock.length === 0 && lowStock.length === 0

  if (allEmpty) {
    return (
      <div className="rounded-2xl border border-white/5 bg-emerald-500/5 py-16 text-center">
        <p className="text-4xl">✅</p>
        <p className="mt-3 text-emerald-400 font-medium">المخزون بخير! لا توجد تنبيهات</p>
      </div>
    )
  }

  const previewQty   = parseInt(restockQty || '0')
  const afterRestock = restockProduct ? restockProduct.stock_available + (previewQty > 0 ? previewQty : 0) : 0

  return (
    <>
      <div className="space-y-6">
        {outOfStock.length > 0 && (
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-400">
              🔴 نفد المخزون
              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs">{outOfStock.length}</span>
            </h2>
            <div className="overflow-hidden rounded-2xl border border-red-500/20">
              {outOfStock.map((p, i) => (
                <ProductRow key={p.id} p={p} i={i} borderColor="border-white/5" />
              ))}
            </div>
          </div>
        )}

        {lowStock.length > 0 && (
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-yellow-400">
              🟡 قارب النفاد
              <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs">{lowStock.length}</span>
            </h2>
            <div className="overflow-hidden rounded-2xl border border-yellow-500/20">
              {lowStock.map((p, i) => (
                <ProductRow key={p.id} p={p} i={i} borderColor="border-white/5" />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modal إعادة التعبئة */}
      {restockProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setRestockProduct(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6"
            onClick={e => e.stopPropagation()}
          >
            {/* رأس */}
            <div className="mb-5 flex items-start gap-3">
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
                {restockProduct.thumbnail_url
                  ? <img src={restockProduct.thumbnail_url} alt="" className="h-full w-full object-cover" />
                  : <div className="flex h-full items-center justify-center">🛍️</div>}
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-white truncate">{restockProduct.name}</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  المخزون الحالي:{' '}
                  <span className={`font-bold ${restockProduct.stock_available <= 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                    {restockProduct.stock_available} قطعة
                  </span>
                </p>
              </div>
            </div>

            <form onSubmit={submitRestock} className="space-y-4">
              {/* الكمية */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  كم قطعة تضيف؟
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  autoFocus
                  value={restockQty}
                  onChange={e => setRestockQty(e.target.value)}
                  placeholder="0"
                  dir="ltr"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-lg font-bold text-white outline-none focus:border-emerald-500/50 focus:bg-emerald-500/5"
                />
                {previewQty > 0 && (
                  <p className="mt-1.5 text-xs text-slate-400">
                    بعد الإضافة:{' '}
                    <span className="font-bold text-emerald-400">{afterRestock} قطعة</span>
                  </p>
                )}
              </div>

              {/* ملاحظة */}
              <div>
                <label className="mb-1.5 block text-sm text-slate-400">
                  ملاحظة <span className="text-slate-600">(اختياري)</span>
                </label>
                <input
                  value={restockNotes}
                  onChange={e => setRestockNotes(e.target.value)}
                  placeholder="رقم الفاتورة، المورد..."
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-white/20"
                />
              </div>

              {restockError && (
                <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{restockError}</p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setRestockProduct(null)}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400 hover:text-white transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={restocking || !restockQty}
                  className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {restocking ? 'جاري الحفظ...' : '📥 إضافة للمخزون'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
