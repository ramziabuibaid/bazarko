import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import ChequesClient from './ChequesClient'

export const metadata = {
  title: 'محفظة الشيكات — Bazarko ERP',
}

export default async function ChequesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: checks },
    { data: bankAccounts },
    { data: suppliers },
    { data: customers },
    { data: operations }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase
      .from('checks')
      .select('*, customer:customers(id, name, phone), supplier:suppliers(id, name, phone), deposit_bank:bank_accounts(id, bank_name, account_number)')
      .eq('store_id', storeId)
      .order('due_date', { ascending: true }),
    supabase
      .from('bank_accounts')
      .select('id, bank_code, bank_name, branch_name, account_number, currency, balance')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .order('bank_name'),
    supabase
      .from('suppliers')
      .select('id, name, phone, balance')
      .eq('store_id', storeId)
      .order('name'),
    supabase
      .from('customers')
      .select('id, name, phone, balance')
      .eq('store_id', storeId)
      .order('name'),
    supabase
      .from('check_operations')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(200)
  ])

  return (
    <ChequesClient
      store={store!}
      initialChecks={checks || []}
      bankAccounts={bankAccounts || []}
      suppliers={suppliers || []}
      customers={customers || []}
      operations={operations || []}
    />
  )
}
