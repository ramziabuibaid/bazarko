import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import DeliveryManager from '@/components/dashboard/delivery/DeliveryManager'

export default async function DeliveryPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code, delivery_enabled, free_delivery_threshold')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  // جلب المناطق مع أنواع الشحن الخاصة بكل منطقة
  const { data: zones } = await supabase
    .from('delivery_zones')
    .select('id, name, cost, is_active, estimated_days, sort_order, shipping_methods(id, name, cost, min_days, max_days, is_active, sort_order)')
    .eq('store_id', store.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">إدارة الشحن والتوصيل</h1>
        <p className="mt-1 text-sm text-slate-400">
          أضف المحافظات التي تشحن إليها ← ثم أضف داخل كل محافظة أنواع الشحن وأسعارها
        </p>
      </div>

      <DeliveryManager
        storeId={store.id}
        currencyCode={store.currency_code}
        initialDeliveryEnabled={store.delivery_enabled ?? true}
        initialFreeThreshold={store.free_delivery_threshold ?? null}
        initialZones={(zones ?? []) as Parameters<typeof DeliveryManager>[0]['initialZones']}
      />
    </div>
  )
}
