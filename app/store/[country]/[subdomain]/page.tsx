import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import StoreHeader from '@/components/store/StoreHeader'
import ProductCard from '@/components/store/ProductCard'
import CategoryFilter from '@/components/store/CategoryFilter'

interface StoreProduct {
  id: string
  name: string
  slug: string
  price: number
  compare_price: number | null
  thumbnail_url: string | null
  stock_available: number | null
  is_featured: boolean
  category_id: string | null
}

interface Props {
  params: { country: string; subdomain: string }
  searchParams: { category?: string; q?: string }
}

export async function generateMetadata({ params }: Props) {
  const supabase = createClient()
  const { data: store } = await supabase
    .from('stores')
    .select('name, description')
    .eq('subdomain', params.subdomain)
    .eq('country_code', params.country.toUpperCase())
    .single()

  return {
    title: store?.name ?? 'متجر',
    description: store?.description ?? '',
  }
}

export default async function StorefrontPage({ params, searchParams }: Props) {
  const supabase = createClient()

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, description, logo_url, cover_url, phone, whatsapp, city, currency_code, country_code')
    .eq('subdomain', params.subdomain)
    .eq('country_code', params.country.toUpperCase())
    .eq('is_active', true)
    .single()

  if (!store) notFound()

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, slug')
    .eq('store_id', store.id)
    .eq('is_active', true)
    .order('sort_order')

  let productQuery = supabase
    .from('products')
    .select('id, name, slug, price, compare_price, thumbnail_url, stock_available, is_featured, category_id')
    .eq('store_id', store.id)
    .eq('is_active', true)
    .order('sort_order')
    .order('created_at', { ascending: false })

  if (searchParams.category) {
    const cat = categories?.find((c: { id: string; name: string; slug: string }) => c.slug === searchParams.category)
    if (cat) productQuery = productQuery.eq('category_id', cat.id)
  }

  if (searchParams.q) {
    productQuery = productQuery.ilike('name', `%${searchParams.q}%`)
  }

  const { data: rawProducts } = await productQuery
  const products = (rawProducts ?? []) as StoreProduct[]
  const featured = products.filter(p => p.is_featured)
  const showFeatured = featured.length > 0 && !searchParams.category && !searchParams.q

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <StoreHeader store={store} country={params.country} subdomain={params.subdomain} />

      <main className="mx-auto max-w-6xl px-4 py-8">

        {store.cover_url && !searchParams.category && !searchParams.q && (
          <div className="mb-8 overflow-hidden rounded-2xl">
            <img src={store.cover_url} alt={store.name} className="h-48 w-full object-cover sm:h-64" />
          </div>
        )}

        {showFeatured && (
          <section className="mb-10">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">منتجات مميزة</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {featured.map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
                  currencyCode={store.currency_code}
                  storeId={store.id}
                  country={params.country}
                  subdomain={params.subdomain}
                />
              ))}
            </div>
          </section>
        )}

        <CategoryFilter
          categories={categories ?? []}
          activeSlug={searchParams.category}
          subdomain={params.subdomain}
          country={params.country}
        />

        <form action={`/store/${params.country}/${params.subdomain}`} className="mt-4 flex gap-2">
          <input
            name="q"
            defaultValue={searchParams.q}
            placeholder="ابحث عن منتج..."
            className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-right text-sm text-gray-900 outline-none focus:border-gray-400"
          />
          <button type="submit" className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white">
            بحث
          </button>
          {searchParams.q && (
            <Link
              href={`/store/${params.country}/${params.subdomain}`}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-500"
            >
              ✕
            </Link>
          )}
        </form>

        <section className="mt-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            {searchParams.q
              ? `نتائج البحث: "${searchParams.q}"`
              : searchParams.category
                ? (categories?.find((c: {slug: string; name: string}) => c.slug === searchParams.category)?.name ?? 'المنتجات')
                : 'جميع المنتجات'}
          </h2>

          {!products?.length ? (
            <div className="rounded-2xl bg-gray-50 p-12 text-center">
              <p className="text-gray-500">لا توجد منتجات</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {products.map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
                  currencyCode={store.currency_code}
                  storeId={store.id}
                  country={params.country}
                  subdomain={params.subdomain}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="mt-16 border-t border-gray-100 py-8 text-center text-sm text-gray-400">
        <p>{store.name}</p>
        {store.city && <p className="mt-1">{store.city}</p>}
        <p className="mt-3 text-xs">
          مدعوم من <a href="https://bazarko.app" className="text-sky-500 hover:underline">Bazarko</a>
        </p>
      </footer>
    </div>
  )
}
