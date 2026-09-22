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
  const fmt = (n: number) => Number(n || 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const isCredit = invoice.payment_method === 'credit'
  const isPaid = invoice.status === 'paid' || (Number(invoice.amount_paid || 0) >= Number(invoice.total || 0))
  const remainingBalance = Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0))
  const taxAmount = Number((invoice as any).tax_amount || 0)

  return (
    <div className="min-h-screen bg-slate-200/60 p-4 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white" dir="rtl">
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 12mm 10mm 12mm 10mm;
          }
          body {
            background: white !important;
            color: #0f172a !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print-hidden {
            display: none !important;
          }
          .invoice-box {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
            max-width: 100% !important;
          }
          table {
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
        }
      `}</style>

      {/* ── شريط الأدوات العلوي ── */}
      <div className="mx-auto mb-6 flex max-w-4xl items-center justify-between rounded-2xl bg-slate-900 p-4 text-white shadow-xl print-hidden">
        <Link
          href="/dashboard/accounting/invoices"
          className="text-xs font-bold text-slate-300 hover:text-white transition flex items-center gap-1.5"
        >
          <span>←</span>
          <span>العودة لفواتير المبيعات</span>
        </Link>

        <div className="flex items-center gap-2">
          <PrintButton
            elementId="invoice-official-canvas"
            filename={`invoice-${invoice.invoice_number}.pdf`}
            label="🖨️ طباعة الفاتورة A4 / PDF"
            className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition shadow-sm"
          />
        </div>
      </div>

      {/* ── لوحة الفاتورة الرسمية (Official Paper Canvas) ── */}
      <div
        id="invoice-official-canvas"
        className="invoice-box mx-auto max-w-4xl rounded-2xl border border-slate-300 bg-white p-8 sm:p-10 shadow-sm print:rounded-none"
      >
        {/* الترويسة الرئيسية */}
        <div className="border-b-2 border-slate-900 pb-5">
          <div className="flex items-start justify-between gap-6">
            {/* بيانات الشركة / المتجر */}
            <div className="flex items-start gap-4">
              {store.logo_url ? (
                <img
                  src={store.logo_url}
                  alt={store.name}
                  className="h-20 w-20 object-contain rounded-xl border border-slate-300 p-1 bg-white shrink-0"
                />
              ) : (
                <div className="h-20 w-20 rounded-xl bg-slate-900 text-white flex items-center justify-center text-3xl font-black shrink-0">
                  {store.name?.slice(0, 1) || 'B'}
                </div>
              )}
              <div className="space-y-1">
                <h1 className="text-2xl font-black text-slate-950 tracking-tight">{store.name}</h1>
                <p className="text-xs text-slate-600 leading-normal">{store.address || 'فلسطين'}</p>
                {store.phone && (
                  <p className="text-xs text-slate-700 font-mono" dir="ltr">
                    هاتف: {store.phone}
                  </p>
                )}
                {store.tax_number && (
                  <p className="text-xs font-semibold text-slate-800">
                    الرقم الضريبي / المشتغل المرخص: <span className="font-mono" dir="ltr">{store.tax_number}</span>
                  </p>
                )}
              </div>
            </div>

            {/* عنوان الفاتورة ورقمها */}
            <div className="text-left shrink-0">
              <div className="border-2 border-slate-900 bg-slate-50 px-5 py-2 rounded-xl text-center shadow-sm">
                <h2 className="text-base font-black text-slate-950">
                  {store.tax_number ? 'فاتورة مبيعات ضريبية' : 'فاتورة مبيعات'}
                </h2>
                <p className="text-[11px] text-slate-500 font-sans mt-0.5">TAX SALES INVOICE</p>
              </div>
              <div className="mt-2 text-center">
                <span className="text-[11px] text-slate-500 block">رقم الفاتورة</span>
                <span className="font-mono text-base font-black text-slate-950" dir="ltr">
                  #{invoice.invoice_number}
                </span>
              </div>
            </div>
          </div>

          {/* شريط البيانات الوصفية للفاتورة */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs">
            <div>
              <span className="text-slate-500 block text-[11px]">تاريخ الإصدار:</span>
              <strong className="font-mono text-slate-900">{invoice.issue_date}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">تاريخ الاستحقاق:</span>
              <strong className="font-mono text-slate-900">{invoice.due_date || 'فوري'}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">طريقة السداد:</span>
              <strong className="text-slate-900">{
                invoice.payment_method === 'cash' ? 'نقداً (Cash)' :
                invoice.payment_method === 'credit' ? 'على الحساب (Credit)' :
                invoice.payment_method === 'check' ? 'شيك بنكي' :
                invoice.payment_method === 'bank' ? 'تحويل بنكي' :
                invoice.payment_method === 'card' ? 'بطاقة دفع' : (invoice.payment_method || 'نقداً')
              }</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">حالة الفاتورة:</span>
              <strong className={isPaid ? 'text-emerald-700' : isCredit ? 'text-amber-700' : 'text-slate-800'}>
                {isPaid ? '✓ مسددة بالكامل' : remainingBalance < Number(invoice.total) ? 'مسددة جزئياً' : 'غير مسددة (آجلة)'}
              </strong>
            </div>
          </div>
        </div>

        {/* بيانات العميل / المشتري */}
        <div className="my-4 rounded-xl border border-slate-300 bg-slate-50/60 p-3.5 text-xs">
          <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-2">
            <span className="font-black text-slate-900 text-xs uppercase tracking-wide">بيانات العميل / Customer Details</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <span className="text-slate-500 block text-[11px]">اسم العميل / المؤسسة:</span>
              <strong className="text-slate-950 text-sm">{invoice.customer_name || 'عميل عام / زبون نقدي'}</strong>
            </div>
            {invoice.customer_phone && (
              <div>
                <span className="text-slate-500 block text-[11px]">رقم الهاتف:</span>
                <strong className="font-mono text-slate-900" dir="ltr">{invoice.customer_phone}</strong>
              </div>
            )}
            {invoice.customer_address && (
              <div>
                <span className="text-slate-500 block text-[11px]">العنوان / مكان التسليم:</span>
                <span className="text-slate-800">{invoice.customer_address}</span>
              </div>
            )}
          </div>
        </div>

        {/* جدول البنود والأصناف */}
        <div className="overflow-x-auto my-4">
          <table className="w-full text-right text-xs border border-slate-300" style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr className="bg-slate-900 text-white border-b-2 border-slate-900">
                <th className="p-2.5 text-center w-10 border-l border-slate-700">#</th>
                <th className="p-2.5 border-l border-slate-700">بيان الصنف / تفاصيل المنتج</th>
                <th className="p-2.5 text-center w-28 border-l border-slate-700">الباركود / SKU</th>
                <th className="p-2.5 text-center w-20 border-l border-slate-700">الكمية</th>
                <th className="p-2.5 text-left w-28 border-l border-slate-700">سعر الوحدة</th>
                <th className="p-2.5 text-left w-28">الإجمالي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-900">
              {(items || []).map((item: any, idx: number) => (
                <tr key={item.id || idx} className={idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                  <td className="p-2.5 text-center font-mono text-slate-500 border-l border-slate-200">{idx + 1}</td>
                  <td className="p-2.5 font-bold text-slate-950 border-l border-slate-200">{item.name}</td>
                  <td className="p-2.5 text-center font-mono text-slate-600 border-l border-slate-200" dir="ltr">
                    {item.sku || '—'}
                  </td>
                  <td className="p-2.5 text-center font-mono font-bold text-slate-950 border-l border-slate-200" dir="ltr">
                    {item.quantity}
                  </td>
                  <td className="p-2.5 text-left font-mono text-slate-900 border-l border-slate-200" dir="ltr">
                    {fmt(item.unit_price)} {currency}
                  </td>
                  <td className="p-2.5 text-left font-mono font-black text-slate-950" dir="ltr">
                    {fmt(item.total)} {currency}
                  </td>
                </tr>
              ))}
              {(!items || items.length === 0) && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400">
                    لا توجد بنود مسجلة في الفاتورة
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ملخص الإجماليات والتفقيط */}
        <div className="mt-4 flex flex-col sm:flex-row justify-between items-start gap-4">
          {/* التفقيط والملاحظات */}
          <div className="flex-1 rounded-xl border border-slate-300 bg-slate-50 p-4 text-xs space-y-3 w-full sm:w-auto">
            <div>
              <span className="font-bold text-slate-700 block mb-1">المبلغ الإجمالي كتابة بالحروف (Tafqeet):</span>
              <p className="font-black text-slate-950 leading-relaxed text-sm bg-white p-2.5 rounded-lg border border-slate-200">
                {tafqeetText}
              </p>
            </div>
            {invoice.notes && (
              <div className="pt-2 border-t border-slate-200 text-slate-700">
                <span className="font-bold text-slate-900 block mb-0.5">شروط وملاحظات:</span>
                <p className="leading-normal">{invoice.notes}</p>
              </div>
            )}
          </div>

          {/* الجدول المالي للإجماليات */}
          <div className="w-full sm:w-80 rounded-xl border-2 border-slate-300 bg-slate-50 p-3.5 text-xs space-y-2 shrink-0">
            <div className="flex justify-between text-slate-700">
              <span>المجموع الفرعي:</span>
              <span className="font-mono font-bold text-slate-950" dir="ltr">
                {fmt(invoice.subtotal)} {currency}
              </span>
            </div>

            {Number(invoice.discount_amount) > 0 && (
              <div className="flex justify-between text-rose-700 font-semibold">
                <span>
                  الخصم التجاري الممنوح {invoice.discount_type === 'percent' || invoice.discount_type === 'percentage' ? `(%${invoice.discount_value})` : ''}:
                </span>
                <span className="font-mono font-bold" dir="ltr">
                  - {fmt(invoice.discount_amount)} {currency}
                </span>
              </div>
            )}

            {taxAmount > 0 && (
              <div className="flex justify-between text-slate-700 font-semibold">
                <span>ضريبة القيمة المضافة (VAT):</span>
                <span className="font-mono font-bold" dir="ltr">
                  + {fmt(taxAmount)} {currency}
                </span>
              </div>
            )}

            <div className="flex justify-between border-t-2 border-slate-900 pt-2 text-sm font-black text-slate-950 bg-white p-2 rounded-lg border border-slate-200">
              <span>صافي الفاتورة الإجمالي:</span>
              <span className="font-mono text-base font-black text-slate-950" dir="ltr">
                {fmt(invoice.total)} {currency}
              </span>
            </div>

            {Number(invoice.amount_paid) > 0 && (
              <div className="flex justify-between text-emerald-700 font-bold border-t border-slate-200 pt-1.5">
                <span>المبلغ المسدد / المدفوع:</span>
                <span className="font-mono" dir="ltr">
                  {fmt(invoice.amount_paid)} {currency}
                </span>
              </div>
            )}

            {remainingBalance > 0 && (
              <div className="flex justify-between text-amber-800 font-black border-t border-slate-300 pt-1.5">
                <span>الرصيد المتبقي على الفاتورة:</span>
                <span className="font-mono text-sm" dir="ltr">
                  {fmt(remainingBalance)} {currency}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* التواقيع الرسمية الثلاثية */}
        <div className="mt-10 pt-6 border-t-2 border-slate-900 grid grid-cols-3 gap-6 text-center text-xs font-bold text-slate-800">
          <div>
            <p className="text-slate-600 mb-8">منظم الفاتورة / المحاسب</p>
            <div className="border-t border-dashed border-slate-400 pt-1 text-[11px] text-slate-500">
              التوقيع والختم
            </div>
          </div>
          <div>
            <p className="text-slate-600 mb-8">أمين المستودع / التسليم</p>
            <div className="border-t border-dashed border-slate-400 pt-1 text-[11px] text-slate-500">
              التوقيع والتاريخ
            </div>
          </div>
          <div>
            <p className="text-slate-600 mb-8">استلام الزبون (البضاعة بحالة سليمة)</p>
            <div className="border-t border-dashed border-slate-400 pt-1 text-[11px] text-slate-500">
              الاسم الكامل والتوقيع
            </div>
          </div>
        </div>

        {/* تذييل الفاتورة الرسمي */}
        <div className="mt-8 text-center text-[10px] text-slate-500 border-t border-slate-200 pt-3 font-sans">
          فاتورة إلكترونية صادرة عن نظام <strong>Bazarko ERP</strong> لإدارة الأعمال والتجارة • شكراً لثقتكم وتفضلكم بالتعامل معنا
        </div>
      </div>
    </div>
  )
}

