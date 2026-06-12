import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import OfferForm from '@/components/dashboard/offers/OfferForm'
import OfferShareActions from '@/components/dashboard/offers/OfferShareActions'

export default async function EditOfferPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code, subdomain, country_code')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  const { data: offer } = await supabase
    .from('offers')
    .select('id, title, description, starts_at, ends_at, is_active, per_customer_limit, view_count, offer_items(product_id, offer_price, max_quantity, sold_quantity)')
    .eq('id', params.id)
    .eq('store_id', store.id)
    .single()
  if (!offer) notFound()

  const offerItems = (offer.offer_items ?? []) as {
    product_id: string; offer_price: number; max_quantity: number | null; sold_quantity: number
  }[]

  const [{ data: products }, { data: categories }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, price, thumbnail_url, stock_available, category_id')
      .eq('store_id', store.id)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('categories')
      .select('id, name')
      .eq('store_id', store.id)
      .eq('is_active', true)
      .order('sort_order'),
  ])

  // تحليلات العرض: طلبيات منتجات العرض خلال فترته
  const productIds = offerItems.map(i => i.product_id)
  let orderedQty = 0
  let offerRevenue = 0
  if (productIds.length) {
    const { data: soldRows } = await supabase
      .from('order_items')
      .select('quantity, total_price, orders!inner(store_id, created_at, status)')
      .in('product_id', productIds)
      .eq('orders.store_id', store.id)
      .gte('orders.created_at', offer.starts_at)
      .lte('orders.created_at', offer.ends_at)
      .neq('orders.status', 'cancelled')

    for (const row of (soldRows ?? []) as { quantity: number; total_price: number }[]) {
      orderedQty += row.quantity ?? 0
      offerRevenue += row.total_price ?? 0
    }
  }

  const domain = process.env.NEXT_PUBLIC_DOMAIN ?? 'bazarko.app'
  const shareUrl = `https://${store.subdomain}.${store.country_code.toLowerCase()}.${domain}/offer/${offer.id}`
  const previewUrl = `/store/${store.country_code.toLowerCase()}/${store.subdomain}/offer/${offer.id}`

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/offers" className="text-sm text-slate-500 hover:text-sky-400">
            → العروض الحصرية
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-white">تعديل العرض</h1>
        </div>
        <a
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
        >
          👁️ معاينة في المتجر
        </a>
      </div>

      {/* تحليلات العرض */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          { label: 'مشاهدات الصفحة', value: (offer.view_count ?? 0).toLocaleString('ar'), icon: '👁️' },
          { label: 'قطع مبيعة خلال العرض', value: orderedQty.toLocaleString('ar'), icon: '🛒' },
          { label: 'إيراد العرض', value: `${offerRevenue.toLocaleString('ar')} ${store.currency_code}`, icon: '💰' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-white/5 bg-slate-900 p-4">
            <p className="text-xs text-slate-500">{s.icon} {s.label}</p>
            <p className="mt-1 text-xl font-semibold text-white">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-6">
        <OfferShareActions offerId={offer.id} offerTitle={offer.title} publicUrl={shareUrl} />
      </div>

      <OfferForm
        storeId={store.id}
        currencyCode={store.currency_code}
        products={(products ?? []) as any}
        categories={(categories ?? []) as any}
        initialData={{
          id: offer.id,
          title: offer.title,
          description: offer.description ?? '',
          starts_at: offer.starts_at,
          ends_at: offer.ends_at,
          is_active: offer.is_active,
          per_customer_limit: offer.per_customer_limit != null ? String(offer.per_customer_limit) : '',
          items: offerItems.map(i => ({
            product_id: i.product_id,
            offer_price: String(i.offer_price),
            max_quantity: i.max_quantity != null ? String(i.max_quantity) : '',
            sold_quantity: i.sold_quantity ?? 0,
          })),
        }}
      />
    </div>
  )
}
