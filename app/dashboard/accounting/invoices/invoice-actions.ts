'use server'
import { createClient } from '@/lib/supabase/server'
import { sendInvoiceEmail } from '@/lib/email/invoice-email'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { requireStorePermission } from '@/lib/supabase/permissions'
import { logFinancialEvent } from '@/lib/accounting/audit'
import { checkIsPeriodClosed } from '@/app/dashboard/accounting/periods/period-actions'
import { reverseJournalEntry } from '@/lib/accounting/engine'
import { revalidatePath } from 'next/cache'

type PayMethod = 'cash' | 'bank' | 'card' | 'transfer'

/**
 * تسجيل دفعة على فاتورة:
 *  - تُنشئ سند قبض (→ يدخل الصندوق تلقائياً عبر trigger)
 *  - تُحدّث كشف حساب الزبون ورصيده
 *  - تُحدّث حالة الفاتورة (partial / paid) و amount_paid و paid_at
 *  - تُسجّل العملية في سجل العمليات المالية
 */
export async function recordInvoicePayment(
  invoiceId: string,
  amount: number,
  method: PayMethod = 'cash',
): Promise<{ ok: boolean; error?: string }> {
  if (!(amount > 0)) return { ok: false, error: 'أدخل مبلغاً صحيحاً' }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'غير مصرح' }

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

  await requireStorePermission(storeId, 'finance.write')

  const todayStr = new Date().toISOString().slice(0, 10)
  const periodCheck = await checkIsPeriodClosed(storeId, todayStr)
  if (periodCheck.isClosed) {
    return { ok: false, error: `لا يمكن تسجيل دفعة في فترة محاسبية مقفلة (${periodCheck.periodName})` }
  }

  const { data: inv } = await supabase
    .from('invoices')
    .select('id, invoice_number, total, amount_paid, status, customer_id, customer_name')
    .eq('id', invoiceId)
    .eq('store_id', storeId)
    .single()
  if (!inv) return { ok: false, error: 'الفاتورة غير موجودة' }
  if (inv.status === 'cancelled') return { ok: false, error: 'الفاتورة ملغاة' }

  const remaining = Math.max(0, inv.total - inv.amount_paid)
  if (remaining <= 0) return { ok: false, error: 'الفاتورة مسددة بالكامل' }

  const pay       = Math.min(amount, remaining)
  const newPaid   = inv.amount_paid + pay
  const fullyPaid = newPaid >= inv.total - 0.001
  const newStatus = fullyPaid ? 'paid' : 'partial'

  // 1) سند قبض → تسلسل آمن وربط الفاتورة
  const { data: generatedVNum } = await supabase.rpc('generate_sequence_number', {
    p_store_id: storeId,
    p_prefix: `RCP-${new Date().getFullYear()}-`,
  })
  const voucherNumber = generatedVNum || `RCP-${Date.now().toString().slice(-6)}`

  const { data: voucher, error: vErr } = await supabase
    .from('vouchers')
    .insert({
      store_id:       storeId,
      voucher_number: voucherNumber,
      type:           'receipt',
      date:           todayStr,
      amount:         pay,
      cash_amount:    method === 'cash' ? pay : 0,
      checks_amount:  0,
      customer_id:    inv.customer_id,
      party_name:     inv.customer_name,
      payment_method: method,
      category:       'تحصيل فاتورة',
      description:    `دفعة على فاتورة ${inv.invoice_number}`,
      reference:      inv.invoice_number,
      invoice_id:     inv.id,
      created_by:     user.id,
    })
    .select('id')
    .single()

  if (vErr || !voucher) {
    console.error('Failed to create receipt voucher:', vErr)
    return { ok: false, error: vErr?.message || 'فشل إنشاء سند القبض للدفعة' }
  }

  // 2) تحديث الفاتورة
  const { error: invUpdErr } = await supabase.from('invoices').update({
    amount_paid: newPaid,
    status:      newStatus,
    updated_at:  new Date().toISOString(),
  }).eq('id', inv.id)

  if (invUpdErr) {
    console.error('Failed to update invoice amount_paid:', invUpdErr)
    await supabase.from('vouchers').delete().eq('id', voucher.id)
    return { ok: false, error: invUpdErr.message || 'فشل تحديث الفاتورة' }
  }

  // 3) كشف حساب الزبون + رصيده
  if (inv.customer_id) {
    const { data: cust } = await supabase
      .from('customers')
      .select('balance, total_paid')
      .eq('id', inv.customer_id)
      .single()

    const newBalance = (cust?.balance ?? 0) - pay
    await supabase.from('customer_ledger').insert({
      store_id:       storeId,
      customer_id:    inv.customer_id,
      type:           'payment',
      date:           todayStr,
      description:    `دفعة على فاتورة ${inv.invoice_number}`,
      debit:          0,
      credit:         pay,
      balance:        newBalance,
      reference_id:   inv.id,
      reference_type: 'invoice',
      created_by:     user.id,
    })
    await supabase.from('customers').update({
      balance:    newBalance,
      total_paid: (cust?.total_paid ?? 0) + pay,
    }).eq('id', inv.customer_id)
  }

  // 4) سجل العمليات المالية
  await logFinancialEvent({
    storeId, entityType: 'invoice', entityId: inv.id,
    entityLabel: inv.invoice_number, action: 'payment', actorId: user.id,
    details: { amount: pay, method, newStatus, voucher: voucherNumber },
  })

  revalidatePath(`/dashboard/accounting/invoices/${inv.id}`)
  revalidatePath('/dashboard/accounting/invoices')
  return { ok: true }
}

