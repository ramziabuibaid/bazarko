import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'إدارة المشتريات — Bazarko ERP',
}

export default async function PurchasesHubPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { count: purchasesCount },
    { data: unpaidPurchases },
    { count: returnsCount },
    { count: suppliersCount },
    { data: suppliersDebt },
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code, plan').eq('id', storeId).single(),
    supabase.from('purchase_invoices').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('purchase_invoices').select('total_amount, paid_amount').eq('store_id', storeId).eq('payment_status', 'unpaid'),
    supabase.from('purchase_returns').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('suppliers').select('balance').eq('store_id', storeId).gt('balance', 0),
  ])

  const currency = store?.currency_code || 'ILS'
  const supplierPayables = (suppliersDebt || []).reduce((sum, s) => sum + Number(s.balance || 0), 0)
  const unpaidPurchasesTotal = (unpaidPurchases || []).reduce((sum, p) => sum + Math.max(0, Number(p.total_amount || 0) - Number(p.paid_amount || 0)), 0)

  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })

  const modules = [
    {
      title: 'فواتير المشتريات',
      desc: 'تسجيل فواتير الشراء من الموردين، تحديث تكاليف المخزون تلقائياً، والطباعة الرسمية.',
      icon: '🛒',
      href: '/dashboard/purchases',
      badge: `${purchasesCount || 0} فاتورة شراء`,
      actionLabel: 'فتح فواتير المشتريات',
      color: 'from-blue-500/20 to-indigo-600/10 border-blue-500/30 text-blue-400',
    },
    {
      title: 'مردود المشتريات',
      desc: 'إدارة البضاعة المعادة للموردين، خصمها من المخزون، وتسوية الذمة المالية للمورد.',
      icon: '🔁',
      href: '/dashboard/purchases/returns',
      badge: `${returnsCount || 0} مرتجع مورد`,
      actionLabel: 'فتح مردود المشتريات',
      color: 'from-amber-500/20 to-orange-600/10 border-amber-500/30 text-amber-400',
    },
    {
      title: 'دليل الموردين',
      desc: 'سجل الموردين المعتمدين، بيانات الاتصال، الأرصدة المستحقة، وكشوف الحسابات.',
      icon: '🏭',
      href: '/dashboard/suppliers',
      badge: `${suppliersCount || 0} مورد معتمد`,
      actionLabel: 'فتح دليل الموردين',
      color: 'from-emerald-500/20 to-teal-600/10 border-emerald-500/30 text-emerald-400',
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
            <span className="text-sky-400">إدارة المشتريات</span>
          </div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-xl border border-blue-500/30">
              🛒
            </span>
            لوحة إدارة المشتريات
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            متابعة التوريد، فواتير الشراء، مردودات الموردين، وإدارة المستحقات
          </p>
        </div>

        <Link
          href="/dashboard/purchases/new"
          className="flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-sky-500 transition shadow-lg shadow-sky-900/30"
        >
          <span>➕</span> تسجيل فاتورة شراء جديدة
        </Link>
      </div>

      {/* ── Quick KPI Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">فواتير المشتريات</span>
          <p className="mt-1 font-mono text-2xl font-black text-white">{purchasesCount || 0}</p>
          <span className="text-[11px] text-slate-500">فاتورة مسجلة</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">مستحقات الموردين (ذمم دائنة)</span>
          <p className="mt-1 font-mono text-xl font-black text-amber-400">{fmt(supplierPayables)} {currency}</p>
          <span className="text-[11px] text-amber-400/80 font-medium">واجبة السداد للموردين</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">فواتير شراء غير مسددة</span>
          <p className="mt-1 font-mono text-xl font-black text-rose-400">{fmt(unpaidPurchasesTotal)} {currency}</p>
          <span className="text-[11px] text-rose-400/80 font-medium">{unpaidPurchases?.length || 0} فاتورة شراء آجلة</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">دليل الموردين</span>
          <p className="mt-1 font-mono text-2xl font-black text-emerald-400">{suppliersCount || 0}</p>
          <span className="text-[11px] text-slate-500">مورد مسجل</span>
        </div>
      </div>

      {/* ── Modules Grid ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
