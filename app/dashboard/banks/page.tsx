import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import BanksClient from './BanksClient'

export const metadata = {
  title: 'الحسابات البنكية — Bazarko ERP',
}

export default async function BanksPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: bankAccounts },
    { data: parentAccounts }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase
      .from('bank_accounts')
      .select('*, account:accounts(id, code, name)')
      .eq('store_id', storeId)
      .order('created_at', { ascending: true }),
    supabase
      .from('accounts')
      .select('id, code, name')
      .eq('store_id', storeId)
      .eq('type', 'asset')
      .order('code', { ascending: true })
  ])

  return (
    <BanksClient
      store={store!}
      initialBankAccounts={bankAccounts || []}
      parentAccounts={parentAccounts || []}
    />
  )
}
