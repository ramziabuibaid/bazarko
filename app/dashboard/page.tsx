import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getStoreForUser } from '@/lib/supabase/getStore'
import Link from 'next/link'
import DashboardRefresh from '@/components/dashboard/DashboardRefresh'
import ExchangeRateWidget from '@/components/dashboard/ExchangeRateWidget'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:    { label: 'معلق',         color: 'bg-yellow-500/15 text-yellow-400' },
  confirmed:  { label: 'مؤكد',        color: 'bg-sky-500/15 text-sky-400' },
  processing: { label: 'قيد التجهيز', color: 'bg-purple-500/15 text-purple-400' },
  ready:      { label: 'جاهز',        color: 'bg-orange-500/15 text-orange-400' },
  shipped:    { label: 'مشحون',       color: 'bg-blue-500/15 text-blue-400' },
  delivered:  { label: 'مُسلّم',      color: 'bg-emerald-500/15 text-emerald-400' },
  cancelled:  { label: 'ملغي',        color: 'bg-red-500/15 text-red-400' },
}

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code, secondary_currency_code, exchange_rate, is_active, suspended_at, logo_url, phone, whatsapp, subdomain, country_code, plan')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  const now = new Date()

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString()

  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  sevenDaysAgo.setHours(0, 0, 0, 0)
  const sevenDaysAgoStr = sevenDaysAgo.toISOString()

  const fourteenDaysAgo = new Date(now)
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
  fourteenDaysAgo.setHours(0, 0, 0, 0)
  const fourteenDaysAgoStr = fourteenDaysAgo.toISOString()

  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  thirtyDaysAgo.setHours(0, 0, 0, 0)
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString()

  const todayDateStr = now.toISOString().slice(0, 10)
  const threeDaysLater = new Date(now)
  threeDaysLater.setDate(threeDaysLater.getDate() + 3)
  const threeDaysLaterStr = threeDaysLater.toISOString().slice(0, 10)

  const [
    ordersRes, customersRes, productsRes, revenueRes,
    todayOrdersRes, todayRevenueRes,
    twoWeeksOrdersRes, recentOrdersRes,
    processingRes, paidOrderIdsRes,
    newOrdersRes, lowStockRes, debtCustomersRes,
    todayVouchersRes, todayInvoicesRes, todayPurchasesRes,
    overdueInvoicesRes, supplierPayablesRes, checksRes,
  ] = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('customers').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('is_active', true),
    supabase.from('orders').select('total_amount').eq('store_id', storeId).eq('payment_status', 'paid'),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('store_id', storeId).gte('created_at', todayStr),
    supabase.from('orders').select('total_amount').eq('store_id', storeId).eq('payment_status', 'paid').gte('created_at', todayStr),
    supabase.from('orders').select('created_at, total_amount, payment_status').eq('store_id', storeId).gte('created_at', fourteenDaysAgoStr).order('created_at', { ascending: true }),
    supabase.from('orders').select('id, order_number, status, payment_status, total_amount, customer_name, created_at').eq('store_id', storeId).order('created_at', { ascending: false }).limit(5),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('store_id', storeId).in('status', ['pending', 'confirmed', 'processing', 'ready', 'shipped']),
    supabase.from('orders').select('id').eq('store_id', storeId).eq('payment_status', 'paid').gte('created_at', thirtyDaysAgoStr).order('created_at', { ascending: false }).limit(200),
    // بطاقة الحالة السريعة
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('status', 'pending'),
    supabase.from('products').select('id, stock_available, low_stock_alert').eq('store_id', storeId).eq('track_stock', true).eq('is_active', true),
    supabase.from('customers').select('balance').eq('store_id', storeId).gt('balance', 0),
    // النبض المالي والتنبيهات
    supabase.from('vouchers').select('type, amount').eq('store_id', storeId).eq('date', todayDateStr),
    supabase.from('invoices').select('total').eq('store_id', storeId).eq('issue_date', todayDateStr).neq('status', 'cancelled'),
    supabase.from('purchase_invoices').select('total_amount').eq('store_id', storeId).eq('invoice_date', todayDateStr),
    supabase.from('invoices').select('id, invoice_number, total, amount_paid, due_date').eq('store_id', storeId).neq('status', 'paid').neq('status', 'cancelled').lt('due_date', todayDateStr),
    supabase.from('suppliers').select('balance').eq('store_id', storeId).gt('balance', 0),
    supabase.from('checks').select('id, check_number, amount, due_date, bank_name, status, type').eq('store_id', storeId).in('status', ['in_portfolio', 'bounced']),
  ])

  // Top products — sequential query using paid order IDs
  const paidOrderIds = (paidOrderIdsRes.data ?? []).map((o: { id: string }) => o.id)
  let orderItemsData: { product_id: string | null; product_name: string; quantity: number }[] = []
  if (paidOrderIds.length > 0) {
    const { data } = await supabase
      .from('order_items')
      .select('product_id, product_name, quantity')
      .in('order_id', paidOrderIds)
    orderItemsData = data ?? []
  }

  // Aggregate by product_id (fallback to product_name to avoid duplicates)
  const productMap = new Map<string, { name: string; qty: number; productId: string | null }>()
  for (const item of orderItemsData) {
    const key = item.product_id ?? item.product_name
    const existing = productMap.get(key)
    if (existing) {
      existing.qty += item.quantity
    } else {
      productMap.set(key, { name: item.product_name, qty: item.quantity, productId: item.product_id ?? null })
    }
  }
  const topProductsSorted = [...productMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 5)
  const totalQtySold   = [...productMap.values()].reduce((sum, p) => sum + p.qty, 0)

  // Fetch thumbnails for top products
  const topProductIds = topProductsSorted.filter(p => p.productId).map(p => p.productId!)
  const thumbnailMap  = new Map<string, string | null>()
  if (topProductIds.length > 0) {
    const { data: prodData } = await supabase
      .from('products')
      .select('id, thumbnail_url')
      .in('id', topProductIds)
    for (const p of (prodData ?? [])) thumbnailMap.set(p.id, p.thumbnail_url)
  }

  const topProducts = topProductsSorted.map(p => ({
    name:      p.name,
    qty:       p.qty,
    thumbnail: p.productId ? (thumbnailMap.get(p.productId) ?? null) : null,
    pct:       totalQtySold > 0 ? Math.round((p.qty / totalQtySold) * 100) : 0,
  }))
  const maxProductQty = topProducts[0]?.qty ?? 1

  // بطاقة الحالة السريعة
  const quickNewOrders  = newOrdersRes.count ?? 0
  const quickDebtTotal  = (debtCustomersRes.data ?? []).reduce((s: number, c: { balance: number | null }) => s + (c.balance ?? 0), 0)
  const quickDebtCount  = debtCustomersRes.data?.length ?? 0
  const allTrackedProducts = lowStockRes.data ?? [] as { id: string; stock_available: number; low_stock_alert: number | null }[]
  const quickLowStock   = (allTrackedProducts as { id: string; stock_available: number; low_stock_alert: number | null }[]).filter(p =>
    p.stock_available <= 0 || (p.low_stock_alert != null && p.low_stock_alert > 0 && p.stock_available <= p.low_stock_alert)
  ).length

  // ── النبض المالي ومحفظة الشيكات ──
  const todayVouchers = (todayVouchersRes.data ?? []) as { type: string; amount: number }[]
  const todayReceipts = todayVouchers.filter(v => v.type === 'receipt').reduce((s, v) => s + Number(v.amount || 0), 0)
  const todayPayments = todayVouchers.filter(v => v.type === 'payment').reduce((s, v) => s + Number(v.amount || 0), 0)
  const todayNetCash = todayReceipts - todayPayments
  const todayInvoiceSales = (todayInvoicesRes.data ?? []).reduce((s: number, i: { total: number | null }) => s + Number(i.total || 0), 0)
  const todayPurchasesTotal = (todayPurchasesRes.data ?? []).reduce((s: number, p: { total_amount: number | null }) => s + Number(p.total_amount || 0), 0)

  const totalCustomerDebt = quickDebtTotal
  const totalSupplierDebt = (supplierPayablesRes.data ?? []).reduce((s: number, sup: { balance: number | null }) => s + Number(sup.balance || 0), 0)
  const supplierDebtCount = supplierPayablesRes.data?.length ?? 0

  type CheckItemRow = { id: string; check_number: string; amount: number; due_date: string; bank_name: string; status: string; type: string }
  const allChecks = (checksRes.data ?? []) as CheckItemRow[]
  const checksPortfolio = allChecks.filter(c => c.status === 'in_portfolio')
  const checksPortfolioTotal = checksPortfolio.reduce((s, c) => s + Number(c.amount || 0), 0)
  const checksDueSoon = checksPortfolio.filter(c => c.due_date && c.due_date >= todayDateStr && c.due_date <= threeDaysLaterStr)
  const checksDueSoonTotal = checksDueSoon.reduce((s, c) => s + Number(c.amount || 0), 0)
  const checksBounced = allChecks.filter(c => c.status === 'bounced')
  const checksBouncedTotal = checksBounced.reduce((s, c) => s + Number(c.amount || 0), 0)

  type OverdueInvRow = { id: string; invoice_number: string; total: number; amount_paid: number; due_date: string }
  const overdueInvoices = (overdueInvoicesRes.data ?? []) as OverdueInvRow[]
  const overdueInvoicesTotal = overdueInvoices.reduce((s, i) => s + Math.max(0, Number(i.total || 0) - Number(i.amount_paid || 0)), 0)

  // Core metrics
  const totalRevenue    = (revenueRes.data ?? []).reduce((s: number, o: { total_amount: number | null }) => s + (o.total_amount ?? 0), 0)
  const todayRevenue    = (todayRevenueRes.data ?? []).reduce((s: number, o: { total_amount: number | null }) => s + (o.total_amount ?? 0), 0)
  const todayOrders     = todayOrdersRes.count ?? 0
  const ordersTotal     = ordersRes.count ?? 0
  const productsCount   = productsRes.count ?? 0
  const processingCount = processingRes.count ?? 0
  const isActive        = store.is_active !== false
  const isNewStore      = ordersTotal === 0 && productsCount === 0

  // خطوات البدء — تختفي عند اكتمال الثلاثة
  const setupSteps = [
    {
      id: 'product',
      label: 'أضف أول منتج',
      desc: 'اجعل متجرك جاهزاً للبيع',
      href: '/dashboard/products/new',
      done: productsCount > 0,
    },
    {
      id: 'contact',
      label: 'أكمل بيانات التواصل',
      desc: 'هاتف أو واتساب للزبائن',
      href: '/dashboard/settings',
      done: !!(store.phone || store.whatsapp),
    },
    {
      id: 'order',
      label: 'أنشئ أول طلبية',
      desc: 'POS أو عبر المتجر الإلكتروني',
      href: '/dashboard/orders/new',
      done: ordersTotal > 0,
    },
  ]
  const setupDone  = setupSteps.filter(s => s.done).length
  const showSetup  = setupDone < setupSteps.length

  // Weekly growth
  type WeekOrder = { created_at: string; total_amount: number | null; payment_status: string }
  const twoWeeksData   = (twoWeeksOrdersRes.data ?? []) as WeekOrder[]
  const thisWeekOrders = twoWeeksData.filter(o => o.created_at >= sevenDaysAgoStr)
  const lastWeekOrders = twoWeeksData.filter(o => o.created_at < sevenDaysAgoStr)
  const thisWeekRev    = thisWeekOrders.filter(o => o.payment_status === 'paid').reduce((s, o) => s + (o.total_amount ?? 0), 0)
  const lastWeekRev    = lastWeekOrders.filter(o => o.payment_status === 'paid').reduce((s, o) => s + (o.total_amount ?? 0), 0)
  const growth         = lastWeekRev === 0 ? null : Math.round(((thisWeekRev - lastWeekRev) / lastWeekRev) * 100)

  // 7-day chart — 6 days ago through today
  const chartDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now)
    d.setDate(d.getDate() - (6 - i))
    d.setHours(0, 0, 0, 0)
    return { date: d.toISOString().slice(0, 10), dayName: DAY_NAMES[d.getDay()], numLabel: d.getDate().toString(), revenue: 0, orders: 0 }
  })
  for (const order of twoWeeksData) {
    const dayStr = order.created_at.slice(0, 10)
    const found  = chartDays.find(d => d.date === dayStr)
    if (found) {
      if (order.payment_status === 'paid') found.revenue += order.total_amount ?? 0
      found.orders += 1
    }
  }
  const maxRevenue = Math.max(...chartDays.map(d => d.revenue), 1)

  const cc  = store.currency_code
  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn')

  type RecentOrder = {
    id: string; order_number: string; status: string;
    payment_status: string | null; total_amount: number | null;
    customer_name: string | null; created_at: string;
  }
  const recentOrders = (recentOrdersRes.data ?? []) as RecentOrder[]

  return (
    <div className="space-y-6 p-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-white">نظرة عامة</h1>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
              isActive
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
                : 'border-red-500/25 bg-red-500/10 text-red-400'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'animate-pulse bg-emerald-400' : 'bg-red-400'}`} />
              {isActive ? 'المتجر نشط' : 'المتجر متوقف'}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-slate-400">
            {now.toLocaleDateString('ar-u-nu-latn', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
          {!isActive && store.suspended_at && (
            <p className="mt-2 text-xs text-red-400/80">
              متوقف منذ {new Date(store.suspended_at).toLocaleDateString('ar-u-nu-latn')}
            </p>
          )}
        </div>
        <DashboardRefresh loadedAt={now.toISOString()} />
      </div>

      {/* ── شريط سعر الصرف ── */}
      {store.secondary_currency_code && (
        <ExchangeRateWidget
          storeId={store.id}
          primaryCode={store.currency_code}
          secondaryCode={store.secondary_currency_code}
          rate={(store as { exchange_rate?: number | null }).exchange_rate ?? null}
        />
      )}

      {/* ── شريط التنبيهات الذكية الاستباقية ── */}
      {(checksDueSoon.length > 0 || overdueInvoices.length > 0 || checksBounced.length > 0) && (
        <div className="space-y-2.5">
          {checksDueSoon.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/15 via-slate-900 to-slate-900 p-4 shadow-lg shadow-amber-500/5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-xl border border-amber-500/30">
                  ⏳
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-white text-sm">شيكات تستحق خلال 3 أيام</p>
                    <span className="rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[11px] font-bold text-amber-400">
                      مطلوب تحصيل / صرف
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    يوجد <span className="font-mono font-bold text-amber-400">{checksDueSoon.length}</span> شيك بقيمة إجمالية{' '}
                    <span className="font-mono font-bold text-white">{fmt(checksDueSoonTotal)} {cc}</span> تستحق في موعد أقصاه {threeDaysLaterStr}
                  </p>
                </div>
              </div>
              <Link
                href="/dashboard/cheques"
                className="shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 transition text-center"
              >
                متابعة محفظة الشيكات ←
              </Link>
            </div>
          )}

          {overdueInvoices.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-rose-500/30 bg-gradient-to-r from-rose-500/15 via-slate-900 to-slate-900 p-4 shadow-lg shadow-rose-500/5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 text-xl border border-rose-500/30">
                  🚨
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-white text-sm">فواتير مبيعات متأخرة عن موعد السداد</p>
                    <span className="rounded-full bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 text-[11px] font-bold text-rose-400">
                      ذمم مستحقة
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    يوجد <span className="font-mono font-bold text-rose-400">{overdueInvoices.length}</span> فاتورة مبيعات تجاوزت تاريخ الاستحقاق بقيمة غير مسددة{' '}
                    <span className="font-mono font-bold text-white">{fmt(overdueInvoicesTotal)} {cc}</span>
                  </p>
                </div>
              </div>
              <Link
                href="/dashboard/accounting/invoices"
                className="shrink-0 rounded-xl bg-rose-500 px-4 py-2 text-xs font-bold text-white hover:bg-rose-600 transition text-center"
              >
                عرض الفواتير المتأخرة ←
              </Link>
            </div>
          )}

          {checksBounced.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-red-500/30 bg-gradient-to-r from-red-500/15 via-slate-900 to-slate-900 p-4 shadow-lg shadow-red-500/5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/20 text-xl border border-red-500/30">
                  ⚠️
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-white text-sm">شيكات راجعة / مرتجعة تحتاج تسوية</p>
                    <span className="rounded-full bg-red-500/20 border border-red-500/30 px-2 py-0.5 text-[11px] font-bold text-red-400">
                      شيك مرتجع
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    يوجد <span className="font-mono font-bold text-red-400">{checksBounced.length}</span> شيك مرتجع بقيمة{' '}
                    <span className="font-mono font-bold text-white">{fmt(checksBouncedTotal)} {cc}</span> لم يتم تسويتها بعد
                  </p>
                </div>
              </div>
              <Link
                href="/dashboard/cheques"
                className="shrink-0 rounded-xl border border-red-500/40 bg-red-500/20 px-4 py-2 text-xs font-bold text-red-300 hover:bg-red-500/30 transition text-center"
              >
                تسوية الشيكات المرتجعة ←
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ── بطاقة الحالة السريعة ── */}
      {!isNewStore && (
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">حالة متجرك الآن</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">

            {/* طلبات جديدة */}
            <Link
              href="/dashboard/orders?status=pending"
              className={`group flex items-center gap-3 rounded-xl border p-3.5 transition-colors ${
                quickNewOrders > 0
                  ? 'border-amber-500/25 bg-amber-500/8 hover:bg-amber-500/12'
                  : 'border-white/5 bg-slate-800/50 hover:border-white/10'
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg ${
                quickNewOrders > 0 ? 'bg-amber-500/15' : 'bg-slate-700/60'
              }`}>
                📥
              </span>
              <div className="min-w-0">
                <p className={`text-xl font-bold leading-none ${quickNewOrders > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                  {quickNewOrders}
                </p>
                <p className="mt-0.5 text-xs text-slate-300 truncate">طلب جديد</p>
              </div>
              {quickNewOrders > 0 && (
                <span className="mr-auto h-2 w-2 shrink-0 rounded-full bg-amber-400 animate-pulse" />
              )}
            </Link>

            {/* مبالغ يجب تحصيلها */}
            <Link
              href="/dashboard/customers"
              className={`group flex items-center gap-3 rounded-xl border p-3.5 transition-colors ${
                quickDebtTotal > 0
                  ? 'border-red-500/25 bg-red-500/8 hover:bg-red-500/12'
                  : 'border-white/5 bg-slate-800/50 hover:border-white/10'
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg ${
                quickDebtTotal > 0 ? 'bg-red-500/15' : 'bg-slate-700/60'
              }`}>
                💰
              </span>
              <div className="min-w-0">
                <p className={`text-xl font-bold leading-none ${quickDebtTotal > 0 ? 'text-red-400' : 'text-slate-400'}`}>
                  {quickDebtTotal > 0 ? fmt(quickDebtTotal) : '0'}
                </p>
                <p className="mt-0.5 text-xs text-slate-300 truncate">
                  {quickDebtTotal > 0 ? `${cc} · ${quickDebtCount} زبون` : 'لا ذمم مستحقة'}
                </p>
              </div>
            </Link>

            {/* منتجات قاربت على النفاد */}
            <Link
              href="/dashboard/inventory/alerts"
              className={`group flex items-center gap-3 rounded-xl border p-3.5 transition-colors ${
                quickLowStock > 0
                  ? 'border-orange-500/25 bg-orange-500/8 hover:bg-orange-500/12'
                  : 'border-white/5 bg-slate-800/50 hover:border-white/10'
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg ${
                quickLowStock > 0 ? 'bg-orange-500/15' : 'bg-slate-700/60'
              }`}>
                📦
              </span>
              <div className="min-w-0">
                <p className={`text-xl font-bold leading-none ${quickLowStock > 0 ? 'text-orange-400' : 'text-slate-400'}`}>
                  {quickLowStock}
                </p>
                <p className="mt-0.5 text-xs text-slate-300">
                  {quickLowStock > 0 ? 'قارب على النفاد' : 'المخزون بخير'}
                </p>
              </div>
              {quickLowStock > 0 && (
                <span className="mr-auto h-2 w-2 shrink-0 rounded-full bg-orange-400 animate-pulse" />
              )}
            </Link>

            {/* حالة المتجر العامة */}
            <div className={`flex items-center gap-3 rounded-xl border p-3.5 ${
              quickNewOrders === 0 && quickDebtTotal === 0 && quickLowStock === 0
                ? 'border-emerald-500/25 bg-emerald-500/8'
                : 'border-white/5 bg-slate-800/50'
            }`}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg ${
                quickNewOrders === 0 && quickDebtTotal === 0 && quickLowStock === 0 ? 'bg-emerald-500/15' : 'bg-slate-700/60'
              }`}>
                {quickNewOrders === 0 && quickDebtTotal === 0 && quickLowStock === 0 ? '✅' : '⚡'}
              </span>
              <div className="min-w-0">
                <p className={`text-sm font-semibold leading-snug ${
                  quickNewOrders === 0 && quickDebtTotal === 0 && quickLowStock === 0 ? 'text-emerald-400' : 'text-white'
                }`}>
                  {quickNewOrders === 0 && quickDebtTotal === 0 && quickLowStock === 0 ? 'كل شيء بخير' : 'يحتاج انتباهك'}
                </p>
                <p className="mt-0.5 text-xs text-slate-300 truncate">
                  {quickNewOrders === 0 && quickDebtTotal === 0 && quickLowStock === 0
                    ? 'لا تنبيهات اليوم'
                    : `${[quickNewOrders > 0 && 'طلبات', quickDebtTotal > 0 && 'ذمم', quickLowStock > 0 && 'مخزون'].filter(Boolean).join(' · ')}`
                  }
                </p>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── نبض اليوم المالي والتشغيلي ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <span>⚡</span> نبض اليوم المالي والتشغيلي
          </h2>
          <span className="text-xs text-slate-400">تحديث لحظي للمقبوضات والمدفوعات وصافي النقد</span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {/* مبيعات اليوم */}
          <div className="rounded-2xl border border-sky-500/20 bg-slate-900 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">مبيعات اليوم</span>
              <span className="rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-400">فواتير + متجر</span>
            </div>
            <p className="mt-2 text-xl font-black text-white font-mono">
              {fmt(todayRevenue + todayInvoiceSales)}{' '}
              <span className="text-xs text-sky-400 font-bold">{cc}</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-500 truncate">
              {todayOrders} طلب متجر · مبيعات اليوم
            </p>
          </div>

          {/* مقبوضات اليوم */}
          <div className="rounded-2xl border border-emerald-500/20 bg-slate-900 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-emerald-400">مقبوضات اليوم</span>
              <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">سند قبض</span>
            </div>
            <p className="mt-2 text-xl font-black text-emerald-400 font-mono">
              {fmt(todayReceipts)}{' '}
              <span className="text-xs text-emerald-300 font-bold">{cc}</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-500 truncate">نقد + شيكات مقبوضة</p>
          </div>

          {/* مدفوعات ومصروفات اليوم */}
          <div className="rounded-2xl border border-rose-500/20 bg-slate-900 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-rose-400">مدفوعات اليوم</span>
              <span className="rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-400">سند صرف</span>
            </div>
            <p className="mt-2 text-xl font-black text-rose-400 font-mono">
              {fmt(todayPayments)}{' '}
              <span className="text-xs text-rose-300 font-bold">{cc}</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-500 truncate">صرف ومصاريف وموردين</p>
          </div>

          {/* مشتريات اليوم */}
          <div className="rounded-2xl border border-blue-500/20 bg-slate-900 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-blue-400">مشتريات اليوم</span>
              <span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-bold text-blue-400">فواتير شراء</span>
            </div>
            <p className="mt-2 text-xl font-black text-blue-400 font-mono">
              {fmt(todayPurchasesTotal)}{' '}
              <span className="text-xs text-blue-300 font-bold">{cc}</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-500 truncate">بضاعة واردة للمستودع</p>
          </div>

          {/* صافي السيولة النقدية اليوم */}
          <div className={`col-span-2 sm:col-span-1 rounded-2xl border p-4 shadow-sm ${
            todayNetCash >= 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">صافي السيولة اليوم</span>
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                todayNetCash >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
              }`}>
                {todayNetCash >= 0 ? 'فائض نقد' : 'عجز نقد'}
              </span>
            </div>
            <p className={`mt-2 text-xl font-black font-mono ${todayNetCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {todayNetCash >= 0 ? `+${fmt(todayNetCash)}` : fmt(todayNetCash)}{' '}
              <span className="text-xs font-bold">{cc}</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-400 truncate">المقبوضات - المدفوعات</p>
          </div>
        </div>
      </div>

      {/* ── مؤشرات الذمم ومحفظة الشيكات ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <span>⚖️</span> الذمم ومحفظة الشيكات
          </h2>
          <span className="text-xs text-slate-400">مراقبة السيولة والديون ومحفظة الشيكات</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* ذمم الزبائن والعملاء */}
          <Link
            href="/dashboard/customers"
            className="group rounded-2xl border border-white/10 bg-slate-900 p-5 hover:border-sky-500/30 transition shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">ديون العملاء (الذمم المدينة)</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400 text-sm">
                👥
              </span>
            </div>
            <p className="mt-2 text-2xl font-black text-white font-mono">
              {fmt(totalCustomerDebt)} <span className="text-xs text-sky-400 font-bold">{cc}</span>
            </p>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400 border-t border-white/5 pt-2">
              <span>{quickDebtCount} عميل مدين</span>
              <span className="font-bold text-sky-400 group-hover:underline">كشوف العملاء ←</span>
            </div>
          </Link>

          {/* التزامات الموردين */}
          <Link
            href="/dashboard/suppliers"
            className="group rounded-2xl border border-white/10 bg-slate-900 p-5 hover:border-amber-500/30 transition shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">مستحقات الموردين (الذمم الدائنة)</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 text-sm">
                🏭
              </span>
            </div>
            <p className="mt-2 text-2xl font-black text-amber-400 font-mono">
              {fmt(totalSupplierDebt)} <span className="text-xs text-amber-300 font-bold">{cc}</span>
            </p>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400 border-t border-white/5 pt-2">
              <span>{supplierDebtCount} مورد دائن</span>
              <span className="font-bold text-amber-400 group-hover:underline">كشوف الموردين ←</span>
            </div>
          </Link>

          {/* محفظة الشيكات */}
          <Link
            href="/dashboard/cheques"
            className="group rounded-2xl border border-white/10 bg-slate-900 p-5 hover:border-purple-500/30 transition shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">محفظة الشيكات (برسم التحصيل)</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400 text-sm">
                📑
              </span>
            </div>
            <p className="mt-2 text-2xl font-black text-purple-400 font-mono">
              {fmt(checksPortfolioTotal)} <span className="text-xs text-purple-300 font-bold">{cc}</span>
            </p>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400 border-t border-white/5 pt-2">
              <span>{checksPortfolio.length} شيك بالمحفظة</span>
              <span className="font-bold text-purple-400 group-hover:underline">إدارة المحفظة ←</span>
            </div>
          </Link>
        </div>
      </div>

      {/* ── بوابات النظام الرئيسية (الخطة الاحترافية) ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <span>🗂️</span> أقسام ولوحات النظام الرئيسية
          </h2>
          <span className="text-xs text-slate-400">وصول مباشر للـ Dashboards المتخصصة</span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Link
            href="/dashboard/sales"
            className="group flex flex-col justify-between rounded-2xl border border-sky-500/30 bg-gradient-to-br from-sky-500/15 via-slate-900 to-slate-900 p-4 transition-all duration-200 hover:-translate-y-1 hover:border-sky-400 hover:shadow-lg hover:shadow-sky-500/10"
          >
            <div>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/20 text-2xl mb-3 shadow-inner">
                📈
              </span>
              <h3 className="font-bold text-white text-sm group-hover:text-sky-400 transition-colors">إدارة المبيعات</h3>
              <p className="mt-1 text-[11px] text-slate-400 line-clamp-2">الفواتير، المرتجعات، عروض الأسعار، POS، والعملاء</p>
            </div>
            <div className="mt-4 flex items-center justify-between text-[11px] font-bold text-sky-400">
              <span>فتح اللوحة</span>
              <span className="transition-transform group-hover:-translate-x-1">←</span>
            </div>
          </Link>

          <Link
            href="/dashboard/purchases-hub"
            className="group flex flex-col justify-between rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-500/15 via-slate-900 to-slate-900 p-4 transition-all duration-200 hover:-translate-y-1 hover:border-blue-400 hover:shadow-lg hover:shadow-blue-500/10"
          >
            <div>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/20 text-2xl mb-3 shadow-inner">
                🛒
              </span>
              <h3 className="font-bold text-white text-sm group-hover:text-blue-400 transition-colors">إدارة المشتريات</h3>
              <p className="mt-1 text-[11px] text-slate-400 line-clamp-2">فواتير الشراء، مردود المشتريات، ودليل الموردين</p>
            </div>
            <div className="mt-4 flex items-center justify-between text-[11px] font-bold text-blue-400">
              <span>فتح اللوحة</span>
              <span className="transition-transform group-hover:-translate-x-1">←</span>
            </div>
          </Link>

          {(store.plan === 'pro' || store.plan === 'basic') && (
            <Link
              href="/dashboard/finance"
              className="group flex flex-col justify-between rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-slate-900 to-slate-900 p-4 transition-all duration-200 hover:-translate-y-1 hover:border-emerald-400 hover:shadow-lg hover:shadow-emerald-500/10"
            >
              <div>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/20 text-2xl mb-3 shadow-inner">
                  💵
                </span>
                <h3 className="font-bold text-white text-sm group-hover:text-emerald-400 transition-colors">الإدارة المالية</h3>
                <p className="mt-1 text-[11px] text-slate-400 line-clamp-2">الشيكات، البنوك، القبض والصرف، والصندوق</p>
              </div>
              <div className="mt-4 flex items-center justify-between text-[11px] font-bold text-emerald-400">
                <span>فتح اللوحة</span>
                <span className="transition-transform group-hover:-translate-x-1">←</span>
              </div>
            </Link>
          )}

          {(store.plan === 'pro' || store.plan === 'basic') && (
            <Link
              href="/dashboard/accounting-hub"
              className="group flex flex-col justify-between rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-500/15 via-slate-900 to-slate-900 p-4 transition-all duration-200 hover:-translate-y-1 hover:border-purple-400 hover:shadow-lg hover:shadow-purple-500/10"
            >
              <div>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-500/20 text-2xl mb-3 shadow-inner">
                  ⚖️
                </span>
                <h3 className="font-bold text-white text-sm group-hover:text-purple-400 transition-colors">المحاسبة والتقارير</h3>
                <p className="mt-1 text-[11px] text-slate-400 line-clamp-2">شجرة الحسابات، قيود اليومية، والقوائم الختامية</p>
              </div>
              <div className="mt-4 flex items-center justify-between text-[11px] font-bold text-purple-400">
                <span>فتح اللوحة</span>
                <span className="transition-transform group-hover:-translate-x-1">←</span>
              </div>
            </Link>
          )}

          <Link
            href="/dashboard/inventory-hub"
            className="group flex flex-col justify-between rounded-2xl border border-teal-500/30 bg-gradient-to-br from-teal-500/15 via-slate-900 to-slate-900 p-4 transition-all duration-200 hover:-translate-y-1 hover:border-teal-400 hover:shadow-lg hover:shadow-teal-500/10"
          >
            <div>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-500/20 text-2xl mb-3 shadow-inner">
                📦
              </span>
              <h3 className="font-bold text-white text-sm group-hover:text-teal-400 transition-colors">إدارة المخزون</h3>
              <p className="mt-1 text-[11px] text-slate-400 line-clamp-2">المنتجات، الحركات، التنبيهات، والماركات</p>
            </div>
            <div className="mt-4 flex items-center justify-between text-[11px] font-bold text-teal-400">
              <span>فتح اللوحة</span>
              <span className="transition-transform group-hover:-translate-x-1">←</span>
            </div>
          </Link>

          <Link
            href="/dashboard/store-hub"
            className="group flex flex-col justify-between rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/15 via-slate-900 to-slate-900 p-4 transition-all duration-200 hover:-translate-y-1 hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/10"
          >
            <div>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/20 text-2xl mb-3 shadow-inner">
                🌐
              </span>
              <h3 className="font-bold text-white text-sm group-hover:text-indigo-400 transition-colors">المتجر الإلكتروني</h3>
              <p className="mt-1 text-[11px] text-slate-400 line-clamp-2">الطلبيات، العروض، حملات WhatsApp، والتقييمات</p>
            </div>
            <div className="mt-4 flex items-center justify-between text-[11px] font-bold text-indigo-400">
              <span>فتح اللوحة</span>
              <span className="transition-transform group-hover:-translate-x-1">←</span>
            </div>
          </Link>
        </div>
      </div>

      {/* ── خطوات البدء السريع ── */}
      {showSetup && (
        <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-l from-sky-500/5 to-transparent p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-white">
                {setupDone === 0 ? '🎉 مرحباً بك في Bazarko!' : '🚀 أكمل إعداد متجرك'}
              </p>
              <p className="mt-0.5 text-sm text-slate-400">
                {setupDone} / {setupSteps.length} خطوات مكتملة
              </p>
            </div>
            {/* شريط التقدم */}
            <div className="hidden sm:block w-32">
              <div className="h-1.5 w-full rounded-full bg-slate-700">
                <div
                  className="h-1.5 rounded-full bg-sky-500 transition-all"
                  style={{ width: `${(setupDone / setupSteps.length) * 100}%` }}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {setupSteps.map(step => (
              <Link
                key={step.id}
                href={step.href}
                className={`flex items-start gap-3 rounded-xl border p-4 transition-colors ${
                  step.done
                    ? 'border-emerald-500/20 bg-emerald-500/5 opacity-60'
                    : 'border-white/10 bg-slate-800/60 hover:border-sky-500/30 hover:bg-slate-800'
                }`}
              >
                <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  step.done ? 'bg-emerald-500 text-white' : 'border border-white/20 text-slate-400'
                }`}>
                  {step.done ? '✓' : ''}
                </span>
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${step.done ? 'text-emerald-400 line-through decoration-emerald-500/40' : 'text-white'}`}>
                    {step.label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">{step.desc}</p>
                </div>
              </Link>
            ))}
          </div>

          {/* شارك رابط المتجر */}
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
            <span className="text-xs text-slate-400">رابط متجرك:</span>
            <span className="text-xs text-sky-400 font-mono" dir="ltr">
              {store.subdomain}.{process.env.NEXT_PUBLIC_DOMAIN ?? 'bazarko.app'}
            </span>
            <a
              href={`https://${store.subdomain}.${process.env.NEXT_PUBLIC_DOMAIN ?? 'bazarko.app'}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mr-auto rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 transition-colors"
            >
              👁️ معاينة المتجر
            </a>
          </div>
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-300">طلبيات اليوم</p>
          <p className="mt-2 text-3xl font-bold text-sky-400">{todayOrders}</p>
          <p className="mt-1 text-xs text-slate-400">
            {isNewStore ? 'أنشئ أول طلبية الآن' : `من ${ordersTotal} إجمالاً`}
          </p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-300">إيرادات اليوم</p>
          <p className="mt-2 text-3xl font-bold text-emerald-400">
            {fmt(todayRevenue)}
            <span className="mr-1 text-sm font-normal text-slate-400">{cc}</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {isNewStore ? 'ستظهر بعد أول إيصال' : 'من الطلبيات المدفوعة'}
          </p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-300">قيد المعالجة</p>
          <p className={`mt-2 text-3xl font-bold ${processingCount > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
            {processingCount}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {processingCount === 0 ? 'لا طلبيات معلقة' : 'طلبية تحتاج متابعة'}
          </p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-300">نمو هذا الأسبوع</p>
          <p className={`mt-2 text-3xl font-bold ${
            growth === null ? 'text-slate-400' : growth >= 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {growth === null ? '—' : `${growth >= 0 ? '+' : ''}${growth}%`}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {growth === null ? 'لا بيانات للمقارنة بعد' : 'مقارنةً بالأسبوع الماضي'}
          </p>
        </div>
      </div>

      {/* ── Sales Chart + Recent Orders ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* 7-Day Sales Chart */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 lg:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">مبيعات آخر 7 أيام</h2>
            <span className="text-xs text-slate-400">{cc}</span>
          </div>
          <div className="flex items-end gap-2" style={{ height: '140px' }}>
            {chartDays.map(day => (
              <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full items-end justify-center" style={{ height: '110px' }}>
                  <div
                    className={`w-full rounded-t-md transition-all ${
                      day.revenue > 0 ? 'bg-sky-500/50 hover:bg-sky-500/70' : 'bg-slate-700/30'
                    }`}
                    style={{ height: `${day.revenue > 0 ? Math.max(4, (day.revenue / maxRevenue) * 106) : 3}px` }}
                    title={`${day.dayName} ${day.numLabel}: ${fmt(day.revenue)} ${cc} — ${day.orders} طلبية`}
                  />
                </div>
                <span className="text-xs text-slate-400">{day.numLabel}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-5 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-500/50" />
              إيرادات مدفوعة
            </span>
            <span className="text-slate-400">المجموع: {fmt(thisWeekRev)} {cc}</span>
          </div>
        </div>

        {/* Recent Orders */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">آخر الطلبيات</h2>
            <Link href="/dashboard/orders" className="text-xs text-sky-400 hover:underline">
              عرض الكل
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-slate-400">لا طلبيات بعد</p>
              <Link
                href="/dashboard/orders/new"
                className="text-xs text-sky-400 hover:underline"
              >
                إنشاء أول طلبية ←
              </Link>
            </div>
          ) : (
            <div className="space-y-2.5">
              {recentOrders.map(order => {
                const st = STATUS_LABELS[order.status] ?? { label: order.status, color: 'bg-white/10 text-white' }
                return (
                  <Link
                    key={order.id}
                    href={`/dashboard/orders/${order.id}`}
                    className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-800/50 p-3 transition-colors hover:border-sky-500/20 hover:bg-slate-800"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-white">{order.order_number}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-300">
                        {order.customer_name ?? 'زبون غير محدد'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${st.color}`}>
                        {st.label}
                      </span>
                      <span className="text-xs text-slate-300">{fmt(order.total_amount ?? 0)} {cc}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Top Products + Total Stats ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

        {/* Top Products */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">أكثر المنتجات مبيعاً</h2>
            <span className="text-xs text-slate-400">آخر 30 يوم</span>
          </div>
          {topProducts.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-slate-400">
                {isNewStore ? 'أضف منتجاتك لتبدأ البيع' : 'لا بيانات مبيعات بعد'}
              </p>
              {isNewStore && (
                <Link href="/dashboard/products/new" className="text-xs text-sky-400 hover:underline">
                  إضافة منتج جديد ←
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {topProducts.map((p, i) => (
                <div key={p.name} className="flex items-center gap-3">
                  {/* صورة مصغّرة */}
                  <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-lg bg-slate-800">
                    {p.thumbnail ? (
                      <img src={p.thumbnail} alt={p.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                        {i + 1}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm text-slate-300">{p.name}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs font-semibold text-violet-400">{p.pct}%</span>
                        <span className="text-xs text-slate-400">{p.qty} قطعة</span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-800">
                      <div
                        className="h-1.5 rounded-full bg-violet-500/60"
                        style={{ width: `${(p.qty / maxProductQty) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Total Stats */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <h2 className="mb-5 text-sm font-semibold text-white">الإحصائيات الإجمالية</h2>
          <div className="grid grid-cols-2 gap-4">
            {([
              { label: 'إجمالي الطلبيات',  value: ordersTotal,              icon: '📦', color: 'text-sky-400',     suffix: '' },
              { label: 'الزبائن',           value: customersRes.count ?? 0,  icon: '👥', color: 'text-violet-400',  suffix: '' },
              { label: 'المنتجات النشطة',   value: productsCount,            icon: '🛍️', color: 'text-emerald-400', suffix: '' },
              { label: 'إجمالي الإيرادات', value: fmt(totalRevenue),        icon: '💰', color: 'text-amber-400',   suffix: cc },
            ] as const).map(stat => (
              <div key={stat.label} className="rounded-xl bg-slate-800/50 p-4">
                <span className="text-xl">{stat.icon}</span>
                <p className={`mt-2 text-xl font-bold ${stat.color}`}>
                  {stat.value}
                  {stat.suffix && <span className="mr-1 text-xs font-normal text-slate-400">{stat.suffix}</span>}
                </p>
                <p className="mt-0.5 text-xs text-slate-300">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">إجراءات سريعة</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { href: '/dashboard/orders/new',          label: 'طلبية جديدة', icon: '➕', desc: 'POS أو ذمة' },
            { href: '/dashboard/products/new',         label: 'منتج جديد',   icon: '📝', desc: 'أضف منتجاً للمتجر' },
            { href: '/dashboard/customers',            label: 'زبون جديد',   icon: '👤', desc: 'أضف زبوناً للقائمة' },
            { href: '/dashboard/accounting/receipts',  label: 'سند قبض',     icon: '💵', desc: 'استلام دفعة' },
          ].map(action => (
            <a
              key={action.href}
              href={action.href}
              className="flex min-h-[110px] flex-col rounded-xl border border-white/5 bg-slate-900 p-4 transition-colors hover:border-sky-500/30 hover:bg-slate-800"
            >
              <span className="text-2xl">{action.icon}</span>
              <p className="mt-2 text-sm font-semibold text-white">{action.label}</p>
              <p className="mt-0.5 text-xs text-slate-400">{action.desc}</p>
            </a>
          ))}
        </div>
      </section>

    </div>
  )
}
