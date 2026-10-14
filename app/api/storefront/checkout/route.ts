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
  requestId?: string
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
      requestId,
    } = body

    if (!storeId || !items || !items.length) {
      return NextResponse.json({ error: 'بيانات الطلبية غير مكتملة' }, { status: 400 })
    }

    // التحقق الصارم من بيانات العميل
    if (!form || !form.name?.trim()) {
      return NextResponse.json({ error: 'يرجى إدخال اسم المستلم' }, { status: 400 })
    }
    const cleanPhone = (form.phone || '').replace(/[\s-]/g, '')
    if (!cleanPhone || cleanPhone.length < 7) {
      return NextResponse.json({ error: 'يرجى إدخال رقم هاتف صحيح للتواصل' }, { status: 400 })
    }

    const allowedPaymentMethods = ['cash_on_delivery', 'cash', 'card', 'bank_transfer', 'online']
    const paymentMethod = form.payment_method || 'cash_on_delivery'
    if (!allowedPaymentMethods.includes(paymentMethod)) {
      return NextResponse.json({ error: 'طريقة الدفع غير صالحة' }, { status: 400 })
    }

    // فحص منع التكرار (Idempotency)
    if (requestId) {
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id')
        .eq('store_id', storeId)
        .eq('internal_notes', `request_id:${requestId}`)
        .maybeSingle()

      if (existingOrder) {
        return NextResponse.json({ orderId: existingOrder.id })
      }
    }

    // 1. التحقق من وجود المتجر وحالته وحد التوصيل المجاني
    const { data: storeData } = await supabase
      .from('stores')
      .select('id, status, free_delivery_threshold')
      .eq('id', storeId)
      .single()

    if (!storeData || storeData.status !== 'active') {
      return NextResponse.json({ error: 'المتجر غير متاح حالياً' }, { status: 404 })
    }

    // 2. التحقق من صحة الكميات والمدخلات
    for (const item of items) {
      if (!item.productId || typeof item.quantity !== 'number' || item.quantity <= 0 || !Number.isInteger(item.quantity) || item.quantity > 9999) {
        return NextResponse.json({ error: 'كميات الأصناف غير صالحة' }, { status: 400 })
      }
    }

    // 3. التحقق الصارم من وجود الأصناف وأسعارها من قاعدة البيانات حصراً
    const productIds = items.map(i => i.productId)
    const nowIso = new Date().toISOString()
    const [{ data: dbProducts }, { data: dbOfferItems }] = await Promise.all([
      supabase.from('products').select('id, name, price, is_active').in('id', productIds).eq('store_id', storeId),
      supabase
        .from('offer_items')
        .select('product_id, offer_price, max_quantity, sold_quantity, offers!inner(store_id, is_active, starts_at, ends_at)')
        .in('product_id', productIds)
        .eq('offers.store_id', storeId)
        .eq('offers.is_active', true)
        .lte('offers.starts_at', nowIso)
        .gte('offers.ends_at', nowIso),
    ])

    const dbProductMap = new Map(((dbProducts ?? []) as { id: string; name: string; price: number; is_active?: boolean }[]).map(p => [p.id, p]))

    // رفض أي صنف غير موجود في هذا المتجر أو غير متاح
    for (const item of items) {
      const dbProd = dbProductMap.get(item.productId)
      if (!dbProd || dbProd.is_active === false) {
        return NextResponse.json({ error: `الصنف غير متاح للطلب في هذا المتجر: ${item.name || item.productId}` }, { status: 400 })
      }
    }

    const offerPriceMap = new Map<string, number>()
    for (const oi of (dbOfferItems ?? []) as { product_id: string; offer_price: number; max_quantity: number | null; sold_quantity: number }[]) {
      const itemRequested = items.find(i => i.productId === oi.product_id)
      const requestedQty = itemRequested ? itemRequested.quantity : 0
      if (oi.max_quantity != null) {
        const remainingQuota = oi.max_quantity - (oi.sold_quantity || 0)
        if (remainingQuota < requestedQty) continue // الكمية المطلوبة تتجاوز حصة العرض المتبقية
      }
      const existing = offerPriceMap.get(oi.product_id)
      if (existing === undefined || oi.offer_price < existing)
        offerPriceMap.set(oi.product_id, Number(oi.offer_price))
    }

    // تسعير الأصناف من السيرفر حصراً دون أي اعتماد على سعر العميل
    const pricedItems = items.map(item => {
      const dbProd = dbProductMap.get(item.productId)!
      const offerPrice = offerPriceMap.get(item.productId)
      const finalPrice = offerPrice !== undefined ? offerPrice : Number(dbProd.price)
      return {
        ...item,
        name: dbProd.name || item.name,
        finalPrice,
        isOfferPrice: offerPrice !== undefined,
      }
    })

    const calcSubtotal = pricedItems.reduce((sum, i) => sum + i.finalPrice * i.quantity, 0)

    // 4. حساب تكلفة الشحن من إعدادات المتجر في السيرفر
    let calculatedShippingCost = 0
    let verifiedZoneName = selectedZoneName || null
    let verifiedMethodName = selectedMethodName || null

    if (selectedZoneId) {
      const { data: zone } = await supabase
        .from('delivery_zones')
        .select('id, name, cost, is_active')
        .eq('id', selectedZoneId)
        .eq('store_id', storeId)
        .single()

      if (!zone || !zone.is_active) {
        return NextResponse.json({ error: 'منطقة التوصيل المحددة غير صالحة أو غير مفعلة' }, { status: 400 })
      }

      verifiedZoneName = zone.name
      calculatedShippingCost = Number(zone.cost || 0)

      if (selectedMethodId) {
        const { data: method } = await supabase
          .from('shipping_methods')
          .select('id, name, cost, is_active')
          .eq('id', selectedMethodId)
          .eq('zone_id', selectedZoneId)
          .eq('store_id', storeId)
          .single()

        if (!method || !method.is_active) {
          return NextResponse.json({ error: 'طريقة الشحن المحددة غير صالحة أو غير مفعلة' }, { status: 400 })
        }

        verifiedMethodName = method.name
        calculatedShippingCost = Number(method.cost || 0)
      }
    }

    const freeThreshold = Number(storeData.free_delivery_threshold || 0)
    if (freeThreshold > 0 && calcSubtotal >= freeThreshold) {
      calculatedShippingCost = 0
    }

    const finalTotal = calcSubtotal + calculatedShippingCost

    const { data: orderNum } = await supabase.rpc('generate_sequence_number', {
      p_store_id: storeId,
      p_prefix: `ORD-${new Date().getFullYear()}-`,
    })

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        store_id: storeId,
        order_number: orderNum ?? `ORD-${Date.now()}`,
        status: 'pending',
        payment_method: paymentMethod,
        subtotal: calcSubtotal,
        total_amount: finalTotal,
        shipping_cost: calculatedShippingCost,
        shipping_amount: calculatedShippingCost,
        shipping_zone_id: selectedZoneId || null,
        shipping_method_id: selectedMethodId || null,
        shipping_zone_name: verifiedZoneName,
        shipping_method_name: verifiedMethodName,
        customer_name: form.name.trim(),
        customer_phone: cleanPhone,
        shipping_address: form.address?.trim() || null,
        shipping_city: form.city?.trim() || verifiedZoneName || null,
        customer_notes: form.notes?.trim() || null,
        internal_notes: requestId ? `request_id:${requestId}` : null,
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
    
    const { error: itemsErr } = await supabase.from('order_items').insert(orderItems)
    if (itemsErr) {
      console.error('Order items insertion error:', itemsErr)
      await supabase.from('orders').delete().eq('id', order.id)
      return NextResponse.json({ error: 'حدث خطأ أثناء حفظ أصناف الطلبية' }, { status: 500 })
    }

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
