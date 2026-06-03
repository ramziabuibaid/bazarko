import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import NewInvoiceForm from '@/components/dashboard/accounting/NewInvoiceForm'

interface SearchParams { from_order?: string }

export default async function NewInvoicePage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code, name')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  // إذا جاء المستخدم من صفحة طلبية — جلب بياناتها لملء الفاتورة تلقائياً
  let prefill: {
    orderId: string; orderNumber: string
    customerId: string | null; customerName: string; customerPhone: string
    items: { product_id: string | null; name: string; sku: string; quantity: number; unit_price: number }[]
  } | undefined

  if (searchParams.from_order) {
    const { data: order } = await supabase
      .from('orders')
      .select('id, order_number, customer_id, customer_name, customer_phone')
      .eq('id', searchParams.from_order)
      .eq('store_id', store.id)
      .single()

    if (order) {
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('product_id, product_name, quantity, unit_price')
        .eq('order_id', order.id)

      prefill = {
        orderId:       order.id,
        orderNumber:   order.order_number,
        customerId:    order.customer_id ?? null,
        customerName:  order.customer_name ?? '',
        customerPhone: order.customer_phone ?? '',
        items: (orderItems ?? []).map((i: { product_id?: string | null; product_name: string; quantity: number; unit_price: number }) => ({
          product_id: i.product_id ?? null,
          name:       i.product_name,
          sku:        '',
          quantity:   i.quantity,
          unit_price: i.unit_price,
        })),
      }
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href={prefill ? `/dashboard/orders/${prefill.orderId}` : '/dashboard/accounting/invoices'}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white"
        >
          ← {prefill ? 'الطلبية' : 'الفواتير'}
        </Link>
        <h1 className="text-xl font-semibold text-white">فاتورة جديدة</h1>
      </div>

      <NewInvoiceForm
        storeId={store.id}
        userId={user.id}
        currencyCode={store.currency_code}
        storeName={store.name}
        prefill={prefill}
      />
    </div>
  )
}
