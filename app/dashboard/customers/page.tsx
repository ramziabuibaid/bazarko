import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import CustomersTable from '@/components/dashboard/customers/CustomersTable'

interface Props {
  searchParams: { q?: string; type?: string; sort?: string }
}

export default async function CustomersPage({ searchParams }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  let query = supabase
    .from('customers')
    .select('id, name, phone, email, city, balance, total_orders, customer_type, is_active, created_at', { count: 'exact' })
    .eq('store_id', store.id)

  if (searchParams.q) {
    query = query.or(`name.ilike.%${searchParams.q}%,phone.ilike.%${searchParams.q}%,email.ilike.%${searchParams.q}%`)
  }
  if (searchParams.type && searchParams.type !== 'all') {
    query = query.eq('customer_type', searchParams.type)
  }

  const sortCol =
    searchParams.sort === 'balance' ? 'balance' :
    searchParams.sort === 'orders' ? 'total_orders' : 'created_at'
  query = query.order(sortCol, { ascending: false })

  const { data: customers, count } = await query

  // آخر طلبية لكل زبون
  const customerIds = (customers ?? []).map(c => c.id)
  const lastOrderMap: Record<string, string> = {}
  if (customerIds.length > 0) {
    const { data: orderRows } = await supabase
      .from('orders')
      .select('customer_id, created_at')
      .in('customer_id', customerIds)
      .eq('store_id', store.id)
      .order('created_at', { ascending: false })
    for (const row of (orderRows ?? [])) {
      if (row.customer_id && !lastOrderMap[row.customer_id]) {
        lastOrderMap[row.customer_id] = row.created_at
      }
    }
  }

  // إحصائيات تسويقية
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const [{ count: newThisMonth }, { count: withPhone }, { data: debtStats }] = await Promise.all([
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', store.id)
      .gte('created_at', monthStart),
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', store.id)
      .eq('is_active', true)
      .not('phone', 'is', null),
    supabase
      .from('customers')
      .select('id, name, phone, balance, credit_limit')
      .eq('store_id', store.id)
      .eq('is_active', true),
  ])

  type DebtRow = { id: string; name: string; phone: string | null; balance: number; credit_limit: number | null }
  const debtRows  = (debtStats ?? []) as DebtRow[]
  const totalDebt = debtRows.reduce((s, c) => s + (c.balance > 0 ? c.balance : 0), 0)
  const withDebt  = debtRows.filter(c => c.balance > 0).length

  // أعلى العملاء مديونية (أهمّ ما يبحث عنه صاحب المتجر)
  const topDebtors = debtRows.filter(c => c.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 5)
  // زبائن متأخرون: تجاوزوا حدّ الائتمان المسموح
  const overLimit  = debtRows.filter(c => (c.credit_limit ?? 0) > 0 && c.balance > (c.credit_limit ?? 0))

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">إدارة الزبائن</h1>
        <p className="mt-1 text-sm text-slate-400">{count ?? 0} زبون مسجّل</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            label: 'إجمالي الزبائن',
            value: debtStats?.length ?? 0,
            icon: '👥',
            color: 'text-white',
          },
          {
            label: 'جديد هذا الشهر',
            value: newThisMonth ?? 0,
            icon: '✨',
            color: 'text-sky-400',
          },
          {
            label: 'قابلون للواتساب',
            value: withPhone ?? 0,
            icon: '💬',
            color: 'text-emerald-400',
          },
          {
            label: 'لديهم ذمة',
            value: withDebt,
            icon: '📒',
            color: 'text-red-400',
            sub: `${totalDebt.toLocaleString('ar-u-nu-latn')} ${store.currency_code}`,
          },
        ].map(card => (
          <div key={card.label} className="rounded-2xl border border-white/5 bg-slate-900 p-4">
            <p className="text-xs text-slate-400">{card.icon} {card.label}</p>
            <p className={`mt-1.5 text-xl font-bold ${card.color}`}>{card.value}</p>
            {'sub' in card && card.sub && (
              <p className="mt-0.5 text-xs text-slate-500">{card.sub}</p>
            )}
          </div>
        ))}
      </div>

      {/* تنبيه: زبائن تجاوزوا حدّ الائتمان (متأخرون) */}
      {overLimit.length > 0 && (
        <div className="mb-5 rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-sm font-semibold text-red-300">
            🚨 {overLimit.length} {overLimit.length === 1 ? 'زبون تجاوز' : 'زبائن تجاوزوا'} حدّ الائتمان المسموح
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {overLimit.slice(0, 6).map(c => (
              <Link key={c.id} href={`/dashboard/customers/${c.id}`}
                className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300 hover:bg-white/10">
                {c.name} · <span className="text-red-400" dir="ltr">{c.balance.toLocaleString('ar-u-nu-latn')} {store.currency_code}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* أعلى العملاء مديونية */}
      {topDebtors.length > 0 && (
        <div className="mb-6 rounded-2xl border border-white/5 bg-slate-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">📒 أعلى العملاء مديونية</h2>
            <Link href="/dashboard/customers/ledger" className="text-xs text-sky-400 hover:underline">كشف الذمم الكامل ←</Link>
          </div>
          <div className="space-y-1">
            {topDebtors.map((c, i) => (
              <Link key={c.id} href={`/dashboard/customers/${c.id}`}
                className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-white/5">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs text-slate-400">{i + 1}</span>
                  <span className="truncate text-sm text-slate-200">{c.name}</span>
                </div>
                <span className="shrink-0 text-sm font-semibold text-red-400" dir="ltr">
                  {c.balance.toLocaleString('ar-u-nu-latn')} {store.currency_code}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <CustomersTable
        customers={customers ?? []}
        currencyCode={store.currency_code}
        storeId={store.id}
        activeType={searchParams.type ?? 'all'}
        searchQuery={searchParams.q ?? ''}
        sort={searchParams.sort ?? 'created_at'}
        lastOrderDates={lastOrderMap}
      />
    </div>
  )
}
