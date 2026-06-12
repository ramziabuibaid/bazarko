import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import AddToCartButton from '@/components/store/AddToCartButton'
import StoreHeader from '@/components/store/StoreHeader'
import OfferCountdown from '@/components/store/OfferCountdown'
import StoreFooter from '@/components/store/StoreFooter'

interface Props {
  params: { country: string; subdomain: string; slug: string }
}

export default async function ProductPage({ params }: Props) {
  const supabase = createClient()

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, description, logo_url, phone, whatsapp, email, city, address, currency_code, country_code, secondary_currency_code, exchange_rate, header_theme, instagram, facebook, tiktok, telegram, business_hours, footer_settings')
    .eq('subdomain', params.subdomain)
    .eq('country_code', params.country.toUpperCase())
    .eq('status', 'active')
    .single()

  if (!store) notFound()

  const { data: product } = await supabase
    .from('products')
    .select('id, name, description, price, compare_price, images, thumbnail_url, stock_available, track_stock, sku, video_url, categories(name)')
    .eq('store_id', store.id)
    .eq('slug', params.slug)
    .eq('is_active', true)
    .single()

  if (!product) notFound()

  // هل المنتج ضمن عرض جارٍ حالياً؟
  const nowIso = new Date().toISOString()
  const { data: rawOfferItem } = await supabase
    .from('offer_items')
    .select('offer_price, max_quantity, sold_quantity, offers!inner(id, title, ends_at, is_active, store_id, per_customer_limit, starts_at)')
    .eq('product_id', product.id)
    .eq('offers.store_id', store.id)
    .eq('offers.is_active', true)
    .lte('offers.starts_at', nowIso)
    .gte('offers.ends_at', nowIso)
    .limit(1)
    .maybeSingle()

  const offerItem = rawOfferItem as unknown as {
    offer_price: number
    max_quantity: number | null
    sold_quantity: number
    offers: { id: string; title: string; ends_at: string; per_customer_limit: number | null }
  } | null

  const offerRemaining = offerItem?.max_quantity != null
    ? Math.max(0, offerItem.max_quantity - offerItem.sold_quantity)
    : null
  const activeOffer = offerItem && (offerRemaining === null || offerRemaining > 0) ? offerItem : null

  const effectivePrice = activeOffer ? activeOffer.offer_price : product.price
  const effectiveCompare = activeOffer ? product.price : product.compare_price

  const outOfStock = product.track_stock && (product.stock_available ?? 0) <= 0
  const discount = effectiveCompare
    ? Math.round((1 - effectivePrice / effectiveCompare) * 100)
    : null

  // الحد الأقصى للسلة: المخزون × كمية العرض المتبقية × حد الزبون
  const cartMax = [
    product.track_stock ? (product.stock_available ?? 0) : null,
    activeOffer ? offerRemaining : null,
    activeOffer?.offers.per_customer_limit ?? null,
  ].filter((n): n is number => n !== null)
  const maxQty = cartMax.length ? Math.min(...cartMax) : null

  const images: string[] = product.images?.length
    ? product.images
    : product.thumbnail_url
      ? [product.thumbnail_url]
      : []

  const secondaryPrice = store.exchange_rate && store.secondary_currency_code
    ? Math.round(effectivePrice * store.exchange_rate)
    : null

  const videoUrl: string | null = (product as unknown as { video_url?: string | null }).video_url ?? null
  function getYouTubeId(url: string): string | null {
    const m = url.match(/(?:v=|youtu\.be\/)([^&\n?#]+)/)
    return m ? m[1] : null
  }
  const youtubeId = videoUrl && (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be'))
    ? getYouTubeId(videoUrl)
    : null
  const isTikTok = videoUrl?.includes('tiktok.com')
  const isInstagram = videoUrl?.includes('instagram.com')

  return (
    <div className="min-h-screen bg-white transition-colors dark:bg-gray-950" dir="rtl">
      <StoreHeader store={store} country={params.country} subdomain={params.subdomain} />

      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="grid gap-8 md:grid-cols-2">
          {/* الصور */}
          <div className="space-y-3">
            <div className="overflow-hidden rounded-2xl bg-gray-50 aspect-square dark:bg-gray-900">
              {images[0] ? (
                <img src={images[0]} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-6xl text-gray-200 dark:text-gray-700">🛍️</div>
              )}
            </div>
            {images.length > 1 && (
              <div className="grid grid-cols-4 gap-2">
                {images.slice(1).map((img, i) => (
                  <div key={i} className="overflow-hidden rounded-xl bg-gray-50 aspect-square dark:bg-gray-900">
                    <img src={img} alt="" className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* التفاصيل */}
          <div>
            {(product.categories as unknown as { name: string } | null)?.name && (
              <p className="mb-2 text-sm text-gray-400 dark:text-gray-500">
                {(product.categories as unknown as { name: string }).name}
              </p>
            )}
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{product.name}</h1>

            {activeOffer && (
              <Link
                href={`/store/${params.country}/${params.subdomain}/offer/${activeOffer.offers.id}`}
                className="mt-4 block rounded-2xl bg-gradient-to-l from-rose-600 via-red-500 to-orange-500 p-4 text-white transition hover:shadow-md"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-white/80">🔥 هذا المنتج ضمن عرض</p>
                    <p className="mt-0.5 font-bold">{activeOffer.offers.title}</p>
                    {offerRemaining !== null && offerRemaining <= 5 && (
                      <p className="mt-0.5 text-xs font-semibold">⚡ بقي {offerRemaining} فقط بسعر العرض!</p>
                    )}
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[10px] text-white/80">ينتهي خلال</span>
                    <OfferCountdown target={activeOffer.offers.ends_at} size="sm" onDark />
                  </div>
                </div>
              </Link>
            )}

            <div className="mt-4">
              <div className="flex items-center gap-3">
                <span className={`text-2xl font-bold ${activeOffer ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                  {effectivePrice.toLocaleString('ar')} {store.currency_code}
                </span>
                {effectiveCompare && (
                  <span className="text-lg text-gray-400 line-through dark:text-gray-500">
                    {effectiveCompare.toLocaleString('ar')}
                  </span>
                )}
                {discount && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-sm font-bold text-red-600 dark:bg-red-500/15 dark:text-red-400">
                    وفّر {discount}%
                  </span>
                )}
              </div>
              {secondaryPrice !== null && (
                <p className="mt-1 text-base text-gray-500 dark:text-gray-400">
                  ≈ {secondaryPrice.toLocaleString('ar')} {store.secondary_currency_code}
                </p>
              )}
            </div>

            {product.description && (
              <p className="mt-4 leading-relaxed text-gray-600 dark:text-gray-300">{product.description}</p>
            )}

            <div className="mt-6">
              {outOfStock ? (
                <div className="rounded-xl bg-gray-100 py-3 text-center text-sm font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  نفد المخزون
                </div>
              ) : (
                <>
                  <AddToCartButton
                    productId={product.id}
                    name={product.name}
                    price={effectivePrice}
                    thumbnail={product.thumbnail_url}
                    maxQty={maxQty}
                    country={params.country}
                    subdomain={params.subdomain}
                  />
                  {activeOffer?.offers.per_customer_limit != null && (
                    <p className="mt-2 text-center text-xs text-gray-400 dark:text-gray-500">
                      الحد الأقصى {activeOffer.offers.per_customer_limit} لكل زبون خلال العرض
                    </p>
                  )}
                </>
              )}
            </div>

            {store.whatsapp && (
              <a
                href={`https://wa.me/${store.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`مرحبا، أريد الاستفسار عن: ${product.name}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-green-200 py-3 text-sm font-medium text-green-700 hover:bg-green-50 dark:border-green-500/25 dark:text-green-400 dark:hover:bg-green-500/10"
              >
                <span>📱</span> استفسر عبر واتساب
              </a>
            )}

            {product.sku && (
              <p className="mt-4 text-xs text-gray-400 dark:text-gray-500" dir="ltr">SKU: {product.sku}</p>
            )}
          </div>
        </div>

        {/* فيديو المنتج */}
        {videoUrl && (
          <div className="mt-8">
            <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">فيديو المنتج</h2>
            {youtubeId ? (
              <div className="overflow-hidden rounded-2xl bg-gray-50 dark:bg-gray-900" style={{ aspectRatio: '16/9' }}>
                <iframe
                  src={`https://www.youtube.com/embed/${youtubeId}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="h-full w-full"
                />
              </div>
            ) : (
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 text-gray-700 hover:bg-gray-100 transition-colors dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <span className="text-2xl">
                  {isTikTok ? '🎵' : isInstagram ? '📷' : '▶️'}
                </span>
                <div>
                  <p className="font-medium">
                    {isTikTok ? 'شاهد على TikTok' : isInstagram ? 'شاهد على Instagram' : 'شاهد الفيديو'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 dark:text-gray-500" dir="ltr">{videoUrl}</p>
                </div>
              </a>
            )}
          </div>
        )}
      </main>
      <StoreFooter store={store} country={params.country} subdomain={params.subdomain} />
    </div>
  )
}