export async function emailInvoice(invoiceId: string, toEmail: string): Promise<{ ok: boolean; error?: string }> {
  if (!toEmail.trim()) return { ok: false, error: 'البريد الإلكتروني مطلوب' }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'غير مصرح' }

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, phone, currency_code')
    .eq('owner_id', user.id)
    .single()
  if (!store) return { ok: false, error: 'المتجر غير موجود' }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, invoice_number, customer_name, issue_date, due_date, subtotal, discount_amount, total, amount_paid')
    .eq('id', invoiceId)
    .eq('store_id', store.id)
    .single()
  if (!invoice) return { ok: false, error: 'الفاتورة غير موجودة' }

  const { data: invoiceItems } = await supabase
    .from('invoice_items')
    .select('name, quantity, unit_price, total')
    .eq('invoice_id', invoiceId)
    .order('id')

  await sendInvoiceEmail({
    to:             toEmail.trim(),
    customerName:   invoice.customer_name ?? 'العميل الكريم',
    storeName:      store.name,
    storePhone:     store.phone ?? null,
    invoiceNumber:  invoice.invoice_number,
    issueDate:      invoice.issue_date,
    dueDate:        invoice.due_date,
    items:          invoiceItems ?? [],
    subtotal:       invoice.subtotal,
    discountAmount: invoice.discount_amount,
    total:          invoice.total,
    amountPaid:     invoice.amount_paid,
    currencyCode:   store.currency_code,
  })

  return { ok: true }
}

/**
 * حذف فاتورة المبيعات مع عكس المخزون، عكس كشف حساب الزبون، وإلغاء القيود المرتبطة
 */
export async function deleteInvoice(invoiceId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'غير مصرح' }

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

  await requireStorePermission(storeId, 'sales.write')

  // 1. جلب الفاتورة وبنودها
  const { data: inv } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('store_id', storeId)
    .single()
  if (!inv) return { ok: false, error: 'الفاتورة غير موجودة' }

  // التحقق من قفل الفترة المحاسبية لتاريخ الفاتورة
  const periodCheck = await checkIsPeriodClosed(storeId, inv.issue_date)
  if (periodCheck.isClosed) {
    return { ok: false, error: `لا يمكن حذف فاتورة تقع ضمن فترة محاسبية مقفلة (${periodCheck.periodName})` }
  }

  const { data: items } = await supabase
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)

  // 2. عكس أثر القيد المحاسبي أولاً في دفتر الأستاذ العام (Fail-Closed)
  try {
    const revRes = await reverseJournalEntry(inv.id, `حذف فاتورة مبيعات #${inv.invoice_number}`, user.id)
    if (!revRes.success) {
      return { ok: false, error: 'فشل عكس القيد المحاسبي للفاتورة' }
    }
  } catch (glErr: any) {
    console.error('Error reversing invoice GL entry:', glErr)
    return { ok: false, error: `فشل عكس القيد المحاسبي للفاتورة: ${glErr?.message || 'خطأ غير معروف'}` }
  }

  // 3. إعادة المخزون المباع للأصناف
  if (items && items.length > 0) {
    for (const item of items) {
      if (item.product_id) {
        const { data: prod } = await supabase
          .from('products')
          .select('stock_quantity')
          .eq('id', item.product_id)
          .single()
        if (prod) {
          const restoredStock = Number(prod.stock_quantity || 0) + Number(item.quantity)
          await supabase.from('products').update({ stock_quantity: restoredStock }).eq('id', item.product_id)

          await supabase
            .from('inventory_movements')
            .delete()
            .eq('ref_id', invoiceId)
            .eq('product_id', item.product_id)
        }
      }
    }
  }

  // 4. عكس كشف حساب الزبون ورصيده مع الحفاظ على الرصيد الدائن
  if (inv.customer_id) {
    const { data: cust } = await supabase
      .from('customers')
      .select('balance, total_invoiced, total_paid')
      .eq('id', inv.customer_id)
      .single()

    if (cust) {
      const remainingDebt = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0))
      // الحفاظ على إشارة الرصيد وعدم حصر الدائن في الصفر
      const newBalance = Number(cust.balance || 0) - remainingDebt
      const newInvoiced = Math.max(0, Number(cust.total_invoiced || 0) - Number(inv.total || 0))
      const newPaid = Math.max(0, Number(cust.total_paid || 0) - Number(inv.amount_paid || 0))

      await supabase.from('customers').update({
        balance: newBalance,
        total_invoiced: newInvoiced,
        total_paid: newPaid,
      }).eq('id', inv.customer_id)

      await supabase
        .from('customer_ledger')
        .delete()
        .eq('reference_id', invoiceId)
        .eq('reference_type', 'invoice')
    }
  }

  // 5. حذف سندات القبض المرتبطة بالفاتورة من الصندوق إن وجدت
  await supabase
    .from('vouchers')
    .delete()
    .eq('reference', inv.invoice_number)
    .eq('store_id', storeId)

  // 6. توثيق العملية في سجل التدقيق المالي
  await logFinancialEvent({
    storeId,
    entityType: 'invoice',
    entityId: inv.id,
    entityLabel: inv.invoice_number,
    action: 'delete',
    actorId: user.id,
    details: { total: inv.total, invoiceNumber: inv.invoice_number, itemsCount: items?.length || 0 },
  })

  // 7. حذف الفاتورة
  const { error: delErr } = await supabase
    .from('invoices')
    .delete()
    .eq('id', invoiceId)
    .eq('store_id', storeId)

  if (delErr) return { ok: false, error: delErr.message }

  revalidatePath('/dashboard/accounting/invoices')
  revalidatePath('/dashboard/sales')
  return { ok: true }
}

