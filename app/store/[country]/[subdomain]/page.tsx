import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import StoreHeader from '@/components/store/StoreHeader'
import ProductCard from '@/components/store/ProductCard'
import CategoryFilter from '@/components/store/CategoryFilter'
import OfferCountdown from '@/components/store/OfferCountdown'
import StoreFooter from '@/components/store/StoreFooter'
import SortSelect from '@/components/store/SortSelect'

interface StoreProduct {
  id: string
  name: string
  slug: string
  price: number
  compare_price: number | null
  price_secondary: number | null
  thumbnail_url: string | null
  stock_available: number | null
  is_featured: boolean
  category_id: string | null
}

const SORT_ORDERS: Record<string, { column: string; ascending: boolean } | null> = {
  newest:       { column: 'created_at', ascending: false },
  oldest:       { column: 'created_at', ascending: true  },
  price_high:   { column: 'price',      ascending: false },
  price_low:    { column: 'price',      ascending: true  },
  best_selling: null, // يُرتَّب في JS بعد جلب الـ RPC
}

interface Props {
  params: { country: string; subdomain: string }
  searchParams: { category?: string; q?: string; sort?: string }
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
    .select('id, name, description, logo_url, cover_url, phone, whatsapp, email, city, address, currency_code, country_code, secondary_currency_code, exchange_rate, prefer_secondary, header_theme, instagram, facebook, tiktok, telegram, business_hours, footer_settings')
    .eq('subdomain', params.subdomain)
    .eq('country_code', params.country.toUpperCase())
    .eq('status', 'active')
    .single()

  if (!store) notFound()

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, slug, image_url')
    .eq('store_id', store.id)
    .eq('is_active', true)
    .order('sort_order')

  const sortKey = (searchParams.sort && searchParams.sort in SORT_ORDERS) ? searchParams.sort : 'newest'
  const sortOrder = SORT_ORDERS[sortKey]

  let productQuery = supabase
    .from('products')
    .select('id, name, slug, price, compare_price, price_secondary, thumbnail_url, stock_available, is_featured, category_id')
    .eq('store_id', store.id)
    .eq('is_active', true)

  if (sortOrder) {
    productQuery = productQuery.order(sortOrder.column, { ascending: sortOrder.ascending })
  } else {
    productQuery = productQuery.order('created_at', { ascending: false })
  }

  if (searchParams.category) {
    const cat = categories?.find((c: { id: string; name: string; slug: string }) => c.slug === searchParams.category)
    if (cat) productQuery = productQuery.eq('category_id', cat.id)
  }

  if (searchParams.q) {
    productQuery = productQuery.ilike('name', `%${searchParams.q}%`)
  }

  const { data: rawProducts } = await productQuery
  let products = (rawProducts ?? []) as StoreProduct[]

  // ترتيب الأكثر مبيعاً عبر RPC
  if (sortKey === 'best_selling') {
    const { data: salesData } = await supabase.rpc('get_product_sales', { p_store_id: store.id })
    const salesMap = new Map((salesData ?? []).map((r: { product_id: string; sold_count: number }) => [r.product_id, r.sold_count]))
    products = [...products].sort((a, b) => ((salesMap.get(b.id) ?? 0) as number) - ((salesMap.get(a.id) ?? 0) as number))
  }
  const featured = products.filter(p => p.is_featured)
  const showFeatured = featured.length > 0 && !searchParams.category && !searchParams.q

  // العروض الجارية حالياً
  const nowIso = new Date().toISOString()
  const { data: rawOffers } = await supabase
    .from('offers')
    .select('id, title, description, ends_at, offer_items(offer_price, products(price, thumbnail_url, is_active))')
    .eq('store_id', store.id)
    .eq('is_active', true)
    .lte('starts_at', nowIso)
    .gte('ends_at', nowIso)
    .order('ends_at')

  const offers = ((rawOffers ?? []) as unknown as {
    id: string
    title: string
    description: string | null
    ends_at: string
    offer_items: { offer_price: number; products: { price: number; thumbnail_url: string | null; is_active: boolean } | null }[]
  }[]).map(o => {
    const activeItems = o.offer_items.filter(i => i.products?.is_active)
    return {
      ...o,
      itemCount: activeItems.length,
      maxDiscount: Math.max(
        0,
        ...activeItems.filter(i => i.products!.price > 0).map(i => Math.round((1 - i.offer_price / i.products!.price) * 100))
      ),
      thumbs: activeItems.map(i => i.products!.thumbnail_url).filter(Boolean).slice(0, 3) as string[],
    }
  }).filter(o => o.itemCount > 0)

