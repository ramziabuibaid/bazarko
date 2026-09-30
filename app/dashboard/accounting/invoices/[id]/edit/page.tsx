import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'تعديل فاتورة المبيعات — Bazarko ERP',
}

export default async function EditInvoicePage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: invoice } = await supabase.from('invoices').select('id').eq('id', params.id).eq('store_id', storeId).single()
  if (!invoice) notFound()
  redirect(`/dashboard/accounting/invoices/${params.id}`)
}
