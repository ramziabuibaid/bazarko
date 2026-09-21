import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import VouchersTable from '@/components/dashboard/accounting/VouchersTable'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'

import { getUserAllowedCashBoxes } from '@/app/dashboard/accounting/vouchers/voucher-actions'

export const metadata = {
  title: 'سندات القبض المالي — Bazarko ERP',
}

export default async function ReceiptsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: vouchers },
    { data: customers },
    cashBoxes,
    { data: bankAccounts }
  ] = await Promise.all([
    supabase
      .from('stores')
      .select('id, currency_code, name, phone')
      .eq('id', storeId)
      .single(),
    supabase
      .from('vouchers')
      .select('id, voucher_number, type, date, amount, cash_amount, checks_amount, checks_data, party_name, customer_id, supplier_id, invoice_id, purchase_invoice_id, payment_method, category, description, reference, cash_box_id, bank_account_id, invoices(invoice_number), cash_boxes(name)')
      .eq('store_id', storeId)
      .eq('type', 'receipt')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('customers')
      .select('id, name, phone, balance')
      .eq('store_id', storeId)
      .order('name'),
    getUserAllowedCashBoxes(storeId, user.id, 'receipt'),
    supabase
      .from('bank_accounts')
      .select('id, bank_name, account_number, currency')
      .eq('store_id', storeId)
      .eq('is_active', true)
  ])

  if (!store) redirect('/onboarding')

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <BackToDashboardButton href="/dashboard/accounting-hub" label="العودة إلى لوحة الإدارة المالية والمحاسبية" />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/accounting" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
            ← المحاسبة
          </Link>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <span>💵</span> سندات القبض المالي
          </h1>
        </div>
      </div>

      <VouchersTable
        vouchers={vouchers ?? []}
        type="receipt"
        storeId={store.id}
        userId={user.id}
        currencyCode={store.currency_code}
        customers={customers ?? []}
        cashBoxes={cashBoxes ?? []}
        bankAccounts={bankAccounts ?? []}
        storeName={store.name}
        storePhone={store.phone ?? undefined}
      />
    </div>
  )
}
