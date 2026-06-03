'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

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
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:    { label: 'معلق',           color: 'bg-yellow-500/15 text-yellow-400' },
  confirmed:  { label: 'مؤكد',          color: 'bg-sky-500/15 text-sky-400' },
  processing: { label: 'قيد التجهيز',   color: 'bg-purple-500/15 text-purple-400' },
  ready:      { label: 'جاهز للشحن',    color: 'bg-orange-500/15 text-orange-400' },
  shipped:    { label: 'تم الشحن',      color: 'bg-blue-500/15 text-blue-400' },
  delivered:  { label: 'مُسلّم',        color: 'bg-emerald-500/15 text-emerald-400' },
  cancelled:  { label: 'ملغي',          color: 'bg-red-500/15 text-red-400' },
  returned:   { label: 'مُرتجع',        color: 'bg-rose-500/15 text-rose-400' },
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
  { key: 'ready',      label: 'جاهز للشحن' },
  { key: 'shipped',    label: 'تم الشحن' },
  { key: 'delivered',  label: 'مُسلّم' },
  { key: 'cancelled',  label: 'ملغي' },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ar', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function OrdersTable({
  orders,
  total,
  page,
  pageSize,
  statusCounts,
  currencyCode,
  activeStatus,
  searchQuery,
}: Props) {
  const router = useRouter()
  const totalPages = Math.ceil(total / pageSize)

  function buildUrl(params: Record<string, string>) {
    const sp = new URLSearchParams()
    if (activeStatus && activeStatus !== 'all') sp.set('status', activeStatus)
    if (searchQuery) sp.set('q', searchQuery)
    sp.set('page', '1')
    for (const [k, v] of Object.entries(params)) {
      if (v) sp.set(k, v)
      else sp.delete(k)
    }
    return `/dashboard/orders?${sp.toString()}`
  }

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value
    router.push(buildUrl({ q, page: '1' }))
  }

  return (
    <div className="space-y-4">
      {/* تبويبات الحالة */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {STATUS_TABS.map(tab => (
          <Link
            key={tab.key}
            href={buildUrl({ status: tab.key === 'all' ? '' : tab.key, page: '1' })}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
              activeStatus === tab.key || (tab.key === 'all' && activeStatus === 'all')
                ? 'bg-sky-500/15 text-sky-400'
                : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            {tab.label}
            {tab.key !== 'all' && statusCounts[tab.key] ? (
              <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-xs">
                {statusCounts[tab.key]}
              </span>
            ) : null}
            {tab.key === 'all' && (
              <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-xs">{total}</span>
            )}
          </Link>
        ))}
      </div>

      {/* البحث */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          name="q"
          defaultValue={searchQuery}
          placeholder="ابحث برقم الطلبية أو اسم الزبون أو رقم الهاتف..."
          className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
        />
        <button
          type="submit"
          className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
        >
          بحث
        </button>
        {searchQuery && (
          <Link
            href={buildUrl({ q: '', page: '1' })}
            className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </Link>
        )}
      </form>

      {/* فارغ */}
      {orders.length === 0 && (
        <div className="rounded-2xl border border-white/5 bg-white/3 py-16 text-center">
          <p className="text-4xl">📦</p>
          <p className="mt-3 text-slate-400">لا توجد طلبيات</p>
        </div>
      )}

      {orders.length > 0 && (
        <>
          {/* ── موبايل: بطاقات ── */}
          <div className="md:hidden space-y-3">
            {orders.map(order => {
              const st = STATUS_LABELS[order.status] ?? { label: order.status, color: 'bg-white/10 text-white' }
              return (
                <div key={order.id} className="rounded-2xl border border-white/5 bg-slate-900 p-4">
                  {/* رقم الطلبية + الحالة */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-white" dir="ltr">
                      {order.order_number}
                    </span>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${st.color}`}>
                      {st.label}
                    </span>
                  </div>

                  {/* الزبون */}
                  <div className="mt-2.5">
                    <p className="text-sm font-medium text-white">{order.customer_name ?? '—'}</p>
                    {order.customer_phone && (
                      <p className="mt-0.5 text-xs text-slate-400" dir="ltr">{order.customer_phone}</p>
                    )}
                  </div>

                  {/* فاصل */}
                  <div className="my-3 border-t border-white/5" />

                  {/* الإجمالي + طريقة الدفع */}
                  <div className="flex items-center justify-between text-sm">
                    <div>
                      <span className="text-xs text-slate-500">الإجمالي: </span>
                      <span className="font-bold text-white" dir="ltr">
                        {order.total_amount.toLocaleString('ar')} {currencyCode}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500">الدفع: </span>
                      <span className="text-xs text-slate-300">
                        {PAYMENT_LABELS[order.payment_method] ?? order.payment_method}
                      </span>
                    </div>
                  </div>

                  {/* التاريخ + زر العرض */}
                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-xs text-slate-500">{formatDate(order.created_at)}</p>
                    <Link
                      href={`/dashboard/orders/${order.id}`}
                      className="rounded-xl border border-white/10 px-4 py-1.5 text-xs font-semibold text-slate-300 hover:border-sky-500/30 hover:bg-sky-500/10 hover:text-sky-400 transition-colors"
                    >
                      عرض ←
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── ديسكتوب: جدول ── */}
          <div className="hidden md:block overflow-hidden rounded-2xl border border-white/5">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5 bg-white/3">
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
              <tbody className="divide-y divide-white/5">
                {orders.map(order => {
                  const st = STATUS_LABELS[order.status] ?? { label: order.status, color: 'bg-white/10 text-white' }
                  return (
                    <tr key={order.id} className="hover:bg-white/3 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm text-white" dir="ltr">{order.order_number}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-white">{order.customer_name ?? '—'}</p>
                        {order.customer_phone && (
                          <p className="text-xs text-slate-500" dir="ltr">{order.customer_phone}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">{order.shipping_city ?? '—'}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-white">
                        {order.total_amount.toLocaleString('ar')} {currencyCode}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">
                        {PAYMENT_LABELS[order.payment_method] ?? order.payment_method}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${st.color}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {formatDate(order.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/orders/${order.id}`}
                          className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
                        >
                          تفاصيل
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* الترقيم */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-slate-500">
            صفحة {page} من {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={buildUrl({ page: String(page - 1) })}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
              >
                السابق
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={buildUrl({ page: String(page + 1) })}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
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
