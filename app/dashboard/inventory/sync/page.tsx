import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import SyncHubClient from './SyncHubClient'
import FeatureGate from '@/components/dashboard/FeatureGate'

export const metadata = {
  title: 'مركز مزامنة وربط المخزون — Bazarko ERP',
}

export default async function InventorySyncPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: logs },
    { count: productsCount }
  ] = await Promise.all([
    supabase
      .from('stores')
      .select('id, name, api_sync_key, currency_code, plan')
      .eq('id', storeId)
      .single(),
    supabase
      .from('inventory_sync_logs')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(15),
    supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId),
  ])

  return (
    <FeatureGate
      plan={store?.plan}
      featureName="مركز مزامنة وربط المخزون (Sync API)"
      featureDescription="ربط المخزون بين الفروع وتحديث كميات وأسعار الأصناف آلياً عبر مفتاح API مخصص."
      icon="⚡"
    >
      <SyncHubClient
        store={store!}
        initialLogs={logs || []}
        totalProductsCount={productsCount || 0}
      />
    </FeatureGate>
  )
}
