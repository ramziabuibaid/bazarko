import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import OffersClient from '@/components/dashboard/offers/OffersClient'

export default async function OffersPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  const { data: rawOffers } = await supabase
    .from('offers')
    .select('id, title, description, starts_at, ends_at, is_active, created_at, offer_items(id, offer_price, products(name, price))')
    .eq('store_id', store.id)
    .order('created_at', { ascending: false })

  const offers = (rawOffers ?? []) as unknown as Parameters<typeof OffersClient>[0]['offers']

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">العروض الحصرية</h1>
          <p className="mt-1 text-sm text-slate-400">{offers.length} عرض في متجرك</p>
        </div>
        <Link
          href="/dashboard/offers/new"
          className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-sky-400"
        >
          + عرض جديد
        </Link>
      </div>

      {offers.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-12 text-center">
          <p className="text-4xl">🏷️</p>
          <p className="mt-3 text-slate-300">لا توجد عروض بعد</p>
          <p className="mt-1 text-sm text-slate-500">أنشئ أول عرض حصري لجذب الزبائن</p>
          <Link
            href="/dashboard/offers/new"
            className="mt-5 inline-block rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-medium text-slate-950 hover:bg-sky-400"
          >
            + عرض جديد
          </Link>
        </div>
      ) : (
        <OffersClient offers={offers} currencyCode={store.currency_code} />
      )}
    </div>
  )
}
