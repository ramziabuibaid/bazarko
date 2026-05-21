import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ProductForm from '@/components/dashboard/products/ProductForm'

export default async function NewProductPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code')
    .eq('owner_id', user.id)
    .single()

  if (!store) redirect('/onboarding')

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .eq('store_id', store.id)
    .eq('is_active', true)
    .order('name')

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">منتج جديد</h1>
        <p className="mt-1 text-sm text-slate-400">أضف منتجاً جديداً لمتجرك</p>
      </div>
      <ProductForm
        storeId={store.id}
        currencyCode={store.currency_code}
        categories={categories ?? []}
      />
    </div>
  )
}
