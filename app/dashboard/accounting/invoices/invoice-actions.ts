'use server'
import { createClient } from '@/lib/supabase/server'
import { sendInvoiceEmail } from '@/lib/email/invoice-email'
import { getStoreForUser } from '@/lib/supabase/getStore'
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
  options: { cashBoxId?: string; bankAccountId?: string; confirmed?: boolean; requestKey: string },
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'غير مصرح' }
  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return { ok: false, error: 'المتجر غير موجود' }
  const { data, error } = await supabase.rpc('record_invoice_payment_atomic', {
    p_invoice: invoiceId,
    p_amount: amount,
    p_method: method,
    p_cashbox: options.cashBoxId || null,
    p_bank: options.bankAccountId || null,
    p_confirmed: options.confirmed === true,
    p_key: options.requestKey,
  })
  if (error || !data?.ok) return { ok: false, error: error?.message || 'فشل تسجيل الدفع كاملاً' }
  revalidatePath(`/dashboard/accounting/invoices/${invoiceId}`)
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
  const { data: invoice } = await supabase.from('invoices').select('id').eq('id', invoiceId).eq('store_id', storeId).single()
  if (!invoice) return { ok: false, error: 'الفاتورة غير موجودة' }
  const { data, error } = await supabase.rpc('cancel_unpaid_sales_invoice_atomic', {
    p_invoice: invoiceId,
    p_reason: 'إلغاء الفاتورة من شاشة الإدارة',
  })
  if (error || !data?.ok) return { ok: false, error: error?.message || 'تعذر إلغاء الفاتورة' }
  revalidatePath('/dashboard/accounting/invoices')
  revalidatePath('/dashboard/sales')
  return { ok: true }
}
