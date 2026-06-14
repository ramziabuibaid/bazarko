import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import StoreHeader from '@/components/store/StoreHeader'
import ProductCard from '@/components/store/ProductCard'
import OfferCountdown from '@/components/store/OfferCountdown'
import StoreFooter from '@/components/store/StoreFooter'

interface OfferProduct {
  id: string
  name: string
  slug: string
  price: number
  compare_price: number | null
  thumbnail_url: string | null
  stock_available: number | null
  is_active: boolean
}

interface OfferItem {
  offer_price: number
  max_quantity: number | null
  sold_quantity: number
  products: OfferProduct | null
}

interface Props {
  params: { country: string; subdomain: string; id: string }
}

export async function generateMetadata({ params }: Props) {
  const supabase = createClient()
  const { data: offer } = await supabase
    .from('offers')
    .select('title, description')
    .eq('id', params.id)
    .single()

  return {
    title: offer?.title ?? 'عرض حصري',
    description: offer?.description ?? '',
  }
}

export default async function OfferPage({ params }: Props) {
  const supabase = createClient()

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, description, logo_url, cover_url, phone, whatsapp, email, city, address, map_url, currency_code, country_code, secondary_currency_code, exchange_rate, header_theme, instagram, facebook, tiktok, telegram, business_hours, footer_settings')
    .eq('subdomain', params.subdomain)
    .eq('country_code', params.country.toUpperCase())
    .eq('status', 'active')
    .single()
  if (!store) notFound()

  const { data: offer } = await supabase
    .from('offers')
    .select('id, title, description, starts_at, ends_at, is_active, per_customer_limit, offer_items(offer_price, max_quantity, sold_quantity, products(id, name, slug, price, compare_price, thumbnail_url, stock_available, is_active))')
    .eq('id', params.id)
    .eq('store_id', store.id)
    .eq('is_active', true)
    .single()
  if (!offer) notFound()

  // عداد المشاهدات — SECURITY DEFINER، يعمل للزوار بدون auth
  await supabase.rpc('increment_offer_views', { p_offer_id: offer.id })

  const now = Date.now()
  const upcoming = now < new Date(offer.starts_at).getTime()
  const ended = now > new Date(offer.ends_at).getTime()

  const items = ((offer.offer_items ?? []) as unknown as OfferItem[])
    .filter(i => i.products && i.products.is_active)

  const maxDiscount = Math.max(
    0,
    ...items
      .filter(i => i.products!.price > 0)
      .map(i => Math.round((1 - i.offer_price / i.products!.price) * 100))
  )

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <StoreHeader store={store} country={params.country} subdomain={params.subdomain} />

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* بانر العرض */}
        <div className="overflow-hidden rounded-3xl bg-gradient-to-l from-rose-600 via-red-500 to-orange-500 p-6 text-white sm:p-10">
          <div className="flex flex-col items-center text-center">
            {maxDiscount > 0 && !ended && (
              <span className="mb-3 rounded-full bg-white/20 px-4 py-1 text-sm font-bold backdrop-blur-sm">
                خصومات حتى {maxDiscount}% 🔥
              </span>
            )}
            <h1 className="text-2xl font-bold sm:text-4xl">{offer.title}</h1>
            {offer.description && (
              <p className="mt-2 max-w-xl text-sm text-white/85 sm:text-base">{offer.description}</p>
            )}

            <div className="mt-6">
              {ended ? (
                <div className="rounded-2xl bg-white/15 px-6 py-4 backdrop-blur-sm">
                  <p className="text-lg font-semibold">انتهى هذا العرض ⏰</p>
                  <p className="mt-1 text-sm text-white/80">ترقّب عروضنا القادمة قريباً</p>
                </div>
              ) : upcoming ? (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm font-medium text-white/85">يبدأ العرض خلال</p>
                  <OfferCountdown target={offer.starts_at} size="lg" onDark />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm font-medium text-white/85">ينتهي العرض خلال</p>
                  <OfferCountdown target={offer.ends_at} size="lg" onDark />
                  {offer.per_customer_limit != null && (
                    <p className="text-xs text-white/75">
                      ⚡ الحد الأقصى {offer.per_customer_limit} لكل زبون
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* منتجات العرض */}
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            منتجات العرض <span className="text-sm font-normal text-gray-400">({items.length})</span>
          </h2>

          {!items.length ? (
            <div className="rounded-2xl bg-gray-50 p-12 text-center">
              <p className="text-gray-500">لا توجد منتجات في هذا العرض</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {items.map(item => {
                const p = item.products!
                const live = !ended && !upcoming
                const offerRemaining = item.max_quantity != null
                  ? Math.max(0, item.max_quantity - item.sold_quantity)
                  : null

                // الحد الفعلي للسلة: المخزون × كمية العرض المتبقية × حد الزبون
                const caps = [
                  p.stock_available,
                  live ? offerRemaining : null,
                  live ? offer.per_customer_limit : null,
                ].filter((n): n is number => n !== null && n !== undefined)
                const effectiveStock = caps.length ? Math.min(...caps) : p.stock_available

                // أثناء سريان العرض: السعر = سعر العرض والسعر الأصلي مشطوب
                const product = live
                  ? { ...p, price: item.offer_price, compare_price: p.price, stock_available: effectiveStock }
                  : p
                return (
                  <ProductCard
                    key={p.id}
                    product={product}
                    currencyCode={store.currency_code}
                    storeId={store.id}
                    country={params.country}
                    subdomain={params.subdomain}
                    secondaryCurrencyCode={store.secondary_currency_code}
                    exchangeRate={store.exchange_rate}
                    offerSold={live && item.max_quantity != null
                      ? { sold: item.sold_quantity, max: item.max_quantity }
                      : null}
                  />
                )
              })}
            </div>
          )}
        </section>

        <div className="mt-10 text-center">
          <Link
            href={`/store/${params.country}/${params.subdomain}`}
            className="inline-block rounded-xl border border-gray-200 px-6 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            ← العودة للمتجر
          </Link>
        </div>
      </main>

      <StoreFooter store={store} country={params.country} subdomain={params.subdomain} />
    </div>
  )
}
