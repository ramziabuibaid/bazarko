import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ProductsTable from '@/components/dashboard/products/ProductsTable'
import BulkImportExport from '@/components/dashboard/products/BulkImportExport'
import { allRows } from '@/lib/dashboard/load-simple-dashboard'
import { type DirectoryProduct } from '@/lib/products/directory'

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: {
    brand_id?: string
    q?: string
    category?: string
    status?: string
    stock?: string
    sort?: string
    page?: string
    size?: string
  }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, currency_code')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  let products: DirectoryProduct[] = []
  let error = false
  try {
    products = await allRows<DirectoryProduct>((from, to) =>
      supabase
        .from('products')
        .select('id, name, slug, price, compare_price, cost_price, stock_quantity, stock_available, track_stock, low_stock_alert, status, is_active, is_featured, thumbnail_url, images, sku, barcode, shamel_code, brand_id, category_id, specifications, created_at, categories(id, name), brands(id, name)')
        .eq('store_id', storeId)
        .order('id')
        .range(from, to)
    )
  } catch {
    error = true
  }

  const [{ data: categories, error: categoryError }, { data: salesData, error: salesError }] = await Promise.all([
    supabase.from('categories').select('id, name').eq('store_id', storeId).eq('is_active', true),
    supabase.rpc('get_product_sales', { p_store_id: storeId }),
  ])

  const sales: Record<string, number> = {}
  for (const r of salesData || []) {
    sales[r.product_id] = Number(r.sold_count)
  }

  return (
    <main className="p-4 sm:p-6" dir="rtl">
      <Link href="/dashboard/inventory-hub" className="text-sm text-slate-400 hover:text-white transition">
        ← العودة لإدارة المخزون
      </Link>
      <header className="flex flex-wrap justify-between items-center gap-4 my-6">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <span>📦</span>
            <span>دليل وقائمة المنتجات</span>
          </h1>
          <p className="text-slate-400 mt-2">
            إدارة كافة أصناف المتجر، أرقام الشامل المعتمدة (SKU)، الأسعار، التكاليف والمخزون
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <BulkImportExport />
          <Link
            href="/dashboard/products/new"
            className="rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 px-5 py-3 font-bold transition"
          >
            ＋ إضافة منتج
          </Link>
        </div>
      </header>
      <p className="text-xs text-slate-400 mb-4">
        الاستيراد والتصدير في الأعلى يشملان كتالوج المتجر بالكامل؛ الفلاتر لا تقيدهما.
      </p>
      <ProductsTable
        products={products}
        categories={categories || []}
        storeId={storeId}
        currencyCode={store.currency_code || 'ILS'}
        filters={searchParams}
        sales={sales}
        loadError={error}
        categoryError={!!categoryError}
        salesError={!!salesError}
      />
    </main>
  )
}
