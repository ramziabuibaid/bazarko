import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import CreateQuotationClient from '@/app/dashboard/quotations/new/CreateQuotationClient'

export const metadata = {
  title: 'تعديل عرض السعر — Bazarko ERP',
}

export default async function EditQuotationPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: quote },
    { data: customers },
    { data: products }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code, subdomain, country_code').eq('id', storeId).single(),
    supabase
      .from('quotations')
      .select('*, customer:customers(id, name, phone, balance), items:quotation_items(*, product:products(id, thumbnail_url, images, cost_price))')
      .eq('id', params.id)
      .eq('store_id', storeId)
      .single(),
    supabase.from('customers').select('id, name, phone, balance').eq('store_id', storeId).order('name').limit(60),
    supabase.from('products').select('id, name, price, cost_price, stock_quantity, sku, barcode, thumbnail_url, images').eq('store_id', storeId).order('is_active', { ascending: false }).order('stock_quantity', { ascending: false }).limit(60)
  ])

  if (!store || !quote) notFound()

  return (
    <CreateQuotationClient
      store={store}
      customers={customers || []}
      products={products || []}
      initialQuote={quote as any}
    />
  )
}
