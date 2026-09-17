import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'
import { getAccountingPeriods } from './period-actions'
import PeriodsClient from './PeriodsClient'

export const metadata = {
  title: 'إقفال الفترات المحاسبية — Bazarko ERP',
}

export default async function AccountingPeriodsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, currency_code, plan')
    .eq('id', storeId)
    .single()

  const periods = await getAccountingPeriods(storeId)

  return (
    <div className="space-y-6 p-4 sm:p-6" dir="rtl">
      <div>
        <BackToDashboardButton href="/dashboard/accounting-hub" label="العودة إلى لوحة الإدارة المالية والمحاسبية" />
      </div>

      <PeriodsClient storeId={storeId} storeName={store?.name || ''} initialPeriods={periods} />
    </div>
  )
}
