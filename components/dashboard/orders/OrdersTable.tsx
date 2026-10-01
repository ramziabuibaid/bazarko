'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { businessDay, BUSINESS_TIME_ZONE } from '@/lib/dashboard/simple-metrics'

interface Order {
  id: string
  order_number: string
  status: string
  payment_method: string
  payment_status: string | null
  total_amount: number
  shipping_city: string | null
  customer_notes: string | null
  customer_name: string | null
  customer_phone: string | null
  created_at: string
}

interface Props {
  orders: Order[]
  total: number
  page: number
  pageSize: number
  statusCounts: Record<string, number>
  currencyCode: string
  activeStatus: string
  searchQuery: string
  dateFrom: string
  dateTo: string
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:    { label: 'معلق',         color: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/25' },
  confirmed:  { label: 'مؤكد',        color: 'bg-sky-500/15 text-sky-400 border border-sky-500/25' },
  processing: { label: 'قيد التجهيز', color: 'bg-purple-500/15 text-purple-400 border border-purple-500/25' },
  ready:      { label: 'جاهز للشحن',  color: 'bg-orange-500/15 text-orange-400 border border-orange-500/25' },
  shipped:    { label: 'تم الشحن',    color: 'bg-blue-500/15 text-blue-400 border border-blue-500/25' },
  delivered:  { label: 'مُسلّم',      color: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25' },
  cancelled:  { label: 'ملغي',        color: 'bg-red-500/15 text-red-400 border border-red-500/25' },
  returned:   { label: 'مُرتجع',      color: 'bg-rose-500/15 text-rose-400 border border-rose-500/25' },
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'نقداً',
  bank_transfer: 'تحويل بنكي',
}

const STATUS_TABS = [
  { key: 'all',        label: 'الكل' },
  { key: 'pending',    label: 'معلق' },
  { key: 'confirmed',  label: 'مؤكد' },
  { key: 'processing', label: 'قيد التجهيز' },
  { key: 'ready',      label: 'جاهز' },
  { key: 'shipped',    label: 'تم الشحن' },
  { key: 'delivered',  label: 'مُسلّم' },
  { key: 'cancelled',  label: 'ملغي' },
]

const DATE_PRESETS = [
  { key: 'all',       label: 'الكل' },
  { key: 'today',     label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: 'week',      label: '7 أيام' },
  { key: 'month',     label: 'الشهر' },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ar-u-nu-latn', {
    timeZone: BUSINESS_TIME_ZONE,
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function getPresetDates(preset: string): { from: string; to: string } {
  const today = businessDay().date
  const now = new Date(`${today}T12:00:00Z`)
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const d = new Date(now); d.setUTCDate(d.getUTCDate() - 1)
      const s = d.toISOString().split('T')[0]
      return { from: s, to: s }
    }
    case 'week': {
      const d = new Date(now); d.setUTCDate(d.getUTCDate() - 6)
      return { from: d.toISOString().split('T')[0], to: today }
    }
    case 'month': {
      return { from: `${today.slice(0, 7)}-01`, to: today }
    }
    default:
      return { from: '', to: '' }
  }
}

function getActivePreset(from: string, to: string): string {
  if (!from && !to) return 'all'
  for (const p of DATE_PRESETS.slice(1)) {
    const { from: f, to: t } = getPresetDates(p.key)
    if (f === from && t === to) return p.key
  }
  return 'custom'
}

function whatsappUrl(phone: string) {
  return `https://wa.me/${phone.replace(/\D/g, '').replace(/^00/, '')}`
}

// ── Icons ─────────────────────────────────────────────────────────────────

function PhoneIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.85 13 19.79 19.79 0 0 1 1.77 4.38 2 2 0 0 1 3.74 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.06 6.06l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  )
}

function WhatsAppIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
    </svg>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function OrdersTable({
  orders, total, page, pageSize, statusCounts,
  currencyCode, activeStatus, searchQuery,
  dateFrom, dateTo,
}: Props) {
  const router      = useRouter()
  const totalPages  = Math.ceil(total / pageSize)
  const activePreset = getActivePreset(dateFrom, dateTo)

  const [isPending, startTransition] = useTransition()

  // Pull-to-refresh (mobile)
  const startYRef   = useRef(0)
  const pullYRef    = useRef(0)
  const [pullDisplay, setPullDisplay] = useState(0)

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      startYRef.current = window.scrollY === 0 ? e.touches[0].clientY : 0
      pullYRef.current  = 0
    }
    function onTouchMove(e: TouchEvent) {
      if (!startYRef.current) return
      const d = e.touches[0].clientY - startYRef.current
      if (d > 0) {
        const v = Math.min(d * 0.45, 72)
        pullYRef.current = v
        setPullDisplay(v)
      }
    }
    function onTouchEnd() {
      if (pullYRef.current >= 55) startTransition(() => router.refresh())
      pullYRef.current  = 0
      startYRef.current = 0
      setPullDisplay(0)
    }
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove',  onTouchMove,  { passive: true })
    document.addEventListener('touchend',   onTouchEnd)
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove',  onTouchMove)
      document.removeEventListener('touchend',   onTouchEnd)
    }
  }, [router])

  // ── URL builder ───────────────────────────────────────────────────────────

  function buildUrl(overrides: Record<string, string>) {
    const sp = new URLSearchParams()
    if (activeStatus && activeStatus !== 'all') sp.set('status', activeStatus)
    if (searchQuery) sp.set('q', searchQuery)
    if (dateFrom)    sp.set('dateFrom', dateFrom)
    if (dateTo)      sp.set('dateTo',   dateTo)
    sp.set('page', '1')
    for (const [k, v] of Object.entries(overrides)) {
      if (v) sp.set(k, v)
      else   sp.delete(k)
    }
    return `/dashboard/orders?${sp.toString()}`
  }

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value
    router.push(buildUrl({ q, page: '1' }))
  }

  function applyDatePreset(preset: string) {
    const { from, to } = getPresetDates(preset)
    router.push(buildUrl({ dateFrom: from, dateTo: to, page: '1' }))
  }

  const hasFilters = !!(searchQuery || dateFrom || dateTo || (activeStatus && activeStatus !== 'all'))

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Pull-to-refresh indicator (mobile only) ── */}
      <div
        className="md:hidden flex items-center justify-center overflow-hidden transition-[height] duration-200"
        style={{ height: isPending ? '44px' : pullDisplay > 0 ? `${pullDisplay}px` : '0px' }}
      >
        <div className={`flex items-center gap-2 text-sky-400 text-xs transition-opacity ${
          pullDisplay >= 55 || isPending ? 'opacity-100' : 'opacity-50'
        }`}>
          <svg
            width="14" height="14" viewBox="0 0 14 14"
            fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round"
            className={isPending ? 'animate-spin' : ''}
          >
            <path d="M12.5 7a5.5 5.5 0 1 1-1.1-3.3" />
            <polyline points="12.5 1.5 12.5 5 9 5" />
          </svg>
          <span>{isPending ? 'جاري التحديث...' : pullDisplay >= 55 ? 'أفلت للتحديث' : 'اسحب للتحديث'}</span>
        </div>
      </div>

      {/* ── البحث ── */}
      <form onSubmit={handleSearch} className="relative flex items-center">
        {/* search icon */}
        <svg
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500"
          width="15" height="15" viewBox="0 0 15 15"
          fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
        >
          <circle cx="6.5" cy="6.5" r="5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>

        <input
          name="q"
          defaultValue={searchQuery}
          placeholder="ابحث برقم الطلبية أو اسم الزبون أو الهاتف..."
          className="flex-1 rounded-xl border border-white/10 bg-slate-900 py-3 pl-24 pr-10 text-sm text-white placeholder-slate-400 outline-none focus:border-sky-500/50 transition-colors"
        />

        {/* clear */}
        {searchQuery && (
          <Link
            href={buildUrl({ q: '', page: '1' })}
            className="absolute left-[68px] flex h-6 w-6 items-center justify-center rounded-full text-slate-500 hover:bg-white/10 hover:text-slate-300 transition-colors text-xs"
          >
            ✕
          </Link>
        )}

        {/* submit */}
        <button
          type="submit"
          className="absolute left-2 rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-400 hover:bg-sky-500/25 transition-colors"
        >
          بحث
        </button>
      </form>

      {/* ── تبويبات الحالة ── */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {STATUS_TABS.map(tab => {
          const count    = tab.key === 'all' ? total : (statusCounts[tab.key] ?? 0)
          const isActive = activeStatus === tab.key
          return (
            <Link
              key={tab.key}
              href={buildUrl({ status: tab.key === 'all' ? '' : tab.key, page: '1' })}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-sky-500/15 text-sky-400 ring-1 ring-inset ring-sky-500/30'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span className={`min-w-[20px] rounded-full px-1.5 py-0.5 text-center text-xs ${
                  isActive ? 'bg-sky-500/25 text-sky-300' : 'bg-white/10 text-slate-400'
                }`}>
                  {count}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      {/* ── فلتر التاريخ ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-xs text-slate-500">التاريخ:</span>
        <div className="flex gap-1">
          {DATE_PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => applyDatePreset(p.key)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activePreset === p.key
                  ? 'bg-slate-700 text-white ring-1 ring-inset ring-white/10'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {/* Custom date inputs — desktop only */}
        <div className="hidden sm:flex items-center gap-1.5 mr-auto">
          <input
            type="date"
            defaultValue={dateFrom}
            onChange={e => router.push(buildUrl({ dateFrom: e.target.value, page: '1' }))}
            className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-sky-500/50 [color-scheme:dark]"
          />
          <span className="text-slate-600">—</span>
          <input
            type="date"
            defaultValue={dateTo}
            onChange={e => router.push(buildUrl({ dateTo: e.target.value, page: '1' }))}
            className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-sky-500/50 [color-scheme:dark]"
          />
        </div>
      </div>

      {/* ── قائمة فارغة ── */}
      {orders.length === 0 && (
        <div className="rounded-2xl border border-white/5 bg-slate-900 py-16 text-center">
          <p className="text-4xl">📦</p>
          <p className="mt-3 text-slate-300">لا توجد طلبيات</p>
          {hasFilters && (
            <Link
              href="/dashboard/orders"
              className="mt-2 inline-block text-sm text-sky-400 hover:text-sky-300"
            >
              إلغاء الفلاتر
            </Link>
          )}
        </div>
      )}

      {orders.length > 0 && (
        <>
          {/* ──────────── موبايل: بطاقات ──────────── */}
          <div className="md:hidden space-y-3">
            {orders.map(order => {
              const st = STATUS_LABELS[order.status] ?? { label: order.status, color: 'bg-white/10 text-white' }
              return (
                <div key={order.id} className="rounded-2xl border border-white/5 bg-slate-900 p-4">

                  {/* رقم الطلبية + الحالة */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold text-white" dir="ltr">
                      {order.order_number}
                    </span>
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.color}`}>
                      {st.label}
                    </span>
                  </div>

                  {/* الزبون + أزرار الاتصال */}
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {order.customer_name ?? '—'}
                      </p>
                      {order.customer_phone && (
                        <p className="mt-0.5 text-xs text-slate-400" dir="ltr">
                          {order.customer_phone}
                        </p>
                      )}
                    </div>
                    {order.customer_phone && (
                      <div className="flex shrink-0 gap-2">
                        <a
                          href={`tel:${order.customer_phone}`}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-slate-800 text-slate-300 transition-colors hover:border-sky-500/40 hover:bg-sky-500/10 hover:text-sky-400"
                          title="اتصال مباشر"
                        >
                          <PhoneIcon size={15} />
                        </a>
                        <a
                          href={whatsappUrl(order.customer_phone)}
                          target="_blank" rel="noopener noreferrer"
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-green-500/20 bg-green-500/10 text-green-400 transition-colors hover:border-green-500/40 hover:bg-green-500/20"
                          title="واتساب"
                        >
                          <WhatsAppIcon size={15} />
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="my-3 border-t border-white/5" />

                  {/* الإجمالي + طريقة الدفع */}
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs text-slate-400">الإجمالي: </span>
                      <span className="font-bold text-white" dir="ltr">
                        {order.total_amount.toLocaleString('ar-u-nu-latn')} {currencyCode}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400">
                      {PAYMENT_LABELS[order.payment_method] ?? order.payment_method}
                    </span>
                  </div>

                  {/* التاريخ + زر العرض */}
                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-xs text-slate-400">{formatDate(order.created_at)}</p>
                    <Link
                      href={`/dashboard/orders/${order.id}`}
                      className="rounded-xl border border-white/10 px-4 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:border-sky-500/30 hover:bg-sky-500/10 hover:text-sky-400"
                    >
                      عرض ←
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ──────────── ديسكتوب: جدول ──────────── */}
          <div className="hidden md:block overflow-hidden rounded-2xl border border-white/5">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5 bg-slate-900">
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">رقم الطلبية</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الزبون</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">المدينة</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الإجمالي</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الدفع</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الحالة</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">التاريخ</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-slate-900/60">
                {orders.map(order => {
                  const st = STATUS_LABELS[order.status] ?? { label: order.status, color: 'bg-white/10 text-white' }
                  return (
                    <tr key={order.id} className="transition-colors hover:bg-white/[0.03]">

                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-semibold text-white" dir="ltr">
                          {order.order_number}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-white">{order.customer_name ?? '—'}</p>
                        {order.customer_phone && (
                          <p className="text-xs text-slate-400" dir="ltr">{order.customer_phone}</p>
                        )}
                      </td>

                      <td className="px-4 py-3 text-sm text-slate-300">{order.shipping_city ?? '—'}</td>

                      <td className="px-4 py-3 text-sm font-semibold text-white">
                        {order.total_amount.toLocaleString('ar-u-nu-latn')}{' '}
                        <span className="text-xs font-normal text-slate-400">{currencyCode}</span>
                      </td>

                      <td className="px-4 py-3 text-sm text-slate-300">
                        {PAYMENT_LABELS[order.payment_method] ?? order.payment_method}
                      </td>

                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${st.color}`}>
                          {st.label}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-400">
                        {formatDate(order.created_at)}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {order.customer_phone && (
                            <>
                              <a
                                href={`tel:${order.customer_phone}`}
                                className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-sky-500/10 hover:text-sky-400"
                                title="اتصال"
                              >
                                <PhoneIcon />
                              </a>
                              <a
                                href={whatsappUrl(order.customer_phone)}
                                target="_blank" rel="noopener noreferrer"
                                className="rounded-lg p-1.5 text-green-600 transition-colors hover:bg-green-500/10 hover:text-green-400"
                                title="واتساب"
                              >
                                <WhatsAppIcon />
                              </a>
                            </>
                          )}
                          <Link
                            href={`/dashboard/orders/${order.id}`}
                            className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                          >
                            تفاصيل
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── الترقيم ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-slate-400">
            صفحة {page} من {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={buildUrl({ page: String(page - 1) })}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5"
              >
                السابق
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={buildUrl({ page: String(page + 1) })}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5"
              >
                التالي
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
