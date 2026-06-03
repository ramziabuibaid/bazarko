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

  const { data: products } = await query

  // إحصائيات
  const { data: all } = await supabase
    .from('products')
    .select('stock_quantity, stock_available, low_stock_alert, cost_price, track_stock')
    .eq('store_id', store.id)
    .eq('is_active', true)

  type StockRow = { stock_quantity: number; stock_available: number; low_stock_alert: number | null; cost_price: number | null; track_stock: boolean }
  const tracked = (all ?? [] as StockRow[]).filter((p: StockRow) => p.track_stock)
  const outOfStock  = tracked.filter((p: StockRow) => (p.stock_available ?? 0) <= 0).length
  const lowStock    = tracked.filter((p: StockRow) =>
    (p.stock_available ?? 0) > 0 &&
    p.low_stock_alert != null &&
    p.low_stock_alert > 0 &&
    (p.stock_available ?? 0) <= p.low_stock_alert
  ).length
  const totalValue  = tracked.reduce((s: number, p: StockRow) => s + (p.stock_quantity ?? 0) * (p.cost_price ?? 0), 0)

  return (
    <div className="p-6">
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
              (outOfStock + lowStock) > 0
                ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                : 'border border-white/10 text-slate-300 hover:bg-white/5'
            }`}>
            ⚠️ تنبيهات {(outOfStock + lowStock) > 0 && `(${outOfStock + lowStock})`}
          </Link>
        </div>
      </div>

      {/* بطاقات */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'منتجات مُتتبَّعة', value: tracked.length,  icon: '📦', color: 'text-white' },
          { label: 'نفد المخزون',      value: outOfStock,       icon: '🔴', color: 'text-red-400' },
          { label: 'قارب النفاد',      value: lowStock,         icon: '🟡', color: 'text-yellow-400' },
          { label: 'قيمة المخزون',     value: `${totalValue.toLocaleString('ar')} ${store.currency_code}`, icon: '💰', color: 'text-emerald-400' },
        ].map(c => (
          <div key={c.label} className="rounded-2xl border border-white/5 bg-slate-900 p-4">
            <p className="text-xs text-slate-400">{c.icon} {c.label}</p>
            <p className={`mt-1.5 text-xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

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
