import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CustomersTable from '@/components/dashboard/customers/CustomersTable'

interface Props {
  searchParams: { q?: string; type?: string; sort?: string }
}

export default async function CustomersPage({ searchParams }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code')
    .eq('owner_id', user.id)
    .single()
  if (!store) redirect('/onboarding')

  let query = supabase
    .from('customers')
    .select('id, name, phone, email, city, balance, total_orders, customer_type, is_active, created_at', { count: 'exact' })
    .eq('store_id', store.id)

  if (searchParams.q) {
    query = query.or(`name.ilike.%${searchParams.q}%,phone.ilike.%${searchParams.q}%`)
  }
  if (searchParams.type && searchParams.type !== 'all') {
    query = query.eq('customer_type', searchParams.type)
  }

  const sortCol = searchParams.sort === 'balance' ? 'balance' : searchParams.sort === 'orders' ? 'total_orders' : 'created_at'
  query = query.order(sortCol, { ascending: false })

  const { data: customers, count } = await query

  // إحصائيات سريعة
  const { data: stats } = await supabase
    .from('customers')
    .select('balance, total_orders')
    .eq('store_id', store.id)
    .eq('is_active', true)

  const totalDebt = (stats ?? []).reduce((s: number, c: { balance: number }) => s + (c.balance > 0 ? c.balance : 0), 0)
  const totalCustomers = stats?.length ?? 0
  const withDebt = (stats ?? []).filter((c: { balance: number }) => c.balance > 0).length

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">الزبائن</h1>
        <p className="mt-1 text-sm text-slate-400">{count ?? 0} زبون مسجّل</p>
      </div>

      {/* بطاقات إحصائية */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        {[
          { label: 'إجمالي الزبائن', value: totalCustomers, icon: '👥', color: 'text-white' },
          { label: 'لديهم ذمة', value: withDebt, icon: '📒', color: 'text-red-400' },
          { label: 'إجمالي الذمم', value: `${totalDebt.toLocaleString('ar')} ${store.currency_code}`, icon: '💳', color: 'text-red-400' },
        ].map(card => (
          <div key={card.label} className="rounded-2xl border border-white/5 bg-slate-900 p-4">
            <p className="text-xs text-slate-400">{card.icon} {card.label}</p>
            <p className={`mt-1.5 text-xl font-bold ${card.color}`}>{card.value}</p>
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
      />
    </div>
  )
}
