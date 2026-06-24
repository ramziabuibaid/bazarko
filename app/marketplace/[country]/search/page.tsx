import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getCountryByCode } from '@/lib/countries'

interface Props {
  params: { country: string }
  searchParams: { q?: string; min?: string; max?: string; store?: string }
}

export default async function MarketplaceSearchPage({ params, searchParams }: Props) {
  const country = getCountryByCode(params.country)
  if (!country) notFound()

  const q       = searchParams.q?.trim() ?? ''
  const minPrice = searchParams.min ? parseFloat(searchParams.min) : null
  const maxPrice = searchParams.max ? parseFloat(searchParams.max) : null
  const storeFilter = searchParams.store ?? ''

  const supabase = createClient()

  // جلب المتاجر النشطة في الدولة
  const { data: stores } = await supabase
    .from('stores')
    .select('id, name, subdomain, country_code')
    .eq('country_code', country.code)
    .eq('is_active', true)

  type StoreRow = { id: string; name: string; subdomain: string; country_code: string }
  const storesList = (stores ?? []) as StoreRow[]
  const storeIds   = storesList.map(s => s.id)

  // بناء استعلام المنتجات
  let query = supabase
    .from('products')
    .select('id, name, slug, price, thumbnail_url, store_id, stores!inner(name, subdomain, country_code)')
    .in('store_id', storeIds.length > 0 ? storeIds : ['no-match'])
    .eq('is_active', true)

  if (q)           query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,description.ilike.%${q}%`)
  if (minPrice)    query = query.gte('price', minPrice)
  if (maxPrice)    query = query.lte('price', maxPrice)
  if (storeFilter) query = query.eq('store_id', storeFilter)

  query = query.order('created_at', { ascending: false }).limit(48)

  const { data: products } = await query

  type ProductRow = {
    id: string; name: string; slug: string; price: number
    thumbnail_url: string | null; store_id: string
    stores: { name: string; subdomain: string; country_code: string }
  }

  const productsList = (products ?? []) as unknown as ProductRow[]
  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 0 })
  const countryLower = params.country.toLowerCase()

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">
          {q ? `نتائج البحث عن "${q}"` : 'كل المنتجات'}
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">{productsList.length} منتج</p>
      </div>

      <div className="flex flex-col gap-6 md:flex-row">

        {/* Sidebar Filters */}
        <aside className="w-full md:w-56 shrink-0 space-y-4">
          <form method="get" className="space-y-4">
            {q && <input type="hidden" name="q" value={q} />}

            {/* نطاق السعر */}
            <div className="rounded-xl border border-white/5 bg-slate-900 p-4 space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">نطاق السعر</h3>
              <div className="flex gap-2 items-center">
                <input type="number" name="min" placeholder="من"
                  defaultValue={searchParams.min ?? ''}
                  className="w-full rounded-lg border border-white/10 bg-slate-800 px-2 py-1.5 text-sm text-white outline-none focus:border-sky-500/50"
                  dir="ltr" />
                <span className="text-slate-600 text-xs">—</span>
                <input type="number" name="max" placeholder="إلى"
                  defaultValue={searchParams.max ?? ''}
                  className="w-full rounded-lg border border-white/10 bg-slate-800 px-2 py-1.5 text-sm text-white outline-none focus:border-sky-500/50"
                  dir="ltr" />
              </div>
            </div>

            {/* فلتر المتجر */}
            <div className="rounded-xl border border-white/5 bg-slate-900 p-4 space-y-2">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">المتجر</h3>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="radio" name="store" value=""
                  defaultChecked={!storeFilter}
                  className="accent-sky-500" />
                الكل
              </label>
              {storesList.map(s => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="radio" name="store" value={s.id}
                    defaultChecked={storeFilter === s.id}
                    className="accent-sky-500" />
                  <span className="truncate">{s.name}</span>
                </label>
              ))}
            </div>

            <button type="submit"
              className="w-full rounded-xl bg-sky-600 py-2 text-sm font-medium text-white hover:bg-sky-500 transition-colors">
              تطبيق الفلاتر
            </button>

            {(minPrice || maxPrice || storeFilter) && (
              <Link href={`/marketplace/${countryLower}/search${q ? `?q=${encodeURIComponent(q)}` : ''}`}
                className="block text-center text-xs text-slate-500 hover:text-white">
                مسح الفلاتر
              </Link>
            )}
          </form>
        </aside>

        {/* Results */}
        <div className="flex-1">
          {productsList.length === 0 ? (
            <div className="rounded-2xl border border-white/5 bg-slate-900 py-20 text-center">
              <p className="text-4xl mb-3">🔍</p>
              <p className="text-slate-400 font-medium">لا توجد نتائج</p>
              {q && <p className="text-slate-600 text-sm mt-1">جرّب كلمات بحث مختلفة</p>}
              <Link href={`/marketplace/${countryLower}`}
                className="mt-4 inline-block text-sm text-sky-400 hover:text-sky-300">
                العودة للرئيسية
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {productsList.map(p => (
                <Link key={p.id}
                  href={`/store/${p.stores.country_code.toLowerCase()}/${p.stores.subdomain}/product/${p.slug}`}
                  className="group rounded-2xl border border-white/5 bg-slate-900 overflow-hidden hover:border-sky-500/30 transition-all">
                  <div className="aspect-square overflow-hidden bg-slate-800">
                    {p.thumbnail_url
                      ? <img src={p.thumbnail_url} alt={p.name}
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      : <div className="h-full w-full flex items-center justify-center text-3xl">🛍️</div>
                    }
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
          )}
        </div>
      </div>
    </div>
  )
}
