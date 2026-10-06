import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {getInvoiceCashBoxes} from './create-invoice-action'
import NewInvoiceForm from '@/components/dashboard/accounting/NewInvoiceForm'

interface SearchParams {
  from_order?: string
  from_quotation?: string
}

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

  let prefill: {
    orderId?: string; orderNumber?: string
    quotationId?: string; quotationNumber?: string
    customerId: string | null; customerName: string; customerPhone: string
    discountAmount?: number; notes?: string
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
        items: (orderItems ?? []).map((i: any) => ({
          product_id: i.product_id ?? null,
          name:       i.product_name,
          sku:        '',
          quantity:   i.quantity,
          unit_price: i.unit_price,
        })),
      }
    }
  } else if (searchParams.from_quotation) {
    const { data: quote } = await supabase
      .from('quotations')
      .select('id, quotation_number, customer_id, discount, notes, customer:customers(id, name, phone), items:quotation_items(*)')
      .eq('id', searchParams.from_quotation)
      .eq('store_id', store.id)
      .single()

    if (quote) {
      let meta: any = {}
      try {
        const match = (quote.notes || '').match(/\[\[META:([\s\S]*?)\]\]/)
        if (match && match[1]) meta = JSON.parse(match[1])
      } catch {}

      const cleanNotes = quote.notes
        ? quote.notes.replace(/\n?\[\[META:[\s\S]*?\]\]/g, '').trim()
        : ''

      // Fetch cost_price and sku for catalog products if any
      const productIds = (quote.items || [])
        .map((i: any) => i.product_id)
        .filter(Boolean)

      let productMap = new Map<string, { cost_price: number; sku: string }>()
      if (productIds.length > 0) {
        const { data: prods } = await supabase
          .from('products')
          .select('id, cost_price, sku')
          .in('id', productIds)
        if (prods) {
          prods.forEach(p => productMap.set(p.id, { cost_price: Number(p.cost_price || 0), sku: p.sku || '' }))
        }
      }

      prefill = {
        quotationId:     quote.id,
        quotationNumber: quote.quotation_number,
        customerId:      quote.customer_id || null,
        customerName:    (quote.customer as any)?.name || '',
        customerPhone:   (quote.customer as any)?.phone || '',
        discountAmount:  Number(quote.discount || 0),
        notes:           cleanNotes || `فاتورة صادرة بناءً على عرض السعر رقم #${quote.quotation_number}`,
        items: (quote.items || []).map((i: any) => {
          const prodInfo = i.product_id ? productMap.get(i.product_id) : null
          return {
            product_id: i.product_id || null,
            name:       i.product_name,
            sku:        prodInfo?.sku || '',
            quantity:   Number(i.quantity || 1),
            unit_price: Number(i.unit_price || 0),
            cost_price: prodInfo?.cost_price || 0,
          }
        }),
      }
    }
  }

  const cashBoxes=await getInvoiceCashBoxes()
  return (
    <div className="p-4 sm:p-6 max-w-[1600px]" dir="rtl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/accounting/invoices"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800/80 px-3.5 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition shadow-sm"
          >
            <span className="text-sky-400">←</span>
            <span>العودة إلى الفواتير</span>
          </Link>
          <h1 className="text-xl font-black text-white">فاتورة مبيعات جديدة</h1>
        </div>

        {prefill?.quotationNumber && (
          <span className="rounded-full bg-purple-500/20 border border-purple-500/30 px-3 py-1 text-xs font-bold text-purple-300">
            📑 تحويل من عرض سعر #{prefill.quotationNumber}
          </span>
        )}
      </div>

      <NewInvoiceForm
        storeId={store.id}
        userId={user.id}
        currencyCode={store.currency_code}
        storeName={store.name}
        prefill={prefill}
        cashBoxes={cashBoxes}
      />
    </div>
  )
}
