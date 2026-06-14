import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import ProductForm from '@/components/dashboard/products/ProductForm'

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: { category_id?: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code, secondary_currency_code, exchange_rate')
    .eq('id', storeId)
    .single()

  if (!store) redirect('/onboarding')

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .eq('store_id', store.id)
    .eq('is_active', true)
    .order('name')

  const preselectedCategory = searchParams.category_id ?? ''

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">منتج جديد</h1>
        <p className="mt-1 text-sm text-slate-400">أضف منتجاً جديداً لمتجرك</p>
      </div>
      <ProductForm
        storeId={store.id}
        currencyCode={store.currency_code}
        secondaryCurrencyCode={store.secondary_currency_code}
        exchangeRate={store.exchange_rate}
        categories={categories ?? []}
        initialData={preselectedCategory ? { category_id: preselectedCategory } : undefined}
      />
    </div>
  )
}
