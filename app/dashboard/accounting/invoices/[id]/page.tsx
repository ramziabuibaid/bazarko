import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect, notFound } from 'next/navigation'
import InvoiceView from '@/components/dashboard/accounting/InvoiceView'

interface Props {
  params: { id: string }
}

export default async function InvoiceDetailPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code, name, phone, logo_url')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, invoice_number, order_id, customer_name, customer_phone, customer_address, customer_id, issue_date, due_date, status, subtotal, discount_type, discount_value, discount_amount, total, amount_paid, payment_method, notes, created_at')
    .eq('id', params.id)
    .eq('store_id', store.id)
    .single()

  if (!invoice) notFound()

  const [{ data: items }, { data: linkedOrder }] = await Promise.all([
    supabase
      .from('invoice_items')
      .select('id, name, sku, quantity, unit_price, total')
      .eq('invoice_id', invoice.id)
      .order('id'),
    invoice.order_id
      ? supabase
          .from('orders')
          .select('id, order_number')
          .eq('id', invoice.order_id)
          .single()
      : Promise.resolve({ data: null }),
  ])

  return (
    <div className="p-4 sm:p-6 max-w-4xl" dir="rtl">
      <InvoiceView
        invoice={invoice as any}
        items={items ?? []}
        storeName={store.name}
        storePhone={(store as { phone?: string | null }).phone ?? null}
        storeLogo={(store as { logo_url?: string | null }).logo_url ?? null}
        currencyCode={store.currency_code}
        linkedOrder={linkedOrder ?? null}
        storeId={store.id}
        userId={user.id}
      />
    </div>
  )
}
