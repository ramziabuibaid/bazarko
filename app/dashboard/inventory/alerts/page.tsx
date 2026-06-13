import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import AlertsContent from '@/components/dashboard/inventory/AlertsContent'

export default async function AlertsPage() {
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

  // جلب المنتجات (نشطة ومخفية على حد سواء — يجب التنبيه لكليهما)
  const { data: products } = await supabase
    .from('products')
    .select('id, name, sku, thumbnail_url, stock_quantity, stock_available, low_stock_alert, price, is_active')
    .eq('store_id', store.id)
    .eq('track_stock', true)
    .order('stock_available', { ascending: true })

  type AlertProduct = {
    id: string; name: string; sku: string | null; thumbnail_url: string | null
    stock_quantity: number; stock_available: number; low_stock_alert: number | null
    price: number; is_active: boolean
  }

  const allTracked = products ?? [] as AlertProduct[]
  const alerts = (allTracked as AlertProduct[]).filter(p =>
    p.stock_available <= 0 ||
    (p.low_stock_alert != null && p.low_stock_alert > 0 && p.stock_available <= p.low_stock_alert)
  )

  // إحصائيات مبيعات آخر 30 يوم لكل منتج في القائمة
  const productIds = alerts.map(p => p.id)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: salesMvmts } = productIds.length > 0
    ? await supabase
        .from('stock_movements')
        .select('product_id, quantity, created_at')
        .eq('store_id', store.id)
        .eq('type', 'sale')
        .in('product_id', productIds)
        .gte('created_at', thirtyDaysAgo)
    : { data: [] }

  // تجميع المبيعات بالمنتج
  const salesMap: Record<string, { monthlySold: number; lastSaleAt: string | null }> = {}
  for (const m of salesMvmts ?? []) {
    if (!salesMap[m.product_id]) salesMap[m.product_id] = { monthlySold: 0, lastSaleAt: null }
    salesMap[m.product_id].monthlySold += Math.abs(m.quantity as number)
    const at = m.created_at as string
    if (!salesMap[m.product_id].lastSaleAt || at > salesMap[m.product_id].lastSaleAt!) {
      salesMap[m.product_id].lastSaleAt = at
    }
  }

  const enriched = alerts.map(p => ({
    ...p,
    monthlySold: salesMap[p.id]?.monthlySold ?? 0,
    lastSaleAt: salesMap[p.id]?.lastSaleAt ?? null,
  }))

  const outOfStock = enriched.filter(p => p.stock_available <= 0)
  const lowStock   = enriched.filter(p => p.stock_available > 0)

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/dashboard/inventory" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          المخزون →
        </Link>
        <h1 className="text-xl font-semibold text-white">تنبيهات المخزون</h1>
      </div>

      <AlertsContent
        outOfStock={outOfStock}
        lowStock={lowStock}
        currencyCode={store.currency_code}
        storeId={store.id}
        userId={user.id}
      />
    </div>
  )
}
