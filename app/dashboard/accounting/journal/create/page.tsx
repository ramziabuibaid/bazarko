import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { checkStorePermission } from '@/lib/supabase/permissions'
import CreateJournalClient from './CreateJournalClient'

export const metadata = {
  title: 'إنشاء قيد يومية يدوي — Bazarko ERP',
}

export default async function CreateJournalPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const hasWrite = await checkStorePermission(storeId, 'journal.write')
  if (!hasWrite) {
    return (
      <div className="p-8 text-center" dir="rtl">
        <div className="mx-auto max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-300">
          <div className="text-3xl mb-2">🚫</div>
          <h2 className="text-lg font-bold text-white mb-2">غير مصرح</h2>
          <p className="text-xs text-slate-300 mb-4">لا تملك صلاحية إنشاء قيود يومية يدوية. هذه العملية مقتصرة على دور المحاسب والمالك.</p>
          <Link href="/dashboard/accounting/journal" className="inline-block rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 transition">
            ← العودة لقيود اليومية
          </Link>
        </div>
      </div>
    )
  }

  const [
    { data: store },
    { data: accounts }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase
      .from('accounts')
      .select('id, code, name, type')
      .eq('store_id', storeId)
      .eq('is_group', false)
      .eq('is_active', true)
      .order('code', { ascending: true })
  ])

  return (
    <CreateJournalClient
      store={store!}
      accounts={accounts || []}
    />
  )
}
