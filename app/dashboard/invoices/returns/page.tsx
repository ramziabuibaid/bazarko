import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import SalesReturnsClient from './SalesReturnsClient'

export const metadata = {
  title: 'مردودات المبيعات — Bazarko ERP',
}

export default async function SalesReturnsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: returns },
    { data: customers },
    { data: products },
    { data: invoices }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase
      .from('sales_returns')
      .select('*, customer:customers(id, name, phone), items:sales_return_items(*)')
      .eq('store_id', storeId)
      .order('return_date', { ascending: false }),
    supabase
      .from('customers')
      .select('id, name, phone, balance')
      .eq('store_id', storeId)
      .order('name'),
    supabase
      .from('products')
      .select('id, name, price, stock_quantity')
      .eq('store_id', storeId)
      .order('name'),
    supabase
      .from('invoices')
      .select('id, invoice_number, customer_id, total_amount, created_at')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(100)
  ])

  return (
    <SalesReturnsClient
      store={store!}
      initialReturns={returns || []}
      customers={customers || []}
      products={products || []}
      invoices={invoices || []}
    />
  )
}
