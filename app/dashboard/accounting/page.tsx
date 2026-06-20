import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { getDefaultCashBox, getCashBalance } from '@/lib/accounting/treasury'
import { redirect } from 'next/navigation'
import Link from 'next/link'

const ORDER_STATUSES = ['delivered', 'processing', 'confirmed', 'ready', 'shipped', 'pending']

export default async function AccountingPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores').select('id, currency_code').eq('id', storeId).single()
  if (!store) redirect('/onboarding')

  // ── نطاقات التاريخ ─────────────────────────────────────────────
  const now = new Date()
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const todayStr = todayStart.toISOString()
  const monthStr = monthStart.toISOString()
  const monthDateStr = monthStr.slice(0, 10)

  // آخر 7 أيام (للرسم البياني)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i))
    return d.toISOString().slice(0, 10)
  })

  // ── جلب البيانات ──────────────────────────────────────────────
  const box = await getDefaultCashBox(supabase, store.id)
  const balance = box ? await getCashBalance(supabase, store.id, box.id, box.opening_balance) : 0

  const [
    { data: monthOrders },
    { data: vouchers },
    { data: invoices },
    { data: debtors },
    { data: weekMovements },
  ] = await Promise.all([
    supabase.from('orders')
      .select('id, total_amount, created_at, status')
      .eq('store_id', store.id)
      .in('status', ORDER_STATUSES)
      .gte('created_at', monthStr),
    supabase.from('vouchers')
      .select('type, amount, date')
      .eq('store_id', store.id)
      .gte('date', monthDateStr),
    supabase.from('invoices')
      .select('total, amount_paid, status')
      .eq('store_id', store.id),
    supabase.from('customers')
      .select('balance')
      .eq('store_id', store.id)
      .gt('balance', 0),
    supabase.from('cash_movements')
      .select('direction, amount, date')
      .eq('store_id', store.id)
      .gte('date', days[0]),
  ])

  type OrderRow = { id: string; total_amount: number | null; created_at: string; status: string }
  const orders = (monthOrders ?? []) as OrderRow[]
  const monthSales = orders.reduce((s, o) => s + (o.total_amount ?? 0), 0)
  const todaySales = orders.filter(o => o.created_at >= todayStr).reduce((s, o) => s + (o.total_amount ?? 0), 0)

  // تكلفة البضاعة المباعة لهذا الشهر (من بنود الطلبيات)
  const orderIds = orders.map(o => o.id)
  let monthCOGS = 0
  if (orderIds.length > 0) {
    const { data: lineItems } = await supabase
      .from('order_items')
      .select('quantity, cost_price, order_id')
      .in('order_id', orderIds)
    monthCOGS = (lineItems ?? []).reduce(
      (s, li: { quantity: number; cost_price: number | null }) => s + (li.cost_price ?? 0) * li.quantity, 0,
    )
  }

  const vts = (vouchers ?? []) as { type: string; amount: number; date: string }[]
  const monthReceipts = vts.filter(v => v.type === 'receipt').reduce((s, v) => s + v.amount, 0)
  const monthPayments = vts.filter(v => v.type === 'payment').reduce((s, v) => s + v.amount, 0)

  // صافي الربح التقديري = مبيعات − تكلفة − مصروفات
  const netProfit = monthSales - monthCOGS - monthPayments

  const inv = (invoices ?? []) as { total: number; amount_paid: number; status: string }[]
  const unpaidInvoices = inv.filter(i => i.status !== 'paid' && i.status !== 'cancelled')
  const unpaidCount = unpaidInvoices.length
  const unpaidAmount = unpaidInvoices.reduce((s, i) => s + Math.max(0, (i.total ?? 0) - (i.amount_paid ?? 0)), 0)

  const debtorRows = (debtors ?? []) as { balance: number }[]
  const debtorCount = debtorRows.length
  const totalDebt = debtorRows.reduce((s, c) => s + (c.balance ?? 0), 0)

  // رسم التدفق النقدي — آخر 7 أيام
  const mv = (weekMovements ?? []) as { direction: string; amount: number; date: string }[]
  const chart = days.map(d => ({
    date: d,
    in:  mv.filter(m => m.date === d && m.direction === 'in').reduce((s, m) => s + m.amount, 0),
    out: mv.filter(m => m.date === d && m.direction === 'out').reduce((s, m) => s + m.amount, 0),
  }))
  const chartMax = Math.max(1, ...chart.map(c => Math.max(c.in, c.out)))

  const cur = store.currency_code
  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 0 })
  const monthLabel = now.toLocaleDateString('ar', { month: 'long', year: 'numeric' })

  const cards = [
    { icon: '💰', label: 'مبيعات اليوم',     value: fmt(todaySales),     unit: cur, color: 'text-emerald-400', border: 'border-emerald-500/15', href: '/dashboard/orders' },
    { icon: '📈', label: 'مبيعات الشهر',     value: fmt(monthSales),     unit: cur, color: 'text-sky-400',     border: 'border-sky-500/15',     href: '/dashboard/orders' },
    { icon: '💵', label: 'صافي الربح',       value: fmt(netProfit),      unit: cur, color: netProfit >= 0 ? 'text-emerald-400' : 'text-red-400', border: 'border-emerald-500/15', href: '/dashboard/accounting/reports' },
    { icon: '📥', label: 'المقبوضات',        value: fmt(monthReceipts),  unit: cur, color: 'text-emerald-400', border: 'border-emerald-500/10', href: '/dashboard/accounting/receipts' },
    { icon: '📤', label: 'المصروفات',        value: fmt(monthPayments),  unit: cur, color: 'text-red-400',     border: 'border-red-500/10',     href: '/dashboard/accounting/payments' },
    { icon: '🧾', label: 'فواتير غير مسددة', value: String(unpaidCount), unit: `(${fmt(unpaidAmount)} ${cur})`, color: 'text-amber-400', border: 'border-amber-500/10', href: '/dashboard/accounting/invoices?status=unpaid' },
    { icon: '👥', label: 'عملاء مدينون',     value: String(debtorCount), unit: `(${fmt(totalDebt)} ${cur})`,   color: 'text-amber-400', border: 'border-amber-500/10', href: '/dashboard/customers' },
  ]

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {/* العنوان */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">💰 لوحة المؤشرات المالية</h1>
          <p className="mt-0.5 text-sm text-slate-400">{monthLabel}</p>
        </div>
        <Link href="/dashboard/accounting/treasury"
          className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/10">
          🏦 الصندوق
        </Link>
      </div>

      {/* رصيد الصندوق — بطاقة بارزة */}
      <Link href="/dashboard/accounting/treasury"
        className={`block rounded-2xl border p-5 transition-colors hover:bg-white/3 ${
          balance >= 0 ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'
        }`}>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">💵 رصيد الصندوق الحالي</p>
        <p dir="ltr" className={`mt-2 text-3xl font-bold tabular-nums sm:text-4xl ${balance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {fmt(balance)}<span className="mr-2 text-base font-normal text-slate-400">{cur}</span>
        </p>
      </Link>

      {/* 7 بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map(c => (
          <Link key={c.label} href={c.href}
            className={`rounded-2xl border bg-slate-900 p-4 transition-colors hover:bg-slate-800 ${c.border}`}>
            <div className="flex items-center gap-2">
              <span className="text-lg">{c.icon}</span>
              <p className="text-xs font-semibold text-slate-400">{c.label}</p>
            </div>
            <p dir="ltr" className={`mt-2 text-2xl font-bold tabular-nums ${c.color}`}>{c.value}</p>
            <p className="mt-0.5 text-[11px] text-slate-600">{c.unit}</p>
          </Link>
        ))}
      </div>

      {/* رسم التدفق النقدي — آخر 7 أيام */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">📊 التدفق النقدي — آخر 7 أيام</h2>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1 text-slate-400"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> داخل</span>
            <span className="flex items-center gap-1 text-slate-400"><span className="h-2 w-2 rounded-sm bg-red-500" /> خارج</span>
          </div>
        </div>
        <div className="flex items-end justify-between gap-2" style={{ height: 140 }}>
          {chart.map(c => (
            <div key={c.date} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full items-end justify-center gap-0.5" style={{ height: 110 }}>
                <div className="w-1/2 rounded-t bg-emerald-500/70" style={{ height: `${(c.in / chartMax) * 100}%`, minHeight: c.in > 0 ? 3 : 0 }} title={`داخل ${fmt(c.in)}`} />
                <div className="w-1/2 rounded-t bg-red-500/70" style={{ height: `${(c.out / chartMax) * 100}%`, minHeight: c.out > 0 ? 3 : 0 }} title={`خارج ${fmt(c.out)}`} />
              </div>
              <span className="text-[10px] text-slate-500">{new Date(c.date).toLocaleDateString('ar', { weekday: 'short' })}</span>
            </div>
          ))}
        </div>
      </div>

      {/* وصول سريع */}
      <div>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">وصول سريع</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { href: '/dashboard/accounting/invoices/new', icon: '➕', label: 'فاتورة جديدة', desc: 'إنشاء فاتورة للزبون' },
            { href: '/dashboard/accounting/receipts',     icon: '💵', label: 'سندات القبض',  desc: 'تسجيل مبلغ مقبوض' },
            { href: '/dashboard/accounting/payments',     icon: '💸', label: 'سندات الصرف',  desc: 'تسجيل مصروف أو دفعة' },
            { href: '/dashboard/accounting/reports',      icon: '📊', label: 'التقارير',     desc: 'الأرباح والتدفق النقدي' },
          ].map(s => (
            <Link key={s.href} href={s.href}
              className="rounded-2xl border border-white/5 bg-slate-900 p-3.5 transition-colors hover:border-sky-500/20 hover:bg-sky-500/5 sm:p-4">
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
