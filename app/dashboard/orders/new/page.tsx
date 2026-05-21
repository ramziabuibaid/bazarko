import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import NewOrderForm from '@/components/dashboard/orders/NewOrderForm'

export default async function NewOrderPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code')
    .eq('owner_id', user.id)
    .single()

  if (!store) redirect('/onboarding')

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/dashboard/orders"
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white"
        >
          ← الطلبيات
        </Link>
        <h1 className="text-xl font-semibold text-white">طلبية جديدة</h1>
      </div>

      <NewOrderForm storeId={store.id} currencyCode={store.currency_code} />
    </div>
  )
}
