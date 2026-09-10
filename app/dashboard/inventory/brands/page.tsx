import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import BrandsClient from './BrandsClient'

export const metadata = {
  title: 'دليل الماركات والبراندات — Bazarko ERP',
}

export default async function BrandsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: brands }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase
      .from('brands')
      .select('*')
      .eq('store_id', storeId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
  ])

  return (
    <BrandsClient
      store={store!}
      initialBrands={brands || []}
    />
  )
}
