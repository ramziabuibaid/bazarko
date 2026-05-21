import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function AccountingPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code')
    .eq('owner_id', user.id)
    .single()
  if (!store) redirect('/onboarding')

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  // إجمالي الإيرادات من الطلبيات المكتملة
  const { data: ordersData } = await supabase
    .from('orders')
    .select('total, amount_paid, created_at')
    .eq('store_id', store.id)
    .in('status', ['delivered', 'processing', 'confirmed', 'ready'])

  type OrderRow = { total: number; amount_paid: number; created_at: string }
  type InvoiceRow = { total: number; amount_paid: number; status: string }
  type VoucherRow = { type: string; amount: number; date: string }
  type CustomerRow = { balance: number }

  const totalRevenue    = (ordersData ?? [] as OrderRow[]).reduce((s: number, o: OrderRow) => s + (o.amount_paid ?? 0), 0)
  const monthRevenue    = (ordersData ?? [] as OrderRow[])
    .filter((o: OrderRow) => o.created_at >= startOfMonth)
    .reduce((s: number, o: OrderRow) => s + (o.amount_paid ?? 0), 0)
  const outstanding     = (ordersData ?? [] as OrderRow[]).reduce((s: number, o: OrderRow) => s + Math.max(0, (o.total ?? 0) - (o.amount_paid ?? 0)), 0)

  // فواتير
  const { data: invoices } = await supabase
    .from('invoices')
    .select('total, amount_paid, status, created_at')
    .eq('store_id', store.id)

  const invoicesPaid    = (invoices ?? [] as InvoiceRow[]).filter((i: InvoiceRow) => i.status === 'paid').length
  const invoicesDraft   = (invoices ?? [] as InvoiceRow[]).filter((i: InvoiceRow) => i.status === 'draft').length
  const invoicesTotal   = (invoices ?? [] as InvoiceRow[]).reduce((s: number, i: InvoiceRow) => s + (i.total ?? 0), 0)

  // سندات هذا الشهر
  const { data: vouchers } = await supabase
    .from('vouchers')
    .select('type, amount, date')
    .eq('store_id', store.id)
    .gte('date', startOfMonth.slice(0, 10))

  const monthReceipts = (vouchers ?? [] as VoucherRow[]).filter((v: VoucherRow) => v.type === 'receipt').reduce((s: number, v: VoucherRow) => s + v.amount, 0)
  const monthPayments = (vouchers ?? [] as VoucherRow[]).filter((v: VoucherRow) => v.type === 'payment').reduce((s: number, v: VoucherRow) => s + v.amount, 0)

  // ذمم الزبائن
  const { data: customers } = await supabase
    .from('customers')
    .select('balance')
    .eq('store_id', store.id)
    .gt('balance', 0)

  const totalDebt = (customers ?? [] as CustomerRow[]).reduce((s: number, c: CustomerRow) => s + (c.balance ?? 0), 0)

  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 0 })

  const stats = [
    { label: 'إيرادات هذا الشهر', value: `${fmt(monthRevenue)} ${store.currency_code}`, icon: '📈', color: 'text-emerald-400', href: '/dashboard/accounting/invoices' },
    { label: 'ذمم الزبائن',        value: `${fmt(totalDebt)} ${store.currency_code}`,   icon: '💳', color: 'text-yellow-400', href: '/dashboard/customers' },
    { label: 'مقبوضات الشهر',     value: `${fmt(monthReceipts)} ${store.currency_code}`, icon: '💵', color: 'text-sky-400',     href: '/dashboard/accounting/receipts' },
    { label: 'مصروفات الشهر',     value: `${fmt(monthPayments)} ${store.currency_code}`, icon: '💸', color: 'text-red-400',     href: '/dashboard/accounting/payments' },
  ]

  const shortcuts = [
    { href: '/dashboard/accounting/invoices',     icon: '📋', label: 'الفواتير',        desc: `${invoicesTotal > 0 ? fmt(invoicesTotal) + ' ' + store.currency_code : 'لا توجد فواتير'}` },
    { href: '/dashboard/accounting/invoices/new', icon: '➕', label: 'فاتورة جديدة',     desc: 'إنشاء فاتورة للزبون' },
    { href: '/dashboard/accounting/receipts',     icon: '💵', label: 'سندات القبض',      desc: 'تسجيل مبلغ مقبوض' },
    { href: '/dashboard/accounting/payments',     icon: '💸', label: 'سندات الصرف',      desc: 'تسجيل مصروف أو دفعة' },
  ]

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">المحاسبة والمالية</h1>
        <p className="mt-1 text-sm text-slate-400">نظرة شاملة على الوضع المالي</p>
      </div>

      {/* البطاقات */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map(s => (
          <Link key={s.label} href={s.href}
            className="rounded-2xl border border-white/5 bg-slate-900 p-4 hover:border-white/10 transition-colors">
            <p className="text-xs text-slate-400">{s.icon} {s.label}</p>
            <p className={`mt-1.5 text-xl font-bold ${s.color}`} dir="ltr">{s.value}</p>
          </Link>
        ))}
      </div>

      {/* الإجمالي الكلي */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="text-xs text-slate-400 mb-1">📦 إجمالي مبيعات الطلبيات</p>
          <p className="text-2xl font-bold text-white" dir="ltr">{fmt(totalRevenue)} {store.currency_code}</p>
          <p className="mt-1 text-xs text-slate-500">{(ordersData ?? []).length} طلبية مكتملة</p>
        </div>
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="text-xs text-slate-400 mb-1">📋 فواتير مستحقة القبض</p>
          <p className="text-2xl font-bold text-yellow-400" dir="ltr">{fmt(outstanding)} {store.currency_code}</p>
          <p className="mt-1 text-xs text-slate-500">{invoicesDraft} فاتورة غير مدفوعة</p>
        </div>
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="text-xs text-slate-400 mb-1">✅ فواتير مدفوعة</p>
          <p className="text-2xl font-bold text-emerald-400" dir="ltr">{fmt(invoicesTotal)} {store.currency_code}</p>
          <p className="mt-1 text-xs text-slate-500">{invoicesPaid} فاتورة مدفوعة</p>
        </div>
      </div>

      {/* اختصارات */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-slate-400">الوصول السريع</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {shortcuts.map(s => (
            <Link key={s.href} href={s.href}
              className="rounded-2xl border border-white/5 bg-slate-900 p-4 hover:border-sky-500/20 hover:bg-sky-500/5 transition-colors">
              <span className="text-2xl">{s.icon}</span>
              <p className="mt-2 text-sm font-semibold text-white">{s.label}</p>
              <p className="mt-0.5 text-xs text-slate-500">{s.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
