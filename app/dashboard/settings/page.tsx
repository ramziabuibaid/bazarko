import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import StoreSettingsForm from '@/components/dashboard/settings/StoreSettingsForm'

import Link from 'next/link'

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
      map_url, header_theme, footer_settings, modules, settings
    `)
    .eq('id', storeId)
    .single()

  if (!store) redirect('/onboarding')

  // العملاء لربط زبون الكاش في الـ POS
  const { data: customers } = await supabase
    .from('customers')
    .select('id, name, shamel_code, phone')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('name')

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
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-white">إعدادات المتجر</h1>
          <p className="mt-1 text-sm text-slate-400">تحديث بيانات وهوية متجرك وفريق العمل</p>
        </div>
        <div className="flex gap-2">
          <span className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs sm:text-sm font-medium text-sky-400">
            ⚙️ بيانات المتجر
          </span>
          <Link
            href="/dashboard/settings/team"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs sm:text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            👥 إدارة المستخدمين والصلاحيات
          </Link>
        </div>
      </div>
      <div className="max-w-3xl">
        <StoreSettingsForm
          store={store}
          customers={customers || []}
          avgRating={avgRating}
          completedOrders={completedOrders ?? 0}
        />
      </div>
    </div>
  )
}
