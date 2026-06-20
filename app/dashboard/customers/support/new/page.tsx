import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import SupportTicketForm from '@/components/dashboard/customers/SupportTicketForm'

export default async function NewSupportTicketPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: customers } = await supabase
    .from('customers')
    .select('id, name, phone')
    .eq('store_id', storeId)
    .order('name')

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/customers/support" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          ← الدعم
        </Link>
        <h1 className="text-xl font-semibold text-white">🎫 تذكرة دعم جديدة</h1>
      </div>

      <SupportTicketForm storeId={storeId} userId={user!.id} customers={customers ?? []} />
    </div>
  )
}
