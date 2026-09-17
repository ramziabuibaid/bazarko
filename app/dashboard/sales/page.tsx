import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'إدارة المبيعات — Bazarko ERP',
}

export default async function SalesDashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { count: invoicesCount },
    { data: unpaidInvoices },
    { count: returnsCount },
    { count: customersCount },
    { data: customersDebt },
    { count: quotesCount },
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code, plan').eq('id', storeId).single(),
    supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('invoices').select('total, amount_paid').eq('store_id', storeId).not('status', 'in', '(paid,cancelled)'),
    supabase.from('sales_returns').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('customers').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('customers').select('balance').eq('store_id', storeId).gt('balance', 0),
    supabase.from('quotations').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
  ])

  const currency = store?.currency_code || 'ILS'
  const outstandingReceivables = (customersDebt || []).reduce((sum, c) => sum + Number(c.balance || 0), 0)
  const unpaidInvoicesTotal = (unpaidInvoices || []).reduce((sum, inv) => sum + Math.max(0, (inv.total || 0) - (inv.amount_paid || 0)), 0)

  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })

  const modules = [
    {
      title: 'فواتير المبيعات',
      desc: 'إصدار فواتير المبيعات النقدية والآجلة، تعديلها وحذفها، وطباعة PDF مع شعار الشركة.',
      icon: '🧾',
      href: '/dashboard/accounting/invoices',
      badge: `${invoicesCount || 0} فاتورة`,
      actionLabel: 'فتح فواتير المبيعات',
      color: 'from-sky-500/20 to-blue-600/10 border-sky-500/30 text-sky-400',
    },
    {
      title: 'مردود المبيعات',
      desc: 'إدارة البضائع المرتجعة من العملاء، تعديلها وحذفها، مع تسوية المخزون وكشف الحساب.',
      icon: '↩️',
      href: '/dashboard/invoices/returns',
      badge: `${returnsCount || 0} مرتجع`,
      actionLabel: 'فتح مردود المبيعات',
      color: 'from-amber-500/20 to-orange-600/10 border-amber-500/30 text-amber-400',
    },
    {
      title: 'عروض الأسعار',
      desc: 'إصدار عروض أسعار موحدة رسمية، طباعة PDF، وتحويل العرض إلى فاتورة بنقرة واحدة.',
      icon: '📑',
      href: '/dashboard/quotations',
      badge: `${quotesCount || 0} عرض سعر`,
      actionLabel: 'فتح عروض الأسعار',
      color: 'from-purple-500/20 to-pink-600/10 border-purple-500/30 text-purple-400',
    },
    {
      title: 'دليل الزبائن والعملاء',
      desc: 'بيانات العملاء وأرقام الهواتف والعناوين والحدود الائتمانية للبيع الآجل.',
      icon: '👥',
      href: '/dashboard/customers',
      badge: `${customersCount || 0} عميل`,
      actionLabel: 'فتح دليل العملاء',
      color: 'from-emerald-500/20 to-teal-600/10 border-emerald-500/30 text-emerald-400',
    },
    {
      title: 'كشوف حسابات الزبائن',
      desc: 'تتبع الحركات المالية الدائنة والمدينة والأرصدة المستحقة وسندات السداد بدقة.',
      icon: '📋',
      href: '/dashboard/customers/ledger',
      badge: `ذمم مستحقة: ${fmt(outstandingReceivables)} ${currency}`,
      actionLabel: 'فتح كشوف الحسابات',
      color: 'from-rose-500/20 to-red-600/10 border-rose-500/30 text-rose-400',
    },
    {
      title: 'نقطة البيع السريعة (POS)',
      desc: 'شاشة كاشير سريعة للبيع الفوري، قراءة الباركود، وطباعة إيصالات حرارية أو PDF.',
      icon: '⚡',
      href: '/dashboard/pos',
      badge: 'بيع مباشر فوري',
      actionLabel: 'بدء نقطة البيع',
      color: 'from-emerald-500/20 to-sky-600/10 border-emerald-500/30 text-emerald-300',
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
            <span className="text-sky-400">إدارة المبيعات</span>
          </div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/20 text-xl border border-sky-500/30">
              📊
            </span>
            لوحة إدارة المبيعات
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            المركز الشامل لعمليات البيع، الفواتير النقدية والآجلة، المرتجعات، وعروض الأسعار
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/pos"
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-lg shadow-emerald-900/30"
          >
            <span>⚡</span> نقطة البيع POS
          </Link>
          <Link
            href="/dashboard/accounting/invoices/new"
            className="flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-sky-500 transition shadow-lg shadow-sky-900/30"
          >
            <span>➕</span> فاتورة جديدة
          </Link>
        </div>
      </div>

      {/* ── Quick KPI Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">إجمالي الفواتير</span>
          <p className="mt-1 font-mono text-2xl font-black text-white">{invoicesCount || 0}</p>
          <span className="text-[11px] text-slate-500">فاتورة مسجلة</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">ذمم العملاء المستحقة</span>
          <p className="mt-1 font-mono text-xl font-black text-rose-400">{fmt(outstandingReceivables)} {currency}</p>
          <span className="text-[11px] text-rose-400/80 font-medium">مطلوبة للتحصيل</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">فواتير غير مسددة</span>
          <p className="mt-1 font-mono text-xl font-black text-amber-400">{fmt(unpaidInvoicesTotal)} {currency}</p>
          <span className="text-[11px] text-amber-400/80 font-medium">{unpaidInvoices?.length || 0} فاتورة بانتظار السداد</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <span className="text-xs text-slate-400 font-semibold">دليل العملاء</span>
          <p className="mt-1 font-mono text-2xl font-black text-emerald-400">{customersCount || 0}</p>
          <span className="text-[11px] text-slate-500">عميل مسجل بالدليل</span>
        </div>
      </div>

      {/* ── Section Modules Grid ── */}
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
