import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import ChequesClient from './ChequesClient'
import FeatureGate from '@/components/dashboard/FeatureGate'

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
    { data: operations },
    { data: cashBoxes }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code, plan').eq('id', storeId).single(),
    supabase
      .from('checks')
      .select('*, customer:customers(id, name, phone), supplier:suppliers(id, name, phone), deposit_bank:bank_accounts(id, bank_name, account_number), voucher:vouchers!checks_voucher_id_fkey(id, voucher_number, type, date)')
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
      .limit(200),
    supabase
      .from('cash_boxes')
      .select('id, name, type, is_default, is_active')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
  ])

  return (
    <FeatureGate
      plan={store?.plan}
      featureName="محفظة الشيكات والأوراق المالية"
      featureDescription="إدارة كاملة للشيكات الصادرة والواردة، التظهير، إيداع الشيكات في البنوك، التحصيل، الإرجاع، وطباعة الشيكات وسندات الاستلام مع القيود المحاسبية التلقائية."
      icon="🏦"
    >
      <ChequesClient
        store={store!}
        initialChecks={checks || []}
        bankAccounts={bankAccounts || []}
        suppliers={suppliers || []}
        customers={customers || []}
        operations={operations || []}
        cashBoxes={cashBoxes || []}
      />
    </FeatureGate>
  )
}
