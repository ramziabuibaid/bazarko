import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ReviewsModeration from '@/components/dashboard/reviews/ReviewsModeration'

interface Props {
  searchParams: { status?: string }
}

export default async function ReviewsPage({ searchParams }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const status = searchParams.status ?? 'pending'

  let query = supabase
    .from('product_reviews')
    .select('id, product_id, customer_name, rating, comment, photos, status, created_at, products(name, slug, thumbnail_url)')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
  if (status !== 'all') query = query.eq('status', status)

  const [{ data: reviews }, { data: allRows }] = await Promise.all([
    query,
    supabase.from('product_reviews').select('status').eq('store_id', storeId),
  ])

  const counts = { pending: 0, approved: 0, rejected: 0, all: (allRows ?? []).length }
  for (const r of (allRows ?? []) as { status: string }[]) {
    if (r.status in counts) counts[r.status as 'pending' | 'approved' | 'rejected']++
  }

  const tabs = [
    { key: 'pending',  label: 'بانتظار المراجعة', count: counts.pending },
    { key: 'approved', label: 'معتمدة',           count: counts.approved },
    { key: 'rejected', label: 'مخفية',            count: counts.rejected },
    { key: 'all',      label: 'الكل',             count: counts.all },
  ]

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">تقييمات العملاء</h1>
        <p className="mt-1 text-sm text-slate-400">راجع تقييمات منتجاتك واعتمد ما يظهر للزبائن</p>
      </div>

      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-white/5 bg-white/3 p-1">
        {tabs.map(t => (
          <Link
            key={t.key}
            href={`/dashboard/reviews?status=${t.key}`}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              status === t.key ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t.label} {t.count > 0 && <span className="text-xs opacity-70">({t.count})</span>}
          </Link>
        ))}
      </div>

      <ReviewsModeration reviews={(reviews ?? []) as never} />
    </div>
  )
}
