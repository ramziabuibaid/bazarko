import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function AlertsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  const { data: products } = await supabase
    .from('products')
    .select('id, name, sku, thumbnail_url, stock_quantity, stock_available, low_stock_alert, price')
    .eq('store_id', store.id)
    .eq('is_active', true)
    .eq('track_stock', true)
    .order('stock_available', { ascending: true })

  type AlertProduct = {
    id: string; name: string; sku: string | null; thumbnail_url: string | null
    stock_quantity: number; stock_available: number; low_stock_alert: number | null; price: number
  }

  // نفد المخزون تماماً أو وصل لحد التنبيه المضبوط يدوياً
  const alerts = (products ?? [] as AlertProduct[]).filter((p: AlertProduct) =>
    p.stock_available <= 0 ||
    (p.low_stock_alert != null && p.low_stock_alert > 0 && p.stock_available <= p.low_stock_alert)
  )

  const outOfStock = alerts.filter((p: AlertProduct) => p.stock_available <= 0)
  const lowStock   = alerts.filter((p: AlertProduct) => p.stock_available > 0)

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/dashboard/inventory" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          ← المخزون
        </Link>
        <h1 className="text-xl font-semibold text-white">تنبيهات المخزون</h1>
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-emerald-500/5 py-16 text-center">
          <p className="text-4xl">✅</p>
          <p className="mt-3 text-emerald-400 font-medium">المخزون بخير! لا توجد تنبيهات</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* نفد المخزون */}
          {outOfStock.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-400">
                🔴 نفد المخزون
                <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs">{outOfStock.length}</span>
              </h2>
              <div className="overflow-hidden rounded-2xl border border-red-500/20">
                {outOfStock.map((p: AlertProduct, i: number) => (
                  <div key={p.id} className={`flex items-center gap-4 px-4 py-3 ${i > 0 ? 'border-t border-white/5' : ''}`}>
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
                      {p.thumbnail_url
                        ? <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
                        : <div className="flex h-full items-center justify-center">🛍️</div>}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white">{p.name}</p>
                      {p.sku && <p className="text-xs text-slate-500" dir="ltr">{p.sku}</p>}
                    </div>
                    <span className="text-sm font-bold text-red-400">نفد</span>
                    <Link
                      href={`/dashboard/inventory?q=${encodeURIComponent(p.name)}`}
                      className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-sky-500/15 hover:text-sky-400"
                    >
                      تعديل المخزون
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* قارب النفاد */}
          {lowStock.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-yellow-400">
                🟡 قارب النفاد
                <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs">{lowStock.length}</span>
              </h2>
              <div className="overflow-hidden rounded-2xl border border-yellow-500/20">
                {lowStock.map((p: AlertProduct, i: number) => (
                  <div key={p.id} className={`flex items-center gap-4 px-4 py-3 ${i > 0 ? 'border-t border-white/5' : ''}`}>
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
                      {p.thumbnail_url
                        ? <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
                        : <div className="flex h-full items-center justify-center">🛍️</div>}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white">{p.name}</p>
                      {p.sku && <p className="text-xs text-slate-500" dir="ltr">{p.sku}</p>}
                    </div>
                    <div className="text-center">
                      <span className="text-sm font-bold text-yellow-400">{p.stock_available}</span>
                      <p className="text-xs text-slate-500">متبقي</p>
                    </div>
                    <div className="text-center">
                      <span className="text-xs text-slate-500">حد التنبيه: {p.low_stock_alert ?? 5}</span>
                    </div>
                    <Link
                      href={`/dashboard/inventory?q=${encodeURIComponent(p.name)}`}
                      className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-sky-500/15 hover:text-sky-400"
                    >
                      تعديل
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
