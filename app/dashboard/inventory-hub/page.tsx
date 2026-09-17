import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'المخزون والمنتجات — Bazarko ERP',
}

export default async function InventoryHubPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { count: productsCount },
    { count: brandsCount },
    { count: categoriesCount },
    { count: movementsCount },
    { data: lowStockRows },
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code, plan').eq('id', storeId).single(),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('brands').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('categories').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('inventory_movements').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('products').select('id, stock_quantity, low_stock_alert').eq('store_id', storeId).eq('track_stock', true),
  ])

  const lowStockCount = (lowStockRows || []).filter(
    (p: any) => p.stock_quantity <= (p.low_stock_alert || 5)
  ).length

  const modules = [
    {
      title: 'قائمة المنتجات',
      desc: 'إضافة المنتجات، الباركود، صور العرض، أسعار البيع والتكلفة، والخصائص المرنة.',
      icon: '🛍️',
      href: '/dashboard/products',
      badge: `${productsCount || 0} منتج`,
      actionLabel: 'فتح المنتجات',
      color: 'from-sky-500/20 to-blue-600/10 border-sky-500/30 text-sky-400',
    },
    {
      title: 'كشف حركة الصنف',
      desc: 'تتبع بطاقة الصنف، الوارد والصادر، التكلفة والكميات المتبقية لكل منتج على حدة.',
      icon: '🔍',
      href: '/dashboard/inventory/statement',
      badge: 'بطاقة صنف تفصيلية',
      actionLabel: 'كشف حركة الصنف',
      color: 'from-blue-500/20 to-cyan-600/10 border-blue-500/30 text-blue-400',
    },
    {
      title: 'الماركات والبرندات',
      desc: 'إدارة العلامات التجارية وشعارات الشركات المصنعة وتصنيف المنتجات حسب الماركة.',
      icon: '🏷️',
      href: '/dashboard/inventory/brands',
      badge: `${brandsCount || 0} ماركة مسجلة`,
      actionLabel: 'إدارة الماركات',
      color: 'from-purple-500/20 to-pink-600/10 border-purple-500/30 text-purple-400',
    },
    {
      title: 'الفئات والتصنيفات',
      desc: 'هيكلة الأقسام الرئيسية والفرعية للمتجر والمستودع لسهولة البحث والفلترة.',
      icon: '📂',
      href: '/dashboard/categories',
      badge: `${categoriesCount || 0} تصنيف`,
      actionLabel: 'إدارة الفئات',
      color: 'from-emerald-500/20 to-teal-600/10 border-emerald-500/30 text-emerald-400',
    },
    {
      title: 'إدارة المخزون والمستودعات',
      desc: 'جرد المخزون، ضبط الأرصدة الافتتاحية، وتسويات العجز والزيادة والتوالف.',
      icon: '📉',
      href: '/dashboard/inventory',
      badge: 'جرد المستودع',
      actionLabel: 'فتح إدارة المخزون',
      color: 'from-indigo-500/20 to-violet-600/10 border-indigo-500/30 text-indigo-400',
    },
    {
      title: 'حركة المخزون الشاملة',
      desc: 'سجل حركات الأصناف الشامل (شراء، بيع، مرتجع مبيعات، مرتجع مشتريات، وتسويات).',
      icon: '🔄',
      href: '/dashboard/inventory/movements',
      badge: `${movementsCount || 0} حركة مخزنية`,
      actionLabel: 'عرض سجل الحركات',
      color: 'from-teal-500/20 to-cyan-600/10 border-teal-500/30 text-teal-400',
    },
    {
      title: 'مزامنة وربط المخزون (Sync API)',
      desc: 'ربط المخزون تلقائياً بين الفروع والموردين وتحديث الكميات آلياً عبر الـ API و Excel.',
      icon: '⚡',
      href: '/dashboard/inventory/sync',
      badge: 'مزامنة سحابية',
      actionLabel: 'إعدادات المزامنة',
      color: 'from-amber-500/20 to-orange-600/10 border-amber-500/30 text-amber-400',
    },
    {
      title: 'تنبيهات نقص المخزون',
      desc: 'تنبيهات فورية للأصناف التي اقتربت من النفاد أو وصلت إلى حد إعادة الطلب الأدنى.',
      icon: '⚠️',
      href: '/dashboard/inventory/alerts',
      badge: `${lowStockCount} منتج قارب النفاد`,
      actionLabel: 'عرض التنبيهات',
      color: 'from-rose-500/20 to-red-600/10 border-rose-500/30 text-rose-400',
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
            <span className="text-sky-400">المخزون والمنتجات</span>
          </div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/20 text-xl border border-teal-500/30">
              📦
            </span>
            لوحة إدارة المخزون والمنتجات
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            متابعة الأصناف، المستودعات، حركات الجرد، التنبيهات، والربط والمزامنة
          </p>
        </div>

        <Link
          href="/dashboard/products/new"
          className="flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-sky-500 transition shadow-lg shadow-sky-900/30"
        >
          <span>➕</span> إضافة منتج جديد
        </Link>
      </div>

      {/* ── Quick KPI Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">إجمالي المنتجات</span>
          <p className="mt-1 font-mono text-2xl font-black text-white">{productsCount || 0}</p>
          <span className="text-[11px] text-slate-500">صنف مسجل بالنظام</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">تنبيهات نقص المخزون</span>
          <p className="mt-1 font-mono text-2xl font-black text-rose-400">{lowStockCount}</p>
          <span className="text-[11px] text-rose-400/80">يحتاج إعادة طلب فورية</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">حركات المخزون الشاملة</span>
          <p className="mt-1 font-mono text-2xl font-black text-sky-400">{movementsCount || 0}</p>
          <span className="text-[11px] text-slate-500">حركة واردة وصادرة</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">التصنيفات والماركات</span>
          <p className="mt-1 font-mono text-2xl font-black text-emerald-400">{(categoriesCount || 0) + (brandsCount || 0)}</p>
          <span className="text-[11px] text-slate-500">{categoriesCount || 0} فئة / {brandsCount || 0} ماركة</span>
        </div>
      </div>

      {/* ── Modules Grid ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
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
