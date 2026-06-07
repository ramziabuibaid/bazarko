import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'

interface Props {
  searchParams: { status?: string; q?: string }
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'مسودة',    cls: 'bg-slate-500/15 text-slate-400' },
  sent:      { label: 'مُرسلة',   cls: 'bg-blue-500/15 text-blue-400' },
  paid:      { label: 'مدفوعة',   cls: 'bg-emerald-500/15 text-emerald-400' },
  cancelled: { label: 'ملغاة',    cls: 'bg-red-500/15 text-red-400' },
}

export default async function InvoicesPage({ searchParams }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code, name')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  let query = supabase
    .from('invoices')
    .select('id, invoice_number, customer_name, customer_id, issue_date, due_date, total, amount_paid, status')
    .eq('store_id', store.id)
    .order('created_at', { ascending: false })

  if (searchParams.status === 'unpaid') {
    query = query.not('status', 'in', '(paid,cancelled)')
  } else if (searchParams.status) {
    query = query.eq('status', searchParams.status)
  }

  const { data: invoices } = await query

  // إحصائيات
  const { data: all } = await supabase
    .from('invoices')
    .select('total, amount_paid, status')
    .eq('store_id', store.id)

  type InvRow = { total: number; amount_paid: number; status: string }
  const allInv = (all ?? [] as InvRow[])
  const totalAll      = allInv.length
  const totalPaid     = allInv.filter((i: InvRow) => i.status === 'paid').length
  const totalDraft    = allInv.filter((i: InvRow) => i.status === 'draft').length
  const totalAmount   = allInv.reduce((s: number, i: InvRow) => s + (i.total ?? 0), 0)
  const outstandingAmt = allInv.filter((i: InvRow) => i.status !== 'paid' && i.status !== 'cancelled')
    .reduce((s: number, i: InvRow) => s + Math.max(0, (i.total ?? 0) - (i.amount_paid ?? 0)), 0)

  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 0 })

  const totalUnpaid = allInv.filter((i: InvRow) => i.status !== 'paid' && i.status !== 'cancelled').length

  const STATUS_TABS = [
    { key: '',       label: 'الكل',         count: totalAll },
    { key: 'unpaid', label: 'غير مدفوعة',   count: totalUnpaid },
    { key: 'draft',  label: 'مسودة',         count: totalDraft },
    { key: 'paid',   label: 'مدفوعة',        count: totalPaid },
  ]

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/dashboard/accounting" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
              ← المحاسبة
            </Link>
            <h1 className="text-xl font-semibold text-white">الفواتير</h1>
          </div>
        </div>
        <Link href="/dashboard/accounting/invoices/new"
          className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500">
          ➕ فاتورة جديدة
        </Link>
      </div>

      {/* إحصائيات */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'إجمالي الفواتير',  value: `${fmt(totalAmount)} ${store.currency_code}`, color: 'text-white' },
          { label: 'غير مدفوع',        value: `${fmt(outstandingAmt)} ${store.currency_code}`, color: 'text-yellow-400' },
          { label: 'مدفوعة',           value: String(totalPaid),  color: 'text-emerald-400' },
          { label: 'مسودات',           value: String(totalDraft), color: 'text-slate-400' },
        ].map(c => (
          <div key={c.label} className="rounded-2xl border border-white/5 bg-slate-900 p-4">
            <p className="text-xs text-slate-400">{c.label}</p>
            <p className={`mt-1 text-lg font-bold ${c.color}`} dir="ltr">{c.value}</p>
          </div>
        ))}
      </div>

      {/* تبويبات الحالة */}
      <div className="flex gap-1 border-b border-white/5 pb-0">
        {STATUS_TABS.map(t => (
          <Link
            key={t.key}
            href={`/dashboard/accounting/invoices${t.key ? `?status=${t.key}` : ''}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              searchParams.status === t.key || (!searchParams.status && !t.key)
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {t.label}
            <span className="mr-1.5 text-xs opacity-60">({t.count})</span>
          </Link>
        ))}
      </div>

      {/* الجدول */}
      {(!invoices || invoices.length === 0) ? (
        <div className="rounded-2xl border border-white/5 bg-white/3 py-16 text-center">
          <p className="text-4xl">📋</p>
          <p className="mt-3 text-slate-300 font-medium">لا توجد فواتير حتى الآن</p>
          <p className="mt-1 text-sm text-slate-500">ابدأ بإنشاء أول فاتورة لزبائنك</p>
          <Link href="/dashboard/accounting/invoices/new"
            className="mt-4 inline-block rounded-xl bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-500">
            إنشاء أول فاتورة
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/3">
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">رقم الفاتورة</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الزبون</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">التاريخ</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">الإجمالي</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">الحالة</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {invoices.map((inv: {
                id: string; invoice_number: string; customer_name: string | null; customer_id: string | null
                issue_date: string; due_date: string | null; total: number; amount_paid: number; status: string
              }) => {
                const sl = STATUS_LABELS[inv.status] ?? { label: inv.status, cls: 'bg-white/5 text-white' }
                const remaining = Math.max(0, (inv.total ?? 0) - (inv.amount_paid ?? 0))
                return (
                  <tr key={inv.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3 font-mono text-sky-400" dir="ltr">{inv.invoice_number}</td>
                    <td className="px-4 py-3 text-white">{inv.customer_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {new Date(inv.issue_date).toLocaleDateString('ar', { year: 'numeric', month: 'short', day: 'numeric' })}
                      {inv.due_date && (
                        <p className="text-slate-600">حتى: {new Date(inv.due_date).toLocaleDateString('ar', { month: 'short', day: 'numeric' })}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-left">
                      <span className="font-semibold text-white" dir="ltr">{fmt(inv.total)} {store.currency_code}</span>
                      {remaining > 0 && inv.status !== 'cancelled' && (
                        <p className="text-xs text-yellow-400" dir="ltr">متبقي: {fmt(remaining)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${sl.cls}`}>{sl.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/accounting/invoices/${inv.id}`}
                        className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-sky-500/15 hover:text-sky-400"
                      >
                        عرض
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
