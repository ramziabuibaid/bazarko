import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendOrderEmail } from '@/lib/email/order-email'

interface LineItem {
  productId: string
  name: string
  unitPrice: number
  quantity: number
}

interface CreateOrderBody {
  mode: 'pos' | 'account'
  items: LineItem[]
  customerId?: string
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  address?: string
  city?: string
  paymentMethod: 'cash' | 'bank_transfer' | 'check' | 'online' | 'credit'
  amountPaid: number
  notes?: string
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, currency_code, country_code, subdomain')
    .eq('owner_id', user.id)
    .single()

  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

  const body: CreateOrderBody = await req.json()
  const { mode, items, customerId, customerName, customerPhone, customerEmail,
    address, city, paymentMethod, amountPaid, notes } = body

  if (!items?.length) {
    return NextResponse.json({ error: 'لا توجد منتجات في الطلبية' }, { status: 400 })
  }

  // حساب المجاميع
  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)
  const totalAmount = subtotal
  const effectiveAmountPaid = mode === 'pos' ? totalAmount : amountPaid
  const paymentStatus = effectiveAmountPaid >= totalAmount ? 'paid'
    : effectiveAmountPaid > 0 ? 'partial'
    : 'unpaid'

  // رقم الطلبية
  const { data: orderNum } = await supabase.rpc('generate_sequence_number', {
    p_store_id: store.id,
    p_prefix: `ORD-${new Date().getFullYear()}-`,
  })

  // بيانات الزبون (من سجل الزبون إذا account mode)
  let resolvedName = customerName ?? ''
  let resolvedPhone = customerPhone ?? ''
  let resolvedEmail = customerEmail ?? ''

  if (mode === 'account' && customerId) {
    const { data: customer } = await supabase
      .from('customers')
      .select('name, phone, email')
      .eq('id', customerId)
      .single()

    if (customer) {
      resolvedName = customer.name
      resolvedPhone = customer.phone ?? ''
      resolvedEmail = customerEmail || customer.email || ''
    }
  }

  // إنشاء الطلبية
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      store_id: store.id,
      order_number: orderNum ?? `ORD-${Date.now()}`,
      status: mode === 'pos' ? 'delivered' : 'pending',
      source: 'dashboard',
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      subtotal,
      total_amount: totalAmount,
      amount_paid: effectiveAmountPaid,
      customer_id: customerId ?? null,
      customer_name: resolvedName || null,
      customer_phone: resolvedPhone || null,
      customer_email: resolvedEmail || null,
      shipping_address: address ?? null,
      shipping_city: city ?? null,
      internal_notes: notes ?? null,
    })
    .select('id, order_number')
    .single()

  if (orderErr || !order) {
    return NextResponse.json({ error: 'فشل إنشاء الطلبية' }, { status: 500 })
  }

  // عناصر الطلبية
  await supabase.from('order_items').insert(
    items.map(item => ({
      order_id: order.id,
      product_id: item.productId,
      product_name: item.name,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total_price: item.unitPrice * item.quantity,
    }))
  )

  // إضافة للذمة إذا account mode وتوجد ذمة متبقية
  const amountRemaining = totalAmount - effectiveAmountPaid
  if (mode === 'account' && customerId && amountRemaining > 0) {
    // جلب الرصيد الحالي للزبون
    const { data: customer } = await supabase
      .from('customers')
      .select('balance')
      .eq('id', customerId)
      .single()

    const currentBalance = customer?.balance ?? 0
    const newBalance = currentBalance + amountRemaining

    await Promise.all([
      // إدخال في كشف الحساب
      supabase.from('customer_ledger').insert({
        store_id: store.id,
        customer_id: customerId,
        type: 'invoice',
        date: new Date().toISOString().split('T')[0],
        description: `طلبية #${order.order_number}`,
        debit: amountRemaining,
        credit: 0,
        balance: newBalance,
        reference_id: order.id,
        reference_type: 'order',
      }),
      // تحديث رصيد الزبون
      supabase.from('customers')
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq('id', customerId),
    ])
  }

  // إرسال الإيميل
  if (resolvedEmail) {
    const domain = process.env.NEXT_PUBLIC_DOMAIN ?? 'bazarko.app'
    const trackingUrl = `https://${store.subdomain}.${store.country_code.toLowerCase()}.${domain}/order/${order.id}`

    await sendOrderEmail({
      to: resolvedEmail,
      customerName: resolvedName || 'عزيزي الزبون',
      storeName: store.name,
      orderNumber: order.order_number,
      currencyCode: store.currency_code,
      subtotal,
      totalAmount,
      paymentMethod,
      trackingUrl,
      items: items.map(i => ({
        product_name: i.name,
        quantity: i.quantity,
        unit_price: i.unitPrice,
        total_price: i.unitPrice * i.quantity,
      })),
    })
  }

  return NextResponse.json({ orderId: order.id, orderNumber: order.order_number })
}
