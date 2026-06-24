'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

interface OfferItem {
  id: string
  offer_price: number
  products: { name: string; price: number } | null
}

interface OfferRow {
  id: string
  title: string
  description: string | null
  starts_at: string
  ends_at: string
  is_active: boolean
  created_at: string
  offer_items: OfferItem[]
}

type OfferStatus = 'active' | 'upcoming' | 'ended' | 'disabled'
type FilterTab  = 'all' | OfferStatus

interface Props {
  offers: OfferRow[]
  currencyCode: string
}

const STATUS_META: Record<OfferStatus, { label: string; cls: string; dot: string }> = {
  active:   { label: 'جارٍ الآن', cls: 'bg-emerald-500/15 text-emerald-400', dot: 'bg-emerald-400' },
  upcoming: { label: 'مجدول',    cls: 'bg-sky-500/15 text-sky-400',         dot: 'bg-sky-400'     },
  ended:    { label: 'منتهي',    cls: 'bg-slate-500/15 text-slate-400',     dot: 'bg-slate-500'   },
  disabled: { label: 'متوقف',   cls: 'bg-amber-500/15 text-amber-400',     dot: 'bg-amber-400'   },
}

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all',      label: 'الكل' },
  { key: 'active',   label: 'جارٍ الآن' },
  { key: 'upcoming', label: 'مجدول' },
  { key: 'ended',    label: 'منتهي' },
  { key: 'disabled', label: 'متوقف' },
]

function getStatus(offer: OfferRow): OfferStatus {
  if (!offer.is_active) return 'disabled'
  const now = Date.now()
  if (now < new Date(offer.starts_at).getTime()) return 'upcoming'
  if (now > new Date(offer.ends_at).getTime()) return 'ended'
  return 'active'
}

// ترتيب زمني: جارٍ (ينتهي أقرب) → مجدول (يبدأ أقرب) → منتهي (الأحدث انتهاءً) → متوقف
const STATUS_ORDER: Record<OfferStatus, number> = { active: 0, upcoming: 1, ended: 2, disabled: 3 }

function sortOffers(offers: OfferRow[]): OfferRow[] {
  return [...offers].sort((a, b) => {
    const sa = getStatus(a), sb = getStatus(b)
    if (sa !== sb) return STATUS_ORDER[sa] - STATUS_ORDER[sb]
    if (sa === 'active')   return new Date(a.ends_at).getTime() - new Date(b.ends_at).getTime()
    if (sa === 'upcoming') return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    return new Date(b.ends_at).getTime() - new Date(a.ends_at).getTime()
  })
}

