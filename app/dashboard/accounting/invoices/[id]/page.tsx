import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect, notFound } from 'next/navigation'
import { customerInvoiceItem } from '@/lib/invoices/detail-presentation'
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
    .select('id, owner_id, currency_code, name, phone, logo_url, address, tax_number')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('id, invoice_number, order_id, customer_name, customer_phone, customer_address, customer_id, issue_date, due_date, status, subtotal, discount_type, discount_value, discount_amount, total, amount_paid, payment_method, notes, created_at')
    .eq('id', params.id)
    .eq('store_id', store.id)
    .maybeSingle()

  if (invoiceError) throw new Error('تعذر تحميل الفاتورة')
  if (!invoice) notFound()

  const { data: member } = await supabase.from('store_members').select('role').eq('store_id',store.id).eq('profile_id',user.id).eq('is_active',true).maybeSingle()
  const canViewInternal = store.owner_id === user.id || ['owner','admin'].includes(member?.role || '')
  const [{ data: items, error: itemsError }, { data: linkedOrder }, { data: journalEntry }] = await Promise.all([
    supabase
      .from('invoice_items')
      .select(canViewInternal ? 'id, name, sku, quantity, unit_price, total, cost_price' : 'id, name, sku, quantity, unit_price, total')
      .eq('invoice_id', invoice.id)
      .order('id'),
    invoice.order_id
      ? supabase
          .from('orders')
          .select('id, order_number')
          .eq('id', invoice.order_id)
          .eq('store_id', store.id)
          .single()
      : Promise.resolve({ data: null }),
    supabase
      .from('journal_entries')
      .select('id, entry_number')
      .eq('store_id', store.id)
      .eq('ref_id', invoice.id)
      .eq('source', 'invoice')
      .maybeSingle()
  ])

  if (itemsError) throw new Error('تعذر تحميل بنود الفاتورة')
  const {data:receipts,error:receiptError} = await supabase.from('vouchers').select('id,voucher_number,amount').eq('store_id',store.id).eq('invoice_id',invoice.id).eq('type','receipt')
  if(receiptError) throw new Error('تعذر تحميل التحصيل')
  const costRows = (items || []) as unknown as {cost_price?:number|null;quantity:number}[]
  const internalCost = canViewInternal ? (costRows.length && costRows.every(i=>i.cost_price !== null && i.cost_price !== undefined) ? Math.round(costRows.reduce((sum,i)=>sum+Number(i.cost_price)*Number(i.quantity),0)*100)/100 : null) : undefined
  return (
    <div className="p-4 sm:p-6 max-w-[1600px]" dir="rtl">
      <InvoiceView
        invoice={invoice as any}
        items={((items || []) as any[]).map(customerInvoiceItem)}
        storeName={store.name}
        storePhone={(store as { phone?: string | null }).phone ?? null}
        storeLogo={(store as { logo_url?: string | null }).logo_url ?? null}
        currencyCode={store.currency_code}
        storeAddress={store.address}
        storeTaxNumber={store.tax_number}
        linkedOrder={linkedOrder ?? null}
        journalEntry={canViewInternal ? journalEntry ?? null : null}
        internalCost={internalCost}
        canEmail={store.owner_id === user.id}
        receipts={receipts || []}
      />
    </div>
  )
}
