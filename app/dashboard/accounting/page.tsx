import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function AccountingPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const { data: ordersData } = await supabase
    .from('orders')
    .select('total, amount_paid, created_at')
    .eq('store_id', store.id)
    .in('status', ['delivered', 'processing', 'confirmed', 'ready'])

  type OrderRow   = { total: number; amount_paid: number; created_at: string }
  type InvoiceRow = { total: number; amount_paid: number; status: string }
  type VoucherRow = { type: string; amount: number; date: string }
  type CustomerRow = { balance: number }

  const totalRevenue = (ordersData ?? [] as OrderRow[]).reduce((s: number, o: OrderRow) => s + (o.amount_paid ?? 0), 0)
  const monthRevenue = (ordersData ?? [] as OrderRow[])
    .filter((o: OrderRow) => o.created_at >= startOfMonth)
    .reduce((s: number, o: OrderRow) => s + (o.amount_paid ?? 0), 0)
  const outstanding  = (ordersData ?? [] as OrderRow[]).reduce((s: number, o: OrderRow) => s + Math.max(0, (o.total ?? 0) - (o.amount_paid ?? 0)), 0)

  const { data: invoices } = await supabase
    .from('invoices')
    .select('total, amount_paid, status, created_at')
    .eq('store_id', store.id)

  const invoicesPaid  = (invoices ?? [] as InvoiceRow[]).filter((i: InvoiceRow) => i.status === 'paid').length
  const invoicesDraft = (invoices ?? [] as InvoiceRow[]).filter((i: InvoiceRow) => i.status === 'draft').length
  const invoicesTotal = (invoices ?? [] as InvoiceRow[]).reduce((s: number, i: InvoiceRow) => s + (i.total ?? 0), 0)

  const { data: vouchers } = await supabase
    .from('vouchers')
    .select('type, amount, date')
    .eq('store_id', store.id)
    .gte('date', startOfMonth.slice(0, 10))

  const monthReceipts = (vouchers ?? [] as VoucherRow[]).filter((v: VoucherRow) => v.type === 'receipt').reduce((s: number, v: VoucherRow) => s + v.amount, 0)
  const monthPayments = (vouchers ?? [] as VoucherRow[]).filter((v: VoucherRow) => v.type === 'payment').reduce((s: number, v: VoucherRow) => s + v.amount, 0)

  const { data: customers } = await supabase
    .from('customers')
    .select('balance')
    .eq('store_id', store.id)
    .gt('balance', 0)

  const totalDebt = (customers ?? [] as CustomerRow[]).reduce((s: number, c: CustomerRow) => s + (c.balance ?? 0), 0)

  const netProfit = monthReceipts - monthPayments
  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 0 })
  const cur = store.currency_code

  return (
    <div className="space-y-5 p-4 sm:p-6">

      {/* العنوان */}
      <div>
        <h1 className="text-xl font-semibold text-white">المحاسبة والمالية</h1>
        <p className="mt-1 text-sm text-slate-400">
          {now.toLocaleDateString('ar', { month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* ── صافي الشهر — البطاقة الرئيسية ── */}
      <div className={`rounded-2xl border p-4 sm:p-5 ${
        netProfit > 0  ? 'border-emerald-500/20 bg-emerald-500/5' :
        netProfit < 0  ? 'border-red-500/20 bg-red-500/5' :
                         'border-white/5 bg-slate-900'
      }`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              صافي الشهر
            </p>
            <p className={`mt-1.5 text-3xl font-bold sm:text-4xl ${
              netProfit > 0 ? 'text-emerald-400' : netProfit < 0 ? 'text-red-400' : 'text-slate-300'
            }`} dir="ltr">
              {netProfit > 0 ? '+' : ''}{fmt(netProfit)}
              <span className="mr-1.5 text-base font-normal text-slate-400">{cur}</span>
            </p>
            <p className="mt-2 text-xs text-slate-500">
              مقبوضات{' '}
              <span className="font-medium text-emerald-400">{fmt(monthReceipts)}</span>
              {' '}−{' '}
              مصروفات{' '}
              <span className="font-medium text-red-400">{fmt(monthPayments)}</span>
            </p>
          </div>
          <span className="text-3xl">{netProfit >= 0 ? '📈' : '📉'}</span>
        </div>
      </div>

      {/* ── 4 بطاقات شهرية ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: 'إيرادات الشهر',
            sub:   'من الطلبيات المكتملة',
            value: fmt(monthRevenue),
            color: 'text-emerald-400',
            border: 'border-emerald-500/10',
            href:  '/dashboard/accounting/invoices',
          },
          {
            label: 'مقبوضات الشهر',
            sub:   'سندات القبض',
            value: fmt(monthReceipts),
            color: 'text-sky-400',
            border: 'border-sky-500/10',
            href:  '/dashboard/accounting/receipts',
          },
          {
            label: 'مصروفات الشهر',
            sub:   'سندات الصرف',
            value: fmt(monthPayments),
            color: 'text-red-400',
            border: 'border-red-500/10',
            href:  '/dashboard/accounting/payments',
          },
          {
            label: 'مستحقات الزبائن',
            sub:   'أرصدة غير مسددة',
            value: fmt(totalDebt),
            color: 'text-amber-400',
            border: 'border-amber-500/10',
            href:  '/dashboard/customers',
          },
        ].map(card => (
          <Link
            key={card.label}
            href={card.href}
            className={`rounded-2xl border bg-slate-900 p-3.5 sm:p-4 transition-colors hover:bg-slate-800 ${card.border}`}
          >
            <p className="text-[11px] font-medium text-slate-400 sm:text-xs">{card.label}</p>
            <p className={`mt-1.5 text-xl font-bold sm:text-2xl ${card.color}`} dir="ltr">
              {card.value}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-600 sm:text-[11px]">{cur} · {card.sub}</p>
          </Link>
        ))}
      </div>

      {/* ── ملخص كامل ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-4 sm:p-5">
          <p className="text-[11px] font-medium text-slate-400 sm:text-xs">إجمالي المبيعات</p>
          <p className="mt-1.5 text-2xl font-bold text-white sm:text-3xl" dir="ltr">
            {fmt(totalRevenue)}
            <span className="mr-1 text-sm font-normal text-slate-500">{cur}</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500">{(ordersData ?? []).length} طلبية مكتملة</p>
        </div>

        <div className="rounded-2xl border border-amber-500/10 bg-slate-900 p-4 sm:p-5">
          <p className="text-[11px] font-medium text-slate-400 sm:text-xs">مستحق التحصيل</p>
          <p className="mt-1.5 text-2xl font-bold text-amber-400 sm:text-3xl" dir="ltr">
            {fmt(outstanding)}
            <span className="mr-1 text-sm font-normal text-slate-500">{cur}</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500">{invoicesDraft} فاتورة غير مدفوعة</p>
        </div>

        <div className="rounded-2xl border border-emerald-500/10 bg-slate-900 p-4 sm:p-5">
          <p className="text-[11px] font-medium text-slate-400 sm:text-xs">فواتير محصّلة</p>
          <p className="mt-1.5 text-2xl font-bold text-emerald-400 sm:text-3xl" dir="ltr">
            {fmt(invoicesTotal)}
            <span className="mr-1 text-sm font-normal text-slate-500">{cur}</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500">{invoicesPaid} فاتورة مدفوعة</p>
        </div>
      </div>

      {/* ── وصول سريع ── */}
      <div>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          وصول سريع
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { href: '/dashboard/accounting/invoices',     icon: '📋', label: 'الفواتير',      desc: `${invoicesTotal > 0 ? fmt(invoicesTotal) + ' ' + cur : 'لا توجد فواتير'}` },
            { href: '/dashboard/accounting/invoices/new', icon: '➕', label: 'فاتورة جديدة',  desc: 'إنشاء فاتورة للزبون' },
            { href: '/dashboard/accounting/receipts',     icon: '💵', label: 'سندات القبض',   desc: 'تسجيل مبلغ مقبوض' },
            { href: '/dashboard/accounting/payments',     icon: '💸', label: 'سندات الصرف',   desc: 'تسجيل مصروف أو دفعة' },
          ].map(s => (
            <Link key={s.href} href={s.href}
              className="rounded-2xl border border-white/5 bg-slate-900 p-3.5 sm:p-4 transition-colors hover:border-sky-500/20 hover:bg-sky-500/5">
              <span className="text-xl sm:text-2xl">{s.icon}</span>
              <p className="mt-2 text-xs font-semibold text-white sm:text-sm">{s.label}</p>
              <p className="mt-0.5 text-[10px] text-slate-500 sm:text-xs">{s.desc}</p>
            </Link>
          ))}
        </div>
      </div>

    </div>
  )
}
