import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import AccountingPeriodFilter from '@/components/dashboard/accounting/AccountingPeriodFilter'

type PctChange = { up: boolean; pct: number; label: string } | null

function calcPct(current: number, prev: number, compareLabel: string): PctChange {
  if (prev === 0) return null
  const pct = ((current - prev) / Math.abs(prev)) * 100
  return { up: pct >= 0, pct: Math.abs(Math.round(pct)), label: `${pct >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(pct))}٪ ${compareLabel}` }
}

interface Props {
  searchParams: { period?: string }
}

export default async function AccountingPage({ searchParams }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  // ── حساب نطاق التاريخ بناءً على الفترة ────────────────────────

  const now    = new Date()
  const period = searchParams.period ?? 'month'

  let periodStart: Date
  let periodEnd:   Date = now
  let prevStart:   Date
  let prevEnd:     Date
  let periodLabel: string
  let compareLabel: string

  switch (period) {
    case 'today': {
      periodStart = new Date(now); periodStart.setHours(0, 0, 0, 0)
      prevEnd     = new Date(periodStart)
      prevStart   = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - 1)
      periodLabel  = 'اليوم'
      compareLabel = 'عن أمس'
      break
    }
    case 'week': {
      // أول يوم في الأسبوع الحالي (الأحد)
      periodStart = new Date(now); periodStart.setDate(now.getDate() - now.getDay()); periodStart.setHours(0, 0, 0, 0)
      prevEnd     = new Date(periodStart)
      prevStart   = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - 7)
      periodLabel  = 'هذا الأسبوع'
      compareLabel = 'عن الأسبوع الماضي'
      break
    }
    case 'last_month': {
      periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      periodEnd   = new Date(now.getFullYear(), now.getMonth(), 1)
      prevStart   = new Date(now.getFullYear(), now.getMonth() - 2, 1)
      prevEnd     = new Date(periodStart)
      periodLabel  = periodStart.toLocaleDateString('ar', { month: 'long', year: 'numeric' })
      compareLabel = 'عن الشهر قبله'
      break
    }
    default: { // month
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
      prevStart   = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      prevEnd     = new Date(periodStart)
      periodLabel  = now.toLocaleDateString('ar', { month: 'long', year: 'numeric' })
      compareLabel = 'عن الشهر الماضي'
      break
    }
  }

  const pStartStr    = periodStart.toISOString()
  const pEndStr      = periodEnd.toISOString()
  const prevStartStr = prevStart.toISOString()
  const prevEndStr   = prevEnd.toISOString()

  // ── جلب البيانات ─────────────────────────────────────────────

  const [
    { data: rawOrders },
    { data: rawVouchers },
    { data: rawInvoices },
    { data: customers },
  ] = await Promise.all([
    // الطلبيات من بداية الفترة السابقة (للمقارنة)
    supabase
      .from('orders')
      .select('total, amount_paid, created_at')
      .eq('store_id', store.id)
      .in('status', ['delivered', 'processing', 'confirmed', 'ready'])
      .gte('created_at', prevStartStr),

    // السندات من بداية الفترة السابقة
    supabase
      .from('vouchers')
      .select('type, amount, date')
      .eq('store_id', store.id)
      .gte('date', prevStartStr.slice(0, 10)),

    // الفواتير في الفترة الحالية فقط
    supabase
      .from('invoices')
      .select('total, amount_paid, status, created_at')
      .eq('store_id', store.id)
      .gte('created_at', pStartStr)
      .lte('created_at', pEndStr),

    // ذمم الزبائن — دائماً حالية بغض النظر عن الفترة
    supabase
      .from('customers')
      .select('balance')
      .eq('store_id', store.id)
      .gt('balance', 0),
  ])

  type OrderRow   = { total: number | null; amount_paid: number | null; created_at: string }
  type VoucherRow = { type: string; amount: number; date: string }
  type InvoiceRow = { total: number | null; amount_paid: number | null; status: string; created_at: string }

  // ── تصفية الطلبيات ──────────────────────────────────────────

  const allOrders    = (rawOrders   ?? []) as OrderRow[]
  const periodOrders = allOrders.filter(o => o.created_at >= pStartStr && o.created_at < pEndStr)
  const prevOrders   = allOrders.filter(o => o.created_at >= prevStartStr && o.created_at < prevEndStr)

  const periodRevenue = periodOrders.reduce((s, o) => s + (o.amount_paid ?? 0), 0)
  const prevRevenue   = prevOrders.reduce((s, o) => s + (o.amount_paid ?? 0), 0)
  const outstanding   = periodOrders.reduce((s, o) => s + Math.max(0, (o.total ?? 0) - (o.amount_paid ?? 0)), 0)

  // ── تصفية السندات ────────────────────────────────────────────

  const pDateStart = pStartStr.slice(0, 10)
  const pDateEnd   = pEndStr.slice(0, 10)
  const prDateStart = prevStartStr.slice(0, 10)
  const prDateEnd   = prevEndStr.slice(0, 10)

  const allVouchers   = (rawVouchers ?? []) as VoucherRow[]
  const periodVouchers = allVouchers.filter(v => v.date >= pDateStart && v.date < pDateEnd)
  const prevVouchers   = allVouchers.filter(v => v.date >= prDateStart && v.date < prDateEnd)

  const periodReceipts = periodVouchers.filter(v => v.type === 'receipt').reduce((s, v) => s + v.amount, 0)
  const periodPayments = periodVouchers.filter(v => v.type === 'payment').reduce((s, v) => s + v.amount, 0)
  const prevReceipts   = prevVouchers.filter(v => v.type === 'receipt').reduce((s, v) => s + v.amount, 0)
  const prevPayments   = prevVouchers.filter(v => v.type === 'payment').reduce((s, v) => s + v.amount, 0)

  const netProfit = periodReceipts - periodPayments
  const prevNet   = prevReceipts   - prevPayments

  // ── الفواتير ─────────────────────────────────────────────────

  const allInvoices    = (rawInvoices ?? []) as InvoiceRow[]
  const invoicesPaid   = allInvoices.filter(i => i.status === 'paid').length
  const invoicesDraft  = allInvoices.filter(i => i.status === 'draft').length
  const invoicesPaidAmt = allInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total ?? 0), 0)

  // ── الذمم ────────────────────────────────────────────────────

  const totalDebt = ((customers ?? []) as { balance: number }[]).reduce((s, c) => s + (c.balance ?? 0), 0)

  const netChange = calcPct(netProfit,    prevNet,      compareLabel)
  const revChange = calcPct(periodRevenue, prevRevenue, compareLabel)

  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 0 })
  const cur = store.currency_code

  const cards = [
    {
      label: 'الإيرادات',   sub: `طلبيات — ${periodLabel}`,
      value: fmt(periodRevenue), change: revChange,
      color: 'text-emerald-400', border: 'border-emerald-500/10',
      href: '/dashboard/accounting/invoices',
    },
    {
      label: 'المصروفات',   sub: `سندات الصرف — ${periodLabel}`,
      value: fmt(periodPayments), change: null,
      color: 'text-red-400', border: 'border-red-500/10',
      href: '/dashboard/accounting/payments',
    },
    {
      label: 'المقبوضات',   sub: `سندات القبض — ${periodLabel}`,
      value: fmt(periodReceipts), change: null,
      color: 'text-sky-400', border: 'border-sky-500/10',
      href: '/dashboard/accounting/receipts',
    },
    {
      label: 'المستحقات',   sub: 'أرصدة الزبائن — الآن',
      value: fmt(totalDebt), change: null,
      color: 'text-amber-400', border: 'border-amber-500/10',
      href: '/dashboard/customers',
    },
  ]

  return (
    <div className="space-y-5 p-4 sm:p-6">

      {/* العنوان + فلتر الفترة */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">المحاسبة والمالية</h1>
          <p className="mt-0.5 text-sm text-slate-400">{periodLabel}</p>
        </div>
        <AccountingPeriodFilter active={period} />
      </div>

      {/* ── صافي الربح — البطاقة الرئيسية ── */}
      <div className={`rounded-2xl border p-5 sm:p-6 ${
        netProfit > 0 ? 'border-emerald-500/20 bg-emerald-500/5' :
        netProfit < 0 ? 'border-red-500/20 bg-red-500/5' :
                        'border-white/5 bg-slate-900'
      }`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              صافي الربح — {periodLabel}
            </p>

            <p
              dir="ltr"
              className={`mt-2 text-4xl font-bold tabular-nums sm:text-5xl ${
                netProfit > 0 ? 'text-emerald-400' :
                netProfit < 0 ? 'text-red-400' : 'text-slate-300'
              }`}
            >
              {netProfit > 0 ? '+' : ''}{fmt(netProfit)}
              <span className="mr-2 text-lg font-normal text-slate-400">{cur}</span>
            </p>

            <p className="mt-2.5 text-xs text-slate-500">
              مقبوضات{' '}
              <span className="font-semibold text-emerald-400">{fmt(periodReceipts)}</span>
              {' '}−{' '}
              مصروفات{' '}
              <span className="font-semibold text-red-400">{fmt(periodPayments)}</span>
            </p>

            {netChange && (
              <p className={`mt-2 text-sm font-bold ${netChange.up ? 'text-emerald-400' : 'text-red-400'}`}>
                {netChange.label}
              </p>
            )}
            {!netChange && prevNet === 0 && netProfit !== 0 && (
              <p className="mt-2 text-xs text-slate-500">لا توجد بيانات الفترة السابقة للمقارنة</p>
            )}
          </div>
          <div className="shrink-0 text-4xl">{netProfit >= 0 ? '📈' : '📉'}</div>
        </div>
      </div>

      {/* ── 4 بطاقات ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(card => (
          <Link
            key={card.label}
            href={card.href}
            className={`rounded-2xl border bg-slate-900 p-4 sm:p-5 transition-colors hover:bg-slate-800 ${card.border}`}
          >
            <p className="text-xs font-semibold text-slate-400">{card.label}</p>
            <p dir="ltr" className={`mt-2 text-2xl font-bold tabular-nums sm:text-3xl ${card.color}`}>
              {card.value}
            </p>
            <p className="mt-1 text-[11px] text-slate-600">{cur} · {card.sub}</p>
            {card.change && (
              <p className={`mt-1.5 text-[11px] font-bold ${card.change.up ? 'text-emerald-400' : 'text-red-400'}`}>
                {card.change.label}
              </p>
            )}
          </Link>
        ))}
      </div>

      {/* ── ملخص إضافي ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-400">إيرادات الطلبيات</p>
          <p dir="ltr" className="mt-2 text-2xl font-bold tabular-nums text-white sm:text-3xl">
            {fmt(periodRevenue)}
            <span className="mr-1 text-sm font-normal text-slate-500">{cur}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{periodOrders.length} طلبية في الفترة</p>
        </div>

        <div className="rounded-2xl border border-amber-500/10 bg-slate-900 p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-400">مستحق التحصيل</p>
          <p dir="ltr" className="mt-2 text-2xl font-bold tabular-nums text-amber-400 sm:text-3xl">
            {fmt(outstanding)}
            <span className="mr-1 text-sm font-normal text-slate-500">{cur}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{invoicesDraft} فاتورة غير مدفوعة في الفترة</p>
        </div>

        <div className="rounded-2xl border border-emerald-500/10 bg-slate-900 p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-400">فواتير محصّلة</p>
          <p dir="ltr" className="mt-2 text-2xl font-bold tabular-nums text-emerald-400 sm:text-3xl">
            {fmt(invoicesPaidAmt)}
            <span className="mr-1 text-sm font-normal text-slate-500">{cur}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{invoicesPaid} فاتورة مدفوعة في الفترة</p>
        </div>
      </div>

      {/* ── وصول سريع ── */}
      <div>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          وصول سريع
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { href: '/dashboard/accounting/invoices',     icon: '📋', label: 'الفواتير',     desc: 'عرض وإدارة الفواتير' },
            { href: '/dashboard/accounting/invoices/new', icon: '➕', label: 'فاتورة جديدة', desc: 'إنشاء فاتورة للزبون' },
            { href: '/dashboard/accounting/receipts',     icon: '💵', label: 'سندات القبض',  desc: 'تسجيل مبلغ مقبوض' },
            { href: '/dashboard/accounting/payments',     icon: '💸', label: 'سندات الصرف',  desc: 'تسجيل مصروف أو دفعة' },
          ].map(s => (
            <Link
              key={s.href} href={s.href}
              className="rounded-2xl border border-white/5 bg-slate-900 p-3.5 transition-colors hover:border-sky-500/20 hover:bg-sky-500/5 sm:p-4"
            >
              <span className="text-2xl">{s.icon}</span>
              <p className="mt-2 text-sm font-semibold text-white">{s.label}</p>
              <p className="mt-0.5 text-xs text-slate-500">{s.desc}</p>
            </Link>
          ))}
        </div>
      </div>

    </div>
  )
}
