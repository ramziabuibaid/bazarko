import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ReportsPeriodFilter from '@/components/dashboard/accounting/ReportsPeriodFilter'

interface SearchParams { period?: string; from?: string; to?: string }

const MONTH_NAMES = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

function getDateRange(period: string, from?: string, to?: string) {
  const now = new Date()
  if (period === 'custom' && from && to) return { start: from, end: to, label: `${from} ← ${to}` }
  if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3)
    const start = new Date(now.getFullYear(), q * 3, 1)
    const end   = new Date(now.getFullYear(), q * 3 + 3, 0)
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label: `الربع ${q + 1} — ${now.getFullYear()}` }
  }
  if (period === 'year') {
    return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31`, label: `سنة ${now.getFullYear()}` }
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label: `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}` }
}

function getLast6Months() {
  const now = new Date()
  return Array.from({ length: 6 }, (_, i) => {
    const d     = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const start = d.toISOString().slice(0, 10)
    const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
    return { start, end, label: MONTH_NAMES[d.getMonth()], key: start.slice(0, 7) }
  })
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores').select('id, currency_code, name').eq('id', storeId).single()
  if (!store) redirect('/onboarding')

  const period = searchParams.period ?? 'month'
  const { start, end, label } = getDateRange(period, searchParams.from, searchParams.to)

  // نطاقات التدفق النقدي (دائماً حالية، مستقلة عن فلتر P&L)
  const now = new Date()
  const todayStr  = now.toISOString().slice(0, 10)
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay())
  const weekStartStr  = weekStart.toISOString().slice(0, 10)
  const monthStartStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const sixMonthsStart = getLast6Months()[0].start

  const [
    { data: orders },
    { data: payments },
    { data: movements },
  ] = await Promise.all([
    supabase.from('orders')
      .select('id, total_amount, payment_status')
      .eq('store_id', store.id)
      .not('status', 'eq', 'cancelled')
      .gte('created_at', start)
      .lte('created_at', end + 'T23:59:59'),
    supabase.from('vouchers')
      .select('amount, category')
      .eq('store_id', store.id).eq('type', 'payment')
      .gte('date', start).lte('date', end),
    supabase.from('cash_movements')
      .select('direction, amount, date')
      .eq('store_id', store.id)
      .gte('date', sixMonthsStart),
  ])

  type OrderRow = { id: string; total_amount: number | null; payment_status: string }
  const ordersArr = (orders ?? []) as OrderRow[]
  const sales = ordersArr.reduce((s, o) => s + (o.total_amount ?? 0), 0)

  // ── تكلفة البضاعة المباعة (COGS) من بنود الطلبيات ──
  const orderIds = ordersArr.map(o => o.id)
  let cogs = 0
  if (orderIds.length > 0) {
    const { data: lineItems } = await supabase
      .from('order_items')
      .select('quantity, cost_price')
      .in('order_id', orderIds)
    cogs = (lineItems ?? []).reduce(
      (s, li: { quantity: number; cost_price: number | null }) => s + (li.cost_price ?? 0) * li.quantity, 0,
    )
  }

  const paymentsArr  = (payments ?? []) as { amount: number; category: string | null }[]
  const expenses     = paymentsArr.reduce((s, v) => s + v.amount, 0)

  const grossProfit  = sales - cogs
  const grossMargin  = sales > 0 ? Math.round((grossProfit / sales) * 100) : null
  const netProfit    = grossProfit - expenses
  const netMargin    = sales > 0 ? Math.round((netProfit / sales) * 100) : null

  // ── توزيع المصاريف ──
  const expenseByCategory: Record<string, number> = {}
  paymentsArr.forEach(v => {
    const cat = v.category ?? 'أخرى'
    expenseByCategory[cat] = (expenseByCategory[cat] ?? 0) + v.amount
  })
  const expenseCategories = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1])

  // ── التدفق النقدي من دفتر الصندوق ──
  const mv = (movements ?? []) as { direction: string; amount: number; date: string }[]
  const flowFor = (fromDate: string) => {
    const rows = mv.filter(m => m.date >= fromDate)
    const inn = rows.filter(m => m.direction === 'in').reduce((s, m) => s + m.amount, 0)
    const out = rows.filter(m => m.direction === 'out').reduce((s, m) => s + m.amount, 0)
    return { in: inn, out, net: inn - out }
  }
  const flowToday = flowFor(todayStr)
  const flowWeek  = flowFor(weekStartStr)
  const flowMonth = flowFor(monthStartStr)

  const last6 = getLast6Months()
  const cashFlow = last6.map(m => {
    const rows = mv.filter(v => v.date >= m.start && v.date <= m.end)
    return {
      ...m,
      in:  rows.filter(v => v.direction === 'in').reduce((s, v) => s + v.amount, 0),
      out: rows.filter(v => v.direction === 'out').reduce((s, v) => s + v.amount, 0),
    }
  })
  const maxBar = Math.max(...cashFlow.flatMap(m => [m.in, m.out]), 1)

  // ── ملخص الطلبيات ──
  const paidOrders = ordersArr.filter(o => o.payment_status === 'paid').length
  const avgOrder   = ordersArr.length > 0 ? sales / ordersArr.length : 0

  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 0 })
  const cc  = store.currency_code

  const flowCards = [
    { label: 'اليوم',     f: flowToday },
    { label: 'هذا الأسبوع', f: flowWeek },
    { label: 'هذا الشهر',  f: flowMonth },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/dashboard/accounting" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          ← المحاسبة
        </Link>
        <h1 className="text-xl font-semibold text-white">📊 التقارير المالية</h1>
        <span className="text-sm text-slate-500">{label}</span>
      </div>

      <ReportsPeriodFilter current={period} from={searchParams.from} to={searchParams.to} />

      {/* ══ الأرباح والخسائر (P&L) ══ */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">الأرباح والخسائر — {label}</h2>
        <div className="mx-auto max-w-lg space-y-2.5 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-slate-300">المبيعات</span>
            <span className="font-semibold text-emerald-400" dir="ltr">{fmt(sales)} {cc}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-400">− تكلفة البضاعة المباعة</span>
            <span className="text-red-400" dir="ltr">{fmt(cogs)} {cc}</span>
          </div>
          <div className="flex justify-between border-t border-white/10 py-2 font-semibold">
            <span className="text-white">= الربح الإجمالي {grossMargin !== null && <span className="text-xs font-normal text-slate-500">({grossMargin}%)</span>}</span>
            <span className={grossProfit >= 0 ? 'text-emerald-400' : 'text-red-400'} dir="ltr">{fmt(grossProfit)} {cc}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-400">− المصروفات التشغيلية</span>
            <span className="text-red-400" dir="ltr">{fmt(expenses)} {cc}</span>
          </div>
          <div className={`flex justify-between rounded-xl border px-4 py-3 text-base font-bold ${
            netProfit >= 0 ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'
          }`}>
            <span className="text-white">= صافي الربح {netMargin !== null && <span className="text-xs font-normal text-slate-500">(هامش {netMargin}%)</span>}</span>
            <span className={netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'} dir="ltr">
              {netProfit >= 0 ? '+' : ''}{fmt(netProfit)} {cc}
            </span>
          </div>
        </div>
      </div>

      {/* ══ التدفق النقدي ══ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {flowCards.map(c => (
          <div key={c.label} className="rounded-2xl border border-white/5 bg-slate-900 p-4">
            <p className="mb-2 text-xs font-semibold text-slate-400">التدفق النقدي — {c.label}</p>
            <div className="flex items-center justify-between text-sm">
              <span className="text-emerald-400" dir="ltr">↓ {fmt(c.f.in)}</span>
              <span className="text-red-400" dir="ltr">↑ {fmt(c.f.out)}</span>
            </div>
            <p className={`mt-2 text-xl font-bold tabular-nums ${c.f.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`} dir="ltr">
              {c.f.net >= 0 ? '+' : ''}{fmt(c.f.net)} {cc}
            </p>
            <p className="text-[11px] text-slate-600">صافي النقد</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* رسم التدفق النقدي 6 أشهر */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <h2 className="mb-5 text-sm font-semibold text-white">التدفق النقدي — آخر 6 أشهر</h2>
          <div className="flex items-end gap-2" style={{ height: '140px' }}>
            {cashFlow.map(m => (
              <div key={m.key} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full items-end gap-0.5" style={{ height: '110px' }}>
                  <div className="flex-1 rounded-t-md bg-emerald-500/50" style={{ height: `${m.in > 0 ? Math.max(3, (m.in / maxBar) * 110) : 2}px` }} title={`داخل: ${fmt(m.in)} ${cc}`} />
                  <div className="flex-1 rounded-t-md bg-red-500/50" style={{ height: `${m.out > 0 ? Math.max(3, (m.out / maxBar) * 110) : 2}px` }} title={`خارج: ${fmt(m.out)} ${cc}`} />
                </div>
                <span className="text-[10px] text-slate-500">{m.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-5 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/50" />داخل</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-500/50" />خارج</span>
          </div>
        </div>

        {/* توزيع المصاريف */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <h2 className="mb-5 text-sm font-semibold text-white">توزيع المصاريف — {label}</h2>
          {expenseCategories.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <p className="text-sm text-slate-500">لا مصاريف مسجّلة في هذه الفترة</p>
            </div>
          ) : (
            <div className="space-y-4">
              {expenseCategories.map(([cat, amount]) => (
                <div key={cat}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="text-slate-300">{cat}</span>
                    <span className="font-medium text-slate-300" dir="ltr">{fmt(amount)} {cc}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                    <div className="h-full rounded-full bg-red-500/60" style={{ width: `${(amount / expenses) * 100}%` }} />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600">{Math.round((amount / expenses) * 100)}% من إجمالي المصاريف</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ملخص الطلبيات */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">ملخص الطلبيات — {label}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: 'إجمالي الطلبيات',     value: ordersArr.length,                cls: 'text-white',       dir: false },
            { label: 'مكتملة الدفع',         value: paidOrders,                     cls: 'text-emerald-400', dir: false },
            { label: 'قيد التنفيذ',          value: ordersArr.length - paidOrders,  cls: 'text-yellow-400',  dir: false },
            { label: 'متوسط قيمة الطلبية',   value: `${fmt(avgOrder)} ${cc}`,       cls: 'text-sky-400',     dir: true  },
          ].map(item => (
            <div key={item.label} className="rounded-xl bg-white/3 p-4 text-center">
              <p className="mb-1 text-xs text-slate-500">{item.label}</p>
              <p className={`text-xl font-bold ${item.cls}`} dir={item.dir ? 'ltr' : undefined}>{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
