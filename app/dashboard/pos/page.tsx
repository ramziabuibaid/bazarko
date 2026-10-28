import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { checkStorePermission } from '@/lib/supabase/permissions'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import NewOrderForm from '@/components/dashboard/orders/NewOrderForm'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'

export const metadata = {
  title: 'نقطة البيع السريعة (POS) — Bazarko ERP',
}

export default async function PosPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const [
    canApproveBelowCost,
    { data: store },
    { data: profile },
  ] = await Promise.all([
    checkStorePermission(storeId, 'sales.below_cost'),
    supabase
      .from('stores')
      .select('id, name, phone, address, currency_code, tax_number, pos_receipt_footer')
      .eq('id', storeId)
      .single(),
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
  ])

  if (!store) redirect('/onboarding')

  return (
    <div className="p-4 sm:p-6" dir="rtl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <BackToDashboardButton href="/dashboard/sales" label="العودة إلى لوحة إدارة المبيعات" />
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>⚡</span> نقطة البيع السريعة (POS)
          </h1>
        </div>

        <Link
          href="/dashboard/accounting/invoices"
          className="rounded-xl border border-white/10 bg-slate-800/80 px-3.5 py-1.5 text-xs font-bold text-slate-300 hover:text-white transition"
        >
          🧾 فواتير المبيعات
        </Link>
      </div>

      <NewOrderForm
        posPresentation
        storeId={store.id}
        currencyCode={store.currency_code}
        canApproveBelowCost={canApproveBelowCost}
        userName={profile?.full_name || user.email?.split('@')[0] || ''}
        storeInfo={{
          name: store.name,
          phone: store.phone,
          address: store.address,
          taxNumber: store.tax_number,
          receiptFooter: store.pos_receipt_footer,
        }}
      />
    </div>
  )
}
