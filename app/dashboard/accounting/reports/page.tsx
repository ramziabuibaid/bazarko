import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ReportsPeriodFilter from '@/components/dashboard/accounting/ReportsPeriodFilter'

interface SearchParams { period?: string; from?: string; to?: string }

const MONTH_NAMES = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

function getDateRange(period: string, from?: string, to?: string) {
  const now = new Date()

  if (period === 'custom' && from && to) {
    return { start: from, end: to, label: `${from} ← ${to}` }
  }
  if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3)
    const start = new Date(now.getFullYear(), q * 3, 1)
    const end   = new Date(now.getFullYear(), q * 3 + 3, 0)
    return {
      start: start.toISOString().slice(0, 10),
      end:   end.toISOString().slice(0, 10),
      label: `الربع ${q + 1} — ${now.getFullYear()}`,
    }
  }
  if (period === 'year') {
    return {
      start: `${now.getFullYear()}-01-01`,
      end:   `${now.getFullYear()}-12-31`,
      label: `سنة ${now.getFullYear()}`,
    }
  }
  // default: current month
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return {
    start: start.toISOString().slice(0, 10),
    end:   end.toISOString().slice(0, 10),
    label: `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`,
  }
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
    .from('stores')
    .select('id, currency_code, name')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  const period = searchParams.period ?? 'month'
  const { start, end, label } = getDateRange(period, searchParams.from, searchParams.to)

  type OrderRow   = { total_amount: number | null; payment_status: string }
  type VoucherRow = { amount: number; date: string; category: string | null; type?: string }

  const [
    { data: orders },
    { data: receipts },
    { data: payments },
    { data: cashFlowVouchers },
  ] = await Promise.all([
    supabase
      .from('orders')
      .select('total_amount, payment_status')
      .eq('store_id', store.id)
      .gte('created_at', start)
      .lte('created_at', end + 'T23:59:59'),
    supabase
      .from('vouchers')
      .select('amount, date, category')
      .eq('store_id', store.id)
      .eq('type', 'receipt')
      .gte('date', start)
      .lte('date', end),
    supabase
      .from('vouchers')
      .select('amount, date, category')
      .eq('store_id', store.id)
      .eq('type', 'payment')
      .gte('date', start)
      .lte('date', end),
    supabase
      .from('vouchers')
      .select('amount, date, type')
      .eq('store_id', store.id)
      .gte('date', getLast6Months()[0].start)
      .lte('date', getLast6Months()[5].end),
  ])

  // ── P&L ──────────────────────────────────────────
  const ordersArr2     = (orders ?? []) as OrderRow[]
  const receiptsArr    = (receipts ?? []) as VoucherRow[]
  const paymentsArr    = (payments ?? []) as VoucherRow[]
  const cfVouchers     = (cashFlowVouchers ?? []) as VoucherRow[]

  const ordersRevenue  = ordersArr2.reduce((s, o) => s + (o.total_amount ?? 0), 0)
  const receiptsTotal  = receiptsArr.reduce((s, v) => s + v.amount, 0)
  const paymentsTotal  = paymentsArr.reduce((s, v) => s + v.amount, 0)
  const totalIncome    = ordersRevenue + receiptsTotal
  const netProfit      = totalIncome - paymentsTotal
  const margin         = totalIncome > 0 ? Math.round((netProfit / totalIncome) * 100) : null

  // ── Expense breakdown ─────────────────────────────
  const expenseByCategory: Record<string, number> = {}
  paymentsArr.forEach(v => {
    const cat = v.category ?? 'أخرى'
    expenseByCategory[cat] = (expenseByCategory[cat] ?? 0) + v.amount
  })
  const expenseCategories = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1])

  // ── Cash flow per month ───────────────────────────
  const last6 = getLast6Months()
  const cashFlow = last6.map(m => {
    const mv = cfVouchers.filter(v => v.date >= m.start && v.date <= m.end)
    const r  = mv.filter(v => v.type === 'receipt').reduce((s, v) => s + v.amount, 0)
    const p  = mv.filter(v => v.type === 'payment').reduce((s, v) => s + v.amount, 0)
    return { ...m, receipts: r, payments: p }
  })
  const maxBar = Math.max(...cashFlow.flatMap(m => [m.receipts, m.payments]), 1)

  // ── Order stats ───────────────────────────────────
  const paidOrders  = ordersArr2.filter(o => o.payment_status === 'paid').length
  const avgOrder    = ordersArr2.length > 0 ? ordersRevenue / ordersArr2.length : 0

  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 0 })
  const cc  = store.currency_code

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/dashboard/accounting"
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          ← المحاسبة
        </Link>
        <h1 className="text-xl font-semibold text-white">التقارير المالية</h1>
        <span className="text-sm text-slate-500">{label}</span>
      </div>

      {/* Period Filter */}
      <ReportsPeriodFilter current={period} from={searchParams.from} to={searchParams.to} />

      {/* P&L Summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Income */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="mb-1 text-xs text-slate-400">إجمالي الإيرادات</p>
          <p className="text-2xl font-bold text-emerald-400" dir="ltr">{fmt(totalIncome)} {cc}</p>
          <div className="mt-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">مبيعات الطلبيات</span>
              <span className="text-slate-400" dir="ltr">{fmt(ordersRevenue)} {cc}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">سندات قبض</span>
              <span className="text-slate-400" dir="ltr">{fmt(receiptsTotal)} {cc}</span>
            </div>
          </div>
        </div>

        {/* Expenses */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="mb-1 text-xs text-slate-400">إجمالي المصاريف</p>
          <p className="text-2xl font-bold text-red-400" dir="ltr">{fmt(paymentsTotal)} {cc}</p>
          <p className="mt-3 text-xs text-slate-500">
            {expenseCategories.length} {expenseCategories.length === 1 ? 'تصنيف' : 'تصنيفات'} مصاريف مسجّلة
          </p>
        </div>

        {/* Net Profit */}
        <div className={`rounded-2xl border p-5 ${
          netProfit >= 0
            ? 'border-emerald-500/20 bg-emerald-500/5'
            : 'border-red-500/20 bg-red-500/5'
        }`}>
          <p className="mb-1 text-xs text-slate-400">صافي الربح</p>
          <p className={`text-2xl font-bold ${netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`} dir="ltr">
            {netProfit >= 0 ? '+' : ''}{fmt(netProfit)} {cc}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            {margin !== null ? `هامش الربح ${margin}%` : 'لا إيرادات في هذه الفترة'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Cash Flow Chart */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <h2 className="mb-5 text-sm font-semibold text-white">التدفق النقدي — آخر 6 أشهر</h2>
          <div className="flex items-end gap-2" style={{ height: '140px' }}>
            {cashFlow.map(m => (
              <div key={m.key} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full items-end gap-0.5" style={{ height: '110px' }}>
                  <div
                    className="flex-1 rounded-t-md bg-emerald-500/50 transition-all"
                    style={{ height: `${m.receipts > 0 ? Math.max(3, (m.receipts / maxBar) * 110) : 2}px` }}
                    title={`مقبوضات: ${fmt(m.receipts)} ${cc}`}
                  />
                  <div
                    className="flex-1 rounded-t-md bg-red-500/50 transition-all"
                    style={{ height: `${m.payments > 0 ? Math.max(3, (m.payments / maxBar) * 110) : 2}px` }}
                    title={`مدفوعات: ${fmt(m.payments)} ${cc}`}
                  />
                </div>
                <span className="text-[10px] text-slate-500">{m.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-5 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/50" />مقبوضات
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-500/50" />مدفوعات
            </span>
          </div>
        </div>

        {/* Expense Breakdown */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <h2 className="mb-5 text-sm font-semibold text-white">توزيع المصاريف</h2>
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
                    <div
                      className="h-full rounded-full bg-red-500/60 transition-all"
                      style={{ width: `${(amount / paymentsTotal) * 100}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {Math.round((amount / paymentsTotal) * 100)}% من إجمالي المصاريف
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Orders Summary */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">ملخص الطلبيات</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: 'إجمالي الطلبيات',   value: ordersArr2.length,           cls: 'text-white',       dir: false },
            { label: 'طلبيات مكتملة الدفع', value: paidOrders,                cls: 'text-emerald-400', dir: false },
            { label: 'قيد التنفيذ',        value: ordersArr2.length - paidOrders, cls: 'text-yellow-400', dir: false },
            { label: 'متوسط قيمة الطلبية', value: `${fmt(avgOrder)} ${cc}`,  cls: 'text-sky-400',     dir: true  },
          ].map(item => (
            <div key={item.label} className="rounded-xl bg-white/3 p-4 text-center">
              <p className="mb-1 text-xs text-slate-500">{item.label}</p>
              <p className={`text-xl font-bold ${item.cls}`} dir={item.dir ? 'ltr' : undefined}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
