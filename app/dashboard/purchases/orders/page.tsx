import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'
import PurchaseOrdersClient from './PurchaseOrdersClient'

export const metadata = {
  title: 'أوامر الشراء (Purchase Orders) — Bazarko ERP',
}

export default async function PurchaseOrdersPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: orders }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase
      .from('purchase_orders')
      .select('*, supplier:suppliers(id, name, phone), items:purchase_order_items(*)')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
  ])

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <BackToDashboardButton href="/dashboard/purchases" label="العودة إلى فواتير المشتريات" />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <span>📋</span> أوامر الشراء (Purchase Orders)
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            إنشاء وإرسال أوامر الشراء للموردين مع إمكانية تحويلها مباشرة إلى فواتير مشتريات بضغطة زر
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/purchases"
            className="rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
          >
            📦 فواتير المشتريات
          </Link>
          <Link
            href="/dashboard/purchases/orders/new"
            className="rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-4 py-2 text-xs font-black text-slate-950 hover:from-sky-400 hover:to-blue-500 transition shadow-lg shadow-sky-500/10"
          >
            ➕ أمر شراء جديد
          </Link>
        </div>
      </div>

      <PurchaseOrdersClient
        store={store!}
        initialOrders={orders || []}
      />
    </div>
  )
}
