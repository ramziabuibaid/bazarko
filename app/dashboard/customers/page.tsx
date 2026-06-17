import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
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
      .select('balance')
      .eq('store_id', store.id)
      .eq('is_active', true),
  ])

  const totalDebt = (debtStats ?? []).reduce((s, c) => s + (c.balance > 0 ? c.balance : 0), 0)
  const withDebt  = (debtStats ?? []).filter(c => c.balance > 0).length

  return (
    <div className="p-6">
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
            sub: `${totalDebt.toLocaleString('ar')} ${store.currency_code}`,
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
