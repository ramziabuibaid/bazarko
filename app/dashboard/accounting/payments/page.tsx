import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import VouchersTable from '@/components/dashboard/accounting/VouchersTable'

export default async function PaymentsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  const { data: vouchers } = await supabase
    .from('vouchers')
    .select('id, voucher_number, type, date, amount, party_name, customer_id, payment_method, category, description, reference')
    .eq('store_id', store.id)
    .eq('type', 'payment')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  const { data: customers } = await supabase
    .from('customers')
    .select('id, name, phone')
    .eq('store_id', store.id)
    .order('name')

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/dashboard/accounting" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          ← المحاسبة
        </Link>
        <h1 className="text-xl font-semibold text-white">سندات الصرف</h1>
      </div>

      <VouchersTable
        vouchers={vouchers ?? []}
        type="payment"
        storeId={store.id}
        userId={user.id}
        currencyCode={store.currency_code}
        customers={customers ?? []}
      />
    </div>
  )
}
