import PrintButton from "@/components/dashboard/PrintButton"
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'طباعة كشف حساب مورد — Bazarko ERP',
}

export default async function PrintSupplierStatementPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: supplier },
    { data: purchases },
    { data: returns },
    { data: payments }
  ] = await Promise.all([
    supabase.from('stores').select('*').eq('id', storeId).single(),
    supabase.from('suppliers').select('*').eq('id', params.id).eq('store_id', storeId).single(),
    supabase.from('purchase_invoices').select('id, invoice_number, invoice_date, total_amount, payment_method').eq('supplier_id', params.id).eq('store_id', storeId),
    supabase.from('purchase_returns').select('id, return_number, return_date, total_amount').eq('supplier_id', params.id).eq('store_id', storeId),
    supabase.from('payment_vouchers').select('id, voucher_number, voucher_date, amount, payment_method').eq('supplier_id', params.id).eq('store_id', storeId)
  ])

  if (!store || !supplier) notFound()

  // Build unified transactions list
  const txs: any[] = []

  // Purchases (Credit -> increase debt owed to supplier)
  for (const p of purchases || []) {
    txs.push({
      date: p.invoice_date,
      type: 'فاتورة مشتريات',
      doc_no: p.invoice_number,
      debit: 0,
      credit: Number(p.total_amount),
      notes: `فاتورة مشتريات (${p.payment_method})`,
    })
  }

  // Returns (Debit -> decrease debt owed to supplier)
  for (const r of returns || []) {
    txs.push({
      date: r.return_date,
      type: 'مردود مشتريات',
      doc_no: r.return_number,
      debit: Number(r.total_amount),
      credit: 0,
      notes: 'إرجاع بضاعة للمورد',
    })
  }

  // Payments (Debit -> decrease debt owed to supplier)
  for (const pm of payments || []) {
    txs.push({
      date: pm.voucher_date,
      type: 'سند صرف (دفعة)',
      doc_no: pm.voucher_number,
      debit: Number(pm.amount),
      credit: 0,
      notes: `سداد دفعة (${pm.payment_method})`,
    })
  }

  // Sort by date
  txs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  let running = 0
  const rows = txs.map(t => {
    running = running + t.credit - t.debit
    return { ...t, balance: running }
  })

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white">
      {/* ── Toolbar ── */}
      <div className="mx-auto mb-6 flex max-w-4xl items-center justify-between rounded-xl bg-slate-900 p-4 text-white shadow-lg print:hidden">
        <Link
          href="/dashboard/suppliers"
          className="text-xs font-bold text-slate-300 hover:text-white transition"
        >
          ← العودة لدليل الموردين
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
              كشف حساب مورد رسمي
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              تاريخ الاستخراج: {new Date().toLocaleDateString('en-GB')}
            </p>
          </div>

          <div className="text-left font-mono text-xs">
            <p><span className="text-slate-500">اسم المورد:</span> <span className="font-bold text-sm">{supplier.name}</span></p>
            {supplier.phone && <p className="mt-1"><span className="text-slate-500">الهاتف:</span> {supplier.phone}</p>}
            {supplier.address && <p className="mt-1"><span className="text-slate-500">العنوان:</span> {supplier.address}</p>}
          </div>
        </div>

        {/* Current Balance Summary Box */}
        <div className="my-4 grid grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <div>
            <span className="text-slate-500">إجمالي المشتريات (دائن):</span>{' '}
            <span className="font-mono font-bold text-slate-900">
              {(purchases || []).reduce((s, p) => s + Number(p.total_amount), 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
            </span>
          </div>
          <div>
            <span className="text-slate-500">إجمالي المدفوعات والمردودات (مدين):</span>{' '}
            <span className="font-mono font-bold text-emerald-800">
              {((payments || []).reduce((s, p) => s + Number(p.amount), 0) + (returns || []).reduce((s, r) => s + Number(r.total_amount), 0)).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
            </span>
          </div>
          <div>
            <span className="text-slate-500">الرصيد المستحق النهائي:</span>{' '}
            <span className="font-mono font-black text-sm text-rose-800">
              {Number(supplier.balance).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
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
              <th className="p-2 text-left text-emerald-800">مدين (سداد / مردود)</th>
              <th className="p-2 text-left text-rose-800">دائن (مشتريات)</th>
              <th className="p-2 text-left">الرصيد التراكمي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-4 text-center text-slate-500">
                  لا توجد حركات مسجلة مع هذا المورد
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={idx}>
                  <td className="p-2 font-mono">{new Date(row.date).toLocaleDateString('en-GB')}</td>
                  <td className="p-2 font-semibold text-slate-900">{row.type}</td>
                  <td className="p-2 font-mono">#{row.doc_no}</td>
                  <td className="p-2 text-slate-600">{row.notes}</td>
                  <td className="p-2 text-left font-mono font-bold text-emerald-800">
                    {row.debit > 0 ? row.debit.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}
                  </td>
                  <td className="p-2 text-left font-mono font-bold text-rose-800">
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
            <p className="text-slate-500 mb-8">مطابقة المورد</p>
            <p className="border-t border-dotted border-slate-400 pt-1">الختم والتوقيع</p>
          </div>
        </div>
      </div>
    </div>
  )
}
