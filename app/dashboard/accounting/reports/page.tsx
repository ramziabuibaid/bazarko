import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import FinancialReportsClient from '@/components/dashboard/accounting/FinancialReportsClient'

export const metadata = {
  title: 'القوائم والتقارير المالية — Bazarko ERP',
}

interface SearchParams {
  from?: string
  to?: string
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code, name')
    .eq('id', storeId)
    .single()

  if (!store) redirect('/onboarding')

  const now = new Date()
  const defaultFrom = searchParams.from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const defaultTo = searchParams.to || now.toISOString().slice(0, 10)

  return (
    <div className="p-4 sm:p-6" dir="rtl">
      <FinancialReportsClient
        storeId={store.id}
        storeName={store.name}
        currencyCode={store.currency_code}
        initialFromDate={defaultFrom}
        initialToDate={defaultTo}
      />
    </div>
  )
}
