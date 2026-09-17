import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import FeatureGate from '@/components/dashboard/FeatureGate'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'

export const metadata = {
  title: 'عروض الأسعار — Bazarko ERP',
}

export default async function QuotationsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: quotations }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code, plan').eq('id', storeId).single(),
    supabase
      .from('quotations')
      .select('*, customer:customers(id, name, phone), items:quotation_items(*)')
      .eq('store_id', storeId)
      .order('issue_date', { ascending: false })
  ])

  const quoteList = quotations || []

  const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
    draft: { label: 'مسودة', color: 'text-slate-400', bg: 'bg-slate-800' },
    sent: { label: 'مرسل للعميل', color: 'text-sky-400', bg: 'bg-sky-500/10' },
    accepted: { label: 'مقبول', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    rejected: { label: 'مرفوض', color: 'text-rose-400', bg: 'bg-rose-500/10' },
    converted: { label: 'تم تحويله لفاتورة', color: 'text-purple-400', bg: 'bg-purple-500/10' },
    expired: { label: 'منتهي الصلاحية', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  }

  return (
    <FeatureGate
      plan={store?.plan}
      featureName="عروض الأسعار الرسمية (Quotations)"
      featureDescription="إصدار عروض أسعار بتصاميم رسمية موحدة للشركات، تحديد مدد الصلاحية والشروط، والتحويل إلى فواتير مبيعات بنقرة واحدة."
      icon="📑"
    >
    <div className="space-y-6">
      {/* ── Back to Sales Hub ── */}
      <div>
        <BackToDashboardButton href="/dashboard/sales" label="العودة إلى لوحة إدارة المبيعات" />
      </div>

      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>📄</span> عروض الأسعار الرسمية (Quotations)
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            إصدار عروض الأسعار للزبائن والشركات وتحويلها إلى فواتير بضغطة زر
          </p>
        </div>

        <Link
          href="/dashboard/quotations/new"
          className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-400 transition"
        >
          ➕ إنشاء عرض سعر جديد
        </Link>
      </div>

      {/* ── Table ── */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-slate-800/60 text-slate-400 font-bold">
                <th className="p-3.5">رقم العرض</th>
                <th className="p-3.5">تاريخ الإصدار</th>
                <th className="p-3.5">العميل</th>
                <th className="p-3.5">ساري حتى</th>
                <th className="p-3.5">الحالة</th>
                <th className="p-3.5">المبلغ الإجمالي</th>
                <th className="p-3.5 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-200">
              {quoteList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    لا توجد عروض أسعار مسجلة بعد
                  </td>
                </tr>
              ) : (
                quoteList.map(q => {
                  const st = STATUS_LABELS[q.status] || { label: q.status, color: 'text-slate-400', bg: 'bg-slate-800' }
                  return (
                    <tr key={q.id} className="hover:bg-slate-800/40 transition">
                      <td className="p-3.5 font-mono font-bold text-sky-400">
                        <Link href={`/dashboard/quotations/print/${q.id}`} className="hover:underline">
                          #{q.quotation_number}
                        </Link>
                      </td>

                      <td className="p-3.5 font-mono text-slate-300">
                        {new Date(q.issue_date).toLocaleDateString('en-GB')}
                      </td>

                      <td className="p-3.5">
                        <p className="font-semibold text-white">{q.customer?.name || 'عميل عام'}</p>
                        {q.customer?.phone && <p className="text-[10px] text-slate-500">{q.customer.phone}</p>}
                      </td>

                      <td className="p-3.5 font-mono text-slate-400">
                        {q.valid_until ? new Date(q.valid_until).toLocaleDateString('en-GB') : '—'}
                      </td>

                      <td className="p-3.5">
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border border-current ${st.bg} ${st.color}`}>
                          {st.label}
                        </span>
                      </td>

                      <td className="p-3.5 font-mono font-bold text-white text-sm">
                        {Number(q.total_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
                      </td>

                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Link
                            href={`/dashboard/accounting/invoices/new?from_quotation=${q.id}`}
                            className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 text-[11px] font-bold text-emerald-400 hover:bg-emerald-500/20 transition whitespace-nowrap"
                            title="تحويل عرض السعر إلى فاتورة مبيعات"
                          >
                            🧾 تحويل لفاتورة
                          </Link>
                          <Link
                            href={`/dashboard/quotations/print/${q.id}`}
                            className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:text-white transition"
                            title="طباعة عرض السعر"
                          >
                            🖨️
                          </Link>
                        </div>
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
    </FeatureGate>
  )
}