export interface UpdateSalesInvoiceInput {
  customerId: string | null
  customerName: string
  customerPhone?: string | null
  customerAddress?: string | null
  issueDate: string
  dueDate?: string | null
  paymentMethod: 'cash' | 'credit' | 'bank' | 'check' | 'card'
  discountType: 'amount' | 'percent'
  discountValue: number
  amountPaid: number
  notes?: string | null
  items: {
    product_id: string | null
    name: string
    sku?: string | null
    quantity: number
    unit_price: number
  }[]
  belowCostApproval?: {
    approvedBy: string
    approvedAt: string
    reason?: string
    items: any[]
  }
}

/**
 * تعديل فاتورة مبيعات ذرياً مع تحديث المخزون، كشف حساب الزبون، والقيد المحاسبي المرتبط
 */
export async function updateSalesInvoice(
  invoiceId: string,
  input: UpdateSalesInvoiceInput,
): Promise<{ ok: boolean; error?: string; data?: any }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'غير مصرح؛ يرجى تسجيل الدخول' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

    await requireStorePermission(storeId, 'sales.write')

    if (!input || !Array.isArray(input.items) || input.items.length === 0) {
      return { ok: false, error: 'يجب إضافة بند واحد على الأقل للفاتورة' }
    }

    let activeCustomerId = input.customerId
    if (!activeCustomerId && input.customerName?.trim()) {
      const trimmedName = input.customerName.trim()
      const trimmedPhone = input.customerPhone?.trim() || null
      const trimmedAddress = input.customerAddress?.trim() || null

      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('store_id', storeId)
        .eq('is_active', true)
        .ilike('name', trimmedName)
        .limit(1)

      if (existing && existing.length > 0) {
        activeCustomerId = existing[0].id
      } else {
        const { data: newCust, error: custErr } = await supabase
          .from('customers')
          .insert({
            store_id: storeId,
            name: trimmedName,
            phone: trimmedPhone,
            address: trimmedAddress,
            customer_type: 'retail',
            is_active: true,
          })
          .select('id')
          .single()
        if (!custErr && newCust?.id) {
          activeCustomerId = newCust.id
        }
      }
    }

    const payload = {
      ...input,
      customerId: activeCustomerId,
    }

    const { data, error } = await supabase.rpc('update_sales_invoice_atomic', {
      p_store_id: storeId,
      p_invoice_id: invoiceId,
      p_payload: payload,
    })

    if (error) {
      console.error('Error in update_sales_invoice_atomic RPC:', error)
      return { ok: false, error: error.message || 'فشل تعديل الفاتورة' }
    }

    if (input.belowCostApproval) {
      await logFinancialEvent({
        storeId,
        entityType: 'invoice',
        entityId: invoiceId,
        entityLabel: `فاتورة مبيعات بيع بأقل من التكلفة`,
        action: 'update',
        actorId: user.id,
        details: {
          below_cost_approved: true,
          approved_by: input.belowCostApproval.approvedBy,
          approved_at: input.belowCostApproval.approvedAt,
          reason: input.belowCostApproval.reason,
          items: input.belowCostApproval.items,
        },
      }).catch(() => {})
    }

    revalidatePath('/dashboard')
    revalidatePath('/dashboard/accounting')
    revalidatePath('/dashboard/accounting/invoices')
    revalidatePath(`/dashboard/accounting/invoices/${invoiceId}`)
    revalidatePath(`/dashboard/accounting/invoices/${invoiceId}/edit`)
    revalidatePath('/dashboard/accounting/journal')
    revalidatePath('/dashboard/customers')
    revalidatePath('/dashboard/customers/ledger')
    revalidatePath('/dashboard/products')
    revalidatePath('/dashboard/finance')

    return { ok: true, data }
  } catch (err: any) {
    console.error('Exception in updateSalesInvoice:', err)
    return { ok: false, error: err.message || 'حدث خطأ غير متوقع أثناء تعديل الفاتورة' }
  }
}

