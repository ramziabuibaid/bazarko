import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface CheckoutBody {
  storeId: string
  items: {
    productId: string
    name: string
    price: number
    quantity: number
  }[]
  form: {
    name: string
    phone: string
    city: string
    address: string
    notes: string
    payment_method: string
  }
  selectedZoneId?: string
  selectedMethodId?: string
  selectedZoneName?: string
  selectedMethodName?: string
  shippingCost: number
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body: CheckoutBody = await req.json()
    const {
      storeId,
      items,
      form,
      selectedZoneId,
      selectedMethodId,
      selectedZoneName,
      selectedMethodName,
      shippingCost,
    } = body

    if (!storeId || !items.length) {
      return NextResponse.json({ error: 'بيانات الطلبية غير مكتملة' }, { status: 400 })
    }

    // تثبيت الأسعار من DB (زيادة في الأمان)
    const productIds = items.map(i => i.productId)
    const nowIso = new Date().toISOString()
    const [{ data: dbProducts }, { data: dbOfferItems }] = await Promise.all([
      supabase.from('products').select('id, price').in('id', productIds).eq('store_id', storeId),
      supabase
        .from('offer_items')
        .select('product_id, offer_price, max_quantity, sold_quantity, offers!inner(store_id, is_active, starts_at, ends_at)')
        .in('product_id', productIds)
        .eq('offers.store_id', storeId)
        .eq('offers.is_active', true)
        .lte('offers.starts_at', nowIso)
        .gte('offers.ends_at', nowIso),
    ])

    const priceMap = new Map<string, number>(
      ((dbProducts ?? []) as { id: string; price: number }[]).map(p => [p.id, p.price])
    )
    const offerPriceMap = new Map<string, number>()
    for (const oi of (dbOfferItems ?? []) as { product_id: string; offer_price: number; max_quantity: number | null; sold_quantity: number }[]) {
      if (oi.max_quantity != null && oi.sold_quantity >= oi.max_quantity) continue
      const existing = offerPriceMap.get(oi.product_id)
      if (existing === undefined || oi.offer_price < existing)
        offerPriceMap.set(oi.product_id, oi.offer_price)
    }

    const pricedItems = items.map(item => ({
      ...item,
      finalPrice: offerPriceMap.get(item.productId) ?? priceMap.get(item.productId) ?? item.price,
      isOfferPrice: offerPriceMap.has(item.productId),
    }))

    const { data: orderNum } = await supabase.rpc('generate_sequence_number', {
      p_store_id: storeId,
      p_prefix: `ORD-${new Date().getFullYear()}-`,
    })

    const calcSubtotal = pricedItems.reduce((sum, i) => sum + i.finalPrice * i.quantity, 0)
    const finalTotal = calcSubtotal + (shippingCost || 0)

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        store_id: storeId,
        order_number: orderNum ?? `ORD-${Date.now()}`,
        status: 'pending',
        payment_method: form.payment_method,
        subtotal: calcSubtotal,
        total_amount: finalTotal,
        shipping_cost: shippingCost || 0,
        shipping_zone_id: selectedZoneId || null,
        shipping_method_id: selectedMethodId || null,
        shipping_zone_name: selectedZoneName || null,
        shipping_method_name: selectedMethodName || null,
        customer_name: form.name,
        customer_phone: form.phone,
        shipping_address: form.address,
        shipping_city: form.city || selectedZoneName || null,
        customer_notes: form.notes,
        source: 'store',
      })
      .select('id')
      .single()

    if (orderErr || !order) {
      console.error('Order creation error:', orderErr)
      return NextResponse.json({ error: 'حدث خطأ أثناء إنشاء الطلبية' }, { status: 500 })
    }

    const orderItems = pricedItems.map(item => ({
      order_id: order.id,
      product_id: item.productId,
      product_name: item.name,
      quantity: item.quantity,
      unit_price: item.finalPrice,
      total_price: item.finalPrice * item.quantity,
    }))
    
    await supabase.from('order_items').insert(orderItems)

    await Promise.all(
      pricedItems
        .filter(i => i.isOfferPrice)
        .map(i => supabase.rpc('record_offer_sale', {
          p_store_id: storeId,
          p_product_id: i.productId,
          p_qty: i.quantity,
        }))
    )

    return NextResponse.json({ orderId: order.id })
  } catch (error) {
    console.error('Checkout error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
