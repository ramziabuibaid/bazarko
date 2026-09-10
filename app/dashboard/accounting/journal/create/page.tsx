import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import CreateJournalClient from './CreateJournalClient'

export const metadata = {
  title: 'إنشاء قيد يومية يدوي — Bazarko ERP',
}

export default async function CreateJournalPage() {
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
      .select('id, code, name, type')
      .eq('store_id', storeId)
      .eq('is_group', false)
      .order('code', { ascending: true })
  ])

  return (
    <CreateJournalClient
      store={store!}
      accounts={accounts || []}
    />
  )
}
