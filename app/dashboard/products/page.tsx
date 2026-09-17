import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ProductsTable from '@/components/dashboard/products/ProductsTable'
import BulkImportExport from '@/components/dashboard/products/BulkImportExport'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { q?: string; category?: string; status?: string; sort?: string }
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
      stock_quantity, stock_available, status, is_active, is_featured,
      thumbnail_url, sku, created_at,
      categories(id, name)
    `)
    .eq('store_id', store.id)

  if (searchParams.q) {
    query = query.ilike('name', `%${searchParams.q}%`)
  }
  if (searchParams.category) {
    query = query.eq('category_id', searchParams.category)
  }
  // ترتيب
  const sortParam = searchParams.sort ?? 'newest'
  if (sortParam === 'oldest')     query = query.order('created_at', { ascending: true })
  else if (sortParam === 'price_high') query = query.order('price', { ascending: false })
  else if (sortParam === 'price_low')  query = query.order('price', { ascending: true })
  else                                 query = query.order('created_at', { ascending: false })

  const statusParam = searchParams.status
  if (statusParam === 'active' || statusParam === 'draft' || statusParam === 'hidden' || statusParam === 'archived') {
    query = query.eq('status', statusParam)
  } else if (statusParam === 'low_stock') {
    query = query.lt('stock_available', 5).gt('stock_available', 0)
  } else if (statusParam === 'out_of_stock') {
    query = query.lte('stock_available', 0)
  }

  let { data: products } = await query

  // ترتيب الأكثر مبيعاً: نجلب إحصاء المبيعات ونرتّب JS-side
  if (sortParam === 'best_selling' && products) {
    const { data: salesData } = await supabase.rpc('get_product_sales', { p_store_id: store.id })
    const salesMap = new Map((salesData ?? []).map((r: { product_id: string; sold_count: number }) => [r.product_id, r.sold_count]))
    products = [...products].sort((a, b) => ((salesMap.get(b.id) ?? 0) as number) - ((salesMap.get(a.id) ?? 0) as number))
  }

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .eq('store_id', store.id)
    .eq('is_active', true)

  type Row = typeof products extends (infer T)[] | null | undefined ? T : never
  const stats = {
    total:       products?.length ?? 0,
    active:      products?.filter((p: Row) => (p.status as string) === 'active').length ?? 0,
    draft:       products?.filter((p: Row) => (p.status as string) === 'draft').length ?? 0,
    hidden:      products?.filter((p: Row) => (p.status as string) === 'hidden').length ?? 0,
    archived:    products?.filter((p: Row) => (p.status as string) === 'archived').length ?? 0,
    low_stock:   products?.filter((p: Row) => ((p.stock_available as number) ?? 0) < 5 && ((p.stock_available as number) ?? 0) > 0).length ?? 0,
    out_of_stock: products?.filter((p: Row) => ((p.stock_available as number) ?? 0) <= 0).length ?? 0,
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <BackToDashboardButton href="/dashboard/inventory-hub" label="العودة إلى لوحة إدارة المخزون والمستودعات" />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">المنتجات</h1>
          <p className="mt-1 text-sm text-slate-400">{stats.total} منتج في متجرك</p>
        </div>
        <div className="flex items-center gap-2">
          <BulkImportExport />
          <Link
            href="/dashboard/products/new"
            className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-sky-400"
          >
            + منتج جديد
          </Link>
        </div>
      </div>

      {/* إحصائيات سريعة */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'الكل',    value: stats.total,    color: 'text-white'         },
          { label: '✅ فعال',  value: stats.active,   color: 'text-emerald-400'   },
          { label: '✏️ مسودة', value: stats.draft,    color: 'text-sky-400'       },
          { label: '🙈 مخفي',  value: stats.hidden,   color: 'text-amber-400'     },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-white/5 bg-slate-900 p-4">
            <p className="text-xs text-slate-400">{s.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <ProductsTable
        products={(products ?? []) as any}
        categories={(categories ?? []) as any}
        storeId={store.id}
        currencyCode={store.currency_code}
        filters={{ ...searchParams, sort: sortParam }}
      />
    </div>
  )
}
