import PrintButton from "@/components/dashboard/PrintButton"
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'طباعة كشف حركات صنف — Bazarko ERP',
}

interface SearchParams {
  product_id?: string
  from?: string
  to?: string
  type?: string
}

const TYPE_LABELS: Record<string, string> = {
  sale: 'فاتورة مبيعات',
  purchase: 'فاتورة مشتريات',
  sales_return: 'مرتجع مبيعات',
  purchase_return: 'مردود مشتريات',
  adjustment_in: 'تسوية جردية (زيادة)',
  adjustment_out: 'تسوية جردية (نقص)',
  transfer_in: 'تحويل وارد',
  transfer_out: 'تحويل صادر',
  damage: 'تالف وهالك',
  initial: 'رصيد افتتاحي',
}

export default async function PrintItemStatementPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [{ data: store }, { data: product }] = await Promise.all([
    supabase.from('stores').select('*').eq('id', storeId).single(),
    supabase.from('products').select('*').eq('id', searchParams.product_id || '').eq('store_id', storeId).single()
  ])

  if (!store || !product) notFound()

  let query = supabase
    .from('inventory_movements')
    .select('*')
    .eq('product_id', product.id)
    .eq('store_id', storeId)
    .order('movement_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (searchParams.from) query = query.gte('movement_date', searchParams.from)
  if (searchParams.to) query = query.lte('movement_date', searchParams.to)
  if (searchParams.type) query = query.eq('movement_type', searchParams.type)

  const { data: movements } = await query
  const mList = movements || []

  const totalIn = mList.reduce((sum, m) => sum + Number(m.quantity_in || 0), 0)
  const totalOut = mList.reduce((sum, m) => sum + Number(m.quantity_out || 0), 0)

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white">
      {/* ── Toolbar ── */}
      <div className="mx-auto mb-6 flex max-w-4xl items-center justify-between rounded-xl bg-slate-900 p-4 text-white shadow-lg print:hidden">
        <Link
          href={`/dashboard/inventory/statement?product_id=${product.id}`}
          className="text-xs font-bold text-slate-300 hover:text-white transition"
        >
          ← العودة لكشف الحركات
        </Link>
        <PrintButton label="🖨️ طباعة الكشف (PDF)" className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition" />
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
              كشف حركات صنف رسمي
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              تاريخ التقرير: {new Date().toLocaleDateString('en-GB')}
            </p>
          </div>

          <div className="text-left font-mono text-xs">
            <p><span className="text-slate-500">رمز الصنف (SKU):</span> <span className="font-bold">{product.sku || '—'}</span></p>
            <p className="mt-1"><span className="text-slate-500">الباركود:</span> {product.barcode || '—'}</p>
            <p className="mt-1"><span className="text-slate-500">الرصيد الحالي:</span> <span className="font-bold text-slate-900">{Number(product.stock_quantity).toLocaleString('en-GB')}</span></p>
          </div>
        </div>

        {/* Product Details Box */}
        <div className="my-4 grid grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <div>
            <span className="text-slate-500">اسم الصنف:</span>{' '}
            <span className="font-bold text-slate-900 text-sm">{product.name}</span>
          </div>
          <div>
            <span className="text-slate-500">إجمالي الوارد (+):</span>{' '}
            <span className="font-mono font-bold text-emerald-800">{totalIn.toLocaleString('en-GB')}</span>
          </div>
          <div>
            <span className="text-slate-500">إجمالي الصادر (-):</span>{' '}
            <span className="font-mono font-bold text-rose-800">{totalOut.toLocaleString('en-GB')}</span>
          </div>
        </div>

        {/* Statement Table */}
        <table className="w-full text-right text-xs border border-slate-200">
          <thead>
            <tr className="bg-slate-100 text-slate-800 border-b font-bold">
              <th className="p-2">التاريخ</th>
              <th className="p-2">نوع الحركة</th>
              <th className="p-2">رقم المستند</th>
              <th className="p-2">الجهة / العميل / المورد</th>
              <th className="p-2 text-center text-emerald-800">وارد (+)</th>
              <th className="p-2 text-center text-rose-800">صادر (-)</th>
              <th className="p-2 text-center font-black">الرصيد بعد الحركة</th>
              <th className="p-2 text-left">السعر</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-800">
            {mList.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-4 text-center text-slate-500">
                  لا توجد حركات مسجلة لهذا الصنف خلال الفترة
                </td>
              </tr>
            ) : (
              mList.map((m: any, idx: number) => (
                <tr key={idx}>
                  <td className="p-2 font-mono">{new Date(m.movement_date).toLocaleDateString('en-GB')}</td>
                  <td className="p-2 font-semibold">{TYPE_LABELS[m.movement_type] || m.movement_type}</td>
                  <td className="p-2 font-mono">{m.document_number ? `#${m.document_number}` : '—'}</td>
                  <td className="p-2">{m.entity_name || '—'}</td>
                  <td className="p-2 text-center font-mono font-bold text-emerald-800">
                    {Number(m.quantity_in) > 0 ? Number(m.quantity_in).toLocaleString('en-GB') : '—'}
                  </td>
                  <td className="p-2 text-center font-mono font-bold text-rose-800">
                    {Number(m.quantity_out) > 0 ? Number(m.quantity_out).toLocaleString('en-GB') : '—'}
                  </td>
                  <td className="p-2 text-center font-mono font-black text-slate-900">
                    {Number(m.balance_after).toLocaleString('en-GB')}
                  </td>
                  <td className="p-2 text-left font-mono">
                    {Number(m.unit_price) > 0 ? `${Number(m.unit_price).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪` : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Signatures */}
        <div className="mt-14 grid grid-cols-3 gap-6 border-t-2 border-slate-900 pt-6 text-center text-xs font-bold text-slate-800">
          <div>
            <p className="text-slate-500 mb-8">أمين المستودع</p>
            <p className="border-t border-dotted border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">مراقب المخزون</p>
            <p className="border-t border-dotted border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">المدير العام / الاعتماد</p>
            <p className="border-t border-dotted border-slate-400 pt-1">الختم والتوقيع</p>
          </div>
        </div>
      </div>
    </div>
  )
}
