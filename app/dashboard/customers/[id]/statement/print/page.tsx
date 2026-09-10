import PrintButton from "@/components/dashboard/PrintButton"
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'طباعة كشف حساب زبون — Bazarko ERP',
}

export default async function PrintCustomerStatementPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: customer },
    { data: invoices },
    { data: returns },
    { data: receipts },
    { data: ledger }
  ] = await Promise.all([
    supabase.from('stores').select('*').eq('id', storeId).single(),
    supabase.from('customers').select('*').eq('id', params.id).eq('store_id', storeId).single(),
    supabase.from('invoices').select('id, invoice_number, issue_date, total, status').eq('customer_id', params.id).eq('store_id', storeId),
    supabase.from('sales_returns').select('id, return_number, return_date, total_amount').eq('customer_id', params.id).eq('store_id', storeId),
    supabase.from('vouchers').select('id, voucher_number, date, amount, payment_method, type').eq('customer_id', params.id).eq('store_id', storeId).eq('type', 'receipt'),
    supabase.from('customer_ledger').select('*').eq('customer_id', params.id).eq('store_id', storeId).order('date', { ascending: true })
  ])

  if (!store || !customer) notFound()

  // Build unified transactions list
  const txs: any[] = []

  // Invoices (Debit -> increases customer debt to us)
  for (const inv of invoices || []) {
    txs.push({
      date: inv.issue_date,
      type: 'فاتورة مبيعات',
      doc_no: inv.invoice_number,
      debit: Number(inv.total),
      credit: 0,
      notes: `فاتورة مبيعات (${inv.status === 'paid' ? 'مدفوعة' : 'آجلة/مستحقة'})`,
    })
  }

  // Sales Returns (Credit -> decreases customer debt)
  for (const ret of returns || []) {
    txs.push({
      date: ret.return_date,
      type: 'مردود مبيعات',
      doc_no: ret.return_number,
      debit: 0,
      credit: Number(ret.total_amount),
      notes: 'إرجاع بضاعة من العميل',
    })
  }

  // Receipts (Credit -> decreases customer debt)
  for (const rcp of receipts || []) {
    txs.push({
      date: rcp.date,
      type: 'سند قبض (دفعة)',
      doc_no: rcp.voucher_number,
      debit: 0,
      credit: Number(rcp.amount),
      notes: `دفعة مقبوضة (${rcp.payment_method || 'نقدي'})`,
    })
  }

  txs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  let running = 0
  const rows = txs.map(t => {
    running = running + t.debit - t.credit
    return { ...t, balance: running }
  })

  const totalInvoiced = (invoices || []).reduce((s, inv) => s + Number(inv.total), 0)
  const totalPaid = ((receipts || []).reduce((s, r) => s + Number(r.amount), 0) + (returns || []).reduce((s, ret) => s + Number(ret.total_amount), 0))

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white" dir="rtl">
      {/* ── Toolbar ── */}
      <div className="mx-auto mb-6 flex max-w-4xl items-center justify-between rounded-xl bg-slate-900 p-4 text-white shadow-lg print:hidden">
        <Link
          href="/dashboard/customers"
          className="text-xs font-bold text-slate-300 hover:text-white transition"
        >
          ← العودة للعملاء
        </Link>
        <PrintButton label="🖨️ طباعة كشف الحساب (PDF)" className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition" />
      </div>

      {/* ── Paper Document ── */}
      <div className="mx-auto max-w-4xl rounded-xl border border-slate-300 bg-white p-8 shadow-sm print:border-none print:shadow-none print:p-4">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">{store.name}</h1>
            <p className="text-xs text-slate-600 mt-0.5">{store.address || 'فلسطين'}</p>
            {store.phone && <p className="text-xs text-slate-600">هاتف: {store.phone}</p>}
          </div>

          <div className="text-center">
            <h2 className="text-lg font-black text-slate-900 border-2 border-slate-900 px-6 py-1 rounded-lg inline-block bg-slate-50">
              كشف حساب عميل رسمي
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              تاريخ الاستخراج: {new Date().toLocaleDateString('en-GB')}
            </p>
          </div>

          <div className="text-left font-mono text-xs">
            <p><span className="text-slate-500">اسم العميل:</span> <span className="font-bold text-sm">{customer.name}</span></p>
            {customer.phone && <p className="mt-1"><span className="text-slate-500">الهاتف:</span> {customer.phone}</p>}
            {customer.city && <p className="mt-1"><span className="text-slate-500">المدينة:</span> {customer.city}</p>}
          </div>
        </div>

        {/* Current Balance Summary Box */}
        <div className="my-4 grid grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <div>
            <span className="text-slate-500">إجمالي المبيعات (مدين):</span>{' '}
            <span className="font-mono font-bold text-slate-900">
              {totalInvoiced.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
            </span>
          </div>
          <div>
            <span className="text-slate-500">إجمالي المقبوضات والمردودات (دائن):</span>{' '}
            <span className="font-mono font-bold text-emerald-800">
              {totalPaid.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
            </span>
          </div>
          <div>
            <span className="text-slate-500">الرصيد المستحق (المتبقي):</span>{' '}
            <span className="font-mono font-black text-sm text-sky-900">
              {Number(customer.balance || running).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
            </span>
          </div>
        </div>

        {/* Statement Table */}
        <table className="w-full text-right text-xs border border-slate-200">
          <thead>
            <tr className="bg-slate-100 text-slate-800 border-b font-bold">
              <th className="p-2">التاريخ</th>
              <th className="p-2">نوع الحركة</th>
              <th className="p-2">رقم المستند</th>
              <th className="p-2">البيان</th>
              <th className="p-2 text-left text-sky-900">مدين (فواتير)</th>
              <th className="p-2 text-left text-emerald-800">دائن (سداد / مردود)</th>
              <th className="p-2 text-left">الرصيد التراكمي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-4 text-center text-slate-500">
                  لا توجد حركات مسجلة لهذا العميل
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={idx}>
                  <td className="p-2 font-mono">{new Date(row.date).toLocaleDateString('en-GB')}</td>
                  <td className="p-2 font-semibold text-slate-900">{row.type}</td>
                  <td className="p-2 font-mono">#{row.doc_no}</td>
                  <td className="p-2 text-slate-600">{row.notes}</td>
                  <td className="p-2 text-left font-mono font-bold text-sky-900">
                    {row.debit > 0 ? row.debit.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}
                  </td>
                  <td className="p-2 text-left font-mono font-bold text-emerald-800">
                    {row.credit > 0 ? row.credit.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}
                  </td>
                  <td className="p-2 text-left font-mono font-black text-slate-900">
                    {row.balance.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Signatures */}
        <div className="mt-14 grid grid-cols-3 gap-6 border-t-2 border-slate-900 pt-6 text-center text-xs font-bold text-slate-800">
          <div>
            <p className="text-slate-500 mb-8">المحاسب المالي</p>
            <p className="border-t border-dotted border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">المدقق الداخلي</p>
            <p className="border-t border-dotted border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">مطابقة العميل</p>
            <p className="border-t border-dotted border-slate-400 pt-1">الختم والتوقيع</p>
          </div>
        </div>
      </div>
    </div>
  )
}
