import PrintButton from "@/components/dashboard/PrintButton"
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { tafqeetCheque } from '@/lib/tafqeet'

export const metadata = {
  title: 'طباعة عرض أسعار — Bazarko ERP',
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

  const currency = store.currency_code || 'ILS'
  const currencySymbol = currency === 'ILS' ? '₪' : currency === 'USD' ? '$' : currency === 'JOD' ? 'د.أ' : currency
  const tafqeetText = tafqeetCheque(Number(quote.total_amount), currency)

  const subtotal = (quote.items || []).reduce((acc: number, item: any) => acc + Number(item.total_price || (item.quantity * item.unit_price)), 0)
  const discount = Number(quote.discount_amount || 0)
  const total = Number(quote.total_amount || (subtotal - discount))

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white" dir="rtl">
      {/* ── Top Toolbar ── */}
      <div className="mx-auto mb-6 flex max-w-4xl items-center justify-between rounded-xl bg-slate-900 p-4 text-white shadow-lg print:hidden">
        <Link
          href="/dashboard/quotations"
          className="text-xs font-bold text-slate-300 hover:text-white transition"
        >
          ← العودة لعروض الأسعار
        </Link>
        <PrintButton label="🖨️ طباعة عرض السعر (Print / PDF)" className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition" />
      </div>

      {/* ── Official Paper Canvas ── */}
      <div className="mx-auto max-w-4xl rounded-2xl border border-slate-300 bg-white p-8 shadow-sm print:border-none print:shadow-none print:p-4">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-5">
          <div>
            <h1 className="text-2xl font-black text-slate-950">{store.name}</h1>
            <p className="text-xs text-slate-600 mt-0.5">{store.address || 'فلسطين'}</p>
            {store.phone && <p className="text-xs text-slate-600">هاتف: {store.phone}</p>}
            {store.tax_number && <p className="text-xs text-slate-600">الرقم الضريبي / المشتغل: {store.tax_number}</p>}
            {store.email && <p className="text-xs text-slate-600">بريد: {store.email}</p>}
          </div>

          <div className="text-center">
            <h2 className="text-xl font-black text-slate-900 border-2 border-slate-900 px-6 py-1.5 rounded-xl inline-block bg-slate-50 shadow-sm">
              عرض أسعار رسمي (Quotation)
            </h2>
            <p className="mt-1 font-mono text-sm font-bold text-sky-900" dir="ltr">
              No: {quote.quotation_number}
            </p>
          </div>

          <div className="text-left text-xs space-y-1 font-mono">
            <div>تاريخ الإصدار: <strong className="text-slate-900">{new Date(quote.issue_date).toLocaleDateString('en-GB')}</strong></div>
            <div>صالح لغاية: <strong className="text-slate-900">{quote.valid_until ? new Date(quote.valid_until).toLocaleDateString('en-GB') : '30 يوماً من تاريخه'}</strong></div>
            <div>حالة العرض: <strong className={quote.status === 'accepted' ? 'text-emerald-700' : 'text-slate-900'}>{
              quote.status === 'accepted' ? 'معتمد ومقبول (Accepted)' :
              quote.status === 'sent' ? 'تم الإرسال للعميل' :
              quote.status === 'rejected' ? 'مرفوض' : 'مسودة رسمية (Draft)'
            }</strong></div>
          </div>
        </div>

        {/* Customer Information Box */}
        <div className="my-5 grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
          <div>
            <span className="text-slate-500 block mb-0.5">السادة / العميل المحترم:</span>
            <strong className="text-slate-900 text-sm">{quote.customer?.name || 'العميل المحترم'}</strong>
          </div>
          <div>
            <span className="text-slate-500 block mb-0.5">رقم الهاتف:</span>
            <strong className="font-mono text-slate-900" dir="ltr">{quote.customer?.phone || '—'}</strong>
          </div>
          <div>
            <span className="text-slate-500 block mb-0.5">العنوان / المدينة:</span>
            <span className="text-slate-800">{quote.customer?.address || '—'}</span>
          </div>
        </div>

        {/* Items Table */}
        <table className="w-full text-right text-xs border border-slate-200">
          <thead>
            <tr className="bg-slate-900 text-white border-b">
              <th className="p-2.5 text-center w-10">#</th>
              <th className="p-2.5">بيان الصنف / المواصفات الفنية</th>
              <th className="p-2.5 text-center">الكمية</th>
              <th className="p-2.5 text-left">سعر الوحدة</th>
              <th className="p-2.5 text-left">الإجمالي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-800">
            {(quote.items || []).map((item: any, idx: number) => (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="p-2.5 text-center font-mono text-slate-500">{idx + 1}</td>
                <td className="p-2.5 font-bold text-slate-950">{item.product_name}</td>
                <td className="p-2.5 text-center font-mono font-bold text-slate-900" dir="ltr">{Number(item.quantity).toLocaleString('en-GB')}</td>
                <td className="p-2.5 text-left font-mono text-slate-900" dir="ltr">
                  {Number(item.unit_price).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {currencySymbol}
                </td>
                <td className="p-2.5 text-left font-mono font-bold text-slate-950" dir="ltr">
                  {Number(item.total_price || (item.quantity * item.unit_price)).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {currencySymbol}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals and Tafqeet */}
        <div className="mt-4 flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-2 w-full sm:w-auto">
            <span className="font-bold text-slate-900 block">المبلغ الإجمالي كتابة بالحروف:</span>
            <p className="font-bold text-slate-800 leading-relaxed text-sm">{tafqeetText}</p>
            {quote.notes && (
              <div className="pt-2 border-t border-slate-200 text-slate-600">
                <span className="font-semibold text-slate-700">ملاحظات:</span> {quote.notes}
              </div>
            )}
            {quote.terms && (
              <div className="pt-2 border-t border-slate-200 text-slate-600 whitespace-pre-line">
                <span className="font-semibold text-slate-700">شروط وأحكام العرض:</span> {quote.terms}
              </div>
            )}
          </div>

          <div className="w-full sm:w-72 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-2">
            <div className="flex justify-between text-slate-600">
              <span>المجموع الفرعي:</span>
              <span className="font-mono font-bold text-slate-900" dir="ltr">
                {subtotal.toLocaleString('en-GB', { minimumFractionDigits: 2 })} {currencySymbol}
              </span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-rose-600">
                <span>الخصم الممنوح:</span>
                <span className="font-mono font-bold" dir="ltr">
                  - {discount.toLocaleString('en-GB', { minimumFractionDigits: 2 })} {currencySymbol}
                </span>
              </div>
            )}
            <div className="flex justify-between border-t-2 border-slate-300 pt-2 text-sm font-black text-slate-950">
              <span>صافي عرض السعر:</span>
              <span className="font-mono text-base text-sky-900" dir="ltr">
                {total.toLocaleString('en-GB', { minimumFractionDigits: 2 })} {currencySymbol}
              </span>
            </div>
          </div>
        </div>

        {/* Signatures */}
        <div className="mt-14 pt-6 border-t-2 border-slate-900 grid grid-cols-3 gap-6 text-center text-xs font-bold text-slate-800">
          <div>
            <p className="text-slate-500 mb-10">منظم عرض السعر / المبيعات</p>
            <p className="border-t border-dashed border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-10">المدير المالي / الاعتماد</p>
            <p className="border-t border-dashed border-slate-400 pt-1">الختم والتوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-10">موافقة واعتماد العميل</p>
            <p className="border-t border-dashed border-slate-400 pt-1">الاسم والتوقيع والتاريخ</p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-[10px] text-slate-400 border-t border-slate-100 pt-3">
          شكراً لاهتمامكم • هذا المستند صادر رسمياً عبر نظام بازاركو لإدارة الأعمال والتجارة
        </div>
      </div>
    </div>
  )
}
