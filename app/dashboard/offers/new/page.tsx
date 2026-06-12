import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import OfferForm from '@/components/dashboard/offers/OfferForm'

const FREE_PLAN_ACTIVE_OFFERS_LIMIT = 1

export default async function NewOfferPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code, plan')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  // بوابة الخطط: الخطة المجانية = عرض نشط واحد (لم ينتهِ بعد)
  if (store.plan === 'free') {
    const { count } = await supabase
      .from('offers')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', store.id)
      .eq('is_active', true)
      .gte('ends_at', new Date().toISOString())

    if ((count ?? 0) >= FREE_PLAN_ACTIVE_OFFERS_LIMIT) {
      return (
        <div className="mx-auto max-w-3xl p-6">
          <Link href="/dashboard/offers" className="text-sm text-slate-500 hover:text-sky-400">
            → العروض الحصرية
          </Link>
          <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-10 text-center">
            <p className="text-4xl">⭐</p>
            <h1 className="mt-4 text-xl font-semibold text-white">وصلت لحد الخطة المجانية</h1>
            <p className="mt-2 text-sm text-slate-400">
              الخطة المجانية تسمح بعرض نشط واحد فقط في نفس الوقت.
              <br />
              رقِّ لخطة Pro للحصول على عروض غير محدودة، أو أوقف/احذف العرض الحالي.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Link
                href="/dashboard/settings"
                className="rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-medium text-slate-950 hover:bg-sky-400"
              >
                ⭐ الترقية لـ Pro
              </Link>
              <Link
                href="/dashboard/offers"
                className="rounded-xl border border-white/10 px-5 py-2.5 text-sm text-slate-300 hover:bg-white/5"
              >
                إدارة العروض الحالية
              </Link>
            </div>
          </div>
        </div>
      )
    }
  }

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

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <Link href="/dashboard/offers" className="text-sm text-slate-500 hover:text-sky-400">
          → العروض الحصرية
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">عرض جديد</h1>
        <p className="mt-1 text-sm text-slate-400">حدد فترة العرض والمنتجات وأسعارها الخاصة</p>
      </div>

      <OfferForm
        storeId={store.id}
        currencyCode={store.currency_code}
        products={(products ?? []) as any}
        categories={(categories ?? []) as any}
      />
    </div>
  )
}
