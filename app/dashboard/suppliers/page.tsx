import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import SuppliersClient from './SuppliersClient'

export const metadata = {
  title: 'دليل الموردين — Bazarko ERP',
}

export default async function SuppliersPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: suppliers }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase.from('suppliers').select('*').eq('store_id', storeId).order('name', { ascending: true })
  ])

  return (
    <SuppliersClient
      store={store!}
      initialSuppliers={suppliers || []}
    />
  )
}
