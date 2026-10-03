import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import ProductForm from '@/components/dashboard/products/ProductForm'

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: { category_id?: string;brand_id?:string }
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

  const {data:brands,error:brandError}=await supabase.from('brands').select('id,name,is_active').eq('store_id',store.id).order('name')
  if(brandError)throw new Error('تعذر تحميل الماركات')

  const { data: categories,error:categoryError } = await supabase
    .from('categories')
    .select('id, name')
    .eq('store_id', store.id)
    .eq('is_active', true)
    .order('name')

  const [{ data: attrDefs,error:defsError }, { data: attrValues,error:valuesError }] = await Promise.all([
    supabase.from('product_attributes').select('id, name, sort_order').eq('store_id', store.id).order('sort_order'),
    supabase.from('product_attribute_values').select('id, attribute_id, value, sort_order').eq('store_id', store.id).order('sort_order'),
  ])
  if(categoryError||defsError||valuesError) throw new Error('تعذر تحميل فئات أو خصائص المنتج')
  const attributes = (attrDefs ?? []).map(a => ({
    id: a.id, name: a.name,
    values: (attrValues ?? []).filter(v => v.attribute_id === a.id).map(v => ({ id: v.id, value: v.value })),
  }))

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
        brands={brands ?? []}
        categories={categories ?? []}
        attributes={attributes}
        initialData={{category_id:preselectedCategory,brand_id:(brands||[]).find(b=>b.id===searchParams.brand_id&&b.is_active)?.id||''}}
      />
    </div>
  )
}
