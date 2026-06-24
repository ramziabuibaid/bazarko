import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ExpenseQuickAdd from '@/components/dashboard/accounting/ExpenseQuickAdd'

interface Props { searchParams: { period?: string } }

const PERIODS = [
  { key: 'month',      label: 'هذا الشهر' },
  { key: 'last_month', label: 'الشهر الماضي' },
  { key: 'year',       label: 'هذه السنة' },
  { key: 'all',        label: 'الكل' },
]

function rangeFor(period: string) {
  const now = new Date()
  if (period === 'last_month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10),
      end:   new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10),
    }
  }
  if (period === 'year') return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31` }
  if (period === 'all')  return { start: '2000-01-01', end: '2999-12-31' }
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
    end:   new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
  }
}

export default async function ExpensesPage({ searchParams }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores').select('id, currency_code').eq('id', storeId).single()
  if (!store) redirect('/onboarding')

  const period = searchParams.period ?? 'month'
  const { start, end } = rangeFor(period)

  const { data: rows } = await supabase
    .from('vouchers')
    .select('id, voucher_number, amount, category, description, party_name, payment_method, date')
    .eq('store_id', store.id)
    .eq('type', 'payment')
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  const expenses = (rows ?? []) as {
    id: string; voucher_number: string; amount: number; category: string | null
    description: string; party_name: string | null; payment_method: string; date: string
  }[]

  const total = expenses.reduce((s, e) => s + e.amount, 0)

  const byCategory: Record<string, number> = {}
  expenses.forEach(e => {
    const c = e.category ?? 'أخرى'
    byCategory[c] = (byCategory[c] ?? 0) + e.amount
  })
  const categories = Object.entries(byCategory).sort((a, b) => b[1] - a[1])

  const cur = store.currency_code
  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 0 })

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/accounting" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
            ← المحاسبة
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-white">💸 المصروفات</h1>
            <p className="mt-0.5 text-sm text-slate-400">سجّل مصاريف المتجر بسرعة وتابعها بالتصنيف</p>
          </div>
        </div>
        <ExpenseQuickAdd storeId={store.id} userId={user!.id} currencyCode={cur} />
      </div>

      {/* فلتر الفترة */}
      <div className="flex gap-1 rounded-xl border border-white/5 bg-white/3 p-1">
        {PERIODS.map(p => (
          <Link key={p.key} href={`/dashboard/accounting/expenses?period=${p.key}`}
            className={`flex-1 rounded-lg py-2 text-center text-xs font-medium transition-colors ${
              period === p.key ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
            }`}>
            {p.label}
          </Link>
        ))}
      </div>

      {/* الإجمالي */}
      <div className="rounded-2xl border border-red-500/15 bg-red-500/5 p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">إجمالي المصروفات</p>
        <p dir="ltr" className="mt-2 text-3xl font-bold tabular-nums text-red-400 sm:text-4xl">
          {fmt(total)}<span className="mr-2 text-base font-normal text-slate-400">{cur}</span>
        </p>
        <p className="mt-1 text-xs text-slate-500">{expenses.length} مصروف · {categories.length} تصنيف</p>
      </div>

      {/* التوزيع بالتصنيف */}
      {categories.length > 0 && (
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">التوزيع بالتصنيف</h2>
          <div className="space-y-3">
            {categories.map(([cat, amt]) => (
              <div key={cat}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-slate-300">{cat}</span>
                  <span className="font-medium text-slate-300" dir="ltr">{fmt(amt)} {cur} · {Math.round((amt / total) * 100)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                  <div className="h-full rounded-full bg-red-500/60" style={{ width: `${(amt / total) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* القائمة */}
      <div>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">المصاريف</h2>
        {expenses.length === 0 ? (
          <div className="rounded-2xl border border-white/5 bg-white/3 py-14 text-center">
            <p className="text-4xl">💸</p>
            <p className="mt-3 font-medium text-slate-300">لا مصاريف في هذه الفترة</p>
            <p className="mt-1 text-sm text-slate-500">استخدم زر "➕ مصروف جديد" للتسجيل السريع</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/5 bg-slate-900">
            <table className="min-w-[680px] w-full text-sm">
              <thead className="border-b border-white/5 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-right font-medium">البيان</th>
                  <th className="px-4 py-3 text-right font-medium">التصنيف</th>
                  <th className="px-4 py-3 text-right font-medium">التاريخ</th>
                  <th className="px-4 py-3 text-left font-medium">المبلغ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {expenses.map(e => (
                  <tr key={e.id}>
                    <td className="px-4 py-3 text-slate-300">
                      {e.description}
                      {e.party_name && <span className="mr-1 text-xs text-slate-500">· {e.party_name}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-400">{e.category ?? 'أخرى'}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500" dir="ltr">{e.date}</td>
                    <td className="px-4 py-3 text-left font-bold tabular-nums text-red-400" dir="ltr">−{fmt(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
