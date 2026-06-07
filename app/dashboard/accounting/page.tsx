import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'

type PctChange = { up: boolean; abs: number; label: string } | null

function calcPct(current: number, last: number): PctChange {
  if (last === 0) return null
  const pct = ((current - last) / Math.abs(last)) * 100
  return { up: pct >= 0, abs: Math.abs(Math.round(pct)), label: `${pct >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(pct))}٪ عن الشهر الماضي` }
}

export default async function AccountingPage() {
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

  const now          = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const startOfLastM = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()

  // ── جلب البيانات ────────────────────────────────────────────

  const [
    { data: ordersData },
    { data: invoices },
    { data: vouchers },
    { data: customers },
  ] = await Promise.all([
    supabase
      .from('orders')
      .select('total, amount_paid, created_at')
      .eq('store_id', store.id)
      .in('status', ['delivered', 'processing', 'confirmed', 'ready']),

    supabase
      .from('invoices')
      .select('total, amount_paid, status')
      .eq('store_id', store.id),

    // نجلب شهرين دفعة واحدة للمقارنة
    supabase
      .from('vouchers')
      .select('type, amount, date')
      .eq('store_id', store.id)
      .gte('date', startOfLastM.slice(0, 10)),

    supabase
      .from('customers')
      .select('balance')
      .eq('store_id', store.id)
      .gt('balance', 0),
  ])

  type OrderRow   = { total: number; amount_paid: number; created_at: string }
  type InvoiceRow = { total: number; amount_paid: number; status: string }
  type VoucherRow = { type: string; amount: number; date: string }
  type CustomerRow = { balance: number }

  // ── الطلبيات ────────────────────────────────────────────────

  const allOrders     = (ordersData ?? []) as OrderRow[]
  const totalRevenue  = allOrders.reduce((s, o) => s + (o.amount_paid ?? 0), 0)
  const monthRevenue  = allOrders
    .filter(o => o.created_at >= startOfMonth)
    .reduce((s, o) => s + (o.amount_paid ?? 0), 0)
  const lastMRevenue  = allOrders
    .filter(o => o.created_at >= startOfLastM && o.created_at < startOfMonth)
    .reduce((s, o) => s + (o.amount_paid ?? 0), 0)
  const outstanding   = allOrders.reduce((s, o) => s + Math.max(0, (o.total ?? 0) - (o.amount_paid ?? 0)), 0)

  // ── الفواتير ────────────────────────────────────────────────

  const allInvoices   = (invoices ?? []) as InvoiceRow[]
  const invoicesPaid  = allInvoices.filter(i => i.status === 'paid').length
  const invoicesDraft = allInvoices.filter(i => i.status === 'draft').length
  const invoicesTotal = allInvoices.reduce((s, i) => s + (i.total ?? 0), 0)

  // ── السندات ─────────────────────────────────────────────────

  const curDate       = startOfMonth.slice(0, 10)
  const allVouchers   = (vouchers ?? []) as VoucherRow[]
  const curV          = allVouchers.filter(v => v.date >= curDate)
  const lastV         = allVouchers.filter(v => v.date < curDate)

  const monthReceipts = curV.filter(v => v.type === 'receipt').reduce((s, v) => s + v.amount, 0)
  const monthPayments = curV.filter(v => v.type === 'payment').reduce((s, v) => s + v.amount, 0)
  const lastReceipts  = lastV.filter(v => v.type === 'receipt').reduce((s, v) => s + v.amount, 0)
  const lastPayments  = lastV.filter(v => v.type === 'payment').reduce((s, v) => s + v.amount, 0)

  // ── الزبائن ──────────────────────────────────────────────────

  const totalDebt     = ((customers ?? []) as CustomerRow[]).reduce((s, c) => s + (c.balance ?? 0), 0)

  // ── الحساب ──────────────────────────────────────────────────

  const netProfit     = monthReceipts - monthPayments
  const lastNet       = lastReceipts - lastPayments

  const netChange  = calcPct(netProfit,    lastNet)
  const revChange  = calcPct(monthRevenue, lastMRevenue)

  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 0 })
  const cur = store.currency_code

  // ── 4 بطاقات ────────────────────────────────────────────────
  // الترتيب المالي الطبيعي: إيرادات → مصروفات → مقبوضات → مستحقات

  const cards: Array<{
    label: string; sub: string; value: string
    change: PctChange; color: string; border: string; href: string
  }> = [
    {
      label: 'الإيرادات',   sub: 'طلبيات الشهر',
      value: fmt(monthRevenue), change: revChange,
      color: 'text-emerald-400', border: 'border-emerald-500/10',
      href: '/dashboard/accounting/invoices',
    },
    {
      label: 'المصروفات',   sub: 'سندات الصرف',
      value: fmt(monthPayments), change: null,
      color: 'text-red-400', border: 'border-red-500/10',
      href: '/dashboard/accounting/payments',
    },
    {
      label: 'المقبوضات',   sub: 'سندات القبض',
      value: fmt(monthReceipts), change: null,
      color: 'text-sky-400', border: 'border-sky-500/10',
      href: '/dashboard/accounting/receipts',
    },
    {
      label: 'المستحقات',   sub: 'أرصدة غير مسددة',
      value: fmt(totalDebt), change: null,
      color: 'text-amber-400', border: 'border-amber-500/10',
      href: '/dashboard/customers',
    },
  ]

  return (
    <div className="space-y-5 p-4 sm:p-6">

      {/* العنوان */}
      <div>
        <h1 className="text-xl font-semibold text-white">المحاسبة والمالية</h1>
        <p className="mt-1 text-sm text-slate-400">
          {now.toLocaleDateString('ar', { month: 'long', year: 'numeric' })}
        </p>
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
              صافي الربح — {now.toLocaleDateString('ar', { month: 'long' })}
            </p>

            {/* الرقم الرئيسي */}
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

            {/* المعادلة */}
            <p className="mt-2.5 text-xs text-slate-500">
              مقبوضات{' '}
              <span className="font-semibold text-emerald-400">{fmt(monthReceipts)}</span>
              {' '}−{' '}
              مصروفات{' '}
              <span className="font-semibold text-red-400">{fmt(monthPayments)}</span>
            </p>

            {/* المقارنة بالشهر الماضي */}
            {netChange && (
              <p className={`mt-2 text-sm font-bold ${netChange.up ? 'text-emerald-400' : 'text-red-400'}`}>
                {netChange.label}
              </p>
            )}
            {!netChange && lastNet === 0 && netProfit !== 0 && (
              <p className="mt-2 text-xs text-slate-500">لا توجد بيانات الشهر الماضي للمقارنة</p>
            )}
          </div>
          <div className="shrink-0 text-4xl">{netProfit >= 0 ? '📈' : '📉'}</div>
        </div>
      </div>

      {/* ── 4 بطاقات شهرية ── */}
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

      {/* ── ملخص كامل ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-400">إجمالي المبيعات</p>
          <p dir="ltr" className="mt-2 text-2xl font-bold tabular-nums text-white sm:text-3xl">
            {fmt(totalRevenue)}
            <span className="mr-1 text-sm font-normal text-slate-500">{cur}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{allOrders.length} طلبية مكتملة</p>
        </div>

        <div className="rounded-2xl border border-amber-500/10 bg-slate-900 p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-400">مستحق التحصيل</p>
          <p dir="ltr" className="mt-2 text-2xl font-bold tabular-nums text-amber-400 sm:text-3xl">
            {fmt(outstanding)}
            <span className="mr-1 text-sm font-normal text-slate-500">{cur}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{invoicesDraft} فاتورة غير مدفوعة</p>
        </div>

        <div className="rounded-2xl border border-emerald-500/10 bg-slate-900 p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-400">فواتير محصّلة</p>
          <p dir="ltr" className="mt-2 text-2xl font-bold tabular-nums text-emerald-400 sm:text-3xl">
            {fmt(invoicesTotal)}
            <span className="mr-1 text-sm font-normal text-slate-500">{cur}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{invoicesPaid} فاتورة مدفوعة</p>
        </div>
      </div>

      {/* ── وصول سريع ── */}
      <div>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          وصول سريع
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { href: '/dashboard/accounting/invoices',     icon: '📋', label: 'الفواتير',     desc: invoicesTotal > 0 ? `${fmt(invoicesTotal)} ${cur}` : 'لا توجد فواتير' },
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
