import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import StoreSettingsForm from '@/components/dashboard/settings/StoreSettingsForm'

export default async function SettingsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select(`
      id, name, description, logo_url, cover_url,
      phone, whatsapp, email, city, address,
      subdomain, country_code, currency_code,
      instagram, facebook, tiktok, telegram,
      business_hours, is_verified,
      secondary_currency_code, exchange_rate, prefer_secondary,
      map_url, header_theme, footer_settings
    `)
    .eq('id', storeId)
    .single()

  if (!store) redirect('/onboarding')

  // متوسط التقييمات
  const { data: reviews } = await supabase
    .from('store_reviews')
    .select('rating')
    .eq('store_id', storeId)
    .eq('is_visible', true)

  const avgRating =
    reviews && reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : null

  // عدد الطلبات المنجزة
  const { count: completedOrders } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('status', 'delivered')

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">إعدادات المتجر</h1>
        <p className="mt-1 text-sm text-slate-400">تحديث بيانات وهوية متجرك</p>
      </div>
      <div className="max-w-3xl">
        <StoreSettingsForm
          store={store}
          avgRating={avgRating}
          completedOrders={completedOrders ?? 0}
        />
      </div>
    </div>
  )
}
