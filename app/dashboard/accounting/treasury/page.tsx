import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { getDefaultCashBox, getCashBalance } from '@/lib/accounting/treasury'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import TreasuryClient from '@/components/dashboard/accounting/TreasuryClient'

const SOURCE_LABELS: Record<string, string> = {
  voucher: 'سند', order: 'طلبية', invoice: 'فاتورة',
  manual: 'يدوي', closing: 'تسوية', opening: 'افتتاحي', transfer: 'تحويل',
}

export default async function TreasuryPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores').select('id, currency_code').eq('id', storeId).single()
  if (!store) redirect('/onboarding')

  const box = await getDefaultCashBox(supabase, store.id)
  if (!box) {
    return <div className="p-4 sm:p-6 text-slate-400">تعذّر تجهيز الصندوق. أعد المحاولة.</div>
  }

  const balance = await getCashBalance(supabase, store.id, box.id, box.opening_balance)

  const today = new Date().toISOString().split('T')[0]

  const [{ data: todayMovements }, { data: recentMovements }, { data: sessions }] = await Promise.all([
    supabase.from('cash_movements')
      .select('direction, amount')
      .eq('store_id', store.id).eq('cash_box_id', box.id).eq('date', today),
    supabase.from('cash_movements')
      .select('id, direction, amount, source, party_name, payment_method, description, date, created_at')
      .eq('store_id', store.id).eq('cash_box_id', box.id)
      .order('created_at', { ascending: false }).limit(30),
    supabase.from('cash_sessions')
      .select('id, closed_at, system_total, counted_amount, variance, notes')
      .eq('store_id', store.id).eq('cash_box_id', box.id)
      .eq('status', 'closed')
      .order('closed_at', { ascending: false }).limit(5),
  ])

  const todayIn  = (todayMovements ?? []).filter(m => m.direction === 'in').reduce((s, m) => s + m.amount, 0)
  const todayOut = (todayMovements ?? []).filter(m => m.direction === 'out').reduce((s, m) => s + m.amount, 0)
  const todayNet = todayIn - todayOut

  const cur = store.currency_code
  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 2 })

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {/* العنوان */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/accounting" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
            ← المحاسبة
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-white">🏦 الصندوق والخزينة</h1>
            <p className="mt-0.5 text-sm text-slate-400">{box.name}</p>
          </div>
        </div>
      </div>

      {/* بطاقة الرصيد + الإجراءات */}
      <div className={`rounded-2xl border p-5 sm:p-6 ${
        balance > 0 ? 'border-emerald-500/20 bg-emerald-500/5'
        : balance < 0 ? 'border-red-500/20 bg-red-500/5'
        : 'border-white/5 bg-slate-900'
      }`}>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">الرصيد الحالي في الصندوق</p>
        <p dir="ltr" className={`mt-2 text-4xl font-bold tabular-nums sm:text-5xl ${
          balance > 0 ? 'text-emerald-400' : balance < 0 ? 'text-red-400' : 'text-slate-300'
        }`}>
          {fmt(balance)}<span className="mr-2 text-lg font-normal text-slate-400">{cur}</span>
        </p>
        <p className="mt-1 text-xs text-slate-500">الرصيد الافتتاحي: {fmt(box.opening_balance)} {cur}</p>

        <TreasuryClient
          currencyCode={cur}
          openingBalance={box.opening_balance}
          systemBalance={balance}
        />
      </div>

      {/* ملخص اليوم */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-emerald-500/10 bg-slate-900 p-4">
          <p className="text-xs text-slate-400">📥 داخل اليوم</p>
          <p dir="ltr" className="mt-2 text-xl font-bold tabular-nums text-emerald-400 sm:text-2xl">{fmt(todayIn)}</p>
        </div>
        <div className="rounded-2xl border border-red-500/10 bg-slate-900 p-4">
          <p className="text-xs text-slate-400">📤 خارج اليوم</p>
          <p dir="ltr" className="mt-2 text-xl font-bold tabular-nums text-red-400 sm:text-2xl">{fmt(todayOut)}</p>
        </div>
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-4">
          <p className="text-xs text-slate-400">💵 صافي اليوم</p>
          <p dir="ltr" className={`mt-2 text-xl font-bold tabular-nums sm:text-2xl ${todayNet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {todayNet >= 0 ? '+' : ''}{fmt(todayNet)}
          </p>
        </div>
      </div>

      {/* آخر عمليات الإغلاق */}
      {(sessions ?? []).length > 0 && (
        <div>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">آخر عمليات الإغلاق</h2>
          <div className="space-y-2">
            {(sessions ?? []).map(s => (
              <div key={s.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-900 px-4 py-3 text-sm">
                <div>
                  <p className="text-slate-300">{s.closed_at ? new Date(s.closed_at).toLocaleString('ar') : '—'}</p>
                  {s.notes && <p className="mt-0.5 text-xs text-slate-500">{s.notes}</p>}
                </div>
                <div className="flex items-center gap-4 text-xs" dir="ltr">
                  <span className="text-slate-400">نظام {fmt(s.system_total)}</span>
                  <span className="text-slate-400">فعلي {fmt(s.counted_amount ?? 0)}</span>
                  <span className={`font-bold ${(s.variance ?? 0) === 0 ? 'text-slate-400' : (s.variance ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(s.variance ?? 0) > 0 ? '+' : ''}{fmt(s.variance ?? 0)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* آخر الحركات */}
      <div>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">آخر الحركات</h2>
        {(recentMovements ?? []).length === 0 ? (
          <p className="rounded-2xl border border-white/5 bg-slate-900 p-6 text-center text-sm text-slate-500">
            لا توجد حركات بعد
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/5 bg-slate-900">
            <table className="min-w-[680px] w-full text-sm">
              <thead className="border-b border-white/5 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-right font-medium">الوصف</th>
                  <th className="px-4 py-3 text-right font-medium">المصدر</th>
                  <th className="px-4 py-3 text-right font-medium">التاريخ</th>
                  <th className="px-4 py-3 text-left font-medium">المبلغ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(recentMovements ?? []).map(m => (
                  <tr key={m.id}>
                    <td className="px-4 py-3 text-slate-300">
                      {m.description}
                      {m.party_name && <span className="mr-1 text-xs text-slate-500">· {m.party_name}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{SOURCE_LABELS[m.source] ?? m.source}</td>
                    <td className="px-4 py-3 text-xs text-slate-500" dir="ltr">{m.date}</td>
                    <td dir="ltr" className={`px-4 py-3 text-left font-bold tabular-nums ${m.direction === 'in' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {m.direction === 'in' ? '+' : '−'}{fmt(m.amount)}
                    </td>
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
