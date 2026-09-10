import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'كشف حساب بنكي — Bazarko ERP',
}

interface SearchParams {
  bank_id?: string
  from?: string
  to?: string
}

export default async function BankStatementPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  // Fetch all bank accounts for selector
  const { data: bankAccounts } = await supabase
    .from('bank_accounts')
    .select('id, bank_code, bank_name, branch_name, account_number, currency, balance, account_id, opening_balance')
    .eq('store_id', storeId)
    .order('bank_name')

  const selectedBankId = searchParams.bank_id || bankAccounts?.[0]?.id
  const currentBank = bankAccounts?.find(b => b.id === selectedBankId)

  // Fetch transactions from journal lines linked to this bank account
  let lines: any[] = []
  if (currentBank?.account_id) {
    let query = supabase
      .from('journal_lines')
      .select('*, entry:journal_entries!inner(id, entry_number, date, description, source)')
      .eq('account_id', currentBank.account_id)
      .order('created_at', { ascending: true })

    if (searchParams.from) query = query.gte('entry.date', searchParams.from)
    if (searchParams.to) query = query.lte('entry.date', searchParams.to)

    const { data } = await query
    lines = data || []
  }

  // Calculate running balances
  let running = Number(currentBank?.opening_balance || 0)
  const statementRows = lines.map(line => {
    const debit = Number(line.debit || 0)
    const credit = Number(line.credit || 0)
    running = running + debit - credit
    return {
      id: line.id,
      date: line.entry?.date || line.created_at,
      entry_number: line.entry?.entry_number,
      description: line.description || line.entry?.description,
      source: line.entry?.source,
      debit,
      credit,
      balance: running,
    }
  })

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>📊</span> كشف حساب بنكي تفصيلي
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            حركات الإيداع والسحب والتحصيلات البنكية مع الرصيد التراكمي
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/banks"
            className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
          >
            ← العودة للحسابات
          </Link>
          {currentBank && (
            <Link
              href={`/dashboard/banks/statement/print?bank_id=${currentBank.id}&from=${searchParams.from || ''}&to=${searchParams.to || ''}`}
              className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition"
            >
              🖨️ طباعة الكشف (PDF)
            </Link>
          )}
        </div>
      </div>

      {/* ── Bank Selector & Date Filter ── */}
      <div className="rounded-2xl border border-white/10 bg-slate-900 p-4">
        <form method="GET" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">اختر الحساب البنكي</label>
            <select
              name="bank_id"
              defaultValue={selectedBankId}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            >
              {bankAccounts?.map(b => (
                <option key={b.id} value={b.id}>
                  {b.bank_name} — {b.branch_name} ({b.account_number})
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
              تحديث الكشف
            </button>
          </div>
        </form>
      </div>

      {/* ── Current Bank Card ── */}
      {currentBank && (
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 flex flex-col sm:flex-row justify-between gap-4">
          <div>
            <span className="rounded bg-sky-500/10 px-2 py-0.5 text-[10px] font-mono text-sky-400 font-bold">
              كود PMA: {currentBank.bank_code}
            </span>
            <h2 className="mt-1 text-xl font-bold text-white">{currentBank.bank_name}</h2>
            <p className="text-xs text-slate-400">{currentBank.branch_name} — رقم الحساب: {currentBank.account_number}</p>
          </div>

          <div className="text-right sm:text-left">
            <p className="text-xs text-slate-400">الرصيد الدفتري الحالي</p>
            <p className="text-2xl font-black text-white font-mono">
              {Number(currentBank.balance).toLocaleString('en-GB', { minimumFractionDigits: 2 })}{' '}
              <span className="text-xs text-sky-400">{currentBank.currency}</span>
            </p>
          </div>
        </div>
      )}

      {/* ── Statement Table ── */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-slate-800/60 text-slate-400 font-bold">
                <th className="p-3.5">التاريخ</th>
                <th className="p-3.5">رقم القيد / السند</th>
                <th className="p-3.5">البيان والتفاصيل</th>
                <th className="p-3.5">المصدر</th>
                <th className="p-3.5 text-emerald-400">مدين (إيداع +)</th>
                <th className="p-3.5 text-rose-400">دائن (سحب -)</th>
                <th className="p-3.5 text-white">الرصيد التراكمي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-200">
              <tr className="bg-slate-800/20 font-bold">
                <td className="p-3 font-mono">—</td>
                <td className="p-3 font-mono">OPN-000</td>
                <td className="p-3">الرصيد الافتتاحي</td>
                <td className="p-3 text-slate-500">افتتاحي</td>
                <td className="p-3 font-mono">{Number(currentBank?.opening_balance || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
                <td className="p-3 font-mono">0.00</td>
                <td className="p-3 font-mono text-white">
                  {Number(currentBank?.opening_balance || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                </td>
              </tr>

              {statementRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    لا توجد حركات مسجلة خلال الفترة المحددة
                  </td>
                </tr>
              ) : (
                statementRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/40 transition">
                    <td className="p-3 font-mono text-slate-300">{new Date(row.date).toLocaleDateString('en-GB')}</td>
                    <td className="p-3 font-mono font-bold text-sky-400">#{row.entry_number || '—'}</td>
                    <td className="p-3 font-medium text-white">{row.description}</td>
                    <td className="p-3 text-[11px] text-slate-400">{row.source}</td>
                    <td className="p-3 font-mono font-bold text-emerald-400">
                      {row.debit > 0 ? row.debit.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}
                    </td>
                    <td className="p-3 font-mono font-bold text-rose-400">
                      {row.credit > 0 ? row.credit.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}
                    </td>
                    <td className="p-3 font-mono font-black text-white">
                      {row.balance.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
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
