import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import InventoryTable from '@/components/dashboard/inventory/InventoryTable'

interface Props {
  searchParams: { q?: string; status?: string }
}

export default async function InventoryPage({ searchParams }: Props) {
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

  let query = supabase
    .from('products')
    .select('id, name, sku, price, cost_price, thumbnail_url, stock_quantity, stock_available, track_stock, low_stock_alert, category_id, is_active, updated_at')
    .eq('store_id', store.id)
    .eq('track_stock', true)
    .order('stock_available', { ascending: true })

  if (searchParams.q) {
    query = query.or(`name.ilike.%${searchParams.q}%,sku.ilike.%${searchParams.q}%`)
  }

  if (searchParams.status === 'out') {
    query = query.lte('stock_available', 0)
  } else if (searchParams.status === 'low') {
    query = query.gt('stock_available', 0)
  }

  let { data: products } = await query

  if (searchParams.status === 'low' && products) {
    products = products.filter(p => 
      (p.stock_available ?? 0) > 0 &&
      p.low_stock_alert != null &&
      p.low_stock_alert > 0 &&
      (p.stock_available ?? 0) <= p.low_stock_alert
    )
  }


  // إحصائيات
  const { data: all } = await supabase
    .from('products')
    .select('stock_quantity, stock_available, low_stock_alert, cost_price, price, track_stock')
    .eq('store_id', store.id)
    .eq('is_active', true)

  type StockRow = { stock_quantity: number; stock_available: number; low_stock_alert: number | null; cost_price: number | null; price: number; track_stock: boolean }
  const tracked = (all ?? [] as StockRow[]).filter((p: StockRow) => p.track_stock)
  const outOfStock  = tracked.filter((p: StockRow) => (p.stock_available ?? 0) <= 0).length
  const lowStock    = tracked.filter((p: StockRow) =>
    (p.stock_available ?? 0) > 0 &&
    p.low_stock_alert != null &&
    p.low_stock_alert > 0 &&
    (p.stock_available ?? 0) <= p.low_stock_alert
  ).length

  // نحسب القيمة والأرباح فقط للمنتجات التي لديها سعر تكلفة محدد وصحيح
  const trackedWithCost = tracked.filter((p: StockRow) => p.cost_price != null && p.cost_price > 0)
  const missingCostCount = tracked.length - trackedWithCost.length
  const totalValue     = trackedWithCost.reduce((s: number, p: StockRow) => s + (p.stock_quantity ?? 0) * p.cost_price!, 0)
  const expectedProfit = trackedWithCost.reduce((s: number, p: StockRow) => s + (p.stock_quantity ?? 0) * ((p.price ?? 0) - p.cost_price!), 0)

  // إن لم يوجد أي منتج بسعر تكلفة → نعرض «—» بدل «0» حتى لا يظنّ المستخدم أنه خطأ
  const hasCostData    = trackedWithCost.length > 0
  const valueDisplay   = hasCostData ? `${totalValue.toLocaleString('ar-u-nu-latn')} ${store.currency_code}` : '—'
  const profitDisplay  = hasCostData ? `${expectedProfit.toLocaleString('ar-u-nu-latn')} ${store.currency_code}` : '—'

  // أهمّ تنبيه يُعرض داخل البطاقة (الأشدّ أولاً)
  const topAlert =
    outOfStock > 0 ? `🔴 ${outOfStock} ${outOfStock === 1 ? 'منتج نفد' : 'منتجات نفدت'} من المخزون`
    : lowStock > 0 ? `🟡 ${lowStock} ${lowStock === 1 ? 'منتج قارب' : 'منتجات قاربت'} النفاد`
    : missingCostCount > 0 ? `⚠️ ${missingCostCount} ${missingCostCount === 1 ? 'منتج' : 'منتجات'} بدون سعر تكلفة`
    : null
  const alertCount = outOfStock + lowStock + missingCostCount

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">إدارة المخزون</h1>
          <p className="mt-1 text-sm text-slate-400">{tracked.length} منتج يتتبع المخزون</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/inventory/reports"
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">
            📊 تقارير
          </Link>
          <Link href="/dashboard/inventory/movements"
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">
            📋 الحركات
          </Link>
          <Link href="/dashboard/inventory/alerts"
            className={`rounded-xl px-4 py-2 text-sm font-medium ${
              alertCount > 0
                ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                : 'border border-white/10 text-slate-300 hover:bg-white/5'
            }`}>
            ⚠️ تنبيهات {alertCount > 0 && `(${alertCount})`}
          </Link>
        </div>
      </div>

      {/* بطاقة التنبيه الأهم — يعرف المستخدم السبب فوراً */}
      {topAlert && (
        <Link href="/dashboard/inventory/alerts"
          className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-4 transition hover:bg-red-500/10">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-red-300">{topAlert}</span>
            {alertCount > 1 && (
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-400">+{alertCount - 1} تنبيه آخر</span>
            )}
          </div>
          <span className="text-xs text-slate-400">عرض الكل ←</span>
        </Link>
      )}

      {/* بطاقات — المشاكل أولاً ثم الإحصائيات (الأهمّ على الجوال) */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'قارب النفاد',      value: lowStock,         icon: '🟡', color: 'text-yellow-400' },
          { label: 'نفد المخزون',      value: outOfStock,       icon: '🔴', color: 'text-red-400' },
          { label: 'منتجات مُتتبَّعة', value: tracked.length,  icon: '📦', color: 'text-white' },
          { label: 'قيمة المخزون',     value: valueDisplay,     icon: '💰', color: 'text-emerald-400' },
          { label: 'الأرباح المتوقعة', value: profitDisplay,    icon: '📈', color: hasCostData && expectedProfit < 0 ? 'text-red-400' : 'text-sky-400' },
        ].map(c => (
          <div key={c.label} className="rounded-2xl border border-white/5 bg-slate-900 p-4">
            <p className="text-xs text-slate-400">{c.icon} {c.label}</p>
            <p className={`mt-1.5 text-xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* تحذير: منتجات بدون سعر تكلفة */}
      {missingCostCount > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <span className="text-lg leading-none">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-400">
              {missingCostCount} {missingCostCount === 1 ? 'منتج' : 'منتجات'} بدون سعر تكلفة
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {hasCostData
                ? 'قيمة المخزون والأرباح المتوقعة تشمل فقط المنتجات ذات سعر تكلفة محدد. أضف سعر التكلفة للمنتجات المتبقية للحصول على أرقام دقيقة.'
                : 'لا يمكن حساب قيمة المخزون أو الأرباح بعد — لم يُحدَّد سعر تكلفة لأي منتج. أضف سعر التكلفة لتظهر الأرقام.'}
            </p>
          </div>
        </div>
      )}

      <InventoryTable
        products={products ?? []}
        currencyCode={store.currency_code}
        storeId={store.id}
        userId={user.id}
        searchQuery={searchParams.q ?? ''}
        statusFilter={searchParams.status ?? ''}
      />
    </div>
  )
}
