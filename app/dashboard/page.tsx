import DashboardRefresh from '@/components/dashboard/DashboardRefresh'
import AdvancedDashboard from '@/components/dashboard/advanced/AdvancedDashboard'
import { loadAdvancedDashboard } from '@/lib/dashboard/load-advanced-dashboard'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getStoreForUser } from '@/lib/supabase/getStore'
import SimpleDashboard from '@/components/dashboard/simple/SimpleDashboard'
import { useSimpleDashboard } from '@/lib/dashboard/simple-metrics'
import { loadSimpleDashboard } from '@/lib/dashboard/load-simple-dashboard'

export default async function DashboardPage({ searchParams }: { searchParams: { view?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, currency_code, secondary_currency_code, exchange_rate, is_active, suspended_at, logo_url, phone, whatsapp, subdomain, country_code, plan, settings')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  if (useSimpleDashboard(store.plan, store.settings) && searchParams.view !== 'advanced') {
    const data = await loadSimpleDashboard(supabase, storeId)
    return <SimpleDashboard store={{ ...store, settings: store.settings || {} }} data={data} />
  }

  const data = await loadAdvancedDashboard(supabase, storeId)
  return <><DashboardRefresh loadedAt={new Date().toISOString()}/>{(!store.is_active || store.suspended_at) && <div role="alert" className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200">متجرك غير نشط حالياً. راجع إعدادات المتجر قبل مشاركة الرابط.</div>}<AdvancedDashboard store={{...store, settings:store.settings || {}}} data={data}/></>
}
