import PrintButton from "@/components/dashboard/PrintButton"
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { tafqeet } from '@/lib/tafqeet'

export const metadata = {
  title: 'طباعة عرض سعر — Bazarko ERP',
}

export default async function PrintQuotationPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: quote }
  ] = await Promise.all([
    supabase.from('stores').select('*').eq('id', storeId).single(),
    supabase
      .from('quotations')
      .select('*, customer:customers(id, name, phone, address), items:quotation_items(*)')
      .eq('id', params.id)
      .eq('store_id', storeId)
      .single()
  ])

  if (!store || !quote) notFound()

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white">
      {/* ── Toolbar ── */}
      <div className="mx-auto mb-6 flex max-w-4xl items-center justify-between rounded-xl bg-slate-900 p-4 text-white shadow-lg print:hidden">
        <Link
          href="/dashboard/quotations"
          className="text-xs font-bold text-slate-300 hover:text-white transition"
        >
          ← العودة لعروض الأسعار
        </Link>
        <PrintButton label="🖨️ طباعة عرض السعر (PDF)" className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition" />
      </div>

      {/* ── Paper Document ── */}
      <div className="mx-auto max-w-4xl rounded-xl border border-slate-300 bg-white p-8 shadow-sm print:border-none print:shadow-none print:p-4">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">{store.name}</h1>
            <p className="text-xs text-slate-600 mt-0.5">{store.address || 'فلسطين'}</p>
            {store.phone && <p className="text-xs text-slate-600">هاتف: {store.phone}</p>}
            {store.email && <p className="text-xs text-slate-600">بريد: {store.email}</p>}
          </div>

          <div className="text-center">
            <h2 className="text-lg font-black text-slate-900 border-2 border-slate-900 px-6 py-1 rounded-lg inline-block bg-slate-50">
              عرض أسعار رسمي (Quotation)
            </h2>
            <p className="mt-1 font-mono text-sm font-bold text-slate-700">#{quote.quotation_number}</p>
          </div>

          <div className="text-left font-mono text-xs">
            <p><span className="text-slate-500">تاريخ الإصدار:</span> <span className="font-bold">{new Date(quote.issue_date).toLocaleDateString('en-GB')}</span></p>
            <p className="mt-1"><span className="text-slate-500">صالح حتى:</span> <span className="font-bold text-rose-700">{quote.valid_until ? new Date(quote.valid_until).toLocaleDateString('en-GB') : '—'}</span></p>
          </div>
        </div>

        {/* Customer Box */}
        <div className="my-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <p><span className="text-slate-500">السادة / </span> <span className="font-bold text-slate-900 text-sm">{quote.customer?.name || 'العميل المحترم'}</span></p>
          {quote.customer?.phone && <p className="mt-1"><span className="text-slate-500">الهاتف:</span> {quote.customer.phone}</p>}
        </div>

        {/* Items Table */}
        <table className="w-full text-right text-xs border border-slate-200">
          <thead>
            <tr className="bg-slate-100 text-slate-800 border-b font-bold">
              <th className="p-2.5 w-12 text-center">#</th>
              <th className="p-2.5">الوصف / اسم الصنف</th>
              <th className="p-2.5 w-24 text-center">الكمية</th>
              <th className="p-2.5 w-28 text-left">السعر الإفرادي</th>
              <th className="p-2.5 w-32 text-left">المجموع</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-800">
            {(quote.items || []).map((item: any, idx: number) => (
              <tr key={item.id}>
                <td className="p-2.5 text-center font-mono text-slate-500">{idx + 1}</td>
                <td className="p-2.5 font-semibold text-slate-900">{item.product_name}</td>
                <td className="p-2.5 text-center font-mono font-bold">{Number(item.quantity).toLocaleString('en-GB')}</td>
                <td className="p-2.5 text-left font-mono">{Number(item.unit_price).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪</td>
                <td className="p-2.5 text-left font-mono font-bold text-slate-900">
                  {Number(item.total_price).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-900 font-bold text-xs">
              <td colSpan={4} className="p-3 text-right">المجموع الكلي لعرض السعر:</td>
              <td className="p-3 text-left font-mono text-sm font-black text-slate-900">
                {Number(quote.total_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Tafqeet in Arabic */}
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs font-bold text-slate-800 border">
          فقط {tafqeet(Number(quote.total_amount), 'ILS')} لا غير.
        </div>

        {/* Terms and Conditions */}
        {quote.terms && (
          <div className="mt-4 rounded-lg border border-slate-200 p-3 text-xs">
            <p className="font-bold text-slate-700 mb-1">الشروط والأحكام:</p>
            <p className="text-slate-600 whitespace-pre-line">{quote.terms}</p>
          </div>
        )}

        {/* Signatures */}
        <div className="mt-14 grid grid-cols-2 gap-12 border-t-2 border-slate-900 pt-6 text-center text-xs font-bold text-slate-800">
          <div>
            <p className="text-slate-500 mb-8">إدارة المبيعات / {store.name}</p>
            <p className="border-t border-dotted border-slate-400 pt-1">الختم والتوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">موافقة واعتماد العميل</p>
            <p className="border-t border-dotted border-slate-400 pt-1">التوقيع والتاريخ</p>
          </div>
        </div>
      </div>
    </div>
  )
}
