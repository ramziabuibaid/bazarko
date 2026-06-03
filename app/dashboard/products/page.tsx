import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ProductsTable from '@/components/dashboard/products/ProductsTable'

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { q?: string; category?: string; status?: string }
}) {
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
    .select(`
      id, name, slug, price, compare_price, cost_price,
      stock_quantity, stock_available, is_active, is_featured,
      thumbnail_url, sku, created_at,
      categories(id, name)
    `)
    .eq('store_id', store.id)
    .order('created_at', { ascending: false })

  if (searchParams.q) {
    query = query.ilike('name', `%${searchParams.q}%`)
  }
  if (searchParams.category) {
    query = query.eq('category_id', searchParams.category)
  }
  if (searchParams.status === 'active') {
    query = query.eq('is_active', true)
  } else if (searchParams.status === 'inactive') {
    query = query.eq('is_active', false)
  } else if (searchParams.status === 'low_stock') {
    query = query.lt('stock_available', 5).gt('stock_available', 0)
  } else if (searchParams.status === 'out_of_stock') {
    query = query.lte('stock_available', 0)
  }

  const { data: products } = await query

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .eq('store_id', store.id)
    .eq('is_active', true)

  type Row = typeof products extends (infer T)[] | null | undefined ? T : never
  const stats = {
    total: products?.length ?? 0,
    active: products?.filter((p: Row) => p.is_active).length ?? 0,
    low_stock: products?.filter((p: Row) => ((p.stock_available as number) ?? 0) < 5 && ((p.stock_available as number) ?? 0) > 0).length ?? 0,
    out_of_stock: products?.filter((p: Row) => ((p.stock_available as number) ?? 0) <= 0).length ?? 0,
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">المنتجات</h1>
          <p className="mt-1 text-sm text-slate-400">{stats.total} منتج في متجرك</p>
        </div>
        <Link
          href="/dashboard/products/new"
          className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-sky-400"
        >
          + منتج جديد
        </Link>
      </div>

      {/* إحصائيات سريعة */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'إجمالي', value: stats.total, color: 'text-white' },
          { label: 'نشط', value: stats.active, color: 'text-emerald-400' },
          { label: 'مخزون منخفض', value: stats.low_stock, color: 'text-amber-400' },
          { label: 'نفد المخزون', value: stats.out_of_stock, color: 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-white/5 bg-slate-900 p-4">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <ProductsTable
        products={(products ?? []) as any}
        categories={(categories ?? []) as any}
        storeId={store.id}
        currencyCode={store.currency_code}
        filters={searchParams}
      />
    </div>
  )
}
