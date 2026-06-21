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
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const todayStr = todayStart.toISOString()
  const todayDateStr = todayStart.toISOString().slice(0, 10)
  const monthStr = monthStart.toISOString()
  const monthDateStr = monthStr.slice(0, 10)

  // نوافذ المقارنة
  const thirtyAgo = new Date(now); thirtyAgo.setDate(thirtyAgo.getDate() - 30); thirtyAgo.setHours(0, 0, 0, 0)
  const sixtyAgo = new Date(now); sixtyAgo.setDate(sixtyAgo.getDate() - 60); sixtyAgo.setHours(0, 0, 0, 0)
  const thirtyStr = thirtyAgo.toISOString()
  const sixtyStr = sixtyAgo.toISOString()
  // أبكر تاريخ نحتاجه لبيانات المقارنة (الـ 60 يوماً أو بداية الشهر الماضي، أيّهما أقدم)
  const trendFromStr = (prevMonthStart < sixtyAgo ? prevMonthStart : sixtyAgo).toISOString()
  // نهاية نافذة الشهر الماضي حتى نفس اليوم (MTD مقابل MTD)
  const prevMTDend = new Date(prevMonthStart.getTime() + (now.getTime() - monthStart.getTime())).toISOString()

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
    { data: trendOrders },
    { data: vouchers },
    { data: invoices },
    { data: debtors },
    { data: weekMovements },
    { data: recentInvoices },
    { data: recentVouchers },
    { data: lowStockProducts },
    { count: todayInvoiceCount },
    { count: newCustomersToday },
  ] = await Promise.all([
    supabase.from('orders')
      .select('id, total_amount, created_at, status, customer_id')
      .eq('store_id', store.id)
      .in('status', ORDER_STATUSES)
      .gte('created_at', monthStr),
    supabase.from('orders')
      .select('total_amount, created_at')
      .eq('store_id', store.id)
      .in('status', ORDER_STATUSES)
      .gte('created_at', trendFromStr),
    supabase.from('vouchers')
      .select('type, amount, date')
      .eq('store_id', store.id)
      .gte('date', monthDateStr),
    supabase.from('invoices')
      .select('total, amount_paid, status, due_date')
      .eq('store_id', store.id),
    supabase.from('customers')
      .select('balance')
      .eq('store_id', store.id)
      .gt('balance', 0),
    supabase.from('cash_movements')
      .select('direction, amount, date')
      .eq('store_id', store.id)
      .gte('date', days[0]),
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
    supabase.from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', store.id)
      .gte('created_at', todayStr),
    supabase.from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', store.id)
      .gte('created_at', todayStr),
  ])

  type OrderRow = { id: string; total_amount: number | null; created_at: string; status: string; customer_id: string | null }
  const orders = (monthOrders ?? []) as OrderRow[]
  const monthSales = orders.reduce((s, o) => s + (o.total_amount ?? 0), 0)
  const todayOrders = orders.filter(o => o.created_at >= todayStr)
  const todaySales = todayOrders.reduce((s, o) => s + (o.total_amount ?? 0), 0)
  const todayOrderIds = new Set(todayOrders.map(o => o.id))

  // تكلفة البضاعة المباعة (شهرياً + اليوم) من بنود الطلبيات
  const orderIds = orders.map(o => o.id)
  let monthCOGS = 0
  let todayCOGS = 0
  if (orderIds.length > 0) {
    const { data: lineItems } = await supabase
      .from('order_items')
      .select('quantity, cost_price, order_id')
      .in('order_id', orderIds)
    for (const li of (lineItems ?? []) as { quantity: number; cost_price: number | null; order_id: string }[]) {
      const cost = (li.cost_price ?? 0) * li.quantity
      monthCOGS += cost
      if (todayOrderIds.has(li.order_id)) todayCOGS += cost
    }
  }

  const vts = (vouchers ?? []) as { type: string; amount: number; date: string }[]
  const monthReceipts = vts.filter(v => v.type === 'receipt').reduce((s, v) => s + v.amount, 0)
  const monthPayments = vts.filter(v => v.type === 'payment').reduce((s, v) => s + v.amount, 0)
  const todayPayments = vts.filter(v => v.type === 'payment' && v.date === todayDateStr).reduce((s, v) => s + v.amount, 0)

  // صافي الربح التقديري = مبيعات − تكلفة − مصروفات
  const netProfit = monthSales - monthCOGS - monthPayments
  const todayProfit = todaySales - todayCOGS - todayPayments

  const inv = (invoices ?? []) as { total: number; amount_paid: number; status: string; due_date: string | null }[]
  const unpaidInvoices = inv.filter(i => i.status !== 'paid' && i.status !== 'cancelled')
  const unpaidCount = unpaidInvoices.length
  const unpaidAmount = unpaidInvoices.reduce((s, i) => s + Math.max(0, (i.total ?? 0) - (i.amount_paid ?? 0)), 0)
  const overdueCount = unpaidInvoices.filter(i => i.due_date && i.due_date < todayDateStr).length

  const debtorRows = (debtors ?? []) as { balance: number }[]
  const debtorCount = debtorRows.length
  const totalDebt = debtorRows.reduce((s, c) => s + (c.balance ?? 0), 0)

  // المنتجات قليلة الكمية
  const lowStock = (lowStockProducts ?? []) as { id: string; stock_quantity: number; low_stock_alert: number | null }[]
  const lowStockCount = lowStock.filter(p => p.stock_quantity <= (p.low_stock_alert ?? 5)).length

  // مقارنات المبيعات
  const trend = (trendOrders ?? []) as { total_amount: number | null; created_at: string }[]
  const last30 = trend.filter(o => o.created_at >= thirtyStr).reduce((s, o) => s + (o.total_amount ?? 0), 0)
  const prev30 = trend.filter(o => o.created_at >= sixtyStr && o.created_at < thirtyStr).reduce((s, o) => s + (o.total_amount ?? 0), 0)
  const salesDropPct = prev30 > 0 ? ((prev30 - last30) / prev30) * 100 : 0
  // MTD مقابل نفس الفترة من الشهر الماضي
  const priorMTD = trend.filter(o => o.created_at >= prevMonthStart.toISOString() && o.created_at < prevMTDend).reduce((s, o) => s + (o.total_amount ?? 0), 0)
  const monthChangePct = priorMTD > 0 ? Math.round(((monthSales - priorMTD) / priorMTD) * 100) : null

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

  // ── أفضل العملاء هذا الشهر ────────────────────────────────────
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

  // ── لوحة التنبيهات ────────────────────────────────────────────
  const alerts: { icon: string; text: string; href: string; tone: 'red' | 'amber' }[] = []
  if (overdueCount > 0) alerts.push({ icon: '⏰', text: `${overdueCount} فواتير متأخرة عن موعد السداد`, href: '/dashboard/accounting/invoices?status=unpaid', tone: 'red' })
  if (debtorCount > 0) alerts.push({ icon: '👥', text: `${debtorCount} عملاء متأخرون بالسداد (${fmt(totalDebt)} ${cur})`, href: '/dashboard/customers', tone: 'amber' })
  if (lowStockCount > 0) alerts.push({ icon: '📦', text: `${lowStockCount} منتجات قاربت على النفاد`, href: '/dashboard/inventory/alerts', tone: 'amber' })
  if (salesDropPct >= 20) alerts.push({ icon: '📉', text: `انخفاض المبيعات ${Math.round(salesDropPct)}% عن الفترة السابقة`, href: '/dashboard/orders', tone: 'red' })

  // ── البطاقات (مرتّبة حسب الأولوية + ألوان دلالية) ────────────
  const cards = [
    { icon: '🟡', label: 'صافي الربح',       value: fmt(netProfit),       unit: cur, color: netProfit >= 0 ? 'text-amber-400' : 'text-red-400', border: 'border-amber-500/15', href: '/dashboard/accounting/reports' },
    { icon: '🟢', label: 'مبيعات الشهر',     value: fmt(monthSales),      unit: cur, color: 'text-emerald-400', border: 'border-emerald-500/15', href: '/dashboard/orders' },
    { icon: '🟢', label: 'مبيعات اليوم',     value: fmt(todaySales),      unit: cur, color: 'text-emerald-400', border: 'border-emerald-500/15', href: '/dashboard/orders' },
    { icon: '🔴', label: 'المصروفات',        value: fmt(monthPayments),   unit: cur, color: 'text-red-400',     border: 'border-red-500/15',     href: '/dashboard/accounting/payments' },
    { icon: '🔵', label: 'المقبوضات',        value: fmt(monthReceipts),   unit: cur, color: 'text-sky-400',     border: 'border-sky-500/15',     href: '/dashboard/accounting/receipts' },
    { icon: '🧾', label: 'فواتير غير مسددة', value: String(unpaidCount),  unit: `(${fmt(unpaidAmount)} ${cur})`, color: 'text-amber-400', border: 'border-amber-500/10', href: '/dashboard/accounting/invoices?status=unpaid' },
    { icon: '👥', label: 'عملاء مدينون',     value: String(debtorCount),  unit: `(${fmt(totalDebt)} ${cur})`,   color: 'text-amber-400', border: 'border-amber-500/10', href: '/dashboard/customers' },
    { icon: '📦', label: 'منتجات قليلة الكمية', value: String(lowStockCount), unit: 'بحاجة إعادة طلب', color: lowStockCount > 0 ? 'text-orange-400' : 'text-slate-400', border: 'border-orange-500/10', href: '/dashboard/inventory/alerts' },
  ]

  const todaySummary = [
    { icon: '🧾', label: 'عدد الفواتير', value: String(todayInvoiceCount ?? 0) },
    { icon: '💰', label: 'المبيعات',     value: `${fmt(todaySales)} ${cur}` },
    { icon: '📈', label: 'الربح',        value: `${fmt(todayProfit)} ${cur}` },
    { icon: '🆕', label: 'عملاء جدد',    value: String(newCustomersToday ?? 0) },
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

      {/* لوحة التنبيهات */}
      {alerts.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {alerts.map((a, i) => (
            <Link key={i} href={a.href}
              className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-sm font-medium transition-colors ${
                a.tone === 'red'
                  ? 'border-red-500/25 bg-red-500/5 text-red-300 hover:bg-red-500/10'
                  : 'border-amber-500/25 bg-amber-500/5 text-amber-300 hover:bg-amber-500/10'
              }`}>
              <span className="text-lg">{a.icon}</span>
              <span>{a.text}</span>
            </Link>
          ))}
        </div>
      )}

      {/* ملخص اليوم + رصيد الصندوق */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* ملخص اليوم */}
        <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/10 to-indigo-500/5 p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-sky-300/80">✨ ملخص اليوم</p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            {todaySummary.map(s => (
              <div key={s.label}>
                <p className="text-[11px] text-slate-400">{s.icon} {s.label}</p>
                <p dir="ltr" className="mt-1 text-lg font-bold tabular-nums text-white">{s.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* رصيد الصندوق + حالته */}
        <Link href="/dashboard/accounting/treasury"
          className={`block rounded-2xl border p-5 transition-colors hover:bg-white/3 ${
            balance > 0 ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'
          }`}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">💵 رصيد الصندوق الحالي</p>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              balance > 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
            }`}>
              {balance > 0 ? '🟢 بحالة جيدة' : '🔴 الرصيد منخفض'}
            </span>
          </div>
          <p dir="ltr" className={`mt-2 text-3xl font-bold tabular-nums sm:text-4xl ${balance > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmt(balance)}<span className="mr-2 text-base font-normal text-slate-400">{cur}</span>
          </p>
        </Link>
      </div>

      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map(c => (
          <Link key={c.label} href={c.href}
            className={`rounded-2xl border bg-slate-900 p-4 transition-colors hover:bg-slate-800 ${c.border}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{c.icon}</span>
                <p className="text-xs font-semibold text-slate-400">{c.label}</p>
              </div>
              {c.label === 'مبيعات الشهر' && monthChangePct !== null && (
                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                  monthChangePct >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                }`} title="مقارنةً بنفس الفترة من الشهر الماضي">
                  {monthChangePct >= 0 ? '▲' : '▼'} {Math.abs(monthChangePct)}%
                </span>
              )}
            </div>
            <p dir="ltr" className={`mt-2 text-2xl font-bold tabular-nums ${c.color}`}>{c.value}</p>
            <p className="mt-0.5 text-[11px] text-slate-600">{c.unit}</p>
          </Link>
        ))}
      </div>

      {/* أفضل العملاء + آخر العمليات */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* أفضل العملاء هذا الشهر */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">🏆 أفضل العملاء هذا الشهر</h2>
          {topCustomers.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">لا توجد مبيعات لعملاء مسجّلين هذا الشهر</p>
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
                        <p className="text-[11px] text-slate-500">{new Date(e.at).toLocaleDateString('ar', { day: 'numeric', month: 'short' })}</p>
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

      {/* زر إنشاء فاتورة عائم — موبايل فقط */}
      <Link href="/dashboard/accounting/invoices/new"
        className="fixed bottom-20 left-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-2xl text-white shadow-lg shadow-emerald-900/40 transition-transform hover:scale-105 active:scale-95 lg:hidden"
        aria-label="فاتورة جديدة">
        ➕
      </Link>
    </div>
  )
}
