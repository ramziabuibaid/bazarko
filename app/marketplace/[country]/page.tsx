import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getCountryByCode } from '@/lib/countries'
import OfferCountdown from '@/components/store/OfferCountdown'

interface Props { params: { country: string } }

const DEVICE_ICONS: Record<string, string> = {
  phone: '📱', laptop: '💻', tablet: '📟', tv: '📺',
  appliance: '🔌', camera: '📷', other: '🛍️',
}

export default async function MarketplaceHomePage({ params }: Props) {
  const country = getCountryByCode(params.country)
  if (!country) notFound()

  const supabase = createClient()

  const { data: stores } = await supabase
    .from('stores')
    .select('id, name, subdomain, country_code, created_at')
    .eq('country_code', country.code)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  const storeIds = (stores ?? []).map((s: { id: string }) => s.id)

  const { count: productCount } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .in('store_id', storeIds.length > 0 ? storeIds : ['no-match'])

  const { data: featuredProducts } = storeIds.length > 0
    ? await supabase
        .from('products')
        .select('id, name, slug, price, thumbnail_url, store_id, stores!inner(name, subdomain, country_code)')
        .in('store_id', storeIds)
        .eq('is_active', true)
        .not('thumbnail_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(12)
    : { data: [] }

  // عروض اليوم: العروض الجارية الآن عبر كل متاجر البلد
  const nowIso = new Date().toISOString()
  const { data: rawDeals } = storeIds.length > 0
    ? await supabase
        .from('offers')
        .select('id, title, description, ends_at, store_id, stores!inner(name, subdomain, country_code), offer_items(offer_price, products(price, thumbnail_url, is_active))')
        .in('store_id', storeIds)
        .eq('is_active', true)
        .lte('starts_at', nowIso)
        .gte('ends_at', nowIso)
        .order('ends_at')
        .limit(6)
    : { data: [] }

  const { data: allProducts } = storeIds.length > 0
    ? await supabase
        .from('products')
        .select('id, name, slug, price, thumbnail_url, store_id, stores!inner(name, subdomain, country_code)')
        .in('store_id', storeIds)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(24)
    : { data: [] }

  type StoreRow = { id: string; name: string; subdomain: string; country_code: string; created_at: string }
  type ProductRow = {
    id: string; name: string; slug: string; price: number
    thumbnail_url: string | null; store_id: string
    stores: { name: string; subdomain: string; country_code: string }
  }

  const storesList   = (stores ?? []) as unknown as StoreRow[]
  const productsList = (allProducts ?? []) as unknown as ProductRow[]
  const featured     = (featuredProducts ?? []) as unknown as ProductRow[]

  type DealRow = {
    id: string; title: string; description: string | null; ends_at: string; store_id: string
    stores: { name: string; subdomain: string; country_code: string }
    offer_items: { offer_price: number; products: { price: number; thumbnail_url: string | null; is_active: boolean } | null }[]
  }
  const deals = ((rawDeals ?? []) as unknown as DealRow[]).map(d => {
    const activeItems = d.offer_items.filter(i => i.products?.is_active)
    return {
      ...d,
      itemCount: activeItems.length,
      maxDiscount: Math.max(
        0,
        ...activeItems.filter(i => i.products!.price > 0).map(i => Math.round((1 - i.offer_price / i.products!.price) * 100))
      ),
      thumbs: activeItems.map(i => i.products!.thumbnail_url).filter(Boolean).slice(0, 3) as string[],
    }
  }).filter(d => d.itemCount > 0)

  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 0 })
  const countryLower = params.country.toLowerCase()

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-12">

      {/* Hero */}
      <div className="rounded-3xl border border-white/5 bg-gradient-to-br from-slate-900 to-slate-800 p-10 text-center space-y-4">
        <p className="text-xs uppercase tracking-widest text-sky-400">سوق {country.name_ar} الإلكتروني</p>
        <h1 className="text-4xl font-black text-white">
          اكتشف آلاف المنتجات<br />
          <span className="text-sky-400">من أفضل المتاجر</span>
        </h1>
        <p className="text-slate-400 text-sm max-w-md mx-auto">
          تسوق بأمان من متاجر موثوقة في {country.name_ar}، بعملة {country.currency_code}
        </p>
        <div className="flex flex-wrap justify-center gap-6 pt-2 text-sm">
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{storesList.length}</p>
            <p className="text-slate-500">متجر</p>
          </div>
          <div className="w-px bg-white/10" />
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{productCount ?? 0}</p>
            <p className="text-slate-500">منتج</p>
          </div>
          <div className="w-px bg-white/10" />
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{country.currency_code}</p>
            <p className="text-slate-500">العملة</p>
          </div>
        </div>
        {/* Search shortcut */}
        <form action={`/marketplace/${countryLower}/search`} method="get"
          className="flex max-w-md mx-auto mt-2 gap-0">
          <input name="q" placeholder="ابحث عن أي منتج..."
            className="flex-1 rounded-r-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-sky-500/50" />
          <button type="submit"
            className="rounded-l-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-500 transition-colors">
            بحث
          </button>
        </form>
      </div>

      {/* عروض اليوم — عبر كل المتاجر */}
      {deals.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">🔥 عروض اليوم</h2>
          <div className={`grid gap-4 ${deals.length > 1 ? 'md:grid-cols-2' : ''}`}>
            {deals.map(deal => (
              <Link
                key={deal.id}
                href={`/store/${deal.stores.country_code.toLowerCase()}/${deal.stores.subdomain}/offer/${deal.id}`}
                className="group relative overflow-hidden rounded-3xl bg-gradient-to-l from-rose-600 via-red-500 to-orange-500 p-5 text-white transition hover:shadow-lg hover:shadow-rose-500/20"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs text-white/75">{deal.stores.name}</p>
                    <h3 className="mt-0.5 truncate text-lg font-bold">{deal.title}</h3>
                    <div className="mt-2 flex items-center gap-2">
                      {deal.maxDiscount > 0 && (
                        <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold backdrop-blur-sm">
                          حتى -{deal.maxDiscount}%
                        </span>
                      )}
                      <span className="text-xs text-white/80">{deal.itemCount} منتج</span>
                      {deal.thumbs.length > 0 && (
                        <div className="flex -space-x-2 space-x-reverse">
                          {deal.thumbs.map((src, i) => (
                            <img key={i} src={src} alt="" className="h-7 w-7 rounded-full border-2 border-white/60 object-cover" />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-1.5">
                    <span className="text-[11px] text-white/80">ينتهي خلال</span>
                    <OfferCountdown target={deal.ends_at} size="sm" onDark />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* أبرز المنتجات (مع صور) */}
      {featured.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">✨ منتجات مميزة</h2>
            <Link href={`/marketplace/${countryLower}/search`}
              className="text-sm text-sky-400 hover:text-sky-300">عرض الكل ←</Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {featured.map((p) => (
              <Link key={p.id}
                href={`/store/${p.stores.country_code.toLowerCase()}/${p.stores.subdomain}/product/${p.slug}`}
                className="group rounded-2xl border border-white/5 bg-slate-900 overflow-hidden hover:border-sky-500/30 transition-all">
                <div className="aspect-square overflow-hidden bg-slate-800">
                  <img src={p.thumbnail_url!} alt={p.name}
                    className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300" />
                </div>
                <div className="p-3">
                  <p className="text-sm font-medium text-white line-clamp-2">{p.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{p.stores.name}</p>
                  <p className="text-sm font-bold text-sky-400 mt-1" dir="ltr">
                    {fmt(p.price)} {country.currency_code}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* أحدث المنتجات (بدون صور أيضاً) */}
      {productsList.length > featured.length && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">🆕 أحدث المنتجات</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {productsList.slice(0, 9).map((p) => (
              <Link key={p.id}
                href={`/store/${p.stores.country_code.toLowerCase()}/${p.stores.subdomain}/product/${p.slug}`}
                className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-900 p-3 hover:border-white/10 hover:bg-slate-800 transition-all">
                <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-800 overflow-hidden">
                  {p.thumbnail_url
                    ? <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
                    : <div className="h-full w-full flex items-center justify-center text-xl">🛍️</div>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{p.name}</p>
                  <p className="text-xs text-slate-500">{p.stores.name}</p>
                </div>
                <p className="text-sm font-bold text-sky-400 shrink-0" dir="ltr">
                  {fmt(p.price)} {country.currency_code}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* أبرز المتاجر */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">🏪 المتاجر</h2>
          <Link href={`/marketplace/${countryLower}/stores`}
            className="text-sm text-sky-400 hover:text-sky-300">كل المتاجر ←</Link>
        </div>

        {storesList.length === 0 ? (
          <div className="rounded-2xl border border-white/5 bg-slate-900 py-16 text-center">
            <p className="text-4xl mb-3">🏪</p>
            <p className="text-slate-400">لا توجد متاجر مسجّلة في {country.name_ar} بعد</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {storesList.slice(0, 8).map((store) => (
              <Link key={store.id}
                href={`/store/${store.country_code.toLowerCase()}/${store.subdomain}`}
                className="group rounded-2xl border border-white/5 bg-slate-900 p-5 hover:border-sky-500/30 hover:bg-slate-800 transition-all">
                <div className="h-12 w-12 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-2xl mb-3">
                  🏪
                </div>
                <p className="font-semibold text-white group-hover:text-sky-400 transition-colors">{store.name}</p>
                <p className="text-xs text-slate-500 mt-0.5" dir="ltr">{store.subdomain}.bazarko.app</p>
                <p className="mt-3 text-xs text-sky-400 group-hover:underline">تسوق الآن ←</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Empty state */}
      {storesList.length === 0 && (
        <div className="rounded-2xl border border-white/5 bg-slate-900/50 p-8 text-center">
          <p className="text-slate-500 text-sm">
            هل تملك متجراً؟{' '}
            <Link href="/onboarding" className="text-sky-400 hover:underline">
              سجّل متجرك الآن مجاناً
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}
