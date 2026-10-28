import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { tafqeetCheque } from '@/lib/tafqeet'
import ReceiptPrintClient from '@/components/dashboard/receipts/ReceiptPrintClient'

export const metadata = {
  title: 'طباعة سند قبض مالي — Bazarko ERP',
}

export default async function PrintReceiptPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: voucher },
    { data: dbChecks }
  ] = await Promise.all([
    supabase.from('stores').select('*').eq('id', storeId).single(),
    supabase.from('vouchers').select('*, invoices(invoice_number), cash_box:cash_boxes!vouchers_cash_box_id_fkey(name), bank_accounts(bank_name,account_number)').eq('id', params.id).eq('store_id', storeId).eq('type', 'receipt').single(),
    supabase.from('checks').select('check_number, bank_name, bank_code, branch_name, branch_code, account_number, drawer_name, amount, due_date').eq('voucher_id', params.id).eq('store_id', storeId)
  ])

  if (!store || !voucher) notFound()

  // If customer is attached, get full customer details
  let customer: any = null
  if (voucher.customer_id) {
    const { data: custData } = await supabase
      .from('customers')
      .select('*')
      .eq('id', voucher.customer_id)
      .single()
    customer = custData
  }

  const { data: canManageFiles } = voucher.payment_method === 'bank'
    ? await supabase.rpc('can_manage_cash_permissions', { p_store_id: storeId })
    : { data: false }

  const amount = Number(voucher.amount || 0)
  const currency = store.currency_code || 'ILS'
  const tafqeetText = tafqeetCheque(amount, currency)

  const paymentMethodLabel: Record<string, string> = {
    cash: 'نقداً',
    bank: 'تحويل بنكي',
    card: 'بطاقة ائتمانية',
    transfer: 'تحويل إلكتروني',
    cheque: 'شيكات مصرفية',
    split: 'نقدي + شيكات (دفع مركب)',
  }

  const rawChecks: any[] = (voucher.checks_data && voucher.checks_data.length > 0)
    ? voucher.checks_data
    : (dbChecks || [])

  const checks = rawChecks.map((chk: any) => {
    const matchingDbCheck = (dbChecks || []).find((dc: any) => String(dc.check_number) === String(chk.check_number))
    return {
      ...chk,
      bank_code: chk.bank_code || matchingDbCheck?.bank_code || null,
      branch_code: chk.branch_code || matchingDbCheck?.branch_code || null,
      branch_name: chk.branch_name || matchingDbCheck?.branch_name || null,
    }
  })

  return (
    <ReceiptPrintClient
      store={store}
      voucher={voucher}
      customer={customer}
      checks={checks}
      amount={amount}
      currency={currency}
      tafqeetText={tafqeetText}
      paymentMethodLabel={paymentMethodLabel}
      canManageFiles={Boolean(canManageFiles)}
      storeId={storeId}
    />
  )
}
