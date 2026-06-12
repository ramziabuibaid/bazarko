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
  is_active: boolean
  monthlySold: number
  lastSaleAt: string | null
}

interface Props {
  outOfStock: AlertProduct[]
  lowStock: AlertProduct[]
  currencyCode: string
}

export default function AlertsContent({ outOfStock, lowStock, currencyCode }: Props) {
  const router = useRouter()
  const [toggling, setToggling] = useState<Record<string, boolean>>({})
  const [localActive, setLocalActive] = useState<Record<string, boolean>>({})

  function isActive(p: AlertProduct) {
    return localActive[p.id] !== undefined ? localActive[p.id] : p.is_active
  }

  async function toggleVisibility(p: AlertProduct) {
    setToggling(prev => ({ ...prev, [p.id]: true }))
    const newVal = !isActive(p)
    await createClient().from('products').update({ is_active: newVal }).eq('id', p.id)
    setLocalActive(prev => ({ ...prev, [p.id]: newVal }))
    setToggling(prev => { const n = { ...prev }; delete n[p.id]; return n })
    router.refresh()
  }

  function salesHint(p: AlertProduct) {
    if (p.monthlySold > 0) {
      return (
        <span className="text-xs text-slate-500">
          ~{p.monthlySold} قطعة/شهر
        </span>
      )
    }
    if (p.lastSaleAt) {
      const days = Math.round((Date.now() - new Date(p.lastSaleAt).getTime()) / 86400000)
      return <span className="text-xs text-slate-500">آخر بيع منذ {days} يوم</span>
    }
    return <span className="text-xs text-slate-600">لا مبيعات مسجّلة</span>
  }

  function HideButton({ p }: { p: AlertProduct }) {
    const active = isActive(p)
    const busy = toggling[p.id]
    return (
      <button
        onClick={() => toggleVisibility(p)}
        disabled={busy}
        title={active ? 'إخفاء مؤقت من المتجر' : 'إعادة إظهار في المتجر'}
        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
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
    const active = isActive(p)
    return (
      <div key={p.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? `border-t ${borderColor}` : ''} ${!active ? 'opacity-60' : ''}`}>
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
          {p.thumbnail_url
            ? <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
            : <div className="flex h-full items-center justify-center">🛍️</div>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{p.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {p.sku && <span className="text-xs text-slate-600" dir="ltr">{p.sku}</span>}
            {p.sku && p.monthlySold > 0 || p.lastSaleAt ? <span className="text-slate-700">·</span> : null}
            {salesHint(p)}
          </div>
          {!active && (
            <span className="mt-0.5 inline-block rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">مخفي من المتجر</span>
          )}
        </div>
        {p.stock_available <= 0 ? (
          <span className="text-sm font-bold text-red-400 shrink-0">نفد</span>
        ) : (
          <div className="text-center shrink-0">
            <span className="text-sm font-bold text-yellow-400">{p.stock_available}</span>
            <p className="text-xs text-slate-500">متبقي</p>
          </div>
        )}
        <HideButton p={p} />
        <Link
          href={`/dashboard/inventory?q=${encodeURIComponent(p.name)}`}
          className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-sky-500/15 hover:text-sky-400 shrink-0"
        >
          تعديل
        </Link>
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

  return (
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
  )
}
