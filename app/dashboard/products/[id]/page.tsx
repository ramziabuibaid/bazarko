import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect, notFound } from 'next/navigation'
import ProductForm from '@/components/dashboard/products/ProductForm'

export default async function EditProductPage({ params }: { params: { id: string } }) {
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

  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('id', params.id)
    .eq('store_id', store.id)
    .single()

  if (!product) notFound()

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .eq('store_id', store.id)
    .eq('is_active', true)
    .order('name')

  const initialData = {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description ?? '',
    sku: product.sku ?? '',
    barcode: product.barcode ?? '',
    category_id: product.category_id ?? '',
    price: product.price?.toString() ?? '',
    compare_price: product.compare_price?.toString() ?? '',
    cost_price: product.cost_price?.toString() ?? '',
    price_secondary: product.price_secondary?.toString() ?? '',
    stock_quantity: product.stock_quantity?.toString() ?? '0',
    low_stock_alert: product.low_stock_alert?.toString() ?? '5',
    track_stock: product.track_stock ?? true,
    allow_backorder: product.allow_backorder ?? false,
    status: product.status ?? 'active',
    is_featured: product.is_featured ?? false,
    images: product.images ?? [],
    tags: (product.tags ?? []).join(', '),
    video_url: product.video_url ?? '',
    specifications: (product.specifications as Array<{ name: string; value: string }> | null) ?? [],
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">تعديل المنتج</h1>
        <p className="mt-1 text-sm text-slate-400">{product.name}</p>
      </div>
      <ProductForm
        storeId={store.id}
        currencyCode={store.currency_code}
        secondaryCurrencyCode={store.secondary_currency_code}
        exchangeRate={store.exchange_rate}
        categories={categories ?? []}
        initialData={initialData}
      />
    </div>
  )
}
