import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import CreatePOClient from './CreatePOClient'

export const metadata = {
  title: 'إنشاء أمر شراء جديد — Bazarko ERP',
}

export default async function NewPurchaseOrderPage() {
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
    supabase.from('products').select('id, name, sku, barcode, price, cost_price, stock_quantity').eq('store_id', storeId).order('name')
  ])

  return (
    <CreatePOClient
      store={store!}
      suppliers={suppliers || []}
      products={products || []}
    />
  )
}
