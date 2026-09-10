import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'فواتير المشتريات — Bazarko ERP',
}

export default async function PurchasesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: purchases }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase
      .from('purchase_invoices')
      .select('*, supplier:suppliers(id, name, phone), items:purchase_items(*)')
      .eq('store_id', storeId)
      .order('invoice_date', { ascending: false })
  ])

  const purchaseList = purchases || []
  const totalAmount = purchaseList.reduce((sum, p) => sum + Number(p.total_amount || 0), 0)

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>📦</span> فواتير المشتريات والموردين (Purchases)
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            إدارة فواتير الشراء من الموردين وتحديث تكلفة وكميات المخزون آلياً
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/suppliers"
            className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
          >
            👥 دليل الموردين
          </Link>
          <Link
            href="/dashboard/purchases/returns"
            className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
          >
            🔄 مردودات المشتريات
          </Link>
          <Link
            href="/dashboard/purchases/new"
            className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-400 transition"
          >
            ➕ تسجيل فاتورة شراء جديدة
          </Link>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">إجمالي المشتريات</p>
          <p className="mt-2 text-2xl font-black text-white font-mono">
            {totalAmount.toLocaleString('en-GB', { minimumFractionDigits: 2 })}{' '}
            <span className="text-xs text-sky-400">₪</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{purchaseList.length} فاتورة مسجلة</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">تحديث المخزون</p>
          <p className="mt-2 text-base font-bold text-emerald-400">✅ إضافة فورية للكميات</p>
          <p className="mt-1 text-xs text-slate-500">تسجيل كميات الشراء وسعر التكلفة في كشف حركات الصنف</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">حسابات الموردين</p>
          <p className="mt-2 text-base font-bold text-purple-400">تحديث آلي لأرصدة الموردين</p>
          <p className="mt-1 text-xs text-slate-500">سداد نقدي / شيكات / آجل بالذمة</p>
        </div>
      </div>

      {/* ── Purchases Table ── */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-slate-800/60 text-slate-400 font-bold">
                <th className="p-3.5">رقم الفاتورة</th>
                <th className="p-3.5">التاريخ</th>
                <th className="p-3.5">المورد</th>
                <th className="p-3.5">طريقة الدفع</th>
                <th className="p-3.5">عدد البنود</th>
                <th className="p-3.5">الإجمالي</th>
                <th className="p-3.5 text-center">الطباعة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-200">
              {purchaseList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    لا توجد فواتير مشتريات مسجلة بعد
                  </td>
                </tr>
              ) : (
                purchaseList.map(purchase => (
                  <tr key={purchase.id} className="hover:bg-slate-800/40 transition">
                    <td className="p-3.5 font-mono font-bold text-sky-400">
                      <Link href={`/dashboard/purchases/print/${purchase.id}`} className="hover:underline">
                        #{purchase.invoice_number}
                      </Link>
                    </td>

                    <td className="p-3.5 font-mono text-slate-300">
                      {new Date(purchase.invoice_date).toLocaleDateString('en-GB')}
                    </td>

                    <td className="p-3.5">
                      <p className="font-semibold text-white">{purchase.supplier?.name || 'مورد عام / نقدي'}</p>
                      {purchase.supplier?.phone && <p className="text-[10px] text-slate-500">{purchase.supplier.phone}</p>}
                    </td>

                    <td className="p-3.5">
                      <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-300">
                        {purchase.payment_method === 'cash' && 'نقدي'}
                        {purchase.payment_method === 'credit' && 'آجل (ذمة)'}
                        {purchase.payment_method === 'check' && 'شيك'}
                        {purchase.payment_method === 'mixed' && 'دفعات مجزأة'}
                      </span>
                    </td>

                    <td className="p-3.5 font-mono text-slate-400">
                      {(purchase.items || []).length} صنف
                    </td>

                    <td className="p-3.5 font-mono font-bold text-white text-sm">
                      {Number(purchase.total_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
                    </td>

                    <td className="p-3.5 text-center">
                      <Link
                        href={`/dashboard/purchases/print/${purchase.id}`}
                        className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:text-white transition"
                        title="طباعة فاتورة الشراء"
                      >
                        🖨️
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
