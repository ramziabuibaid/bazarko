import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import AccountsTreeClient from './AccountsTreeClient'

export const metadata = {
  title: 'دليل الحسابات — Bazarko ERP',
}

export default async function AccountsTreePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: accounts }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase
      .from('accounts')
      .select('*')
      .eq('store_id', storeId)
      .order('code', { ascending: true })
  ])

  return (
    <AccountsTreeClient
      store={store!}
      initialAccounts={accounts || []}
    />
  )
}
