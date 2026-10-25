import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { checkStorePermission } from '@/lib/supabase/permissions'
import EditInvoiceForm from '@/components/dashboard/accounting/EditInvoiceForm'

export const metadata = {
  title: 'تعديل فاتورة المبيعات — Bazarko ERP',
}

export default async function EditInvoicePage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const canApproveBelowCost = await checkStorePermission(storeId, 'sales.below_cost')

  const [
    { data: store },
    { data: invoice },
    { data: items },
    { data: profile },
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase.from('invoices').select('*').eq('id', params.id).eq('store_id', storeId).single(),
    supabase.from('invoice_items').select('*').eq('invoice_id', params.id).order('id'),
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
  ])

  if (!store || !invoice) notFound()

  const productIds = (items || []).map(i => i.product_id).filter(Boolean)
  const productsCostMap = new Map<string, number>()
  if (productIds.length > 0) {
    const { data: prods } = await supabase.from('products').select('id, cost_price').in('id', productIds)
    if (prods) {
      for (const p of prods) {
        productsCostMap.set(p.id, Number(p.cost_price || 0))
      }
    }
  }

  const enrichedItems = (items || []).map(i => ({
    ...i,
    cost_price: Number(i.cost_price || 0) || (i.product_id ? (productsCostMap.get(i.product_id) || 0) : 0),
  }))

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <EditInvoiceForm
        storeId={store.id}
        userId={user.id}
        currencyCode={store.currency_code}
        storeName={store.name}
        canApproveBelowCost={canApproveBelowCost}
        userName={profile?.full_name || user.email?.split('@')[0] || ''}
        invoice={{
          ...invoice,
          items: enrichedItems,
        }}
      />
    </div>
  )
}
