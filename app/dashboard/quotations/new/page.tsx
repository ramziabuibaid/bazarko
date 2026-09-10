import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import CreateQuotationClient from './CreateQuotationClient'

export const metadata = {
  title: 'إنشاء عرض سعر جديد — Bazarko ERP',
}

export default async function NewQuotationPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: customers },
    { data: products }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase.from('customers').select('id, name, phone').eq('store_id', storeId).order('name'),
    supabase.from('products').select('id, name, price, stock_quantity').eq('store_id', storeId).order('name')
  ])

  return (
    <CreateQuotationClient
      store={store!}
      customers={customers || []}
      products={products || []}
    />
  )
}
