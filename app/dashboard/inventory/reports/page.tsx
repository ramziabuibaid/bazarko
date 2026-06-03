import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function InventoryReportsPage() {
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

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
  const sevenDaysAgo  = new Date(Date.now() -  7 * 86400000).toISOString()

  // جلب كل البيانات بالتوازي
  const [
    { data: allProducts },
    { data: saleMovements },
    { data: purchaseMovements },
    { data: recentMovements },
    { data: categories },
  ] = await Promise.all([
    // كل المنتجات النشطة مع تتبع المخزون
    supabase
      .from('products')
      .select('id, name, sku, category_id, stock_quantity, stock_available, cost_price, price, low_stock_alert, track_stock, updated_at')
      .eq('store_id', store.id)
      .eq('is_active', true)
      .eq('track_stock', true),

    // مبيعات آخر 30 يوم
    supabase
      .from('stock_movements')
      .select('product_id, quantity')
      .eq('store_id', store.id)
      .eq('type', 'sale')
      .gte('created_at', thirtyDaysAgo),

    // مشتريات آخر 30 يوم
    supabase
      .from('stock_movements')
      .select('product_id, quantity')
      .eq('store_id', store.id)
      .eq('type', 'purchase')
      .gte('created_at', thirtyDaysAgo),

    // حركات آخر 7 أيام للرسم البياني اليومي
    supabase
      .from('stock_movements')
      .select('type, quantity, created_at')
      .eq('store_id', store.id)
      .gte('created_at', sevenDaysAgo)
      .order('created_at'),

    // الفئات
    supabase
      .from('categories')
      .select('id, name')
      .eq('store_id', store.id),
  ])

  type Product = {
    id: string; name: string; sku: string | null; category_id: string | null
    stock_quantity: number; stock_available: number; cost_price: number | null
    price: number; low_stock_alert: number | null; track_stock: boolean; updated_at: string
  }
  type Movement = { product_id: string; quantity: number }
  type DailyMove = { type: string; quantity: number; created_at: string }
  type Category  = { id: string; name: string }

  const products  = (allProducts    ?? []) as Product[]
  const sales     = (saleMovements  ?? []) as Movement[]
  const purchases = (purchaseMovements ?? []) as Movement[]
  const daily     = (recentMovements  ?? []) as DailyMove[]
  const cats      = (categories ?? []) as Category[]

  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 0 })

  // مجمّع المبيعات لكل منتج
  const salesMap: Record<string, number> = {}
  sales.forEach(m => {
    salesMap[m.product_id] = (salesMap[m.product_id] ?? 0) + Math.abs(m.quantity)
  })

  const purchasesMap: Record<string, number> = {}
  purchases.forEach(m => {
    purchasesMap[m.product_id] = (purchasesMap[m.product_id] ?? 0) + Math.abs(m.quantity)
  })

  // الإحصائيات الإجمالية
  const totalValue    = products.reduce((s, p) => s + (p.stock_quantity ?? 0) * (p.cost_price ?? 0), 0)
  const totalUnits    = products.reduce((s, p) => s + (p.stock_quantity ?? 0), 0)
  const totalSold30   = sales.reduce((s, m) => s + Math.abs(m.quantity), 0)
  const totalBought30 = purchases.reduce((s, m) => s + Math.abs(m.quantity), 0)

  // المنتجات الأكثر مبيعاً (آخر 30 يوم)
  const topSellers = products
    .map(p => ({ ...p, sold: salesMap[p.id] ?? 0 }))
    .filter(p => p.sold > 0)
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 10)

  // المنتجات الراكدة (لا حركة بيع في 30 يوم + مخزون > 0)
  const stagnant = products
    .filter(p => (salesMap[p.id] ?? 0) === 0 && p.stock_available > 0)
    .sort((a, b) => (b.stock_quantity * (b.cost_price ?? 0)) - (a.stock_quantity * (a.cost_price ?? 0)))
    .slice(0, 10)

  // توزيع قيمة المخزون بالفئة
  const catMap: Record<string, string> = {}
  cats.forEach(c => { catMap[c.id] = c.name })

  const categoryValues: Record<string, { name: string; value: number; count: number }> = {}
  products.forEach(p => {
    const catName = p.category_id ? (catMap[p.category_id] ?? 'غير مصنّف') : 'غير مصنّف'
    if (!categoryValues[catName]) categoryValues[catName] = { name: catName, value: 0, count: 0 }
    categoryValues[catName].value += (p.stock_quantity ?? 0) * (p.cost_price ?? 0)
    categoryValues[catName].count += 1
  })
  const catList = Object.values(categoryValues).sort((a, b) => b.value - a.value)
  const maxCatValue = Math.max(...catList.map(c => c.value), 1)

  // الرسم البياني: حركات يومية (آخر 7 أيام)
  const dayLabels: string[] = []
  const daySales:  number[] = []
  const dayBuys:   number[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
    const dateStr = d.toISOString().slice(0, 10)
    dayLabels.push(d.toLocaleDateString('ar', { weekday: 'short', day: 'numeric' }))
    const dayMovements = daily.filter(m => m.created_at.slice(0, 10) === dateStr)
    daySales.push(dayMovements.filter(m => m.type === 'sale').reduce((s, m) => s + Math.abs(m.quantity), 0))
    dayBuys.push(dayMovements.filter(m => m.type === 'purchase').reduce((s, m) => s + Math.abs(m.quantity), 0))
  }
  const maxBar = Math.max(...daySales, ...dayBuys, 1)

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard/inventory"
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          ← المخزون
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-white">تقارير المخزون</h1>
          <p className="text-sm text-slate-400">آخر 30 يوم</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: 'قيمة المخزون الكلية', value: `${fmt(totalValue)} ${store.currency_code}`, cls: 'text-emerald-400' },
          { label: 'إجمالي الوحدات',      value: fmt(totalUnits),                              cls: 'text-white' },
          { label: 'مُباع هذا الشهر',     value: fmt(totalSold30),                             cls: 'text-red-400' },
          { label: 'مُستلَم هذا الشهر',   value: fmt(totalBought30),                           cls: 'text-sky-400' },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border border-white/5 bg-slate-900 p-4 text-center">
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className={`text-xl font-bold ${s.cls}`} dir="ltr">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

        {/* رسم بياني — حركات آخر 7 أيام */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-white mb-4">حركات آخر 7 أيام</h2>
          <div className="flex items-end gap-2 h-36">
            {dayLabels.map((label, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex gap-0.5 items-end" style={{ height: '100px' }}>
                  <div className="flex-1 rounded-t bg-red-500/60 transition-all"
                    style={{ height: `${(daySales[i] / maxBar) * 100}%`, minHeight: daySales[i] > 0 ? '4px' : '0' }} />
                  <div className="flex-1 rounded-t bg-sky-500/60 transition-all"
                    style={{ height: `${(dayBuys[i] / maxBar) * 100}%`, minHeight: dayBuys[i] > 0 ? '4px' : '0' }} />
                </div>
                <p className="text-xs text-slate-600 text-center leading-tight">{label}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded bg-red-500/60" /> مبيعات</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded bg-sky-500/60" /> مشتريات</span>
          </div>
        </div>

        {/* توزيع قيمة المخزون بالفئة */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-white mb-4">قيمة المخزون بالفئة</h2>
          {catList.length === 0 ? (
            <p className="text-sm text-slate-600 text-center py-8">لا توجد بيانات</p>
          ) : (
            <div className="space-y-3">
              {catList.map(c => (
                <div key={c.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">{c.name}</span>
                    <span className="text-slate-400" dir="ltr">{fmt(c.value)} {store.currency_code}</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full bg-sky-500/70"
                      style={{ width: `${(c.value / maxCatValue) * 100}%` }} />
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">{c.count} منتج</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* المنتجات الأكثر مبيعاً */}
      <div className="rounded-2xl border border-white/5 bg-slate-900">
        <div className="px-5 py-4 border-b border-white/5">
          <h2 className="text-sm font-semibold text-white">🔥 الأكثر مبيعاً — آخر 30 يوم</h2>
        </div>
        {topSellers.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-600 text-center">لا توجد مبيعات مسجّلة في هذه الفترة</p>
        ) : (
          <div className="divide-y divide-white/5">
            {topSellers.map((p, i) => {
              const stockValue = (p.stock_quantity ?? 0) * (p.cost_price ?? 0)
              return (
                <div key={p.id} className="flex items-center gap-4 px-5 py-3">
                  <span className="text-lg font-bold text-slate-600 w-6 text-center">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{p.name}</p>
                    {p.sku && <p className="text-xs text-slate-500" dir="ltr">{p.sku}</p>}
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-red-400" dir="ltr">−{p.sold}</p>
                    <p className="text-xs text-slate-600">مباع</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-white">{p.stock_available}</p>
                    <p className="text-xs text-slate-600">متبقي</p>
                  </div>
                  {stockValue > 0 && (
                    <div className="text-left hidden sm:block">
                      <p className="text-xs text-slate-400" dir="ltr">{fmt(stockValue)} {store.currency_code}</p>
                      <p className="text-xs text-slate-600">قيمة المخزون</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* المنتجات الراكدة */}
      <div className="rounded-2xl border border-white/5 bg-slate-900">
        <div className="px-5 py-4 border-b border-white/5">
          <h2 className="text-sm font-semibold text-white">🧊 منتجات راكدة — لا مبيعات في 30 يوم</h2>
        </div>
        {stagnant.length === 0 ? (
          <p className="px-5 py-8 text-sm text-emerald-600 text-center">✓ جميع المنتجات تحركت خلال الشهر الماضي</p>
        ) : (
          <div className="divide-y divide-white/5">
            {stagnant.map(p => {
              const stockValue = (p.stock_quantity ?? 0) * (p.cost_price ?? 0)
              return (
                <div key={p.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{p.name}</p>
                    {p.sku && <p className="text-xs text-slate-500" dir="ltr">{p.sku}</p>}
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-yellow-400">{p.stock_available}</p>
                    <p className="text-xs text-slate-600">وحدة</p>
                  </div>
                  {stockValue > 0 && (
                    <div className="text-left">
                      <p className="text-xs text-slate-400" dir="ltr">{fmt(stockValue)} {store.currency_code}</p>
                      <p className="text-xs text-slate-600">قيمة مجمّدة</p>
                    </div>
                  )}
                  <Link href={`/dashboard/products/${p.id}`}
                    className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-400 hover:text-white">
                    تعديل
                  </Link>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
