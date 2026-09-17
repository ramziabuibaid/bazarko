import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'المتجر الإلكتروني — Bazarko ERP',
}

export default async function StoreHubPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { count: ordersCount },
    { count: pendingOrdersCount },
    { count: offersCount },
    { count: reviewsCount },
    { count: attributesCount },
    { count: adsCount },
  ] = await Promise.all([
    supabase.from('stores').select('id, name, subdomain, currency_code, plan').eq('id', storeId).single(),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('status', 'pending'),
    supabase.from('offers').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('product_reviews').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('product_attributes').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('ads_campaigns').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
  ])

  const storeUrl = `${store?.subdomain}.${process.env.NEXT_PUBLIC_DOMAIN ?? 'bazarko.app'}`

  const modules = [
    {
      title: 'طلبيات المتجر',
      desc: 'استقبال طلبات الزبائن أونلاين، تحديث حالات التوصيل، متابعة الدفع، وإصدار الفواتير.',
      icon: '📦',
      href: '/dashboard/orders',
      badge: `${ordersCount || 0} طلبية`,
      actionLabel: 'فتح الطلبيات',
      color: 'from-sky-500/20 to-blue-600/10 border-sky-500/30 text-sky-400',
    },
    {
      title: 'العروض الحصرية (Flash Sales)',
      desc: 'حملات التخفيض المؤقتة، البانرات الترويجية، العداد التنازلي، والخصومات الجماعية.',
      icon: '🎁',
      href: '/dashboard/offers',
      badge: `${offersCount || 0} عرض حصري`,
      actionLabel: 'إدارة العروض',
      color: 'from-amber-500/20 to-orange-600/10 border-amber-500/30 text-amber-400',
    },
    {
      title: 'خصائص ومواصفات المنتجات',
      desc: 'تعريف سمات المنتجات (المقاسات، الألوان، السعة، الوزن) وفلاتر التصفح للمتجر.',
      icon: '🎚️',
      href: '/dashboard/attributes',
      badge: `${attributesCount || 0} خاصية`,
      actionLabel: 'إدارة الخصائص',
      color: 'from-purple-500/20 to-pink-600/10 border-purple-500/30 text-purple-400',
    },
    {
      title: 'تقييمات الزبائن والآراء',
      desc: 'مراجعة واعتماد تقييمات الزبائن بالنجوم والصور والتعليقات على المنتجات.',
      icon: '⭐',
      href: '/dashboard/reviews',
      badge: `${reviewsCount || 0} تقييم`,
      actionLabel: 'إدارة التقييمات',
      color: 'from-yellow-500/20 to-amber-600/10 border-yellow-500/30 text-yellow-400',
    },
    {
      title: 'مناطق ورسوم التوصيل',
      desc: 'تحديد المدن والمحافظات، تكاليف الشحن، أوقات التوصيل، والشحن المجاني.',
      icon: '🚚',
      href: '/dashboard/delivery',
      badge: 'مناطق الشحن',
      actionLabel: 'إعدادات التوصيل',
      color: 'from-emerald-500/20 to-teal-600/10 border-emerald-500/30 text-emerald-400',
    },
    {
      title: 'تحليلات وحركة الزوار',
      desc: 'إحصائيات زيارات المتجر، أكثر المنتجات مشاهدة، ومعدلات التحويل والشراء.',
      icon: '📡',
      href: '/dashboard/analytics',
      badge: 'تحليلات الزوار',
      actionLabel: 'عرض التحليلات',
      color: 'from-cyan-500/20 to-blue-600/10 border-cyan-500/30 text-cyan-400',
    },
    {
      title: 'الإعلانات وحملات WhatsApp',
      desc: 'استوديو توليد بطاقات العروض ورسائل WhatsApp الترويجية وإرسالها للزبائن بضغطة زر.',
      icon: '📢',
      href: '/dashboard/marketing/ads',
      badge: `${adsCount || 0} حملة ترويجية`,
      actionLabel: 'فتح استوديو الإعلانات',
      color: 'from-green-500/20 to-emerald-600/10 border-green-500/30 text-green-400',
    },
  ]

  return (
    <div className="space-y-6 p-4 sm:p-6" dir="rtl">
      {/* ── Top Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <Link href="/dashboard" className="hover:text-white transition">الرئيسية</Link>
            <span>/</span>
            <span className="text-sky-400">المتجر الإلكتروني</span>
          </div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/20 text-xl border border-purple-500/30">
              🌐
            </span>
            لوحة المتجر الإلكتروني
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            إدارة الواجهة الرقمية، الطلبات، العروض الترويجية، حملات WhatsApp، وتقييمات العملاء
          </p>
        </div>

        <a
          href={`https://${storeUrl}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-sky-600 px-4 py-2.5 text-xs font-bold text-white hover:opacity-90 transition shadow-lg shadow-purple-900/30"
        >
          <span>👁️</span> معاينة المتجر المباشر
        </a>
      </div>

      {/* ── Quick KPI Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">طلبات جديدة معلقة</span>
          <p className="mt-1 font-mono text-2xl font-black text-amber-400">{pendingOrdersCount || 0}</p>
          <span className="text-[11px] text-amber-400/80 font-medium">بانتظار التأكيد والتجهيز</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">إجمالي الطلبيات</span>
          <p className="mt-1 font-mono text-2xl font-black text-white">{ordersCount || 0}</p>
          <span className="text-[11px] text-slate-500">طلبية مسجلة بالمتجر</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">عروض حصرية نشطة</span>
          <p className="mt-1 font-mono text-2xl font-black text-purple-400">{offersCount || 0}</p>
          <span className="text-[11px] text-slate-500">حملة تخفيضات</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">تقييمات الزبائن</span>
          <p className="mt-1 font-mono text-2xl font-black text-yellow-400">{reviewsCount || 0}</p>
          <span className="text-[11px] text-slate-500">تقييم معتمد</span>
        </div>
      </div>

      {/* ── Modules Grid ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {modules.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className={`group flex flex-col justify-between rounded-2xl border bg-gradient-to-br p-5 shadow-lg transition-all duration-200 hover:-translate-y-1 hover:shadow-xl ${m.color}`}
          >
            <div>
              <div className="flex items-start justify-between mb-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900/90 text-2xl shadow-inner border border-white/10">
                  {m.icon}
                </span>
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
                  {m.badge}
                </span>
              </div>
              <h2 className="text-lg font-bold text-white group-hover:text-sky-300 transition-colors">
                {m.title}
              </h2>
              <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                {m.desc}
              </p>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-3 text-xs font-bold text-slate-200 group-hover:text-white">
              <span>{m.actionLabel}</span>
              <span className="transition-transform group-hover:-translate-x-1">←</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
