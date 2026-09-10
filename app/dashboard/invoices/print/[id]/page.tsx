import PrintButton from "@/components/dashboard/PrintButton"
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { tafqeetCheque } from '@/lib/tafqeet'

export const metadata = {
  title: 'طباعة فاتورة مبيعات — Bazarko ERP',
}

export default async function PrintInvoicePage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: invoice },
    { data: items }
  ] = await Promise.all([
    supabase.from('stores').select('*').eq('id', storeId).single(),
    supabase.from('invoices').select('*').eq('id', params.id).eq('store_id', storeId).single(),
    supabase.from('invoice_items').select('*').eq('invoice_id', params.id).order('id')
  ])

  if (!store || !invoice) notFound()

  const currency = store.currency_code || 'ILS'
  const tafqeetText = tafqeetCheque(invoice.total, currency)

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white" dir="rtl">
      {/* ── Top Toolbar ── */}
      <div className="mx-auto mb-6 flex max-w-4xl items-center justify-between rounded-xl bg-slate-900 p-4 text-white shadow-lg print:hidden">
        <Link
          href="/dashboard/accounting/invoices"
          className="text-xs font-bold text-slate-300 hover:text-white transition"
        >
          ← العودة لفواتير المبيعات
        </Link>
        <PrintButton label="🖨️ طباعة الفاتورة (Print / PDF)" className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition" />
      </div>

      {/* ── Official Paper Canvas ── */}
      <div className="mx-auto max-w-4xl rounded-2xl border border-slate-300 bg-white p-8 shadow-sm print:border-none print:shadow-none print:p-4">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-5">
          <div>
            <h1 className="text-2xl font-black text-slate-950">{store.name}</h1>
            <p className="text-xs text-slate-600 mt-0.5">{store.address || 'فلسطين'}</p>
            {store.phone && <p className="text-xs text-slate-600">هاتف: {store.phone}</p>}
          </div>

          <div className="text-center">
            <h2 className="text-xl font-black text-slate-900 border-2 border-slate-900 px-6 py-1.5 rounded-xl inline-block bg-slate-50">
              فاتورة مبيعات ضريبية
            </h2>
            <p className="mt-1 font-mono text-sm font-bold text-sky-900" dir="ltr">
              No: {invoice.invoice_number}
            </p>
          </div>

          <div className="text-left text-xs space-y-1 font-mono">
            <div>تاريخ الإصدار: <strong className="text-slate-900">{new Date(invoice.issue_date).toLocaleDateString('en-GB')}</strong></div>
            {invoice.due_date && (
              <div>تاريخ الاستحقاق: <strong className="text-slate-900">{new Date(invoice.due_date).toLocaleDateString('en-GB')}</strong></div>
            )}
            <div>الحالة: <strong className="text-slate-900">{invoice.status === 'paid' ? 'مدفوعة بالكامل' : invoice.status === 'partial' ? 'مدفوعة جزئياً' : 'آجلة / مستحقة'}</strong></div>
          </div>
        </div>

        {/* Customer Information Box */}
        <div className="my-5 grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
          <div>
            <span className="text-slate-500 block mb-0.5">اسم العميل / الزبون:</span>
            <strong className="text-slate-900 text-sm">{invoice.customer_name || 'عميل نقدي عام'}</strong>
          </div>
          {invoice.customer_phone && (
            <div>
              <span className="text-slate-500 block mb-0.5">رقم الهاتف:</span>
              <strong className="font-mono text-slate-900" dir="ltr">{invoice.customer_phone}</strong>
            </div>
          )}
          {invoice.customer_address && (
            <div>
              <span className="text-slate-500 block mb-0.5">العنوان والتوصيل:</span>
              <span className="text-slate-800">{invoice.customer_address}</span>
            </div>
          )}
        </div>

        {/* Items Table */}
        <table className="w-full text-right text-xs border border-slate-200">
          <thead>
            <tr className="bg-slate-900 text-white border-b">
              <th className="p-2.5 text-center w-10">#</th>
              <th className="p-2.5">بيان الصنف / المنتج</th>
              <th className="p-2.5 text-center">الباركود / SKU</th>
              <th className="p-2.5 text-center">الكمية</th>
              <th className="p-2.5 text-left">سعر الوحدة</th>
              <th className="p-2.5 text-left">الإجمالي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-800">
            {(items || []).map((item: any, idx: number) => (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="p-2.5 text-center font-mono text-slate-500">{idx + 1}</td>
                <td className="p-2.5 font-bold text-slate-950">{item.name}</td>
                <td className="p-2.5 text-center font-mono text-slate-600" dir="ltr">{item.sku || '—'}</td>
                <td className="p-2.5 text-center font-mono font-bold text-slate-900" dir="ltr">{item.quantity}</td>
                <td className="p-2.5 text-left font-mono text-slate-900" dir="ltr">
                  {Number(item.unit_price).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
                </td>
                <td className="p-2.5 text-left font-mono font-bold text-slate-950" dir="ltr">
                  {Number(item.total).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
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
            {invoice.notes && (
              <div className="pt-2 border-t border-slate-200 text-slate-600">
                <span className="font-semibold text-slate-700">ملاحظات:</span> {invoice.notes}
              </div>
            )}
          </div>

          <div className="w-full sm:w-72 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-2">
            <div className="flex justify-between text-slate-600">
              <span>المجموع الفرعي:</span>
              <span className="font-mono font-bold text-slate-900" dir="ltr">
                {Number(invoice.subtotal).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
              </span>
            </div>
            {Number(invoice.discount_amount) > 0 && (
              <div className="flex justify-between text-rose-600">
                <span>الخصم الممنوح:</span>
                <span className="font-mono font-bold" dir="ltr">
                  - {Number(invoice.discount_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
                </span>
              </div>
            )}
            <div className="flex justify-between border-t-2 border-slate-300 pt-2 text-sm font-black text-slate-950">
              <span>صافي الفاتورة:</span>
              <span className="font-mono text-base text-sky-900" dir="ltr">
                {Number(invoice.total).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
              </span>
            </div>
            {Number(invoice.amount_paid) > 0 && (
              <>
                <div className="flex justify-between text-emerald-700">
                  <span>المدفوع:</span>
                  <span className="font-mono font-bold" dir="ltr">
                    {Number(invoice.amount_paid).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
                  </span>
                </div>
                {Number(invoice.total) - Number(invoice.amount_paid) > 0 && (
                  <div className="flex justify-between text-amber-700 font-bold">
                    <span>المتبقي:</span>
                    <span className="font-mono" dir="ltr">
                      {(Number(invoice.total) - Number(invoice.amount_paid)).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Signatures */}
        <div className="mt-14 pt-6 border-t-2 border-slate-900 grid grid-cols-3 gap-6 text-center text-xs font-bold text-slate-800">
          <div>
            <p className="text-slate-500 mb-10">منظم الفاتورة</p>
            <p className="border-t border-dashed border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-10">أمين المستودع / التسليم</p>
            <p className="border-t border-dashed border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-10">استلام الزبون (البضاعة بحالة ممتازة)</p>
            <p className="border-t border-dashed border-slate-400 pt-1">الاسم والتوقيع</p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-[10px] text-slate-400 border-t border-slate-100 pt-3">
          شكراً لتعاملكم معنا • نظام بازاركو الفلسطيني لإدارة الأعمال والتجارة الإلكترونية
        </div>
      </div>
    </div>
  )
}
