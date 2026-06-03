import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import RepairIntakeForm from '@/components/dashboard/maintenance/RepairIntakeForm'

export default async function NewRepairPage() {
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

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/dashboard/maintenance"
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          ← لوحة الصيانة
        </Link>
        <h1 className="text-xl font-semibold text-white">استلام جهاز جديد</h1>
      </div>

      <RepairIntakeForm
        storeId={store.id}
        userId={user.id}
        currencyCode={store.currency_code}
      />
    </div>
  )
}
