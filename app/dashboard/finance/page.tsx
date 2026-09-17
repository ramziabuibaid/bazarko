import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'الإدارة المالية — Bazarko ERP',
}

export default async function FinanceHubPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { count: chequesCount },
    { count: banksCount },
    { count: receiptsCount },
    { count: paymentsCount },
    { data: treasuryBox },
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code, plan').eq('id', storeId).single(),
    supabase.from('cheques').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('bank_accounts').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('vouchers').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('type', 'receipt'),
    supabase.from('vouchers').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('type', 'payment'),
    supabase.from('cash_boxes').select('balance').eq('store_id', storeId).maybeSingle(),
  ])

  const currency = store?.currency_code || 'ILS'
  const cashBalance = Number(treasuryBox?.balance || 0)
  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })

  const modules = [
    {
      title: 'محفظة الشيكات',
      desc: 'إدارة الشيكات الواردة والصادرة، التحصيل، التظهير، التجيير، الإرجاع، وسلطة النقد.',
      icon: '🏦',
      href: '/dashboard/cheques',
      badge: `${chequesCount || 0} شيك`,
      actionLabel: 'فتح محفظة الشيكات',
      color: 'from-sky-500/20 to-blue-600/10 border-sky-500/30 text-sky-400',
    },
    {
      title: 'الحسابات البنكية',
      desc: 'إدارة حسابات الشركة في البنوك المحلية، تتبع الأرصدة بالعملات، والإيداعات والتحويلات.',
      icon: '🏛️',
      href: '/dashboard/banks',
      badge: `${banksCount || 0} حساب بنكي`,
      actionLabel: 'فتح الحسابات البنكية',
      color: 'from-indigo-500/20 to-purple-600/10 border-indigo-500/30 text-indigo-400',
    },
    {
      title: 'كشوف حسابات البنوك',
      desc: 'مطابقة الكشوفات البنكية، تتبع حركات الإيداع والسحب والعمولات، وطباعة الكشوفات.',
      icon: '📜',
      href: '/dashboard/banks/statement',
      badge: 'مطابقة دورية',
      actionLabel: 'عرض كشوف البنوك',
      color: 'from-blue-500/20 to-cyan-600/10 border-blue-500/30 text-blue-400',
    },
    {
      title: 'سندات القبض',
      desc: 'إصدار سندات القبض الرسمية، إدخال السيولة للصندوق، والتفقيط والطباعة مع الـ PDF.',
      icon: '📥',
      href: '/dashboard/accounting/receipts',
      badge: `${receiptsCount || 0} سند قبض`,
      actionLabel: 'فتح سندات القبض',
      color: 'from-emerald-500/20 to-teal-600/10 border-emerald-500/30 text-emerald-400',
    },
    {
      title: 'سندات الصرف',
      desc: 'تسجيل المصروفات والمدفوعات الرسمية للموردين أو الجهات الخارجية مع الترحيل للصندوق.',
      icon: '📤',
      href: '/dashboard/accounting/payments',
      badge: `${paymentsCount || 0} سند صرف`,
      actionLabel: 'فتح سندات الصرف',
      color: 'from-rose-500/20 to-red-600/10 border-rose-500/30 text-rose-400',
    },
    {
      title: 'اللوحة المالية والسيولة',
      desc: 'نظرة شاملة على التدفقات النقدية (Cash Flow)، الأرباح والخسائر، والمؤشرات المالية.',
      icon: '💰',
      href: '/dashboard/accounting',
      badge: 'مؤشرات السيولة',
      actionLabel: 'فتح اللوحة المالية',
      color: 'from-amber-500/20 to-yellow-600/10 border-amber-500/30 text-amber-400',
    },
    {
      title: 'الصندوق والخزينة',
      desc: 'إدارة حركة النقد اليومية، إيداعات الكاشير، الإغلاق اليومي، ومطابقة رصيد الخزينة.',
      icon: '💼',
      href: '/dashboard/accounting/treasury',
      badge: `رصيد الصندوق: ${fmt(cashBalance)} ${currency}`,
      actionLabel: 'فتح الصندوق والخزينة',
      color: 'from-teal-500/20 to-emerald-600/10 border-teal-500/30 text-teal-300',
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
            <span className="text-sky-400">الإدارة المالية</span>
          </div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-xl border border-emerald-500/30">
              💵
            </span>
            لوحة الإدارة المالية
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            إدارة النقدية، البنوك، الشيكات، سندات القبض والصرف، والصناديق
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/accounting/receipts"
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-lg shadow-emerald-900/30"
          >
            <span>📥</span> سند قبض جديد
          </Link>
          <Link
            href="/dashboard/accounting/payments"
            className="flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-rose-500 transition shadow-lg shadow-rose-900/30"
          >
            <span>📤</span> سند صرف جديد
          </Link>
        </div>
      </div>

      {/* ── Quick KPI Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">رصيد الصندوق النقدي</span>
          <p className="mt-1 font-mono text-2xl font-black text-emerald-400">{fmt(cashBalance)} {currency}</p>
          <span className="text-[11px] text-slate-500">نقدية متوفرة</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">محفظة الشيكات</span>
          <p className="mt-1 font-mono text-2xl font-black text-sky-400">{chequesCount || 0}</p>
          <span className="text-[11px] text-slate-500">شيك تحت التحصيل/صادر</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">حسابات البنوك</span>
          <p className="mt-1 font-mono text-2xl font-black text-indigo-400">{banksCount || 0}</p>
          <span className="text-[11px] text-slate-500">حساب بنكي نشط</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">سندات القبض والصرف</span>
          <p className="mt-1 font-mono text-2xl font-black text-white">{(receiptsCount || 0) + (paymentsCount || 0)}</p>
          <span className="text-[11px] text-slate-500">{receiptsCount || 0} قبض / {paymentsCount || 0} صرف</span>
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
