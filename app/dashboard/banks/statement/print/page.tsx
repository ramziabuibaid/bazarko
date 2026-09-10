import PrintButton from "@/components/dashboard/PrintButton"
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'طباعة كشف حساب بنكي — Bazarko ERP',
}

interface SearchParams {
  bank_id?: string
  from?: string
  to?: string
}

export default async function PrintBankStatementPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [{ data: store }, { data: bank }] = await Promise.all([
    supabase.from('stores').select('*').eq('id', storeId).single(),
    supabase.from('bank_accounts').select('*').eq('id', searchParams.bank_id || '').eq('store_id', storeId).single()
  ])

  if (!store || !bank) notFound()

  // Fetch transactions
  let lines: any[] = []
  if (bank.account_id) {
    let query = supabase
      .from('journal_lines')
      .select('*, entry:journal_entries!inner(id, entry_number, date, description, source)')
      .eq('account_id', bank.account_id)
      .order('created_at', { ascending: true })

    if (searchParams.from) query = query.gte('entry.date', searchParams.from)
    if (searchParams.to) query = query.lte('entry.date', searchParams.to)

    const { data } = await query
    lines = data || []
  }

  let running = Number(bank.opening_balance || 0)
  const statementRows = lines.map(line => {
    const debit = Number(line.debit || 0)
    const credit = Number(line.credit || 0)
    running = running + debit - credit
    return {
      date: line.entry?.date || line.created_at,
      entry_number: line.entry?.entry_number,
      description: line.description || line.entry?.description,
      debit,
      credit,
      balance: running,
    }
  })

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white">
      {/* ── Toolbar (Hidden on Print) ── */}
      <div className="mx-auto mb-6 flex max-w-4xl items-center justify-between rounded-xl bg-slate-900 p-4 text-white shadow-lg print:hidden">
        <Link
          href={`/dashboard/banks/statement?bank_id=${bank.id}`}
          className="text-xs font-bold text-slate-300 hover:text-white transition"
        >
          ← العودة للكشف
        </Link>
        <PrintButton label="🖨️ طباعة (Print / PDF)" className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition" />
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
            <h2 className="text-lg font-black text-slate-900 border-2 border-slate-900 px-4 py-1 rounded-lg inline-block bg-slate-50">
              كشف حساب بنكي رسمي
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              تاريخ التقرير: {new Date().toLocaleDateString('en-GB')}
            </p>
          </div>

          <div className="text-left font-mono text-xs">
            <p><span className="text-slate-500">البنك:</span> <span className="font-bold">{bank.bank_name}</span></p>
            <p><span className="text-slate-500">الفرع:</span> {bank.branch_name}</p>
            <p><span className="text-slate-500">رقم الحساب:</span> <span className="font-bold">{bank.account_number}</span></p>
            <p><span className="text-slate-500">العملة:</span> {bank.currency}</p>
          </div>
        </div>

        {/* Period & Balances Box */}
        <div className="my-4 grid grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <div>
            <span className="text-slate-500">فترة التقرير:</span>{' '}
            <span className="font-semibold text-slate-800">
              {searchParams.from ? new Date(searchParams.from).toLocaleDateString('en-GB') : 'البداية'} إلى{' '}
              {searchParams.to ? new Date(searchParams.to).toLocaleDateString('en-GB') : 'تاريخه'}
            </span>
          </div>
          <div>
            <span className="text-slate-500">الرصيد الافتتاحي:</span>{' '}
            <span className="font-mono font-bold text-slate-900">
              {Number(bank.opening_balance || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {bank.currency}
            </span>
          </div>
          <div>
            <span className="text-slate-500">الرصيد النهائي:</span>{' '}
            <span className="font-mono font-bold text-slate-900">
              {Number(running).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {bank.currency}
            </span>
          </div>
        </div>

        {/* Statement Table */}
        <table className="w-full text-right text-xs border border-slate-200">
          <thead>
            <tr className="bg-slate-100 text-slate-800 border-b">
              <th className="p-2 font-bold">التاريخ</th>
              <th className="p-2 font-bold">رقم القيد</th>
              <th className="p-2 font-bold">البيان</th>
              <th className="p-2 font-bold text-emerald-800">مدين (إيداع)</th>
              <th className="p-2 font-bold text-rose-800">دائن (سحب)</th>
              <th className="p-2 font-bold text-slate-900">الرصيد</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-800">
            <tr>
              <td className="p-2 font-mono">—</td>
              <td className="p-2 font-mono">OPN</td>
              <td className="p-2 font-semibold">رصيد افتتاحي</td>
              <td className="p-2 font-mono">{Number(bank.opening_balance || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
              <td className="p-2 font-mono">0.00</td>
              <td className="p-2 font-mono font-bold">{Number(bank.opening_balance || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
            </tr>

            {statementRows.map((row, idx) => (
              <tr key={idx}>
                <td className="p-2 font-mono">{new Date(row.date).toLocaleDateString('en-GB')}</td>
                <td className="p-2 font-mono">#{row.entry_number || '—'}</td>
                <td className="p-2">{row.description}</td>
                <td className="p-2 font-mono font-semibold text-emerald-800">
                  {row.debit > 0 ? row.debit.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}
                </td>
                <td className="p-2 font-mono font-semibold text-rose-800">
                  {row.credit > 0 ? row.credit.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}
                </td>
                <td className="p-2 font-mono font-bold text-slate-900">
                  {row.balance.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Signatures */}
        <div className="mt-12 grid grid-cols-3 gap-6 border-t-2 border-slate-900 pt-6 text-center text-xs font-bold text-slate-800">
          <div>
            <p className="text-slate-500 mb-8">المحاسب المالي</p>
            <p className="border-t border-dotted border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">المدقق الداخلي</p>
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
