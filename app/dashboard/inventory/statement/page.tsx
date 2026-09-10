import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'كشف حركات صنف — Bazarko ERP',
}

interface SearchParams {
  product_id?: string
  from?: string
  to?: string
  type?: string
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  sale: { label: 'فاتورة مبيعات', color: 'text-rose-400' },
  purchase: { label: 'فاتورة مشتريات', color: 'text-emerald-400' },
  sales_return: { label: 'مرتجع مبيعات', color: 'text-emerald-400' },
  purchase_return: { label: 'مردود مشتريات', color: 'text-rose-400' },
  adjustment_in: { label: 'تسوية جردية (زيادة)', color: 'text-emerald-400' },
  adjustment_out: { label: 'تسوية جردية (نقص)', color: 'text-rose-400' },
  transfer_in: { label: 'تحويل وارد', color: 'text-emerald-400' },
  transfer_out: { label: 'تحويل صادر', color: 'text-rose-400' },
  damage: { label: 'تالف وهالك', color: 'text-rose-400' },
  initial: { label: 'رصيد افتتاحي', color: 'text-sky-400' },
}

export default async function ItemStatementPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  // Fetch all products for selector
  const { data: products } = await supabase
    .from('products')
    .select('id, name, sku, barcode, stock_quantity, price, cost_price')
    .eq('store_id', storeId)
    .order('name')

  const selectedProductId = searchParams.product_id || products?.[0]?.id
  const currentProduct = products?.find(p => p.id === selectedProductId)

  let movements: any[] = []
  if (selectedProductId) {
    let query = supabase
      .from('inventory_movements')
      .select('*')
      .eq('product_id', selectedProductId)
      .eq('store_id', storeId)
      .order('movement_date', { ascending: true })
      .order('created_at', { ascending: true })

    if (searchParams.from) query = query.gte('movement_date', searchParams.from)
    if (searchParams.to) query = query.lte('movement_date', searchParams.to)
    if (searchParams.type) query = query.eq('movement_type', searchParams.type)

    const { data } = await query
    movements = data || []
  }

  const totalIn = movements.reduce((sum, m) => sum + Number(m.quantity_in || 0), 0)
  const totalOut = movements.reduce((sum, m) => sum + Number(m.quantity_out || 0), 0)

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>📋</span> كشف حركات صنف (Item Movement Statement)
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            تتبع كافة عمليات الدخول والخروج والمبيعات والمشتريات والمردودات للصنف
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/inventory"
            className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
          >
            ← العودة للمخزون
          </Link>
          {currentProduct && (
            <Link
              href={`/dashboard/inventory/statement/print?product_id=${currentProduct.id}&from=${searchParams.from || ''}&to=${searchParams.to || ''}&type=${searchParams.type || ''}`}
              className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition"
            >
              🖨️ طباعة كشف الحركات (PDF)
            </Link>
          )}
        </div>
      </div>

      {/* ── Filter Form ── */}
      <div className="rounded-2xl border border-white/10 bg-slate-900 p-4">
        <form method="GET" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">اختر الصنف *</label>
            <select
              name="product_id"
              defaultValue={selectedProductId}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            >
              {products?.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.sku ? `[${p.sku}]` : ''} (المخزون الحالي: {p.stock_quantity})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">من تاريخ</label>
            <input
              type="date"
              name="from"
              defaultValue={searchParams.from}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">إلى تاريخ</label>
            <input
              type="date"
              name="to"
              defaultValue={searchParams.to}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-xl bg-sky-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-sky-400 transition"
            >
              عرض كشف الحركات
            </button>
          </div>
        </form>
      </div>

      {/* ── Current Product Card & Summary ── */}
      {currentProduct && (
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 flex flex-col sm:flex-row justify-between gap-4">
          <div>
            <span className="rounded bg-sky-500/10 px-2 py-0.5 text-[10px] font-mono text-sky-400 font-bold">
              SKU: {currentProduct.sku || '—'}
            </span>
            <h2 className="mt-1 text-xl font-bold text-white">{currentProduct.name}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              سعر البيع: {currentProduct.price} ₪ | سعر التكلفة: {currentProduct.cost_price || 0} ₪
            </p>
          </div>

          <div className="flex gap-6 text-right sm:text-left font-mono">
            <div>
              <p className="text-xs text-slate-400 font-sans">إجمالي الوارد (+)</p>
              <p className="text-xl font-bold text-emerald-400">{totalIn.toLocaleString('en-GB')}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-sans">إجمالي الصادر (-)</p>
              <p className="text-xl font-bold text-rose-400">{totalOut.toLocaleString('en-GB')}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-sans">الرصيد الفعلي الحالي</p>
              <p className="text-2xl font-black text-white">{Number(currentProduct.stock_quantity).toLocaleString('en-GB')}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Movements Table ── */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-slate-800/60 text-slate-400 font-bold">
                <th className="p-3.5">التاريخ</th>
                <th className="p-3.5">نوع الحركة</th>
                <th className="p-3.5">رقم المستند</th>
                <th className="p-3.5">الجهة / العميل / المورد</th>
                <th className="p-3.5 text-emerald-400 text-center">وارد (+)</th>
                <th className="p-3.5 text-rose-400 text-center">صادر (-)</th>
                <th className="p-3.5 text-white text-center">الرصيد بعد الحركة</th>
                <th className="p-3.5 text-left">السعر</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-200">
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    لا توجد حركات مسجلة لهذا الصنف خلال الفترة المحددة
                  </td>
                </tr>
              ) : (
                movements.map((m, idx) => {
                  const typeConf = TYPE_LABELS[m.movement_type] || { label: m.movement_type, color: 'text-slate-400' }

                  return (
                    <tr key={m.id || idx} className="hover:bg-slate-800/40 transition">
                      <td className="p-3 font-mono text-slate-300">{new Date(m.movement_date).toLocaleDateString('en-GB')}</td>
                      <td className="p-3">
                        <span className={`font-bold ${typeConf.color}`}>{typeConf.label}</span>
                      </td>
                      <td className="p-3 font-mono text-sky-400 font-bold">
                        {m.document_number ? `#${m.document_number}` : '—'}
                      </td>
                      <td className="p-3 font-semibold text-white">{m.entity_name || '—'}</td>
                      <td className="p-3 text-center font-mono font-bold text-emerald-400">
                        {Number(m.quantity_in) > 0 ? Number(m.quantity_in).toLocaleString('en-GB') : '—'}
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-rose-400">
                        {Number(m.quantity_out) > 0 ? Number(m.quantity_out).toLocaleString('en-GB') : '—'}
                      </td>
                      <td className="p-3 text-center font-mono font-black text-white text-sm">
                        {Number(m.balance_after).toLocaleString('en-GB')}
                      </td>
                      <td className="p-3 text-left font-mono font-semibold text-slate-300">
                        {Number(m.unit_price) > 0 ? `${Number(m.unit_price).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪` : '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
