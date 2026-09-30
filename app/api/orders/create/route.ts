import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendOrderEmail } from '@/lib/email/order-email'
import { postPosSaleJournalEntries } from '@/lib/accounting/engine'

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

  const todayStr = new Date().toISOString().split('T')[0]

  // جلب بيانات المنتجات لحساب التكلفة وتحديث المخزون
  const productIds = items.map(i => i.productId).filter(Boolean)
  const { data: dbProducts } = await supabase
    .from('products')
    .select('id, name, sku, price, cost_price, stock_quantity, track_stock')
    .in('id', productIds)
    .eq('store_id', store.id)

  const productMap = new Map<string, any>()
  for (const p of dbProducts || []) {
    productMap.set(p.id, p)
  }

  // حساب المجاميع والتكلفة الإجمالية
  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)
  const totalAmount = subtotal
  const effectiveAmountPaid = paymentMethod === 'credit'
    ? Math.min(amountPaid || 0, totalAmount)
    : (mode === 'pos' ? totalAmount : (amountPaid ?? totalAmount))
  const paymentStatus = effectiveAmountPaid >= totalAmount ? 'paid'
    : effectiveAmountPaid > 0 ? 'partial'
    : 'unpaid'

  let totalCost = 0
  for (const item of items) {
    const p = productMap.get(item.productId)
    const cost = Number(p?.cost_price || 0)
    if (cost > 0) {
      totalCost += cost * Number(item.quantity || 1)
    }
  }

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

  if (mode === 'pos' && !resolvedName.trim()) {
    resolvedName = 'زبون نقدي'
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

  // عناصر الطلبية مع التكلفة
  await supabase.from('order_items').insert(
    items.map(item => {
      const p = productMap.get(item.productId)
      const cost = Number(p?.cost_price || 0)
      return {
        order_id: order.id,
        product_id: item.productId,
        product_name: item.name,
        product_sku: p?.sku || null,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        cost_price: cost > 0 ? cost : null,
        total_price: item.unitPrice * item.quantity,
      }
    })
  )

  // ── تحديث المخزون وحركات المخزون تلقائياً ──────────────────────
  for (const item of items) {
    const p = productMap.get(item.productId)
    if (p && p.track_stock !== false) {
      const curStock = Number(p.stock_quantity || 0)
      const newStock = Math.max(0, curStock - Number(item.quantity))

      await supabase.from('products').update({ stock_quantity: newStock }).eq('id', p.id)

      await supabase.from('inventory_movements').insert({
        store_id: store.id,
        product_id: p.id,
        movement_type: 'sale',
        document_number: order.order_number,
        document_type: mode === 'pos' ? 'نقطة بيع POS (نقدي)' : 'نقطة بيع POS (آجل)',
        ref_id: order.id,
        entity_name: mode === 'pos' ? 'مبيعات نقدية' : (resolvedName || 'عميل آجل'),
        quantity_in: 0,
        quantity_out: Number(item.quantity),
        balance_after: newStock,
        unit_price: Number(item.unitPrice),
        movement_date: todayStr,
        created_by: user.id,
      })

      await supabase.from('stock_movements').insert({
        store_id: store.id,
        product_id: p.id,
        type: 'sale',
        quantity: Number(item.quantity),
        quantity_before: curStock,
        quantity_after: newStock,
        reference_id: order.id,
        reference_type: 'order',
        notes: `نقطة بيع #${order.order_number}`,
        created_by: user.id,
      })
    }
  }

  // ── إنشاء فاتورة مبيعات مطابقة في جدول invoices ───────────────
  const { count: invCount } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', store.id)

  const invoiceNumber = `INV-${String((invCount ?? 0) + 1).padStart(4, '0')}`
  const invoiceStatus = paymentStatus === 'paid' ? 'paid' : paymentStatus === 'partial' ? 'partial' : 'draft'

  const { data: inv } = await supabase
    .from('invoices')
    .insert({
      store_id: store.id,
      invoice_number: invoiceNumber,
      order_id: order.id,
      customer_id: customerId ?? null,
      customer_name: resolvedName || (mode === 'pos' ? 'عميل نقدي' : null),
      customer_phone: resolvedPhone || null,
      customer_address: address || null,
      issue_date: todayStr,
      payment_method: paymentMethod,
      status: invoiceStatus,
      subtotal,
      discount_amount: 0,
      total: totalAmount,
      amount_paid: effectiveAmountPaid,
      notes: notes || null,
      created_by: user.id,
    })
    .select('id, invoice_number')
    .single()

  if (inv) {
    await supabase.from('invoice_items').insert(
      items.map(item => {
        const p = productMap.get(item.productId)
        return {
          invoice_id: inv.id,
          product_id: item.productId,
          name: item.name,
          sku: p?.sku || null,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total: item.unitPrice * item.quantity,
        }
      })
    )
  }

  // ── تحديث الصندوق (نقد مقبوض في البيع النقدي أو الدفعة الفورية) ──
  if (effectiveAmountPaid > 0 && paymentMethod !== 'credit') {
    const methodMap: Record<string, 'cash' | 'bank' | 'card' | 'transfer'> = {
      cash: 'cash', bank_transfer: 'bank', check: 'bank', online: 'card',
    }
    const { data: boxId } = await supabase.rpc('ensure_cash_box', { p_store_id: store.id })
    if (boxId) {
      await supabase.from('cash_movements').insert({
        store_id:       store.id,
        cash_box_id:    boxId,
        direction:      'in',
        amount:         effectiveAmountPaid,
        source:         'order',
        ref_id:         order.id,
        party_name:     resolvedName || null,
        payment_method: methodMap[paymentMethod] ?? 'cash',
        description:    mode === 'pos' ? `مبيعات نقدية POS #${order.order_number}` : `دفعة نقدية طلبية #${order.order_number}`,
        date:           todayStr,
        created_by:     user.id,
      })
    }
  }

  // ── ترحيل القيود اليومية المحاسبية المزدوجة ──────────────────────
  try {
    await postPosSaleJournalEntries({
      storeId: store.id,
      orderId: order.id,
      orderNumber: order.order_number,
      invoiceId: inv?.id || null,
      invoiceNumber: inv?.invoice_number || null,
      date: todayStr,
      mode,
      customerId: mode === 'account' ? (customerId ?? null) : null,
      customerName: mode === 'account' ? resolvedName : 'عميل نقدي',
      totalAmount,
      totalCost,
      amountPaid: effectiveAmountPaid,
      actorId: user.id,
    })
  } catch (glErr) {
    console.error('Error posting POS accounting entries:', glErr)
  }

  // إضافة للذمة إذا كان الطلب بالآجل أو بنمط الحساب وتوجد ذمة متبقية
  const amountRemaining = totalAmount - effectiveAmountPaid
  if ((mode === 'account' || paymentMethod === 'credit') && customerId && amountRemaining > 0) {
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

  // ── Auto-create/link customer for POS orders ──────────────────────────────
  // الطلبيات الكاشير تُخزّن اسم الزبون في orders مباشرةً لكن لا تُنشئ سجلاً في customers.
  // هنا نُنشئ الزبون تلقائياً (أو نربطه إذا كان موجوداً بنفس الهاتف) لضمان تطابق الإحصائيات.
  if (mode === 'pos' && resolvedName.trim() && resolvedPhone.trim()) {
    const normalizedPhone = resolvedPhone.replace(/\s+/g, '')

    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id, total_orders')
      .eq('store_id', store.id)
      .eq('phone', normalizedPhone)
      .maybeSingle()

    if (existingCustomer) {
      await Promise.all([
        supabase.from('customers').update({
          total_orders: (existingCustomer.total_orders ?? 0) + 1,
          last_order_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', existingCustomer.id),
        supabase.from('orders').update({ customer_id: existingCustomer.id }).eq('id', order.id),
      ])
    } else {
      const { data: newCustomer } = await supabase
        .from('customers')
        .insert({
          store_id: store.id,
          name: resolvedName.trim(),
          phone: normalizedPhone,
          email: resolvedEmail || null,
          total_orders: 1,
          last_order_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (newCustomer) {
        await supabase.from('orders').update({ customer_id: newCustomer.id }).eq('id', order.id)
      }
    }
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

  return NextResponse.json({
    orderId: order.id,
    orderNumber: order.order_number,
    invoiceId: inv?.id,
    invoiceNumber: inv?.invoice_number,
  })
}
