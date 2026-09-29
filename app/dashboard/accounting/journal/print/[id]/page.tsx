import PrintButton from "@/components/dashboard/PrintButton"
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'طباعة سند قيد اليومية — Bazarko ERP',
}

export default async function PrintJournalEntryPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: entry }
  ] = await Promise.all([
    supabase.from('stores').select('*').eq('id', storeId).single(),
    supabase
      .from('journal_entries')
      .select('*, lines:journal_lines(*, account:accounts(code, name))')
      .eq('id', params.id)
      .eq('store_id', storeId)
      .single()
  ])

  if (!store || !entry) notFound()

  const totalDebit = (entry.lines || []).reduce((sum: number, l: any) => sum + Number(l.debit || 0), 0)
  const totalCredit = (entry.lines || []).reduce((sum: number, l: any) => sum + Number(l.credit || 0), 0)

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white">
      {/* ── Toolbar ── */}
      <div className="mx-auto mb-6 flex max-w-4xl items-center justify-between rounded-xl bg-slate-900 p-4 text-white shadow-lg print:hidden">
        <Link
          href="/dashboard/accounting/journal"
          className="text-xs font-bold text-slate-300 hover:text-white transition"
        >
          ← العودة للقيود
        </Link>
        <PrintButton label="🖨️ طباعة سند القيد (PDF)" className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition" />
      </div>

      {/* ── Document ── */}
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
              سند قيد يومية عام
            </h2>
            <p className="mt-1 font-mono text-sm font-bold text-slate-700">#{entry.entry_number}</p>
          </div>

          <div className="text-left font-mono text-xs">
            <p><span className="text-slate-500">التاريخ:</span> <span className="font-bold">{new Date(entry.date).toLocaleDateString('en-GB')}</span></p>
            <p className="mt-1"><span className="text-slate-500">المصدر:</span> {entry.source}</p>
            {entry.accounting_rule && (
              <p className="mt-1"><span className="text-slate-500">القاعدة:</span> <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200">{entry.accounting_rule}</span></p>
            )}
            <p className="mt-1"><span className="text-slate-500">الحالة:</span> <span className="font-bold text-emerald-700">مرحل</span></p>
          </div>
        </div>

        {/* General Description */}
        <div className="my-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <span className="font-bold text-slate-700">بيان القيد: </span>
          <span className="text-slate-900 font-semibold">{entry.description}</span>
        </div>

        {/* Lines Table */}
        <table className="w-full text-right text-xs border border-slate-200">
          <thead>
            <tr className="bg-slate-100 text-slate-800 border-b font-bold">
              <th className="p-2.5 w-24">كود الحساب</th>
              <th className="p-2.5">اسم الحساب</th>
              <th className="p-2.5">البيان</th>
              <th className="p-2.5 w-32 text-emerald-800">مدين (Debit)</th>
              <th className="p-2.5 w-32 text-rose-800">دائن (Credit)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-800">
            {(entry.lines || []).map((line: any) => (
              <tr key={line.id}>
                <td className="p-2 font-mono font-bold text-slate-900">{line.account?.code || '—'}</td>
                <td className="p-2 font-semibold text-slate-900">
                  <div className="flex items-center gap-1.5">
                    <span>{line.account?.name || '—'}</span>
                    {line.account_tag_used && (
                      <span className="inline-block text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-50 text-sky-700 border border-sky-200">
                        #{line.account_tag_used}
                      </span>
                    )}
                  </div>
                </td>
                <td className="p-2 text-slate-600">{line.description || entry.description}</td>
                <td className="p-2 font-mono font-bold text-emerald-800">
                  {Number(line.debit) > 0 ? Number(line.debit).toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}
                </td>
                <td className="p-2 font-mono font-bold text-rose-800">
                  {Number(line.credit) > 0 ? Number(line.credit).toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 border-t-2 border-slate-900 font-mono font-black text-xs">
              <td colSpan={3} className="p-2.5 text-right font-sans font-bold">المجموع الإجمالي (متوازن):</td>
              <td className="p-2.5 text-emerald-800">{totalDebit.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪</td>
              <td className="p-2.5 text-rose-800">{totalCredit.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪</td>
            </tr>
          </tfoot>
        </table>

        {/* Signatures */}
        <div className="mt-14 grid grid-cols-3 gap-6 border-t-2 border-slate-900 pt-6 text-center text-xs font-bold text-slate-800">
          <div>
            <p className="text-slate-500 mb-8">منشئ القيد</p>
            <p className="border-t border-dotted border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">المحاسب المالي</p>
            <p className="border-t border-dotted border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">المدير المالي / الاعتماد</p>
            <p className="border-t border-dotted border-slate-400 pt-1">الختم والتوقيع</p>
          </div>
        </div>
      </div>
    </div>
  )
}