  const showOffers = offers.length > 0 && !searchParams.category && !searchParams.q

  return (
    <div className="min-h-screen bg-white transition-colors dark:bg-gray-950" dir="rtl">
      <StoreHeader store={store} country={params.country} subdomain={params.subdomain} />

      <main className="mx-auto max-w-6xl px-4 py-8">

        {store.cover_url && !searchParams.category && !searchParams.q && (
          <div className="mb-8 overflow-hidden rounded-2xl">
            <img src={store.cover_url} alt={store.name} className="h-48 w-full object-cover sm:h-64" />
          </div>
        )}

        {showOffers && (
          <section className="mb-10">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">🔥 العروض الحصرية</h2>
            <div className={`grid gap-4 ${offers.length > 1 ? 'sm:grid-cols-2' : ''}`}>
              {offers.map(offer => (
                <Link
                  key={offer.id}
                  href={`/store/${params.country}/${params.subdomain}/offer/${offer.id}`}
                  className="group relative overflow-hidden rounded-3xl bg-gradient-to-l from-rose-600 via-red-500 to-orange-500 p-5 text-white transition hover:shadow-lg sm:p-6"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      {offer.maxDiscount > 0 && (
                        <span className="mb-2 inline-block rounded-full bg-white/20 px-3 py-0.5 text-xs font-bold backdrop-blur-sm">
                          خصومات حتى {offer.maxDiscount}%
                        </span>
                      )}
                      <h3 className="truncate text-lg font-bold sm:text-xl">{offer.title}</h3>
                      {offer.description && (
                        <p className="mt-1 line-clamp-1 text-sm text-white/80">{offer.description}</p>
                      )}
                      <div className="mt-3 flex items-center gap-3">
                        {offer.thumbs.length > 0 && (
                          <div className="flex -space-x-2 space-x-reverse">
                            {offer.thumbs.map((src, i) => (
                              <img
                                key={i}
                                src={src}
                                alt=""
                                className="h-8 w-8 rounded-full border-2 border-white/60 object-cover"
                              />
                            ))}
                          </div>
                        )}
                        <span className="text-xs text-white/80">{offer.itemCount} منتج</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="text-[11px] font-medium text-white/80">ينتهي خلال</span>
                      <OfferCountdown target={offer.ends_at} size="sm" onDark />
                      <span className="mt-1 rounded-full bg-white px-4 py-1 text-xs font-bold text-rose-600 transition group-hover:bg-rose-50">
                        تسوق العرض ←
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {showFeatured && (
          <section className="mb-10">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">⭐ منتجات مميزة</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {featured.map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
                  currencyCode={store.currency_code}
                  storeId={store.id}
                  country={params.country}
                  subdomain={params.subdomain}
                  secondaryCurrencyCode={store.secondary_currency_code}
                  exchangeRate={store.exchange_rate}
                  preferSecondary={store.prefer_secondary ?? false}
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

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <SortSelect
            current={sortKey}
            basePath={`/store/${params.country}/${params.subdomain}`}
            category={searchParams.category}
            q={searchParams.q}
          />
        </div>

        <form action={`/store/${params.country}/${params.subdomain}`} className="mt-2 flex gap-2">
          <input
            name="q"
            defaultValue={searchParams.q}
            placeholder="ابحث عن منتج..."
            className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-right text-sm text-gray-900 outline-none focus:border-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:focus:border-gray-600"
          />
          <button type="submit" className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-gray-900">
            بحث
          </button>
          {searchParams.q && (
            <Link
              href={`/store/${params.country}/${params.subdomain}`}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400"
            >
              ✕
            </Link>
          )}
        </form>

        <section className="mt-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
            {searchParams.q
              ? `نتائج البحث: "${searchParams.q}"`
              : searchParams.category
                ? (categories?.find((c: {slug: string; name: string}) => c.slug === searchParams.category)?.name ?? 'المنتجات')
                : 'جميع المنتجات'}
          </h2>

          {!products?.length ? (
            <div className="rounded-2xl bg-gray-50 p-12 text-center dark:bg-gray-900">
              <p className="text-gray-500 dark:text-gray-400">لا توجد منتجات</p>
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
                  secondaryCurrencyCode={store.secondary_currency_code}
                  exchangeRate={store.exchange_rate}
                  preferSecondary={store.prefer_secondary ?? false}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <StoreFooter store={store} country={params.country} subdomain={params.subdomain} />
    </div>
  )
}
