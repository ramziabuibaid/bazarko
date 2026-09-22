import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import AccountStatementClient, { AccountOption } from './AccountStatementClient'

export const metadata = {
  title: 'كشف حساب محاسبي عام — Bazarko ERP',
}

interface SearchParams {
  accountId?: string
  from?: string
  to?: string
}

export default async function AccountStatementPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, currency_code')
    .eq('id', storeId)
    .single()

  if (!store) redirect('/onboarding')

  // جلب كافة الحسابات النشطة في شجرة الحسابات
  const { data: accountsData } = await supabase
    .from('accounts')
    .select('id, code, name, type, normal_balance, is_group, currency')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('code', { ascending: true })

  const accounts = (accountsData || []) as AccountOption[]

  return (
    <div className="p-4 sm:p-6" dir="rtl">
      <AccountStatementClient
        accounts={accounts}
        initialAccountId={searchParams.accountId}
        currencyCode={store.currency_code || 'ILS'}
        storeName={store.name}
      />
    </div>
  )
}
