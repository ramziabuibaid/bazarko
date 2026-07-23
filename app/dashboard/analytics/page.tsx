import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getStoreForUser } from '@/lib/supabase/getStore'

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

export default async function AnalyticsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, subdomain, country_code, currency_code')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  const now     = new Date()
  const todayStart    = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const weekStart     = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0, 0, 0, 0)
  const monthStart    = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 29); thirtyDaysAgo.setHours(0, 0, 0, 0)

  // جلب كل الأحداث في آخر 30 يوم (مع حد معقول)
  const { data: events } = await supabase
    .from('store_analytics')
    .select('event_type, visitor_id, session_id, product_id, is_mobile, created_at')
    .eq('store_id', storeId)
    .gte('created_at', thirtyDaysAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(10000)

  const allEvents = events ?? []

  // ── زوار فريدون ──
  const todayEvents  = allEvents.filter(e => e.created_at >= todayStart.toISOString())
  const weekEvents   = allEvents.filter(e => e.created_at >= weekStart.toISOString())
  const monthEvents  = allEvents.filter(e => e.created_at >= monthStart.toISOString())

  const visitEventsToday = todayEvents.filter(e => e.event_type === 'store_visit')
  const visitEventsWeek  = weekEvents.filter(e => e.event_type === 'store_visit')
  const visitEventsMonth = monthEvents.filter(e => e.event_type === 'store_visit')

  const uniqueVisitorsToday  = new Set(visitEventsToday.map(e => e.visitor_id)).size
  const uniqueVisitorsWeek   = new Set(visitEventsWeek.map(e => e.visitor_id)).size
  const uniqueVisitorsMonth  = new Set(visitEventsMonth.map(e => e.visitor_id)).size
  const totalVisitsToday     = visitEventsToday.length
  const totalVisitsWeek      = visitEventsWeek.length

  // ── الجهاز ──
  const mobileCount  = allEvents.filter(e => e.event_type === 'store_visit' && e.is_mobile).length
  const desktopCount = allEvents.filter(e => e.event_type === 'store_visit' && !e.is_mobile).length
  const totalDevices = mobileCount + desktopCount
  const mobilePct    = totalDevices > 0 ? Math.round((mobileCount / totalDevices) * 100) : 0

  // ── رسم بياني آخر 7 أيام ──
  const chartDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now)
    d.setDate(d.getDate() - (6 - i))
    d.setHours(0, 0, 0, 0)
    const nextD = new Date(d); nextD.setDate(d.getDate() + 1)
    const dayEvents = allEvents.filter(
      e => e.event_type === 'store_visit' && e.created_at >= d.toISOString() && e.created_at < nextD.toISOString()
    )
    return {
      date:         d.toISOString().slice(0, 10),
      dayName:      DAY_NAMES[d.getDay()],
      numLabel:     d.getDate().toString(),
      uniqueVisitors: new Set(dayEvents.map(e => e.visitor_id)).size,
      totalVisits:  dayEvents.length,
    }
  })
  const maxVisitors = Math.max(...chartDays.map(d => d.uniqueVisitors), 1)

  // ── أكثر المنتجات مشاهدةً (من products.view_count) ──
  const { data: topViewedRaw } = await supabase
    .from('products')
    .select('id, name, thumbnail_url, view_count')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('view_count', { ascending: false })
    .limit(5)
  const topViewed = (topViewedRaw ?? []).filter(p => p.view_count > 0)
  const maxViews  = topViewed[0]?.view_count ?? 1

  // ── أكثر المنتجات إضافةً للسلة (من analytics) ──
  const cartEvents = allEvents.filter(e => e.event_type === 'add_to_cart' && e.product_id)
  const cartMap    = new Map<string, number>()
  for (const e of cartEvents) {
    cartMap.set(e.product_id!, (cartMap.get(e.product_id!) ?? 0) + 1)
  }
  const topCartIds = [...cartMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  // ── أكثر المنتجات إضافةً للمفضلة (من analytics) ──
  const wishEvents = allEvents.filter(e => e.event_type === 'add_to_wishlist' && e.product_id)
  const wishMap    = new Map<string, number>()
  for (const e of wishEvents) {
    wishMap.set(e.product_id!, (wishMap.get(e.product_id!) ?? 0) + 1)
  }
  const topWishIds = [...wishMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  // جلب أسماء وصور المنتجات من السلة والمفضلة
  const productIdsNeeded = [...new Set([...topCartIds.map(x => x[0]), ...topWishIds.map(x => x[0])])]
  const productNameMap   = new Map<string, { name: string; thumbnail: string | null }>()
  if (productIdsNeeded.length > 0) {
    const { data: pData } = await supabase
      .from('products')
      .select('id, name, thumbnail_url')
      .in('id', productIdsNeeded)
    for (const p of (pData ?? [])) productNameMap.set(p.id, { name: p.name, thumbnail: p.thumbnail_url })
  }

  const topCart = topCartIds.map(([pid, count]) => ({
    ...productNameMap.get(pid) ?? { name: pid.slice(0, 8), thumbnail: null },
    count,
  }))
  const topWish = topWishIds.map(([pid, count]) => ({
    ...productNameMap.get(pid) ?? { name: pid.slice(0, 8), thumbnail: null },
    count,
  }))
  const maxCart = topCart[0]?.count ?? 1
  const maxWish = topWish[0]?.count ?? 1

  // ── قمع التحويل (آخر 30 يوم) ──
  const funnelVisits    = new Set(allEvents.filter(e => e.event_type === 'store_visit').map(e => e.visitor_id)).size
  const funnelViews     = new Set(allEvents.filter(e => e.event_type === 'product_view').map(e => e.visitor_id)).size
  const funnelCart      = new Set(allEvents.filter(e => e.event_type === 'add_to_cart').map(e => e.visitor_id)).size
  const funnelCheckout  = new Set(allEvents.filter(e => e.event_type === 'checkout_start').map(e => e.visitor_id)).size
  const funnelMax       = funnelVisits || 1

  const noData = allEvents.length === 0

  return (
    <div className="space-y-6 p-6" dir="rtl">

      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-semibold text-white">تحليلات المتجر</h1>
        <p className="mt-1 text-sm text-slate-400">بيانات الزوار والسلوك — آخر 30 يوم</p>
      </div>

      {noData && (
        <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/50 p-10 text-center">
          <p className="text-3xl">📊</p>
          <p className="mt-3 font-semibold text-white">لا بيانات بعد</p>
          <p className="mt-1 text-sm text-slate-400">
            ستظهر البيانات فور أول زيارة لمتجرك. طبّق migration 021 أولاً.
          </p>
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">

        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-300">زوار اليوم</p>
          <p className="mt-2 text-3xl font-bold text-sky-400">{uniqueVisitorsToday}</p>
          <p className="mt-1 text-xs text-slate-400">{totalVisitsToday} زيارة إجمالاً</p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-300">زوار هذا الأسبوع</p>
          <p className="mt-2 text-3xl font-bold text-violet-400">{uniqueVisitorsWeek}</p>
          <p className="mt-1 text-xs text-slate-400">{totalVisitsWeek} زيارة إجمالاً</p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-300">زوار هذا الشهر</p>
          <p className="mt-2 text-3xl font-bold text-emerald-400">{uniqueVisitorsMonth}</p>
          <p className="mt-1 text-xs text-slate-400">منذ أول الشهر</p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-300">الجهاز</p>
          <p className="mt-2 text-3xl font-bold text-amber-400">{mobilePct}%</p>
          <p className="mt-1 text-xs text-slate-400">
            {mobileCount} موبايل · {desktopCount} ديسكتوب
          </p>
        </div>

      </div>

      {/* ── رسم بياني ── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">الزوار الفريدون — آخر 7 أيام</h2>
          <span className="text-xs text-slate-400">زائر/يوم</span>
        </div>
        <div className="flex items-end gap-2" style={{ height: '140px' }}>
          {chartDays.map(day => (
            <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full items-end justify-center" style={{ height: '110px' }}>
                <div
                  className={`w-full rounded-t-md transition-all ${
                    day.uniqueVisitors > 0 ? 'bg-sky-500/60 hover:bg-sky-500/80' : 'bg-slate-700/30'
                  }`}
                  style={{ height: `${day.uniqueVisitors > 0 ? Math.max(4, (day.uniqueVisitors / maxVisitors) * 106) : 3}px` }}
                  title={`${day.dayName} ${day.numLabel}: ${day.uniqueVisitors} زائر فريد · ${day.totalVisits} زيارة`}
                />
              </div>
              <span className="text-xs text-slate-400">{day.numLabel}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-5 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-500/60" />
            زوار فريدون (بدون تكرار نفس الشخص)
          </span>
          <span>
            المجموع هذا الأسبوع: {uniqueVisitorsWeek} زائر فريد
          </span>
        </div>
      </div>

      {/* ── قمع التحويل ── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="mb-5 text-sm font-semibold text-white">قمع التحويل — آخر 30 يوم</h2>
        <div className="space-y-3">
          {([
            { label: 'زاروا المتجر',      value: funnelVisits,   color: 'bg-sky-500',     icon: '👥' },
            { label: 'فتحوا منتجاً',      value: funnelViews,    color: 'bg-violet-500',  icon: '👁️' },
            { label: 'أضافوا للسلة',      value: funnelCart,     color: 'bg-amber-500',   icon: '🛒' },
            { label: 'بدأوا الدفع',       value: funnelCheckout, color: 'bg-emerald-500', icon: '💳' },
          ] as const).map((step, i, arr) => {
            const pct = funnelMax > 0 ? Math.round((step.value / funnelMax) * 100) : 0
            const convPct = i > 0 && arr[i - 1].value > 0
              ? Math.round((step.value / arr[i - 1].value) * 100)
              : null
            return (
              <div key={step.label}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm text-slate-300">
                    <span>{step.icon}</span>
                    {step.label}
                  </span>
                  <div className="flex items-center gap-3">
                    {convPct !== null && (
                      <span className="text-xs text-slate-500">
                        تحويل: {convPct}%
                      </span>
                    )}
                    <span className="text-sm font-bold text-white w-8 text-left">{step.value}</span>
                  </div>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-800">
                  <div
                    className={`h-2 rounded-full ${step.color} opacity-70 transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── المنتجات: مشاهدات + سلة + مفضلة ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* أكثر مشاهدةً */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <h2 className="mb-5 text-sm font-semibold text-white">👁️ أكثر المنتجات مشاهدةً</h2>
          {topViewed.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6">لا بيانات بعد</p>
          ) : (
            <div className="space-y-3">
              {topViewed.map(p => (
                <div key={p.id} className="flex items-center gap-3">
                  <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg bg-slate-800">
                    {p.thumbnail_url ? (
                      <img src={p.thumbnail_url} alt={p.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">📦</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-1">
                      <span className="truncate text-xs text-slate-300">{p.name}</span>
                      <span className="shrink-0 text-xs font-bold text-sky-400">{p.view_count}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-800">
                      <div className="h-1.5 rounded-full bg-sky-500/60" style={{ width: `${(p.view_count / maxViews) * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* أكثر إضافةً للسلة */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <h2 className="mb-5 text-sm font-semibold text-white">🛒 أكثر إضافةً للسلة</h2>
          {topCart.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6">لا بيانات بعد</p>
          ) : (
            <div className="space-y-3">
              {topCart.map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg bg-slate-800">
                    {p.thumbnail ? (
                      <img src={p.thumbnail} alt={p.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">🛒</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-1">
                      <span className="truncate text-xs text-slate-300">{p.name}</span>
                      <span className="shrink-0 text-xs font-bold text-amber-400">{p.count}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-800">
                      <div className="h-1.5 rounded-full bg-amber-500/60" style={{ width: `${(p.count / maxCart) * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* أكثر إضافةً للمفضلة */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <h2 className="mb-5 text-sm font-semibold text-white">❤️ أكثر إضافةً للمفضلة</h2>
          {topWish.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6">لا بيانات بعد</p>
          ) : (
            <div className="space-y-3">
              {topWish.map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg bg-slate-800">
                    {p.thumbnail ? (
                      <img src={p.thumbnail} alt={p.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">❤️</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-1">
                      <span className="truncate text-xs text-slate-300">{p.name}</span>
                      <span className="shrink-0 text-xs font-bold text-red-400">{p.count}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-800">
                      <div className="h-1.5 rounded-full bg-red-500/60" style={{ width: `${(p.count / maxWish) * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

    </div>
  )
}
