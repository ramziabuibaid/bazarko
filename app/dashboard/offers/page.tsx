import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'

interface OfferRow {
  id: string
  title: string
  description: string | null
  starts_at: string
  ends_at: string
  is_active: boolean
  created_at: string
  offer_items: { id: string; offer_price: number; products: { name: string; price: number } | null }[]
}

type OfferStatus = 'active' | 'upcoming' | 'ended' | 'disabled'

function offerStatus(offer: OfferRow): OfferStatus {
  if (!offer.is_active) return 'disabled'
  const now = Date.now()
  if (now < new Date(offer.starts_at).getTime()) return 'upcoming'
  if (now > new Date(offer.ends_at).getTime()) return 'ended'
  return 'active'
}

const STATUS_META: Record<OfferStatus, { label: string; cls: string }> = {
  active:   { label: 'جارٍ الآن',  cls: 'bg-emerald-500/15 text-emerald-400' },
  upcoming: { label: 'مجدول',     cls: 'bg-sky-500/15 text-sky-400' },
  ended:    { label: 'منتهي',     cls: 'bg-slate-500/15 text-slate-400' },
  disabled: { label: 'متوقف',     cls: 'bg-amber-500/15 text-amber-400' },
}

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

  const offers = (rawOffers ?? []) as unknown as OfferRow[]

  const stats = {
    total: offers.length,
    active: offers.filter(o => offerStatus(o) === 'active').length,
    upcoming: offers.filter(o => offerStatus(o) === 'upcoming').length,
    ended: offers.filter(o => offerStatus(o) === 'ended').length,
  }

  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleDateString('ar', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">العروض الحصرية</h1>
          <p className="mt-1 text-sm text-slate-400">{stats.total} عرض في متجرك</p>
        </div>
        <Link
          href="/dashboard/offers/new"
          className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-sky-400"
        >
          + عرض جديد
        </Link>
      </div>

      {/* إحصائيات سريعة */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'إجمالي', value: stats.total, color: 'text-white' },
          { label: 'جارٍ الآن', value: stats.active, color: 'text-emerald-400' },
          { label: 'مجدول', value: stats.upcoming, color: 'text-sky-400' },
          { label: 'منتهي', value: stats.ended, color: 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-white/5 bg-slate-900 p-4">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {!offers.length ? (
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
        <div className="space-y-3">
          {offers.map(offer => {
            const status = offerStatus(offer)
            const meta = STATUS_META[status]
            const maxDiscount = Math.max(
              0,
              ...offer.offer_items
                .filter(i => i.products && i.products.price > 0)
                .map(i => Math.round((1 - i.offer_price / i.products!.price) * 100))
            )
            return (
              <Link
                key={offer.id}
                href={`/dashboard/offers/${offer.id}`}
                className="block rounded-2xl border border-white/5 bg-slate-900 p-5 transition hover:border-white/10"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold text-white">{offer.title}</h3>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </div>
                    {offer.description && (
                      <p className="mt-1 line-clamp-1 text-sm text-slate-400">{offer.description}</p>
                    )}
                    <p className="mt-2 text-xs text-slate-500">
                      {dateFmt(offer.starts_at)} ← {dateFmt(offer.ends_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-center">
                      <p className="font-semibold text-white">{offer.offer_items.length}</p>
                      <p className="text-xs text-slate-500">منتج</p>
                    </div>
                    {maxDiscount > 0 && (
                      <div className="text-center">
                        <p className="font-semibold text-red-400">-{maxDiscount}%</p>
                        <p className="text-xs text-slate-500">أعلى خصم</p>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
