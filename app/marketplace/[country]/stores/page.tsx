import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getCountryByCode } from '@/lib/countries'

interface Props { params: { country: string } }

export default async function MarketplaceStoresPage({ params }: Props) {
  const country = getCountryByCode(params.country)
  if (!country) notFound()

  const supabase = createClient()

  const { data: stores } = await supabase
    .from('stores')
    .select('id, name, subdomain, country_code, created_at')
    .eq('country_code', country.code)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  type StoreRow = { id: string; name: string; subdomain: string; country_code: string; created_at: string }
  const storesList = (stores ?? []) as StoreRow[]

  // عدد منتجات كل متجر
  const { data: productCounts } = storesList.length > 0
    ? await supabase
        .from('products')
        .select('store_id')
        .in('store_id', storesList.map(s => s.id))
        .eq('is_active', true)
    : { data: [] }

  const countMap: Record<string, number> = {}
  ;(productCounts ?? []).forEach((p: { store_id: string }) => {
    countMap[p.store_id] = (countMap[p.store_id] ?? 0) + 1
  })

  const countryLower = params.country.toLowerCase()

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">🏪 المتاجر في {country.name_ar}</h1>
          <p className="text-sm text-slate-400 mt-0.5">{storesList.length} متجر نشط</p>
        </div>
        <Link href={`/marketplace/${countryLower}`}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          ← الرئيسية
        </Link>
      </div>

      {storesList.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-slate-900 py-20 text-center">
          <p className="text-5xl mb-4">🏪</p>
          <p className="text-slate-400">لا توجد متاجر مسجّلة في {country.name_ar} بعد</p>
          <Link href="/onboarding"
            className="mt-4 inline-block rounded-xl bg-sky-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-sky-500">
            سجّل متجرك مجاناً
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {storesList.map(store => (
            <Link key={store.id}
              href={`/store/${store.country_code.toLowerCase()}/${store.subdomain}`}
              className="group rounded-2xl border border-white/5 bg-slate-900 p-5 hover:border-sky-500/30 hover:bg-slate-800 transition-all">
              {/* Store Avatar */}
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-sky-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center text-2xl mb-4">
                🏪
              </div>
              <p className="font-semibold text-white group-hover:text-sky-400 transition-colors leading-tight">
                {store.name}
              </p>
              <p className="text-xs text-slate-500 mt-0.5" dir="ltr">{store.subdomain}.bazarko.app</p>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  {countMap[store.id] ?? 0} منتج
                </span>
                <span className="text-xs text-sky-400 group-hover:underline">زيارة ←</span>
              </div>

              <p className="text-xs text-slate-600 mt-2">
                منذ {new Date(store.created_at).toLocaleDateString('ar', { year: 'numeric', month: 'short' })}
              </p>
            </Link>
          ))}
        </div>
      )}

      {/* CTA للتجار */}
      <div className="rounded-2xl border border-sky-500/10 bg-sky-500/5 p-6 text-center">
        <p className="text-sm text-slate-300">هل تملك متجراً وتريد الظهور هنا؟</p>
        <Link href="/onboarding"
          className="mt-3 inline-block rounded-xl bg-sky-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 transition-colors">
          انضم إلى Bazarko مجاناً ←
        </Link>
      </div>
    </div>
  )
}
