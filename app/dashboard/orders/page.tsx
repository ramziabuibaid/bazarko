import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import OrdersTable from '@/components/dashboard/orders/OrdersTable'

interface Props {
  searchParams: {
    status?: string
    q?: string
    page?: string
    dateFrom?: string
    dateTo?: string
  }
}

export default async function OrdersPage({ searchParams }: Props) {
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

  const page     = Math.max(1, parseInt(searchParams.page ?? '1'))
  const pageSize = 20
  const from     = (page - 1) * pageSize
  const to       = from + pageSize - 1

  let query = supabase
    .from('orders')
    .select(
      'id, order_number, status, payment_method, payment_status, total_amount, shipping_city, customer_notes, created_at, customer_name, customer_phone',
      { count: 'exact' }
    )
    .eq('store_id', store.id)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (searchParams.status && searchParams.status !== 'all') {
    query = query.eq('status', searchParams.status)
  }

  if (searchParams.q) {
    query = query.or(
      `order_number.ilike.%${searchParams.q}%,customer_name.ilike.%${searchParams.q}%,customer_phone.ilike.%${searchParams.q}%`
    )
  }

  if (searchParams.dateFrom) {
    query = query.gte('created_at', searchParams.dateFrom)
  }

  if (searchParams.dateTo) {
    query = query.lte('created_at', searchParams.dateTo + 'T23:59:59.999')
  }

  const { data: orders, count } = await query

  const { data: statusRows } = await supabase
    .from('orders')
    .select('status')
    .eq('store_id', store.id)

  const statusCounts: Record<string, number> = {}
  for (const row of statusRows ?? []) {
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">الطلبيات</h1>
          <p className="mt-1 text-sm text-slate-400">إجمالي {count ?? 0} طلبية</p>
        </div>
        <Link
          href="/dashboard/orders/new"
          className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 transition-colors"
        >
          + طلبية جديدة
        </Link>
      </div>

      <OrdersTable
        orders={orders ?? []}
        total={count ?? 0}
        page={page}
        pageSize={pageSize}
        statusCounts={statusCounts}
        currencyCode={store.currency_code}
        activeStatus={searchParams.status ?? 'all'}
        searchQuery={searchParams.q ?? ''}
        dateFrom={searchParams.dateFrom ?? ''}
        dateTo={searchParams.dateTo ?? ''}
      />
    </div>
  )
}
