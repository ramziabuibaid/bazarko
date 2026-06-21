import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import OrderDetail from '@/components/dashboard/orders/OrderDetail'

interface Props {
  params: { id: string }
}

export default async function OrderDetailPage({ params }: Props) {
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

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', params.id)
    .eq('store_id', store.id)
    .single()

  if (!order) notFound()

  const [{ data: items }, { data: linkedInvoice }] = await Promise.all([
    supabase
      .from('order_items')
      .select('id, product_id, product_name, quantity, unit_price, total_price')
      .eq('order_id', order.id),
    supabase
      .from('invoices')
      .select('id, invoice_number')
      .eq('store_id', store.id)
      .eq('order_id', order.id)
      .maybeSingle(),
  ])

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          href="/dashboard/orders"
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white"
        >
          ← الطلبيات
        </Link>
        <h1 className="font-mono text-lg font-semibold text-white" dir="ltr">
          {order.order_number}
        </h1>
        <div className="flex-1" />
        {linkedInvoice ? (
          <Link
            href={`/dashboard/accounting/invoices/${linkedInvoice.id}`}
            className="flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-300 hover:bg-sky-500/20"
          >
            📋 <span dir="ltr">{linkedInvoice.invoice_number}</span>
          </Link>
        ) : (
          <Link
            href={`/dashboard/accounting/invoices/new?from_order=${order.id}`}
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
          >
            📋 إنشاء فاتورة
          </Link>
        )}
      </div>

      <OrderDetail
        order={order}
        items={items ?? []}
        currencyCode={store.currency_code}
      />
    </div>
  )
}
