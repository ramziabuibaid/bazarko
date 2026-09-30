import { createAdminClient } from '@/lib/supabase/admin'
import { sendOrderEmail } from './order-email'

/** Delivery happens only after the financial transaction commits. */
export async function sendPendingOrderEmail(orderId: string): Promise<void> {
  const db = createAdminClient()
  const { data: claim, error: claimError } = await db.rpc('claim_order_email', { p_order: orderId })
  if (claimError || !claim) return
  const { data: order, error: orderError } = await db.from('orders')
    .select('id,store_id,order_number,customer_name,payment_method,subtotal,total_amount,items:order_items(product_name,quantity,unit_price,total_price)')
    .eq('id', orderId).eq('store_id', claim.storeId).single()
  const { data: store, error: storeError } = await db.from('stores')
    .select('name,currency_code').eq('id', claim.storeId).single()
  if (orderError || storeError || !order || !store) return
  const sent = await sendOrderEmail({
    to: claim.recipient,
    customerName: order.customer_name || 'عزيزي الزبون',
    storeName: store.name,
    orderNumber: order.order_number,
    currencyCode: store.currency_code,
    subtotal: Number(order.subtotal),
    totalAmount: Number(order.total_amount),
    paymentMethod: order.payment_method || 'cash',
    items: (order.items || []).map((i: any) => ({
      product_name: i.product_name,
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      total_price: Number(i.total_price),
    })),
    idempotencyKey: `order:${orderId}`,
  })
  if (sent) await db.from('order_email_outbox').update({ sent_at: new Date().toISOString(), lease_until: null }).eq('order_id', orderId)
}
