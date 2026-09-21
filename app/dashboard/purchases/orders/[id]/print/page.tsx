import PrintButton from "@/components/dashboard/PrintButton"
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { tafqeetCheque } from '@/lib/tafqeet'

export const metadata = {
  title: 'طباعة أمر شراء — Bazarko ERP',
}

export default async function PrintPurchaseOrderPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: po },
    { data: items }
  ] = await Promise.all([
    supabase.from('stores').select('*').eq('id', storeId).single(),
    supabase.from('purchase_orders').select('*, supplier:suppliers(*)').eq('id', params.id).eq('store_id', storeId).single(),
    supabase.from('purchase_order_items').select('*').eq('purchase_order_id', params.id).order('id')
  ])

  if (!store || !po) notFound()

  const currency = store.currency_code || 'ILS'
  const tafqeetText = tafqeetCheque(po.total, currency)
  const fmt = (n: number) => Number(n || 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white" dir="rtl">
      {/* ── شريط الأدوات العلوي ── */}
      <div className="mx-auto mb-6 flex max-w-4xl items-center justify-between rounded-2xl bg-slate-900 p-4 text-white shadow-xl print:hidden">
        <Link
          href="/dashboard/purchases/orders"
          className="text-xs font-bold text-slate-300 hover:text-white transition flex items-center gap-1.5"
        >
          <span>←</span>
          <span>العودة لقائمة أوامر الشراء</span>
        </Link>
        <PrintButton
          label="🖨️ طباعة أمر الشراء (PDF)"
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
              أمر شراء رسمي (Purchase Order)
            </h2>
            <p className="mt-1 font-mono text-sm font-black text-sky-900" dir="ltr">
              No: {po.order_number}
            </p>
          </div>

          <div className="text-left text-xs space-y-1 font-sans">
            <div>تاريخ الطلب: <strong className="font-mono text-slate-900">{po.issue_date}</strong></div>
            {po.expected_date && (
              <div>تاريخ التسليم المطلوب: <strong className="font-mono text-slate-900">{po.expected_date}</strong></div>
            )}
            <div>حالة الأمر: <strong className="text-indigo-900">{
              po.status === 'draft' ? 'مسودة' :
              po.status === 'sent' ? 'مرسل للتوريد' :
              po.status === 'confirmed' ? 'مؤكد' :
              po.status === 'received' ? 'مستلم ومحول لفاتورة' : 'ملغي'
            }</strong></div>
          </div>
        </div>

        {/* بيانات المورد والوجهة */}
        <div className="my-5 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
          <div>
            <span className="text-slate-500 block mb-0.5">المورد الموجه له الأمر:</span>
            <strong className="text-slate-950 text-sm">{po.supplier?.name || 'مورد عام'}</strong>
            {po.supplier?.phone && (
              <p className="text-slate-600 font-mono text-xs mt-0.5" dir="ltr">هاتف: {po.supplier.phone}</p>
            )}
          </div>
          <div>
            <span className="text-slate-500 block mb-0.5">مكان وموقع الاستلام:</span>
            <span className="text-slate-900 font-bold">{store.address || 'مستودع المتجر الرئيسي'}</span>
            <p className="text-slate-500 text-[11px] mt-0.5">يرجى إرفاق أمر الشراء هذا مع إرسالية البضاعة</p>
          </div>
        </div>

        {/* جدول بنود أمر الشراء */}
        <table className="w-full text-right text-xs border border-slate-200">
          <thead>
            <tr className="bg-slate-900 text-white border-b">
              <th className="p-2.5 text-center w-10">#</th>
              <th className="p-2.5">بيان الصنف المطلوب</th>
              <th className="p-2.5 text-center">الباركود / SKU</th>
              <th className="p-2.5 text-center">الكمية المطلوبة</th>
              <th className="p-2.5 text-left">سعر التكلفة المتفق عليه</th>
              <th className="p-2.5 text-left">الإجمالي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-800">
            {(items || []).map((item: any, idx: number) => (
              <tr key={item.id || idx} className="hover:bg-slate-50">
                <td className="p-2.5 text-center font-mono text-slate-500">{idx + 1}</td>
                <td className="p-2.5 font-bold text-slate-950">{item.item_name}</td>
                <td className="p-2.5 text-center font-mono text-slate-600" dir="ltr">{item.item_sku || '—'}</td>
                <td className="p-2.5 text-center font-mono font-bold text-slate-900" dir="ltr">{item.quantity}</td>
                <td className="p-2.5 text-left font-mono text-slate-900" dir="ltr">
                  {fmt(item.unit_price)} {currency}
                </td>
                <td className="p-2.5 text-left font-mono font-bold text-slate-950" dir="ltr">
                  {fmt(item.total)} {currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ملخص الإجماليات والتفقيط */}
        <div className="mt-4 flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-2 w-full sm:w-auto">
            <span className="font-bold text-slate-900 block">إجمالي أمر الشراء بالحروف:</span>
            <p className="font-bold text-slate-800 leading-relaxed text-sm">{tafqeetText}</p>
            {po.notes && (
              <div className="pt-2 border-t border-slate-200 text-slate-600">
                <span className="font-semibold text-slate-700">شروط وملاحظات التوريد:</span> {po.notes}
              </div>
            )}
          </div>

          <div className="w-full sm:w-72 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-2">
            <div className="flex justify-between text-slate-600">
              <span>المجموع الفرعي:</span>
              <span className="font-mono font-bold text-slate-900" dir="ltr">
                {fmt(po.subtotal)} {currency}
              </span>
            </div>

            {Number(po.discount_amount) > 0 && (
              <div className="flex justify-between text-rose-600">
                <span>الخصم المتفق عليه:</span>
                <span className="font-mono font-bold" dir="ltr">
                  - {fmt(po.discount_amount)} {currency}
                </span>
              </div>
            )}

            <div className="flex justify-between border-t-2 border-slate-300 pt-2 text-sm font-black text-slate-950">
              <span>صافي قيمة أمر الشراء:</span>
              <span className="font-mono text-base text-indigo-900" dir="ltr">
                {fmt(po.total)} {currency}
              </span>
            </div>
          </div>
        </div>

        {/* التواقيع الرسمية */}
        <div className="mt-14 pt-6 border-t-2 border-slate-900 grid grid-cols-2 gap-8 text-center text-xs font-bold text-slate-800">
          <div>
            <p className="text-slate-500 mb-8">مسؤول المشتريات / اعتماد الطلب</p>
            <p className="border-t border-dashed border-slate-400 pt-1">التوقيع والختم</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">تأكيد وقبول المورد للتوريد</p>
            <p className="border-t border-dashed border-slate-400 pt-1">توقيع المورد وتاريخ الاستلام</p>
          </div>
        </div>

        <div className="mt-8 text-center text-[10px] text-slate-400 border-t border-slate-100 pt-3 font-mono">
          أمر شراء معتمد صادر من نظام بازاركو • Bazarko ERP
        </div>
      </div>
    </div>
  )
}
