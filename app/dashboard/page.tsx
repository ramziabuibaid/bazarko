import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getStoreForUser } from '@/lib/supabase/getStore'
import Link from 'next/link'
import DashboardRefresh from '@/components/dashboard/DashboardRefresh'

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
    .select('id, currency_code, is_active, suspended_at, logo_url, phone, whatsapp, subdomain, country_code')
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

  const [
    ordersRes, customersRes, productsRes, revenueRes,
    todayOrdersRes, todayRevenueRes,
    twoWeeksOrdersRes, recentOrdersRes,
    processingRes, paidOrderIdsRes,
    newOrdersRes, lowStockRes, debtCustomersRes,
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
  const fmt = (n: number) => n.toLocaleString('ar')

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
            {now.toLocaleDateString('ar', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
          {!isActive && store.suspended_at && (
            <p className="mt-2 text-xs text-red-400/80">
              متوقف منذ {new Date(store.suspended_at).toLocaleDateString('ar')}
            </p>
          )}
        </div>
        <DashboardRefresh loadedAt={now.toISOString()} />
      </div>

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
                <p className="mt-0.5 text-xs text-slate-300 truncate">
                  {quickLowStock > 0 ? 'منتج قارب النفاد' : 'المخزون بخير'}
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
              className="rounded-xl border border-white/5 bg-slate-900 p-4 transition-colors hover:border-sky-500/30 hover:bg-slate-800"
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
