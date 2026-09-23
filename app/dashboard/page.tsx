import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { getDefaultCashBox, getCashBalance } from '@/lib/accounting/treasury'
import Link from 'next/link'
import DashboardRefresh from '@/components/dashboard/DashboardRefresh'
import ExchangeRateWidget from '@/components/dashboard/ExchangeRateWidget'

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, currency_code, secondary_currency_code, exchange_rate, is_active, suspended_at, logo_url, phone, whatsapp, subdomain, country_code, plan')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  const now = new Date()
  const todayDateStr = now.toISOString().slice(0, 10)
  const threeDaysLater = new Date(now)
  threeDaysLater.setDate(threeDaysLater.getDate() + 3)
  const threeDaysLaterStr = threeDaysLater.toISOString().slice(0, 10)

  // جلب الصندوق الافتراضي والرصيد الحالي
  const defaultBox = await getDefaultCashBox(supabase, storeId)
  const cashBalance = defaultBox
    ? await getCashBalance(supabase, storeId, defaultBox.id, defaultBox.opening_balance)
    : 0

  // استعلامات المؤشر العام والبيانات اليومية
  const [
    todayVouchersRes,
    todayInvoicesRes,
    todayOrdersRes,
    productsCountRes,
    customersCountRes,
    suppliersCountRes,
    accountsCountRes,
    checksRes,
    overdueInvoicesRes,
  ] = await Promise.all([
    // سندات اليوم
    supabase.from('vouchers').select('type, amount').eq('store_id', storeId).eq('date', todayDateStr),
    // فواتير اليوم
    supabase.from('invoices').select('total, amount_paid').eq('store_id', storeId).eq('issue_date', todayDateStr).neq('status', 'cancelled'),
    // طلبات اليوم مدفوعة
    supabase.from('orders').select('total_amount').eq('store_id', storeId).eq('payment_status', 'paid').gte('created_at', todayDateStr),
    // عدد الأصناف
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('is_active', true),
    // عدد العملاء
    supabase.from('customers').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    // عدد الموردين
    supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    // شجرة الحسابات
    supabase.from('accounts').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    // شيكات تستحق قريباً أو راجعة
    supabase.from('checks').select('id, check_number, amount, due_date, status, type').eq('store_id', storeId).in('status', ['in_portfolio', 'bounced']),
    // فواتير متأخرة
    supabase.from('invoices').select('id, invoice_number, total, amount_paid, due_date').eq('store_id', storeId).neq('status', 'paid').neq('status', 'cancelled').lt('due_date', todayDateStr),
  ])

  // 1. حساب مؤشرات اليوم
  const todayVouchers = (todayVouchersRes.data ?? []) as { type: string; amount: number }[]
  const todayReceipts = todayVouchers.filter(v => v.type === 'receipt').reduce((s, v) => s + Number(v.amount || 0), 0)
  const todayPayments = todayVouchers.filter(v => v.type === 'payment').reduce((s, v) => s + Number(v.amount || 0), 0)

  const todayInvSales = (todayInvoicesRes.data ?? []).reduce((s: number, i: { total: number | null }) => s + Number(i.total || 0), 0)
  const todayOrderSales = (todayOrdersRes.data ?? []).reduce((s: number, o: { total_amount: number | null }) => s + Number(o.total_amount || 0), 0)
  const todayTotalSales = Math.max(todayInvSales, todayOrderSales) || (todayInvSales + todayOrderSales)

  // 2. تنبيهات استباقية هامة
  const allChecks = (checksRes.data ?? []) as { id: string; due_date: string; amount: number; status: string }[]
  const checksDueSoon = allChecks.filter(c => c.status === 'in_portfolio' && c.due_date && c.due_date >= todayDateStr && c.due_date <= threeDaysLaterStr)
  const checksDueSoonTotal = checksDueSoon.reduce((s, c) => s + Number(c.amount || 0), 0)

  const overdueInvoices = (overdueInvoicesRes.data ?? []) as { id: string; total: number; amount_paid: number }[]
  const overdueTotal = overdueInvoices.reduce((s, i) => s + Math.max(0, Number(i.total || 0) - Number(i.amount_paid || 0)), 0)

  // 3. خطوات إكمال إعداد المتجر والنظام
  const productsCount = productsCountRes.count ?? 0
  const customersCount = customersCountRes.count ?? 0
  const suppliersCount = suppliersCountRes.count ?? 0
  const accountsCount = accountsCountRes.count ?? 0
  const hasStoreInfo = !!(store.phone || store.whatsapp)

  const setupSteps = [
    {
      id: 'products',
      title: 'إضافة المنتجات والخدمات',
      desc: 'سجل أصناف المخزون بأسعارها وكمياتها',
      href: '/dashboard/products/new',
      done: productsCount > 0,
      badge: productsCount > 0 ? `${productsCount} صنف` : 'مطلوب',
      icon: '📦',
    },
    {
      id: 'accounts',
      title: 'شجرة الحسابات والخزينة',
      desc: 'تهيئة الحسابات المحاسبية والصناديق والبنوك',
      href: '/dashboard/accounting/chart-of-accounts',
      done: accountsCount > 0,
      badge: accountsCount > 0 ? 'مفعلة' : 'إعداد الحسابات',
      icon: '🏛️',
    },
    {
      id: 'contacts',
      title: 'بيانات المتجر والتواصل',
      desc: 'إكمال رقم الهاتف، الواتساب واللوجو للطباعة',
      href: '/dashboard/settings',
      done: hasStoreInfo,
      badge: hasStoreInfo ? 'مكتمل' : 'بيانات التواصل',
      icon: '⚙️',
    },
    {
      id: 'customers',
      title: 'دليل الزبائن والموردين',
      desc: 'إدخال بيانات العملاء والموردين لمتابعة الحسابات',
      href: '/dashboard/customers',
      done: customersCount > 0 || suppliersCount > 0,
      badge: (customersCount + suppliersCount) > 0 ? `${customersCount + suppliersCount} مسجل` : 'بدء التسجيل',
      icon: '👥',
    },
    {
      id: 'first_transaction',
      title: 'تسجيل أول عملية بيع أو شراء',
      desc: 'إصدار فاتورة مبيعات أو أمر شراء لبدء النشاط',
      href: '/dashboard/accounting/invoices/new',
      done: (todayInvoicesRes.data?.length ?? 0) > 0,
      badge: (todayInvoicesRes.data?.length ?? 0) > 0 ? 'تم البدء' : 'فاتورة جديدة',
      icon: '🧾',
    },
  ]

  const completedSteps = setupSteps.filter(s => s.done).length
  const setupPercent = Math.round((completedSteps / setupSteps.length) * 100)

  const cc = store.currency_code || 'ILS'
  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2, minimumFractionDigits: 0 })
  const isActive = store.is_active !== false

  return (
    <div className="space-y-7 p-4 sm:p-6 max-w-7xl mx-auto" dir="rtl">

      {/* ── الترويسة الرئيسية ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-white/5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-white">{store.name || 'المؤشر العام'}</h1>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold ${
              isActive
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-red-500/30 bg-red-500/10 text-red-400'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'animate-pulse bg-emerald-400' : 'bg-red-400'}`} />
              {isActive ? 'النظام نشط' : 'متوقف'}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {now.toLocaleDateString('ar-u-nu-latn', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <DashboardRefresh loadedAt={now.toISOString()} />
        </div>
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

      {/* ── 1. الاختصارات الرئيسية للعمليات (أعلى الصفحة) ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
            ⚡ الاختصارات السريعة للعمليات
          </h2>
          <span className="text-xs text-slate-400">الوصول المباشر للعمليات الأساسية</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* 1. مبيعات */}
          <Link
            href="/dashboard/accounting/invoices/new"
            className="group relative flex flex-col items-center justify-center p-4 rounded-2xl border border-sky-500/20 bg-gradient-to-b from-sky-500/10 to-slate-900/80 hover:from-sky-500/20 hover:border-sky-500/40 transition duration-200 shadow-sm text-center"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-500/20 text-2xl text-sky-400 mb-2 group-hover:scale-110 transition">
              🧾
            </span>
            <span className="font-bold text-white text-base">مبيعات</span>
            <span className="text-[11px] text-sky-300/70 mt-0.5">فاتورة مبيعات جديدة</span>
          </Link>

          {/* 2. مشتريات */}
          <Link
            href="/dashboard/purchases/new"
            className="group relative flex flex-col items-center justify-center p-4 rounded-2xl border border-indigo-500/20 bg-gradient-to-b from-indigo-500/10 to-slate-900/80 hover:from-indigo-500/20 hover:border-indigo-500/40 transition duration-200 shadow-sm text-center"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20 text-2xl text-indigo-400 mb-2 group-hover:scale-110 transition">
              🛒
            </span>
            <span className="font-bold text-white text-base">مشتريات</span>
            <span className="text-[11px] text-indigo-300/70 mt-0.5">فاتورة شراء جديدة</span>
          </Link>

          {/* 3. سند قبض */}
          <Link
            href="/dashboard/accounting/receipts?new=1"
            className="group relative flex flex-col items-center justify-center p-4 rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/10 to-slate-900/80 hover:from-emerald-500/20 hover:border-emerald-500/40 transition duration-200 shadow-sm text-center"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20 text-2xl text-emerald-400 mb-2 group-hover:scale-110 transition">
              📥
            </span>
            <span className="font-bold text-white text-base">سند قبض</span>
            <span className="text-[11px] text-emerald-300/70 mt-0.5">تحصيل نقد أو شيكات</span>
          </Link>

          {/* 4. سند صرف */}
          <Link
            href="/dashboard/accounting/payments?new=1"
            className="group relative flex flex-col items-center justify-center p-4 rounded-2xl border border-rose-500/20 bg-gradient-to-b from-rose-500/10 to-slate-900/80 hover:from-rose-500/20 hover:border-rose-500/40 transition duration-200 shadow-sm text-center"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/20 text-2xl text-rose-400 mb-2 group-hover:scale-110 transition">
              📤
            </span>
            <span className="font-bold text-white text-base">سند صرف</span>
            <span className="text-[11px] text-rose-300/70 mt-0.5">دفع نقد أو مصاريف</span>
          </Link>

          {/* 5. المخزون */}
          <Link
            href="/dashboard/products"
            className="group relative flex flex-col items-center justify-center p-4 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-500/10 to-slate-900/80 hover:from-amber-500/20 hover:border-amber-500/40 transition duration-200 shadow-sm text-center"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20 text-2xl text-amber-400 mb-2 group-hover:scale-110 transition">
              📦
            </span>
            <span className="font-bold text-white text-base">المخزون</span>
            <span className="text-[11px] text-amber-300/70 mt-0.5">دليل الأصناف والكميات</span>
          </Link>
        </div>
      </section>

      {/* ── 2. قسم المؤشر العام (Daily Indicators) ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
            📊 المؤشر العام اليومي
          </h2>
          <span className="text-xs text-slate-400">حركة اليوم المباشرة ({todayDateStr})</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* مبيعات اليوم */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-5 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400">مبيعات اليوم</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400 text-sm">
                📈
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-black font-mono text-white tracking-tight">
                {fmt(todayTotalSales)}
              </span>
              <span className="text-xs font-bold text-sky-400">{cc}</span>
            </div>
            <p className="mt-2 text-xs text-slate-400 flex items-center justify-between">
              <span>الفواتير والطلبات اليوم</span>
              <Link href="/dashboard/accounting/invoices" className="text-sky-400 hover:underline">عرض ←</Link>
            </p>
          </div>

          {/* مقبوضات اليوم */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-5 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400">مقبوضات اليوم</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 text-sm">
                💵
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-black font-mono text-emerald-400 tracking-tight">
                +{fmt(todayReceipts)}
              </span>
              <span className="text-xs font-bold text-emerald-400/80">{cc}</span>
            </div>
            <p className="mt-2 text-xs text-slate-400 flex items-center justify-between">
              <span>سندات القبض المسجلة</span>
              <Link href="/dashboard/accounting/receipts" className="text-emerald-400 hover:underline">عرض ←</Link>
            </p>
          </div>

          {/* مدفوعات اليوم */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-5 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400">مدفوعات اليوم</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/15 text-rose-400 text-sm">
                💸
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-black font-mono text-rose-400 tracking-tight">
                -{fmt(todayPayments)}
              </span>
              <span className="text-xs font-bold text-rose-400/80">{cc}</span>
            </div>
            <p className="mt-2 text-xs text-slate-400 flex items-center justify-between">
              <span>سندات الصرف والمصاريف</span>
              <Link href="/dashboard/accounting/payments" className="text-rose-400 hover:underline">عرض ←</Link>
            </p>
          </div>

          {/* رصيد الصندوق */}
          <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-amber-500/10 p-5 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-300">رصيد الصندوق والخزينة</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400 text-sm border border-amber-500/30">
                💰
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-black font-mono text-white tracking-tight">
                {fmt(cashBalance)}
              </span>
              <span className="text-xs font-bold text-amber-400">{cc}</span>
            </div>
            <p className="mt-2 text-xs text-slate-400 flex items-center justify-between">
              <span>{defaultBox?.name || 'الصندوق الرئيسي'}</span>
              <Link href="/dashboard/accounting/treasury" className="text-amber-400 hover:underline">الخزينة ←</Link>
            </p>
          </div>
        </div>
      </section>

      {/* ── شريط تنبيهات عاجل ومختصر (إن وجد) ── */}
      {(checksDueSoon.length > 0 || overdueInvoices.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {checksDueSoon.length > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5">
              <div className="flex items-center gap-3">
                <span className="text-xl">⏳</span>
                <div>
                  <p className="text-xs font-bold text-amber-300">
                    {checksDueSoon.length} شيكات تستحق خلال 3 أيام ({fmt(checksDueSoonTotal)} {cc})
                  </p>
                  <p className="text-[11px] text-slate-400">مطلوب متابعة الصرف أو الإيداع</p>
                </div>
              </div>
              <Link href="/dashboard/cheques" className="shrink-0 text-xs font-bold text-amber-400 hover:underline">
                محفظة الشيكات ←
              </Link>
            </div>
          )}

          {overdueInvoices.length > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5">
              <div className="flex items-center gap-3">
                <span className="text-xl">🚨</span>
                <div>
                  <p className="text-xs font-bold text-rose-300">
                    {overdueInvoices.length} فواتير مبيعات تجاوزت الاستحقاق ({fmt(overdueTotal)} {cc})
                  </p>
                  <p className="text-[11px] text-slate-400">مطلوب متابعة التحصيل</p>
                </div>
              </div>
              <Link href="/dashboard/accounting/invoices" className="shrink-0 text-xs font-bold text-rose-400 hover:underline">
                الفواتير ←
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ── 3. قسم إكمال إعداد متجرك / إعداد النظام ── */}
      <section className="rounded-2xl border border-white/10 bg-slate-900/90 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">إكمال إعداد متجرك ونظامك المحاسبي</h2>
              <span className="rounded-full bg-sky-500/20 border border-sky-500/30 px-2.5 py-0.5 text-xs font-bold text-sky-400">
                {completedSteps} من {setupSteps.length} مكتمل ({setupPercent}%)
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              أكمل الخطوات التالية لتجهيز نظامك للعمل بكامل كفاءته المحاسبية والتشغيلية
            </p>
          </div>

          {/* شريط التقدم */}
          <div className="w-full sm:w-48 bg-slate-800 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-sky-500 to-emerald-500 h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${setupPercent}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
          {setupSteps.map((step) => (
            <Link
              key={step.id}
              href={step.href}
              className={`group flex items-start gap-3 p-3.5 rounded-xl border transition duration-150 ${
                step.done
                  ? 'border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/30'
                  : 'border-white/5 bg-slate-800/40 hover:border-sky-500/30 hover:bg-slate-800/70'
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg ${
                step.done ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/60 text-slate-300'
              }`}>
                {step.done ? '✓' : step.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <p className={`text-sm font-bold truncate ${step.done ? 'text-emerald-300' : 'text-white'}`}>
                    {step.title}
                  </p>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    step.done ? 'bg-emerald-500/20 text-emerald-400' : 'bg-sky-500/20 text-sky-300'
                  }`}>
                    {step.badge}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{step.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

    </div>
  )
}
