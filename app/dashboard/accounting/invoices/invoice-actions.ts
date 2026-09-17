'use server'
import { createClient } from '@/lib/supabase/server'
import { sendInvoiceEmail } from '@/lib/email/invoice-email'
import { getStoreForUser } from '@/lib/supabase/getStore'
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
  const newStatus = fullyPaid ? 'paid' : 'draft'

  // 1) سند قبض → يولّد حركة صندوق (نقد داخل) عبر الـ trigger
  const { count } = await supabase
    .from('vouchers')
    .select('*', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('type', 'receipt')
  const voucherNumber = `RCP-${String((count ?? 0) + 1).padStart(4, '0')}`

  await supabase.from('vouchers').insert({
    store_id:       storeId,
    voucher_number: voucherNumber,
    type:           'receipt',
    date:           new Date().toISOString().slice(0, 10),
    amount:         pay,
    customer_id:    inv.customer_id,
    party_name:     inv.customer_name,
    payment_method: method,
    category:       'تحصيل فاتورة',
    description:    `دفعة على فاتورة ${inv.invoice_number}`,
    reference:      inv.invoice_number,
    created_by:     user.id,
  })

  // 2) تحديث الفاتورة
  await supabase.from('invoices').update({
    amount_paid: newPaid,
    status:      newStatus,
    updated_at:  new Date().toISOString(),
  }).eq('id', inv.id)

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
      date:           new Date().toISOString().slice(0, 10),
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

  // 2. إعادة المخزون المباع للأصناف
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

  // 3. عكس كشف حساب الزبون ورصيده
  if (inv.customer_id) {
    const { data: cust } = await supabase
      .from('customers')
      .select('balance, total_invoiced, total_paid')
      .eq('id', inv.customer_id)
      .single()

    if (cust) {
      const remainingDebt = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0))
      const newBalance = Math.max(0, Number(cust.balance || 0) - remainingDebt)
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

  // 4. حذف سندات القبض المرتبطة بالفاتورة من الصندوق إن وجدت
  await supabase
    .from('vouchers')
    .delete()
    .eq('reference', inv.invoice_number)
    .eq('store_id', storeId)

  // 5. توثيق العملية في سجل التدقيق المالي
  await logFinancialEvent({
    storeId,
    entityType: 'invoice',
    entityId: inv.id,
    entityLabel: inv.invoice_number,
    action: 'delete',
    actorId: user.id,
    details: { total: inv.total, invoiceNumber: inv.invoice_number, itemsCount: items?.length || 0 },
  })

  // 5.5. عكس القيد المحاسبي في دفتر الأستاذ العام
  try {
    await reverseJournalEntry(inv.id, `حذف فاتورة مبيعات #${inv.invoice_number}`, user.id)
  } catch (glErr) {
    console.error('Error reversing invoice GL entry:', glErr)
  }

  // 6. حذف الفاتورة
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
