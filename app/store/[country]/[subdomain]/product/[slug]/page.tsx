import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import AddToCartButton from '@/components/store/AddToCartButton'
import StoreHeader from '@/components/store/StoreHeader'

interface Props {
  params: { country: string; subdomain: string; slug: string }
}

export default async function ProductPage({ params }: Props) {
  const supabase = createClient()

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, logo_url, phone, whatsapp, currency_code, secondary_currency_code, exchange_rate')
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

  const outOfStock = product.track_stock && (product.stock_available ?? 0) <= 0
  const discount = product.compare_price
    ? Math.round((1 - product.price / product.compare_price) * 100)
    : null

  const images: string[] = product.images?.length
    ? product.images
    : product.thumbnail_url
      ? [product.thumbnail_url]
      : []

  const secondaryPrice = store.exchange_rate && store.secondary_currency_code
    ? Math.round(product.price * store.exchange_rate)
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
    <div className="min-h-screen bg-white" dir="rtl">
      <StoreHeader store={store} country={params.country} subdomain={params.subdomain} />

      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="grid gap-8 md:grid-cols-2">
          {/* الصور */}
          <div className="space-y-3">
            <div className="overflow-hidden rounded-2xl bg-gray-50 aspect-square">
              {images[0] ? (
                <img src={images[0]} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-6xl text-gray-200">🛍️</div>
              )}
            </div>
            {images.length > 1 && (
              <div className="grid grid-cols-4 gap-2">
                {images.slice(1).map((img, i) => (
                  <div key={i} className="overflow-hidden rounded-xl bg-gray-50 aspect-square">
                    <img src={img} alt="" className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* التفاصيل */}
          <div>
            {(product.categories as unknown as { name: string } | null)?.name && (
              <p className="mb-2 text-sm text-gray-400">
                {(product.categories as unknown as { name: string }).name}
              </p>
            )}
            <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>

            <div className="mt-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold text-gray-900">
                  {product.price.toLocaleString('ar')} {store.currency_code}
                </span>
                {product.compare_price && (
                  <span className="text-lg text-gray-400 line-through">
                    {product.compare_price.toLocaleString('ar')}
                  </span>
                )}
                {discount && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-sm font-bold text-red-600">
                    وفّر {discount}%
                  </span>
                )}
              </div>
              {secondaryPrice !== null && (
                <p className="mt-1 text-base text-gray-500">
                  ≈ {secondaryPrice.toLocaleString('ar')} {store.secondary_currency_code}
                </p>
              )}
            </div>

            {product.description && (
              <p className="mt-4 leading-relaxed text-gray-600">{product.description}</p>
            )}

            <div className="mt-6">
              {outOfStock ? (
                <div className="rounded-xl bg-gray-100 py-3 text-center text-sm font-medium text-gray-500">
                  نفد المخزون
                </div>
              ) : (
                <AddToCartButton
                  productId={product.id}
                  name={product.name}
                  price={product.price}
                  thumbnail={product.thumbnail_url}
                  maxQty={product.track_stock ? (product.stock_available ?? null) : null}
                  country={params.country}
                  subdomain={params.subdomain}
                />
              )}
            </div>

            {store.whatsapp && (
              <a
                href={`https://wa.me/${store.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`مرحبا، أريد الاستفسار عن: ${product.name}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-green-200 py-3 text-sm font-medium text-green-700 hover:bg-green-50"
              >
                <span>📱</span> استفسر عبر واتساب
              </a>
            )}

            {product.sku && (
              <p className="mt-4 text-xs text-gray-400" dir="ltr">SKU: {product.sku}</p>
            )}
          </div>
        </div>

        {/* فيديو المنتج */}
        {videoUrl && (
          <div className="mt-8">
            <h2 className="mb-3 text-lg font-semibold text-gray-900">فيديو المنتج</h2>
            {youtubeId ? (
              <div className="overflow-hidden rounded-2xl bg-gray-50" style={{ aspectRatio: '16/9' }}>
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
                className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <span className="text-2xl">
                  {isTikTok ? '🎵' : isInstagram ? '📷' : '▶️'}
                </span>
                <div>
                  <p className="font-medium">
                    {isTikTok ? 'شاهد على TikTok' : isInstagram ? 'شاهد على Instagram' : 'شاهد الفيديو'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5" dir="ltr">{videoUrl}</p>
                </div>
              </a>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
