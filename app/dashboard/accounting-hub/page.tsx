import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'المحاسبة العامة والتقارير — Bazarko ERP',
}

export default async function AccountingHubPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { count: accountsCount },
    { count: journalCount },
    { count: auditCount },
    { count: closedPeriodsCount },
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code, plan').eq('id', storeId).single(),
    supabase.from('accounts').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('journal_entries').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('financial_audit_log').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('accounting_periods').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('is_closed', true),
  ])

  const modules = [
    {
      title: 'شجرة الحسابات (دليل الحسابات)',
      desc: 'دليل الحسابات الشامل المبني على المعايير المحاسبية المعتمدة (أصول، خصوم، حقوق ملكية، إيرادات، مصروفات).',
      icon: '🌳',
      href: '/dashboard/accounting/accounts',
      badge: `${accountsCount || 0} حساب محاسبي`,
      actionLabel: 'فتح دليل الحسابات',
      color: 'from-emerald-500/20 to-teal-600/10 border-emerald-500/30 text-emerald-400',
    },
    {
      title: 'قيود اليومية العامة',
      desc: 'تسجيل قيود اليومية المزدوجة المتوازنة، الترحيل التلقائي، فحص التوازن، والطباعة الرسمية.',
      icon: '⚖️',
      href: '/dashboard/accounting/journal',
      badge: `${journalCount || 0} قيد محاسبي`,
      actionLabel: 'فتح قيود اليومية',
      color: 'from-sky-500/20 to-blue-600/10 border-sky-500/30 text-sky-400',
    },
    {
      title: 'إقفال الفترات المحاسبية',
      desc: 'إغلاق الفترات المالية والشهور ومنع التعديل أو الحذف بعد الإقفال التام لضمان حماية الدفاتر وسلامة الرقابة.',
      icon: '🔒',
      href: '/dashboard/accounting/periods',
      badge: `${closedPeriodsCount || 0} فترة مقفلة`,
      actionLabel: 'إدارة الفترات والإقفال',
      color: 'from-cyan-500/20 to-blue-600/10 border-cyan-500/30 text-cyan-400',
    },
    {
      title: 'التقارير المالية والختامية',
      desc: 'قائمة الدخل (الأرباح والخسائر P&L)، التدفقات النقدية، تقارير المصروفات، والتحليل المالي الدوري.',
      icon: '📈',
      href: '/dashboard/accounting/reports',
      badge: 'قوائم ختامية',
      actionLabel: 'عرض التقارير المالية',
      color: 'from-indigo-500/20 to-purple-600/10 border-indigo-500/30 text-indigo-400',
    },
    {
      title: 'سجل العمليات والرقابة الداخلية',
      desc: 'سجل تدقيق كامل غير قابل للتعديل (Audit Trail) يوثق كل عملية مالية وتعديل ومن قام بها بدقة.',
      icon: '🛡️',
      href: '/dashboard/accounting/audit',
      badge: `${auditCount || 0} عملية موثقة`,
      actionLabel: 'سجل الرقابة والتدقيق',
      color: 'from-rose-500/20 to-red-600/10 border-rose-500/30 text-rose-400',
    },
    {
      title: 'مستورد ومزامنة الشامل ERP',
      desc: 'استيراد الحسابات والأرصدة والزبائن والموردين مباشرة من ملفات الشامل المحاسبي بدقة متناهية.',
      icon: '🔄',
      href: '/dashboard/accounting/shamel',
      badge: 'ربط برامج ERP',
      actionLabel: 'فتح مستورد الشامل',
      color: 'from-amber-500/20 to-orange-600/10 border-amber-500/30 text-amber-400',
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
            <span className="text-sky-400">المحاسبة والتقارير</span>
          </div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/20 text-xl border border-purple-500/30">
              ⚖️
            </span>
            لوحة المحاسبة العامة والتقارير
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            شجرة الحسابات، قيود اليومية، القوائم المالية الختامية، وسجل الرقابة والتدقيق
          </p>
        </div>

        <Link
          href="/dashboard/accounting/journal/create"
          className="flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-sky-500 transition shadow-lg shadow-sky-900/30"
        >
          <span>➕</span> إنشاء قيد يومية جديد
        </Link>
      </div>

      {/* ── Quick KPI Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">حسابات الدليل</span>
          <p className="mt-1 font-mono text-2xl font-black text-emerald-400">{accountsCount || 0}</p>
          <span className="text-[11px] text-slate-500">حساب في شجرة الحسابات</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">قيود اليومية المسجلة</span>
          <p className="mt-1 font-mono text-2xl font-black text-sky-400">{journalCount || 0}</p>
          <span className="text-[11px] text-slate-500">قيد مزدوج متوازن</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">سجل الرقابة والعمليات</span>
          <p className="mt-1 font-mono text-2xl font-black text-white">{auditCount || 0}</p>
          <span className="text-[11px] text-slate-500">حدث مالي مراقب وموثق</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">حالة الدفاتر المحاسبية</span>
          <p className="mt-1 font-bold text-lg text-emerald-400">متوازنة ومطابقة ✓</p>
          <span className="text-[11px] text-emerald-400/80">قيود دفتر الأستاذ العام</span>
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
