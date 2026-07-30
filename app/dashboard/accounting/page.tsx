import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { getDefaultCashBox, getCashBalance } from '@/lib/accounting/treasury'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import TimeFilter, { Period } from '@/components/dashboard/accounting/TimeFilter'

const ORDER_STATUSES = ['delivered', 'processing', 'confirmed', 'ready', 'shipped', 'pending']

export default async function AccountingPage({ searchParams }: { searchParams: { period?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores').select('id, currency_code').eq('id', storeId).single()
  if (!store) redirect('/onboarding')

  // ── نطاقات التاريخ بناءً على الفلتر ────────────────────────────
  const period = (searchParams.period as Period) || 'month'
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  
  let startDate = new Date(0) // all
  let periodLabel = 'كل الأوقات'

  if (period === 'today') {
    startDate = todayStart
    periodLabel = 'اليوم'
  } else if (period === 'week') {
    startDate = new Date(now)
    startDate.setDate(now.getDate() - now.getDay()) // start of week
    startDate.setHours(0, 0, 0, 0)
    periodLabel = 'هذا الأسبوع'
  } else if (period === 'month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    periodLabel = 'هذا الشهر'
  } else if (period === 'year') {
    startDate = new Date(now.getFullYear(), 0, 1)
    periodLabel = 'هذا العام'
  }

  const startDateStr = startDate.toISOString()
  const startDateDateStr = startDate.toISOString().slice(0, 10)

  // ── جلب البيانات ──────────────────────────────────────────────
  const box = await getDefaultCashBox(supabase, store.id)
  const balance = box ? await getCashBalance(supabase, store.id, box.id, box.opening_balance) : 0

  const [
    { data: periodOrders },
    { data: periodVouchers },
    { data: invoices },
    { data: debtors },
    { data: recentInvoices },
    { data: recentVouchers },
    { data: lowStockProducts },
  ] = await Promise.all([
    supabase.from('orders')
      .select('id, total_amount, created_at, status, customer_id')
      .eq('store_id', store.id)
      .in('status', ORDER_STATUSES)
      .gte('created_at', startDateStr),
    supabase.from('vouchers')
      .select('type, amount, date')
      .eq('store_id', store.id)
      .gte('date', startDateDateStr),
    supabase.from('invoices')
      .select('total, amount_paid, status, due_date')
      .eq('store_id', store.id),
    supabase.from('customers')
      .select('balance')
      .eq('store_id', store.id)
      .gt('balance', 0),
    supabase.from('invoices')
      .select('invoice_number, total, status, created_at')
      .eq('store_id', store.id)
      .order('created_at', { ascending: false })
      .limit(6),
    supabase.from('vouchers')
      .select('voucher_number, type, amount, created_at')
      .eq('store_id', store.id)
      .order('created_at', { ascending: false })
      .limit(6),
    supabase.from('products')
      .select('id, stock_quantity, low_stock_alert')
      .eq('store_id', store.id)
      .eq('track_stock', true)
      .eq('is_active', true),
  ])

  type OrderRow = { id: string; total_amount: number | null; created_at: string; status: string; customer_id: string | null }
  const orders = (periodOrders ?? []) as OrderRow[]
  const periodSales = orders.reduce((s, o) => s + (o.total_amount ?? 0), 0)

  // تكلفة البضاعة المباعة (حسب الفترة) من بنود الطلبيات
  const orderIds = orders.map(o => o.id)
  let periodCOGS = 0
  if (orderIds.length > 0) {
    const { data: lineItems } = await supabase
      .from('order_items')
      .select('quantity, cost_price, order_id')
      .in('order_id', orderIds)
    for (const li of (lineItems ?? []) as { quantity: number; cost_price: number | null; order_id: string }[]) {
      const cost = (li.cost_price ?? 0) * li.quantity
      periodCOGS += cost
    }
  }

  const vts = (periodVouchers ?? []) as { type: string; amount: number; date: string }[]
  const periodReceipts = vts.filter(v => v.type === 'receipt').reduce((s, v) => s + v.amount, 0)
  const periodPayments = vts.filter(v => v.type === 'payment').reduce((s, v) => s + v.amount, 0)

  // صافي الربح التقديري
  const netProfit = periodSales - periodCOGS - periodPayments

  const inv = (invoices ?? []) as { total: number; amount_paid: number; status: string; due_date: string | null }[]
  const unpaidInvoices = inv.filter(i => i.status !== 'paid' && i.status !== 'cancelled')
  const unpaidCount = unpaidInvoices.length
  const unpaidAmount = unpaidInvoices.reduce((s, i) => s + Math.max(0, (i.total ?? 0) - (i.amount_paid ?? 0)), 0)
  const overdueCount = unpaidInvoices.filter(i => i.due_date && i.due_date < todayStart.toISOString().slice(0, 10)).length

  const debtorRows = (debtors ?? []) as { balance: number }[]
  const debtorCount = debtorRows.length
  const totalDebt = debtorRows.reduce((s, c) => s + (c.balance ?? 0), 0)

  // المنتجات قليلة الكمية
  const lowStock = (lowStockProducts ?? []) as { id: string; stock_quantity: number; low_stock_alert: number | null }[]
  const lowStockCount = lowStock.filter(p => p.stock_quantity <= (p.low_stock_alert ?? 5)).length

  const cur = store.currency_code
  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 0 })

  // ── أفضل العملاء ────────────────────────────────────
  const custTotals = new Map<string, { total: number; count: number }>()
  for (const o of orders) {
    if (!o.customer_id) continue
    const e = custTotals.get(o.customer_id) ?? { total: 0, count: 0 }
    e.total += o.total_amount ?? 0; e.count += 1
    custTotals.set(o.customer_id, e)
  }
  const topCustIds = [...custTotals.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 5)
  let topCustomers: { id: string; name: string; total: number; count: number }[] = []
  if (topCustIds.length > 0) {
    const { data: cs } = await supabase
      .from('customers').select('id, name').in('id', topCustIds.map(x => x[0]))
    const nameMap = new Map((cs ?? []).map((c: { id: string; name: string }) => [c.id, c.name]))
    topCustomers = topCustIds.map(([id, v]) => ({ id, name: nameMap.get(id) ?? 'زبون', total: v.total, count: v.count }))
  }

  // ── آخر العمليات ──────────────────────────────────────────────
  type Ev = { kind: 'invoice' | 'receipt' | 'payment'; number: string; amount: number; at: string }
  const invEv: Ev[] = (recentInvoices ?? []).map((i: { invoice_number: string; total: number; created_at: string }) =>
    ({ kind: 'invoice', number: i.invoice_number, amount: i.total, at: i.created_at }))
  const vouEv: Ev[] = (recentVouchers ?? []).map((v: { voucher_number: string; type: string; amount: number; created_at: string }) =>
    ({ kind: v.type === 'receipt' ? 'receipt' : 'payment', number: v.voucher_number, amount: v.amount, at: v.created_at }))
  const events = [...invEv, ...vouEv].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6)
  const evMeta = {
    invoice: { icon: '🧾', color: 'text-sky-400',     sign: '',  href: '/dashboard/accounting/invoices', label: 'فاتورة' },
    receipt: { icon: '📥', color: 'text-emerald-400', sign: '+', href: '/dashboard/accounting/receipts', label: 'سند قبض' },
    payment: { icon: '📤', color: 'text-red-400',     sign: '−', href: '/dashboard/accounting/payments', label: 'سند صرف' },
  } as const

  // ── لوحة التنبيهات والأمور التي تتطلب إجراء ──────────────────
  const actionableAlerts: { icon: string; title: string; subtitle: string; href: string; tone: 'red' | 'amber' | 'orange' }[] = []
  if (overdueCount > 0) actionableAlerts.push({ icon: '⏰', title: `${overdueCount} فواتير متأخرة`, subtitle: 'يجب تحصيلها قريباً', href: '/dashboard/accounting/invoices?status=unpaid', tone: 'red' })
  if (unpaidCount > 0) actionableAlerts.push({ icon: '🧾', title: `${unpaidCount} فواتير غير مسددة`, subtitle: `بإجمالي ${fmt(unpaidAmount)} ${cur}`, href: '/dashboard/accounting/invoices?status=unpaid', tone: 'amber' })
  if (debtorCount > 0) actionableAlerts.push({ icon: '👥', title: `${debtorCount} عملاء مدينون`, subtitle: `إجمالي الديون ${fmt(totalDebt)} ${cur}`, href: '/dashboard/customers', tone: 'amber' })
  if (lowStockCount > 0) actionableAlerts.push({ icon: '📦', title: `${lowStockCount} منتجات قاربت على النفاد`, subtitle: 'بحاجة لإعادة طلب', href: '/dashboard/inventory/alerts', tone: 'orange' })

  // ── البطاقات الأساسية ────────────
  const cards = [
    { icon: '🟡', label: 'صافي الربح', value: fmt(netProfit), unit: cur, color: netProfit >= 0 ? 'text-amber-400' : 'text-red-400', border: 'border-amber-500/15', href: '/dashboard/accounting/reports' },
    { icon: '🟢', label: 'المبيعات',   value: fmt(periodSales), unit: cur, color: 'text-emerald-400', border: 'border-emerald-500/15', href: '/dashboard/orders' },
    { icon: '🔴', label: 'المصروفات',  value: fmt(periodPayments), unit: cur, color: 'text-red-400', border: 'border-red-500/15', href: '/dashboard/accounting/payments' },
    { icon: '🔵', label: 'المقبوضات',  value: fmt(periodReceipts), unit: cur, color: 'text-sky-400', border: 'border-sky-500/15', href: '/dashboard/accounting/receipts' },
  ]

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {/* العنوان والفلتر */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">💰 لوحة المؤشرات المالية</h1>
        </div>
        <div className="flex items-center justify-between gap-3 md:justify-end">
          <TimeFilter />
        </div>
      </div>

      {/* بطاقات المؤشرات (مرتبطة بالفلتر الزمني) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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

      {/* لوحة التنبيهات والأمور التي تتطلب إجراء (غير مرتبطة بالوقت) */}
      {actionableAlerts.length > 0 && (
        <div>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">يتطلب إجراء (الآن)</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {actionableAlerts.map((a, i) => (
              <Link key={i} href={a.href}
                className={`flex items-start gap-3 rounded-xl border p-4 transition-colors ${
                  a.tone === 'red'
                    ? 'border-red-500/25 bg-red-500/5 hover:bg-red-500/10'
                    : a.tone === 'orange'
                    ? 'border-orange-500/25 bg-orange-500/5 hover:bg-orange-500/10'
                    : 'border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/10'
                }`}>
                <span className="text-2xl mt-0.5">{a.icon}</span>
                <div>
                  <p className={`text-sm font-semibold ${
                     a.tone === 'red' ? 'text-red-300' : a.tone === 'orange' ? 'text-orange-300' : 'text-amber-300'
                  }`}>{a.title}</p>
                  <p className="text-xs text-slate-400 mt-1">{a.subtitle}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* وصول سريع + حالة الصندوق */}
      <div className="grid gap-3 lg:grid-cols-3">
        {/* حالة الصندوق */}
        <div className="lg:col-span-1">
          <Link href="/dashboard/accounting/treasury"
            className={`block h-full rounded-2xl border p-5 transition-colors hover:bg-white/3 ${
              balance > 0 ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'
            }`}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">💵 رصيد الصندوق</p>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                balance > 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
              }`}>
                {balance > 0 ? '🟢 بحالة جيدة' : '🔴 الرصيد منخفض'}
              </span>
            </div>
            <p dir="ltr" className={`mt-3 text-3xl font-bold tabular-nums sm:text-4xl ${balance > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmt(balance)}<span className="mr-2 text-base font-normal text-slate-400">{cur}</span>
            </p>
          </Link>
        </div>

        {/* وصول سريع */}
        <div className="lg:col-span-2 rounded-2xl border border-white/5 bg-slate-900 p-4 sm:p-5">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-500">وصول سريع</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { href: '/dashboard/accounting/invoices/new', icon: '➕', label: 'فاتورة جديدة', desc: 'إنشاء فاتورة' },
              { href: '/dashboard/accounting/receipts',     icon: '💵', label: 'سند قبض',  desc: 'تسجيل مقبوضات' },
              { href: '/dashboard/accounting/payments',     icon: '💸', label: 'سند صرف',  desc: 'تسجيل مصروف' },
              { href: '/dashboard/accounting/reports',      icon: '📊', label: 'التقارير',     desc: 'أرباح وتدفقات' },
            ].map(s => (
              <Link key={s.href} href={s.href}
                className="flex flex-col items-center justify-center text-center rounded-xl border border-white/5 bg-white/5 p-3 transition-colors hover:border-sky-500/30 hover:bg-sky-500/10">
                <span className="text-2xl mb-2">{s.icon}</span>
                <p className="text-sm font-semibold text-white">{s.label}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* أفضل العملاء + آخر العمليات */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* أفضل العملاء */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">🏆 أفضل العملاء ({periodLabel})</h2>
          {topCustomers.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">لا توجد مبيعات لعملاء مسجّلين في هذه الفترة</p>
          ) : (
            <ul className="space-y-2.5">
              {topCustomers.map((c, i) => (
                <li key={c.id}>
                  <Link href={`/dashboard/customers/${c.id}`}
                    className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/5">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      i === 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-400'
                    }`}>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{c.name}</p>
                      <p className="text-[11px] text-slate-500">{c.count} طلبية</p>
                    </div>
                    <p dir="ltr" className="shrink-0 text-sm font-bold tabular-nums text-emerald-400">{fmt(c.total)} <span className="text-[11px] font-normal text-slate-500">{cur}</span></p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* آخر العمليات */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">🧾 آخر العمليات</h2>
          {events.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">لا توجد عمليات بعد</p>
          ) : (
            <ul className="space-y-2.5">
              {events.map((e, i) => {
                const m = evMeta[e.kind]
                return (
                  <li key={i}>
                    <Link href={m.href}
                      className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/5">
                      <span className="text-base">{m.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{m.label} {e.number}</p>
                        <p className="text-[11px] text-slate-500">{new Date(e.at).toLocaleDateString('ar-u-nu-latn', { day: 'numeric', month: 'short' })}</p>
                      </div>
                      <p dir="ltr" className={`shrink-0 text-sm font-bold tabular-nums ${m.color}`}>{m.sign}{fmt(e.amount)} <span className="text-[11px] font-normal text-slate-500">{cur}</span></p>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* زر إنشاء فاتورة عائم — موبايل فقط */}
      <Link href="/dashboard/accounting/invoices/new"
        className="fixed bottom-20 left-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-2xl text-white shadow-lg shadow-emerald-900/40 transition-transform hover:scale-105 active:scale-95 lg:hidden"
        aria-label="فاتورة جديدة">
        ➕
      </Link>
    </div>
  )
}
