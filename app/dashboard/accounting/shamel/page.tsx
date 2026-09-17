import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import ShamelWizardClient from './ShamelWizardClient'
import FeatureGate from '@/components/dashboard/FeatureGate'

export const metadata = {
  title: 'مركز استعلام واستيراد بيانات الشامل المحاسبي — Bazarko ERP',
}

export const dynamic = 'force-dynamic'

export default async function ShamelImportPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: syncConfig },
    { data: snapshots },
    { count: accountsCount },
    { count: customersCount },
    { count: productsCount },
    { count: checksCount },
    { count: isoCustomersCount },
    { count: isoStockCount },
    { count: isoChequesCount },
    { count: isoAccountsCount },
    { data: chequeStats },
  ] = await Promise.all([
    supabase
      .from('stores')
      .select('id, name, currency_code, plan')
      .eq('id', storeId)
      .single(),
    supabase
      .from('shamel_sync_configs')
      .select('*')
      .eq('store_id', storeId)
      .maybeSingle(),
    supabase
      .from('shamel_snapshots')
      .select('*')
      .eq('store_id', storeId)
      .order('imported_at', { ascending: false })
      .limit(10),
    supabase
      .from('accounts')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId),
    supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId),
    supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId),
    supabase
      .from('checks')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId),
    supabase
      .from('shamel_customers')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId),
    supabase
      .from('shamel_stock')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId),
    supabase
      .from('shamel_cheques')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId),
    supabase
      .from('shamel_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId),
    supabase
      .rpc('shamel_get_cheque_stats', { p_store_id: storeId }),
  ])

  return (
    <FeatureGate
      plan={store?.plan}
      featureName="مركز استعلام واستيراد بيانات الشامل المحاسبي (Al-Shamel ERP)"
      featureDescription="استعلام وتصفح شامل لبيانات الشامل المحاسبي (الزبائن، الشيكات، المخزون، الحسابات) مع إمكانية الموائمة والترحيل التدريجي إلى بازاركو."
      icon="🔄"
    >
      <ShamelWizardClient
        store={store!}
        initialSyncConfig={syncConfig}
        initialSnapshots={snapshots || []}
        initialChequeStats={chequeStats || null}
        existingStats={{
          accounts: accountsCount || 0,
          customers: customersCount || 0,
          products: productsCount || 0,
          checks: checksCount || 0,
        }}
        isolatedStats={{
          customers: isoCustomersCount || 0,
          stock: isoStockCount || 0,
          cheques: isoChequesCount || 0,
          accounts: isoAccountsCount || 0,
        }}
      />
    </FeatureGate>
  )
}
