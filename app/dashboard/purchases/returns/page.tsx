import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import PurchaseReturnsClient from './PurchaseReturnsClient'

export const metadata = {
  title: 'مردودات المشتريات — Bazarko ERP',
}

export default async function PurchaseReturnsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: returns },
    { data: suppliers },
    { data: products }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase
      .from('purchase_returns')
      .select('*, supplier:suppliers(id, name, phone), items:purchase_return_items(*)')
      .eq('store_id', storeId)
      .order('return_date', { ascending: false }),
    supabase.from('suppliers').select('id, name, phone, balance').eq('store_id', storeId).order('name'),
    supabase.from('products').select('id, name, cost_price, price, stock_quantity').eq('store_id', storeId).order('name')
  ])

  return (
    <PurchaseReturnsClient
      store={store!}
      initialReturns={returns || []}
      suppliers={suppliers || []}
      products={products || []}
    />
  )
}
