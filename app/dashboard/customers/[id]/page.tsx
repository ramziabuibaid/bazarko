import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import CustomerProfile from '@/components/dashboard/customers/CustomerProfile'

interface Props {
  params: { id: string }
}

export default async function CustomerDetailPage({ params }: Props) {
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

  const { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('id', params.id)
    .eq('store_id', store.id)
    .single()

  if (!customer) notFound()

  const { data: ledger } = await supabase
    .from('customer_ledger')
    .select('id, type, date, description, debit, credit, balance, reference_type, created_at')
    .eq('customer_id', customer.id)
    .order('created_at', { ascending: false })
    .limit(50)

  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_number, status, total_amount, amount_paid, created_at')
    .eq('customer_id', customer.id)
    .order('created_at', { ascending: false })
    .limit(10)

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/dashboard/customers" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          ← الزبائن
        </Link>
        <h1 className="text-xl font-semibold text-white">{customer.name}</h1>
      </div>

      <CustomerProfile
        customer={customer}
        ledger={ledger ?? []}
        orders={orders ?? []}
        currencyCode={store.currency_code}
        storeId={store.id}
      />
    </div>
  )
}
