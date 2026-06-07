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
    .select('id, currency_code, is_active, suspended_at')
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
  ])

  // Top products — sequential query using paid order IDs
  const paidOrderIds = (paidOrderIdsRes.data ?? []).map((o: { id: string }) => o.id)
  let orderItemsData: { product_name: string; quantity: number }[] = []
  if (paidOrderIds.length > 0) {
    const { data } = await supabase.from('order_items').select('product_name, quantity').in('order_id', paidOrderIds)
    orderItemsData = data ?? []
  }

  // Aggregate top products
  const productMap = new Map<string, number>()
  for (const item of orderItemsData) {
    productMap.set(item.product_name, (productMap.get(item.product_name) ?? 0) + item.quantity)
  }
  const topProducts = [...productMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const maxProductQty = topProducts[0]?.[1] ?? 1

  // Core metrics
  const totalRevenue    = (revenueRes.data ?? []).reduce((s: number, o: { total_amount: number | null }) => s + (o.total_amount ?? 0), 0)
  const todayRevenue    = (todayRevenueRes.data ?? []).reduce((s: number, o: { total_amount: number | null }) => s + (o.total_amount ?? 0), 0)
  const todayOrders     = todayOrdersRes.count ?? 0
  const ordersTotal     = ordersRes.count ?? 0
  const productsCount   = productsRes.count ?? 0
  const processingCount = processingRes.count ?? 0
  const isActive        = store.is_active !== false
  const isNewStore      = ordersTotal === 0 && productsCount === 0

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

      {/* ── رسالة ترحيب للمتاجر الجديدة ── */}
      {isNewStore && (
        <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-l from-sky-500/5 to-transparent p-5">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 text-2xl leading-none">🎉</div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-white">مرحباً بك في Bazarko!</p>
              <p className="mt-1 text-sm text-slate-400">
                متجرك جاهز — ابدأ بإضافة منتجاتك أو إنشاء أول طلبية مباشرةً.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/dashboard/products/new"
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400"
                >
                  إضافة أول منتج
                </Link>
                <Link
                  href="/dashboard/orders/new"
                  className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
                >
                  إنشاء أول طلبية
                </Link>
                <Link
                  href="/dashboard/customers"
                  className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
                >
                  إضافة زبون
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-400">طلبيات اليوم</p>
          <p className="mt-2 text-3xl font-bold text-sky-400">{todayOrders}</p>
          <p className="mt-1 text-xs text-slate-400">
            {isNewStore ? 'أنشئ أول طلبية الآن' : `من ${ordersTotal} إجمالاً`}
          </p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-400">إيرادات اليوم</p>
          <p className="mt-2 text-3xl font-bold text-emerald-400">
            {fmt(todayRevenue)}
            <span className="mr-1 text-sm font-normal text-slate-400">{cc}</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {isNewStore ? 'ستظهر بعد أول إيصال' : 'من الطلبيات المدفوعة'}
          </p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-400">قيد المعالجة</p>
          <p className={`mt-2 text-3xl font-bold ${processingCount > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
            {processingCount}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {processingCount === 0 ? 'لا طلبيات معلقة' : 'طلبية تحتاج متابعة'}
          </p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-400">نمو هذا الأسبوع</p>
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
            <span className="text-xs text-slate-500">{cc}</span>
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
                <span className="text-[10px] text-slate-500">{day.numLabel}</span>
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
                      <p className="mt-0.5 truncate text-[11px] text-slate-400">
                        {order.customer_name ?? 'زبون غير محدد'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${st.color}`}>
                        {st.label}
                      </span>
                      <span className="text-[11px] text-slate-300">{fmt(order.total_amount ?? 0)} {cc}</span>
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
            <span className="text-xs text-slate-500">آخر 30 يوم</span>
          </div>
          {topProducts.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-slate-400">
                {isNewStore ? 'أضف منتجاتك لتبدأ البيع' : 'لا بيانات مبيعات بعد'}
              </p>
              {isNewStore && (
                <Link
                  href="/dashboard/products/new"
                  className="text-xs text-sky-400 hover:underline"
                >
                  إضافة منتج جديد ←
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {topProducts.map(([name, qty], i) => (
                <div key={name}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate text-slate-300">{i + 1}. {name}</span>
                    <span className="shrink-0 text-xs text-slate-400">{qty} قطعة</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-800">
                    <div
                      className="h-1.5 rounded-full bg-violet-500/60"
                      style={{ width: `${(qty / maxProductQty) * 100}%` }}
                    />
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
                <p className="mt-0.5 text-[11px] text-slate-400">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">إجراءات سريعة</h2>
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