const dateFmt = (iso: string) =>
  new Date(iso).toLocaleDateString('ar-u-nu-latn', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function timeRemaining(endsAt: string): string {
  const diff = new Date(endsAt).getTime() - Date.now()
  if (diff <= 0) return ''
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(h / 24)
  if (d > 0) return `ينتهي خلال ${d} يوم`
  if (h > 0) return `ينتهي خلال ${h} ساعة`
  const m = Math.floor(diff / 60000)
  return `ينتهي خلال ${m} دقيقة`
}

function timeUntil(startsAt: string): string {
  const diff = new Date(startsAt).getTime() - Date.now()
  if (diff <= 0) return ''
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(h / 24)
  if (d > 0) return `يبدأ خلال ${d} يوم`
  if (h > 0) return `يبدأ خلال ${h} ساعة`
  const m = Math.floor(diff / 60000)
  return `يبدأ خلال ${m} دقيقة`
}

export default function OffersClient({ offers, currencyCode }: Props) {
  const [query, setQuery]  = useState('')
  const [tab, setTab]      = useState<FilterTab>('all')

  const counts = useMemo(() => ({
    all:      offers.length,
    active:   offers.filter(o => getStatus(o) === 'active').length,
    upcoming: offers.filter(o => getStatus(o) === 'upcoming').length,
    ended:    offers.filter(o => getStatus(o) === 'ended').length,
    disabled: offers.filter(o => getStatus(o) === 'disabled').length,
  }), [offers])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sortOffers(offers).filter(o => {
      if (tab !== 'all' && getStatus(o) !== tab) return false
      if (q && !o.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [offers, query, tab])

  return (
    <>
      {/* ── إحصائيات ── */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { key: 'all',      label: 'إجمالي',    value: counts.all,      color: 'text-white'       },
          { key: 'active',   label: 'جارٍ الآن', value: counts.active,   color: 'text-emerald-400' },
          { key: 'upcoming', label: 'مجدول',     value: counts.upcoming, color: 'text-sky-400'     },
          { key: 'ended',    label: 'منتهي',     value: counts.ended,    color: 'text-slate-400'   },
        ].map(s => (
          <button
            key={s.key}
            onClick={() => setTab(s.key as FilterTab)}
            className={`rounded-xl border p-4 text-right transition ${
              tab === s.key
                ? 'border-sky-500/30 bg-sky-500/10'
                : 'border-white/5 bg-slate-900 hover:border-white/10'
            }`}
          >
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${s.color}`}>{s.value}</p>
          </button>
        ))}
      </div>

      {/* ── شريط البحث والتبويبات ── */}
      <div className="mb-4 space-y-3">
        {/* البحث */}
        <div className="relative">
          <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
            width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="6.5" cy="6.5" r="5" />
            <line x1="10.5" y1="10.5" x2="14.5" y2="14.5" />
          </svg>
          <input
            type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="ابحث عن عرض..."
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-4 pr-10 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
          />
          {query && (
            <button onClick={() => setQuery('')}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">✕</button>
          )}
        </div>

        {/* تبويبات الفلتر */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {TABS.map(t => {
            const cnt = counts[t.key]
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-medium transition ${
                  tab === t.key
                    ? 'bg-sky-500 text-slate-950'
                    : 'border border-white/10 text-slate-400 hover:border-white/20 hover:text-white'
                }`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 py-0 text-xs font-bold ${
                  tab === t.key ? 'bg-sky-700/40 text-sky-100' : 'bg-white/10 text-slate-400'
                }`}>
                  {cnt}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── القائمة ── */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-slate-900 py-14 text-center">
          <p className="text-slate-500">
            {query ? `لا توجد عروض تطابق "${query}"` : 'لا توجد عروض في هذه الفئة'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(offer => {
            const status = getStatus(offer)
            const meta   = STATUS_META[status]
            const maxDiscount = Math.max(
              0,
              ...offer.offer_items
                .filter(i => i.products && i.products.price > 0)
                .map(i => Math.round((1 - i.offer_price / i.products!.price) * 100))
            )
            const hint = status === 'active'   ? timeRemaining(offer.ends_at)
                       : status === 'upcoming' ? timeUntil(offer.starts_at)
                       : null

            return (
              <Link
                key={offer.id}
                href={`/dashboard/offers/${offer.id}`}
                className="block rounded-2xl border border-white/5 bg-slate-900 p-5 transition hover:border-white/10"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold text-white">{offer.title}</h3>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.cls}`}>
                        <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${meta.dot} ${status === 'active' ? 'animate-pulse' : ''}`} />
                        {meta.label}
                      </span>
                    </div>
                    {offer.description && (
                      <p className="mt-1 line-clamp-1 text-sm text-slate-400">{offer.description}</p>
                    )}
                    <p className="mt-2 text-xs text-slate-500">
                      {dateFmt(offer.starts_at)} ← {dateFmt(offer.ends_at)}
                    </p>
                    {hint && (
                      <p className={`mt-1 text-xs font-medium ${status === 'active' ? 'text-emerald-400' : 'text-sky-400'}`}>
                        {hint}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-4 text-sm">
                    <div className="text-center">
                      <p className="font-semibold text-white">{offer.offer_items.length}</p>
                      <p className="text-xs text-slate-500">منتج</p>
                    </div>
                    {maxDiscount > 0 && (
                      <div className="text-center">
                        <p className="font-semibold text-red-400">-{maxDiscount}%</p>
                        <p className="text-xs text-slate-500">أعلى خصم</p>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}
