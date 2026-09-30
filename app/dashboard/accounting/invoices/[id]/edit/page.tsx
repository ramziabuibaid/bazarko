import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
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

  const [
    { data: store },
    { data: invoice },
    { data: items },
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase.from('invoices').select('*').eq('id', params.id).eq('store_id', storeId).single(),
    supabase.from('invoice_items').select('*').eq('invoice_id', params.id).order('id'),
  ])

  if (!store || !invoice) notFound()

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <EditInvoiceForm
        storeId={store.id}
        userId={user.id}
        currencyCode={store.currency_code}
        storeName={store.name}
        invoice={{
          ...invoice,
          items: items || [],
        }}
      />
    </div>
  )
}
