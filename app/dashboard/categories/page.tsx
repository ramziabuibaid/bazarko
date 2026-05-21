import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CategoryManager from '@/components/dashboard/categories/CategoryManager'

export default async function CategoriesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: store } = await supabase
    .from('stores')
    .select('id')
    .eq('owner_id', user.id)
    .single()

  if (!store) redirect('/onboarding')

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, slug, parent_id, is_active, sort_order')
    .eq('store_id', store.id)
    .order('sort_order')

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">الفئات</h1>
          <p className="mt-1 text-sm text-slate-400">
            نظّم منتجاتك في فئات ليسهل على الزبائن التصفح
          </p>
        </div>
      </div>
      <CategoryManager storeId={store.id} initialCategories={categories ?? []} />
    </div>
  )
}
