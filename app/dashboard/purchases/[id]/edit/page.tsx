import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { requireStorePermission } from '@/lib/supabase/permissions'
import { allRows } from '@/lib/dashboard/load-simple-dashboard'
import EditPurchaseForm from '@/components/dashboard/purchases/EditPurchaseForm'

export const metadata = {
  title: 'تعديل فاتورة المشتريات — Bazarko ERP',
}

export default async function EditPurchasePage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  try {
    await requireStorePermission(storeId, 'purchases.write')
  } catch {
    redirect(`/dashboard/purchases/${params.id}`)
  }

  const [
    { data: store },
    { data: purchase },
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase.from('purchase_invoices').select('*').eq('id', params.id).eq('store_id', storeId).maybeSingle(),
  ])

  if (!store || !purchase) notFound()

  // Do not allow editing cancelled invoices
  if (purchase.status === 'cancelled') {
    redirect(`/dashboard/purchases/${params.id}`)
  }

  const [items, suppliers, products] = await Promise.all([
    allRows<{ id: string; product_id: string; product_name: string; quantity: number; unit_price: number; notes?: string | null }>((from, to) =>
      supabase
        .from('purchase_items')
        .select('id, product_id, product_name, quantity, unit_price, notes')
        .eq('purchase_invoice_id', params.id)
        .order('id')
        .range(from, to)
    ),
    allRows<{ id: string; name: string; phone: string | null; balance: number }>((from, to) =>
      supabase
        .from('suppliers')
        .select('id, name, phone, balance')
        .eq('store_id', storeId)
        .order('name')
        .range(from, to)
    ),
    allRows<{ id: string; name: string; sku: string | null; barcode: string | null; cost_price: number | null; stock_quantity: number; price: number }>((from, to) =>
      supabase
        .from('products')
        .select('id, name, sku, barcode, cost_price, stock_quantity, price')
        .eq('store_id', storeId)
        .eq('is_active', true)
        .order('name')
        .range(from, to)
    ),
  ])

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <EditPurchaseForm
        store={store}
        purchase={{
          id: purchase.id,
          invoice_number: purchase.invoice_number,
          supplier_invoice_number: purchase.supplier_invoice_number,
          supplier_id: purchase.supplier_id,
          invoice_date: purchase.invoice_date,
          due_date: purchase.due_date,
          discount: Number(purchase.discount || 0),
          notes: purchase.notes,
          status: purchase.status,
          paid_amount: Number(purchase.paid_amount || 0),
          total_amount: Number(purchase.total_amount || 0),
        }}
        initialItems={items || []}
        suppliers={suppliers || []}
        products={products || []}
      />
    </div>
  )
}
