import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import AdStudioClient from '@/components/dashboard/marketing/AdStudioClient'

export const metadata = {
  title: 'استوديو الإعلانات وواتساب — Bazarko ERP',
}

export default async function MarketingAdsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: products },
    { data: customers },
    { data: campaigns }
  ] = await Promise.all([
    supabase
      .from('stores')
      .select('id, name, subdomain, country_code, currency_code')
      .eq('id', storeId)
      .single(),
    supabase
      .from('products')
      .select('id, name, price, compare_price, thumbnail_url, images, slug')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('customers')
      .select('id, name, phone, email, balance')
      .eq('store_id', storeId)
      .order('name')
      .limit(100),
    supabase
      .from('ads_campaigns')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(30),
  ])

  return (
    <AdStudioClient
      store={store!}
      products={products || []}
      customers={customers || []}
      initialCampaigns={campaigns || []}
    />
  )
}
