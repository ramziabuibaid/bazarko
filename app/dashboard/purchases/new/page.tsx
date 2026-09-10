import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import CreatePurchaseClient from './CreatePurchaseClient'

export const metadata = {
  title: 'تسجيل فاتورة شراء جديدة — Bazarko ERP',
}

export default async function NewPurchasePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: suppliers },
    { data: products }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase.from('suppliers').select('id, name, phone, balance').eq('store_id', storeId).order('name'),
    supabase.from('products').select('id, name, price, cost_price, stock_quantity').eq('store_id', storeId).order('name')
  ])

  return (
    <CreatePurchaseClient
      store={store!}
      suppliers={suppliers || []}
      products={products || []}
    />
  )
}
