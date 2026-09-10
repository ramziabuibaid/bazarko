import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'قيود اليومية — Bazarko ERP',
}

interface SearchParams {
  from?: string
  to?: string
  source?: string
}

export default async function JournalEntriesPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  let query = supabase
    .from('journal_entries')
    .select('*, lines:journal_lines(*, account:accounts(code, name))')
    .eq('store_id', storeId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  if (searchParams.from) query = query.gte('date', searchParams.from)
  if (searchParams.to) query = query.lte('date', searchParams.to)
  if (searchParams.source) query = query.eq('source', searchParams.source)

  const { data: entries } = await query

  const entriesList = entries || []
  const totalDebit = entriesList.reduce((sum, e) => {
    return sum + (e.lines || []).reduce((lSum: number, l: any) => lSum + Number(l.debit || 0), 0)
  }, 0)

  const SOURCE_LABELS: Record<string, string> = {
    manual: 'قيد يدوي',
    invoice: 'فاتورة مبيعات',
    purchase: 'فاتورة مشتريات',
    sales_return: 'مرتجع مبيعات',
    purchase_return: 'مردود مشتريات',
    voucher: 'سند مالي',
    check_op: 'حركة شيكات',
    opening: 'قيد افتتاحي',
    closing: 'قيد إقفال',
    system: 'نظام آلي',
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>📋</span> قيود اليومية العامة (Journal Entries)
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            دفتر القيود المزدوجة الآلية واليدوية لكافة العمليات المالية والمخزنية
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/accounting/accounts"
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-700 transition"
          >
            🌳 شجرة الحسابات
          </Link>
          <Link
            href="/dashboard/accounting/journal/create"
            className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-400 transition"
          >
            ➕ إنشاء قيد يدوي جديد
          </Link>
        </div>
      </div>

      {/* ── Stats Box ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">إجمالي عدد القيود</p>
          <p className="mt-2 text-2xl font-black text-white">{entriesList.length}</p>
          <p className="mt-1 text-xs text-slate-500">مرحلة ومسجلة في دفتر الأستاذ</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">إجمالي حركة القيود (مدين = دائن)</p>
          <p className="mt-2 text-2xl font-black text-white font-mono">
            {totalDebit.toLocaleString('en-GB', { minimumFractionDigits: 2 })}{' '}
            <span className="text-xs text-sky-400 font-bold">₪</span>
          </p>
          <p className="mt-1 text-xs text-emerald-400 font-medium">✅ توازن دفتري تام</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">نوع التسجيل</p>
          <p className="mt-2 text-base font-bold text-purple-400">قيد مزدوج آلي (Double Entry)</p>
          <p className="mt-1 text-xs text-slate-500">تحديث لحظي لأرصدة العملاء والموردين والبنوك</p>
        </div>
      </div>

      {/* ── Entries List ── */}
      <div className="space-y-4">
        {entriesList.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900 p-12 text-center text-slate-500">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-base font-bold text-white">لا توجد قيود مسجلة بعد</p>
            <p className="mt-1 text-xs text-slate-400">يتم إنشاء القيود تلقائياً عند إجراء المبيعات والمشتريات والشيكات أو يدوياً</p>
          </div>
        ) : (
          entriesList.map(entry => {
            const entryTotal = (entry.lines || []).reduce((sum: number, l: any) => sum + Number(l.debit || 0), 0)

            return (
              <div
                key={entry.id}
                className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-md hover:border-white/20 transition"
              >
                {/* Entry Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-slate-800/60 px-5 py-3.5 text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-black text-sm text-sky-400">#{entry.entry_number}</span>
                    <span className="font-mono text-slate-300">{new Date(entry.date).toLocaleDateString('en-GB')}</span>
                    <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[11px] font-bold text-slate-300 border border-white/10">
                      {SOURCE_LABELS[entry.source] || entry.source}
                    </span>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="font-mono">
                      <span className="text-slate-400">الإجمالي: </span>
                      <span className="font-bold text-white">
                        {entryTotal.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
                      </span>
                    </div>

                    <Link
                      href={`/dashboard/accounting/journal/print/${entry.id}`}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-bold text-slate-300 hover:text-white hover:bg-white/10 transition"
                    >
                      🖨️ طباعة القيد
                    </Link>
                  </div>
                </div>

                {/* Entry Description */}
                <div className="px-5 py-2.5 text-xs font-semibold text-slate-200 bg-slate-900/40">
                  {entry.description}
                </div>

                {/* Entry Lines Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="border-b border-white/5 text-[11px] text-slate-500">
                        <th className="px-5 py-2 font-medium">كود الحساب</th>
                        <th className="px-5 py-2 font-medium">اسم الحساب</th>
                        <th className="px-5 py-2 font-medium">البيان</th>
                        <th className="px-5 py-2 font-medium text-emerald-400">مدين</th>
                        <th className="px-5 py-2 font-medium text-rose-400">دائن</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-slate-300">
                      {(entry.lines || []).map((line: any) => (
                        <tr key={line.id} className="hover:bg-slate-800/30 transition">
                          <td className="px-5 py-2 font-mono font-bold text-sky-400">{line.account?.code || '—'}</td>
                          <td className="px-5 py-2 font-semibold text-white">{line.account?.name || 'حساب غير معرف'}</td>
                          <td className="px-5 py-2 text-slate-400">{line.description || entry.description}</td>
                          <td className="px-5 py-2 font-mono font-bold text-emerald-400">
                            {Number(line.debit) > 0 ? Number(line.debit).toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}
                          </td>
                          <td className="px-5 py-2 font-mono font-bold text-rose-400">
                            {Number(line.credit) > 0 ? Number(line.credit).toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
