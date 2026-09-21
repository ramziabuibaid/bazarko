import PrintButton from "@/components/dashboard/PrintButton"
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'طباعة كشف حساب زبون — Bazarko ERP',
}

interface Props {
  params: { id: string }
  searchParams?: { from?: string; to?: string }
}

export default async function PrintCustomerStatementPage({ params, searchParams }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const fromDate = searchParams?.from || ''
  const toDate = searchParams?.to || ''

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
    supabase.from('invoices').select('id, invoice_number, issue_date, total, status, notes').eq('customer_id', params.id).eq('store_id', storeId).neq('status', 'cancelled'),
    supabase.from('sales_returns').select('id, return_number, return_date, total_amount, reason').eq('customer_id', params.id).eq('store_id', storeId),
    supabase.from('vouchers').select('id, voucher_number, date, amount, payment_method, type, description').eq('customer_id', params.id).eq('store_id', storeId).eq('type', 'receipt'),
    supabase.from('customer_ledger').select('*').eq('customer_id', params.id).eq('store_id', storeId).order('date', { ascending: true })
  ])

  if (!store || !customer) notFound()

  const currency = store.currency_code || 'ILS'
  const fmt = (n: number) => Number(n || 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // تجميع كافة الحركات وتوحيدها
  const allTxs: {
    date: string
    type: string
    doc_no: string
    debit: number
    credit: number
    notes: string
  }[] = []

  // الفواتير (مدين -> ذمة على العميل)
  for (const inv of invoices || []) {
    allTxs.push({
      date: inv.issue_date,
      type: 'فاتورة مبيعات',
      doc_no: inv.invoice_number,
      debit: Number(inv.total || 0),
      credit: 0,
      notes: inv.notes || `فاتورة مبيعات (${inv.status === 'paid' ? 'مسددة' : 'آجلة'})`,
    })
  }

  // المردودات (دائن -> تخفيض ذمة العميل)
  for (const ret of returns || []) {
    allTxs.push({
      date: ret.return_date,
      type: 'مردود مبيعات',
      doc_no: ret.return_number,
      debit: 0,
      credit: Number(ret.total_amount || 0),
      notes: ret.reason || 'إرجاع بضاعة ومردود',
    })
  }

  // سندات القبض (دائن -> تخفيض ذمة العميل)
  for (const rcp of receipts || []) {
    allTxs.push({
      date: rcp.date,
      type: 'سند قبض',
      doc_no: rcp.voucher_number,
      debit: 0,
      credit: Number(rcp.amount || 0),
      notes: rcp.description || `سند قبض (${rcp.payment_method || 'نقدي'})`,
    })
  }

  // الترتيب الزمني التصاعدي
  allTxs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  // حساب الرصيد الافتتاحي والحركات ضمن الفترة المحددة
  let openingBalance = 0
  const periodTxs: typeof allTxs = []

  for (const tx of allTxs) {
    if (fromDate && tx.date < fromDate) {
      openingBalance += (tx.debit - tx.credit)
    } else if (toDate && tx.date > toDate) {
      // بعد الفترة المحددة
      continue
    } else {
      periodTxs.push(tx)
    }
  }

  let runningBalance = openingBalance
  const rows = periodTxs.map(t => {
    runningBalance = runningBalance + t.debit - t.credit
    return { ...t, balance: runningBalance }
  })

  const totalPeriodDebit = periodTxs.reduce((s, t) => s + t.debit, 0)
  const totalPeriodCredit = periodTxs.reduce((s, t) => s + t.credit, 0)
  const finalBalance = runningBalance

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white" dir="rtl">
      {/* ── شريط الأدوات العلوي ── */}
      <div className="mx-auto mb-6 flex max-w-4xl items-center justify-between rounded-2xl bg-slate-900 p-4 text-white shadow-xl print:hidden">
        <Link
          href="/dashboard/customers"
          className="text-xs font-bold text-slate-300 hover:text-white transition flex items-center gap-1.5"
        >
          <span>←</span>
          <span>العودة لدليل العملاء</span>
        </Link>
        <PrintButton
          label="🖨️ طباعة كشف الحساب الرسمى (PDF)"
          className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition shadow-sm"
        />
      </div>

      {/* ── المستند الرسمي ── */}
      <div className="mx-auto max-w-4xl rounded-2xl border border-slate-300 bg-white p-8 shadow-sm print:border-none print:shadow-none print:p-4">
        {/* الترويسة الرئيسية */}
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-5">
          <div className="flex items-center gap-4">
            {store.logo_url ? (
              <img
                src={store.logo_url}
                alt={store.name}
                className="h-16 w-16 object-contain rounded-xl border border-slate-200 p-1"
              />
            ) : (
              <div className="h-14 w-14 rounded-xl bg-slate-900 text-white flex items-center justify-center text-xl font-black">
                {store.name?.slice(0, 1) || 'B'}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-black text-slate-950">{store.name}</h1>
              <p className="text-xs text-slate-600 mt-0.5">{store.address || 'فلسطين'}</p>
              {store.phone && <p className="text-xs text-slate-600 font-mono" dir="ltr">هاتف: {store.phone}</p>}
            </div>
          </div>

          <div className="text-center">
            <h2 className="text-xl font-black text-slate-900 border-2 border-slate-900 px-6 py-1.5 rounded-xl inline-block bg-slate-50 shadow-sm">
              كشف حساب عميل (Statement)
            </h2>
            <p className="mt-1.5 text-xs text-slate-500">
              تاريخ الطباعة: <span className="font-mono font-bold text-slate-800">{new Date().toISOString().slice(0, 10)}</span>
            </p>
          </div>

          <div className="text-left text-xs space-y-1 font-sans">
            <div>الفترة المحاسبية:</div>
            <div className="font-mono font-bold text-slate-900">
              {fromDate ? fromDate : 'البداية'} — {toDate ? toDate : 'حتى تاريخه'}
            </div>
            <div className="text-slate-500">العملة الأساسية: <strong>{currency}</strong></div>
          </div>
        </div>

        {/* بطاقة بيانات العميل والرصيد */}
        <div className="my-5 grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
          <div>
            <span className="text-slate-500 block mb-0.5">اسم العميل:</span>
            <strong className="text-slate-950 text-sm">{customer.name}</strong>
          </div>
          <div>
            <span className="text-slate-500 block mb-0.5">رقم الهاتف:</span>
            <strong className="font-mono text-slate-900" dir="ltr">{customer.phone || '—'}</strong>
          </div>
          <div className="text-left sm:text-right">
            <span className="text-slate-500 block mb-0.5">صافي الرصيد الحالي:</span>
            <strong className={`font-mono text-base ${finalBalance > 0 ? 'text-rose-700 font-black' : finalBalance < 0 ? 'text-emerald-700 font-black' : 'text-slate-700'}`} dir="ltr">
              {fmt(Math.abs(finalBalance))} {currency} {finalBalance > 0 ? '(مدين / عليه)' : finalBalance < 0 ? '(دائن / له)' : '(مسدد)'}
            </strong>
          </div>
        </div>

        {/* جدول الحركات التاريخية والتراكمية */}
        <table className="w-full text-right text-xs border border-slate-200">
          <thead>
            <tr className="bg-slate-900 text-white border-b">
              <th className="p-2.5 text-center">التاريخ</th>
              <th className="p-2.5">نوع المستند</th>
              <th className="p-2.5 text-center">رقم المرجع</th>
              <th className="p-2.5">البيان / الملاحظات</th>
              <th className="p-2.5 text-left">مدين (+)</th>
              <th className="p-2.5 text-left">دائن (-)</th>
              <th className="p-2.5 text-left bg-slate-800">الرصيد التراكمي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-800">
            {/* سطر الرصيد الافتتاحي السابق */}
            {fromDate && (
              <tr className="bg-amber-50/50 font-bold border-b border-amber-200">
                <td className="p-2.5 text-center font-mono text-slate-600">{fromDate}</td>
                <td className="p-2.5" colSpan={3}>
                  📌 رصيد سابق ما قبل الفترة المحددة (Opening Balance)
                </td>
                <td className="p-2.5 text-left font-mono">{openingBalance > 0 ? fmt(openingBalance) : '—'}</td>
                <td className="p-2.5 text-left font-mono">{openingBalance < 0 ? fmt(Math.abs(openingBalance)) : '—'}</td>
                <td className="p-2.5 text-left font-mono font-black text-slate-950 bg-amber-50">
                  {fmt(openingBalance)} {currency}
                </td>
              </tr>
            )}

            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  لا توجد حركات مسجلة خلال الفترة المحددة
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="p-2.5 text-center font-mono text-slate-600">{row.date}</td>
                  <td className="p-2.5 font-semibold text-slate-900">{row.type}</td>
                  <td className="p-2.5 text-center font-mono text-sky-900 font-bold" dir="ltr">{row.doc_no}</td>
                  <td className="p-2.5 text-slate-600 max-w-xs truncate">{row.notes}</td>
                  <td className="p-2.5 text-left font-mono font-bold text-slate-900" dir="ltr">
                    {row.debit > 0 ? fmt(row.debit) : '—'}
                  </td>
                  <td className="p-2.5 text-left font-mono font-bold text-emerald-700" dir="ltr">
                    {row.credit > 0 ? fmt(row.credit) : '—'}
                  </td>
                  <td className="p-2.5 text-left font-mono font-black text-slate-950 bg-slate-50" dir="ltr">
                    {fmt(row.balance)} {currency}
                  </td>
                </tr>
              ))
            )}
          </tbody>

          {/* تذييل الجدول والإجماليات */}
          <tfoot className="border-t-2 border-slate-900 bg-slate-50 font-bold text-slate-900">
            <tr>
              <td colSpan={4} className="p-3 text-right">إجمالي حركات الفترة المحددة:</td>
              <td className="p-3 text-left font-mono text-slate-950" dir="ltr">{fmt(totalPeriodDebit)} {currency}</td>
              <td className="p-3 text-left font-mono text-emerald-700" dir="ltr">{fmt(totalPeriodCredit)} {currency}</td>
              <td className="p-3 text-left font-mono font-black text-base text-sky-950 bg-slate-100" dir="ltr">
                {fmt(finalBalance)} {currency}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* التواقيع الرسمية وتأكيد الرصيد */}
        <div className="mt-14 pt-6 border-t-2 border-slate-900 grid grid-cols-2 gap-8 text-center text-xs font-bold text-slate-800">
          <div>
            <p className="text-slate-500 mb-8">المحاسب المسؤول / تدقيق الحسابات</p>
            <p className="border-t border-dashed border-slate-400 pt-1">التوقيع والختم</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">مصادقة العميل على صحة الرصيد المذكور</p>
            <p className="border-t border-dashed border-slate-400 pt-1">توقيع العميل</p>
          </div>
        </div>

        <div className="mt-8 text-center text-[10px] text-slate-400 border-t border-slate-100 pt-3 font-mono">
          كشف حساب رسمي صادر من نظام بازاركو • تم التدقيق آلياً
        </div>
      </div>
    </div>
  )
}
