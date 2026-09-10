import PrintButton from "@/components/dashboard/PrintButton"
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { tafqeet } from '@/lib/tafqeet'

export const metadata = {
  title: 'طباعة سند مردودات مشتريات — Bazarko ERP',
}

export default async function PrintPurchaseReturnPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: returnDoc }
  ] = await Promise.all([
    supabase.from('stores').select('*').eq('id', storeId).single(),
    supabase
      .from('purchase_returns')
      .select('*, supplier:suppliers(id, name, phone, address), items:purchase_return_items(*)')
      .eq('id', params.id)
      .eq('store_id', storeId)
      .single()
  ])

  if (!store || !returnDoc) notFound()

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white">
      {/* ── Toolbar ── */}
      <div className="mx-auto mb-6 flex max-w-4xl items-center justify-between rounded-xl bg-slate-900 p-4 text-white shadow-lg print:hidden">
        <Link
          href="/dashboard/purchases/returns"
          className="text-xs font-bold text-slate-300 hover:text-white transition"
        >
          ← العودة لمردودات المشتريات
        </Link>
        <PrintButton label="🖨️ طباعة السند (PDF)" className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition" />
      </div>

      {/* ── Paper Document ── */}
      <div className="mx-auto max-w-4xl rounded-xl border border-slate-300 bg-white p-8 shadow-sm print:border-none print:shadow-none print:p-4">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">{store.name}</h1>
            <p className="text-xs text-slate-600 mt-0.5">{store.address || 'فلسطين'}</p>
            {store.phone && <p className="text-xs text-slate-600">هاتف: {store.phone}</p>}
            {store.tax_number && <p className="text-xs text-slate-600">الرقم الضريبي: {store.tax_number}</p>}
          </div>

          <div className="text-center">
            <h2 className="text-lg font-black text-slate-900 border-2 border-slate-900 px-6 py-1 rounded-lg inline-block bg-slate-50">
              سند مردودات مشتريات (إرجاع لمورد)
            </h2>
            <p className="mt-1 font-mono text-sm font-bold text-slate-700">#{returnDoc.return_number}</p>
          </div>

          <div className="text-left font-mono text-xs">
            <p><span className="text-slate-500">التاريخ:</span> <span className="font-bold">{new Date(returnDoc.return_date).toLocaleDateString('en-GB')}</span></p>
            <p className="mt-1"><span className="text-slate-500">طريقة التسوية:</span> {returnDoc.refund_method === 'credit' ? 'خصم من رصيد المورد' : 'نقدي'}</p>
          </div>
        </div>

        {/* Supplier & Reason Info */}
        <div className="my-4 grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <div>
            <p><span className="text-slate-500">اسم المورد:</span> <span className="font-bold text-slate-900">{returnDoc.supplier?.name || 'مورد عام'}</span></p>
            {returnDoc.supplier?.phone && <p className="mt-1"><span className="text-slate-500">الهاتف:</span> {returnDoc.supplier.phone}</p>}
          </div>
          <div>
            <p><span className="text-slate-500">سبب الإرجاع:</span> <span className="font-semibold text-slate-900">{returnDoc.reason || '—'}</span></p>
            {returnDoc.notes && <p className="mt-1"><span className="text-slate-500">ملاحظات:</span> {returnDoc.notes}</p>}
          </div>
        </div>

        {/* Items Table */}
        <table className="w-full text-right text-xs border border-slate-200">
          <thead>
            <tr className="bg-slate-100 text-slate-800 border-b font-bold">
              <th className="p-2.5 w-12 text-center">#</th>
              <th className="p-2.5">اسم الصنف المرجع للمورد</th>
              <th className="p-2.5 w-24 text-center">الكمية</th>
              <th className="p-2.5 w-28 text-left">سعر التكلفة</th>
              <th className="p-2.5 w-32 text-left">الإجمالي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-800">
            {(returnDoc.items || []).map((item: any, idx: number) => (
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
              <td colSpan={4} className="p-3 text-right">الإجمالي الكلي لمردود الشراء:</td>
              <td className="p-3 text-left font-mono text-sm font-black text-slate-900">
                {Number(returnDoc.total_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Tafqeet in Arabic */}
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs font-bold text-slate-800 border">
          فقط {tafqeet(Number(returnDoc.total_amount), 'ILS')} لا غير.
        </div>

        {/* Signatures */}
        <div className="mt-14 grid grid-cols-3 gap-6 border-t-2 border-slate-900 pt-6 text-center text-xs font-bold text-slate-800">
          <div>
            <p className="text-slate-500 mb-8">أمين المستودع / المخرج</p>
            <p className="border-t border-dotted border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">المحاسب المالي</p>
            <p className="border-t border-dotted border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">المورد / المستلم</p>
            <p className="border-t border-dotted border-slate-400 pt-1">التوقيع والختم</p>
          </div>
        </div>
      </div>
    </div>
  )
}
