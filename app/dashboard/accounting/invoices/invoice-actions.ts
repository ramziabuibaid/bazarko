'use server'
import { createClient } from '@/lib/supabase/server'
import { sendInvoiceEmail } from '@/lib/email/invoice-email'

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
