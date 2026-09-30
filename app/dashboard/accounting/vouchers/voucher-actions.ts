'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { revalidatePath } from 'next/cache'

export interface ChequeItem {
  check_number: string
  bank_name: string
  bank_code?: string
  branch_name?: string
  branch_code?: string
  account_number?: string
  drawer_name?: string
  payee_name?: string
  amount: number
  due_date: string
  date?: string // تاريخ تحرير الشيك
  notes?: string
  images?: string[]
}

/**
 * جلب الصناديق والخزائن المسموح للمستخدم باستخدامها في سندات القبض أو الصرف
 */
export async function getUserAllowedCashBoxes(
  storeId: string,
  userId: string,
  voucherType: 'receipt' | 'payment',
) {
  const supabase = createClient()

  // 1. فحص رتبة العضو في المتجر
  const { data: member } = await supabase
    .from('store_members')
    .select('role')
    .eq('store_id', storeId)
    .eq('profile_id', userId)
    .maybeSingle()

  // 2. جلب جميع الصناديق النشطة في المتجر
  const { data: allBoxes } = await supabase
    .from('cash_boxes')
    .select('id, name, type, is_default, is_active')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })

  if (!allBoxes || allBoxes.length === 0) return []

  // إذا كان المستخدم مالكاً أو مديراً للمتجر، تتاح له كافة الصناديق
  if (member?.role === 'owner' || member?.role === 'admin') {
    return allBoxes
  }

  // 3. فحص جدول الصلاحيات المقيدة للمستخدم
  const { data: perms } = await supabase
    .from('user_cash_box_permissions')
    .select('cash_box_id, can_receipt, can_payment')
    .eq('store_id', storeId)
    .eq('user_id', userId)

  // إذا لم يتم وضع قيود خاصة لهذا المستخدم، فإن السياسة الافتراضية هي إتاحة الكل
  if (!perms || perms.length === 0) {
    return allBoxes
  }

  const allowedIds = new Set(
    perms
      .filter(p => (voucherType === 'receipt' ? p.can_receipt : p.can_payment))
      .map(p => p.cash_box_id),
  )

  return allBoxes.filter(b => allowedIds.has(b.id))
}

export interface CreateVoucherInput {
  type: 'receipt' | 'payment'
  date: string
  payment_method: 'cash' | 'cheque' | 'split' | 'bank' | 'transfer'
  amount: number
  cash_amount?: number
  checks_amount?: number
  cash_box_id?: string | null
  bank_account_id?: string | null
  customer_id?: string | null
  supplier_id?: string | null
  party_name: string
  category?: string | null
  description: string
  reference?: string | null
  invoice_id?: string | null
  purchase_invoice_id?: string | null
  checks?: ChequeItem[]
  request_key: string
}

/**
 * جلب الفواتير المفتوحة (غير المدفوعة أو المدفوعة جزئياً) لزبون محدد لربطها اختيارياً
 */
export async function getCustomerOpenInvoices(customerId: string) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return []

    const { data, error } = await supabase
      .from('invoices')
      .select('id, invoice_number, issue_date, total, amount_paid, status')
      .eq('store_id', storeId)
      .eq('customer_id', customerId)
      .neq('status', 'paid')
      .neq('status', 'cancelled')
      .order('issue_date', { ascending: false })

    if (error) throw error
    return (data || []).map(inv => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      issue_date: inv.issue_date,
      total: Number(inv.total || 0),
      amount_paid: Number(inv.amount_paid || 0),
      remaining: Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0)),
      status: inv.status,
    }))
  } catch (err) {
    console.error('Error fetching customer invoices:', err)
    return []
  }
}

/**
 * جلب فواتير المشتريات المفتوحة لمورد محدد لربطها اختيارياً
 */
export async function getSupplierOpenPurchases(supplierId: string) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return []

    const { data, error } = await supabase
      .from('purchase_invoices')
      .select('id, invoice_number, invoice_date, total_amount, paid_amount, payment_status')
      .eq('store_id', storeId)
      .eq('supplier_id', supplierId)
      .neq('payment_status', 'paid')
      .order('invoice_date', { ascending: false })

    if (error) throw error
    return (data || []).map(inv => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      total: Number(inv.total_amount || 0),
      paid_amount: Number(inv.paid_amount || 0),
      remaining: Math.max(0, Number(inv.total_amount || 0) - Number(inv.paid_amount || 0)),
      status: inv.payment_status,
    }))
  } catch (err) {
    console.error('Error fetching supplier purchase invoices:', err)
    return []
  }
}

/**
 * تطبيع موحد لطريقة الدفع عبر السندات
 */
function normalizePaymentMethod(method?: string | null): 'cash' | 'cheque' | 'split' | 'bank' {
  const rawMethod = (method || 'cash').toLowerCase().trim()
  const isChequeMethod = rawMethod === 'cheque' || rawMethod === 'check' || rawMethod === 'cheques' || rawMethod === 'checks' || rawMethod.includes('شيك')
  const isSplitMethod = rawMethod === 'split' || rawMethod.includes('مختلط') || rawMethod.includes('مركب') || rawMethod.includes('مجزأ')
  const isBankMethod = rawMethod === 'bank' || rawMethod === 'transfer' || rawMethod.includes('بنك') || rawMethod.includes('تحويل')
  return isChequeMethod ? 'cheque' : isSplitMethod ? 'split' : isBankMethod ? 'bank' : 'cash'
}

/**
 * إنشاء سند قبض أو صرف مع دعم الدفع النقدي، الشيكات، أو (نقدي + شيكات)
 * والربط الاختياري بالفواتير
 */
export async function createVoucher(input: CreateVoucherInput) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }
    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }
    if (input.cash_box_id) {
      const allowed = await getUserAllowedCashBoxes(storeId, user.id, input.type)
      if (!allowed.some(b => b.id === input.cash_box_id)) return { success: false, error: 'ليس لديك صلاحية على الصندوق المحدد' }
    }
    if (!input.request_key) return { success: false, error: 'معرف محاولة السند مطلوب' }
    const { request_key, ...payload } = input
    const { data, error } = await supabase.rpc('create_voucher_atomic', {
      p_store: storeId,
      p_payload: payload,
      p_key: request_key,
    })
    if (error || !data?.id) return { success: false, error: error?.message || 'فشل حفظ السند كاملاً' }
    revalidatePath('/dashboard/accounting')
    revalidatePath('/dashboard/finance')
    revalidatePath('/dashboard/accounting/receipts')
    revalidatePath('/dashboard/accounting/payments')
    revalidatePath('/dashboard/accounting/treasury')
    revalidatePath('/dashboard/cheques')
    revalidatePath('/dashboard/customers')
    revalidatePath('/dashboard/suppliers')
    return { success: true, voucher: data }
  } catch (err: any) {
    return { success: false, error: err?.message || 'حدث خطأ أثناء حفظ السند' }
  }
}

/**
 * حذف السند مع عكس الأثر المالي على الصندوق، الشيكات، كشف الحساب، والفواتير
 */
export async function deleteVoucher(_voucherId: string) {
  return { success: false, error: 'لا يجوز حذف سند مُرحّل. يلزم إنشاء عملية عكس موثقة تشمل القيد والذمم والشيكات.' }
}

export interface UpdateVoucherInput {
  id: string
  date: string
  payment_method: 'cash' | 'cheque' | 'split' | 'bank' | 'transfer'
  amount: number
  cash_amount?: number
  checks_amount?: number
  cash_box_id?: string | null
  bank_account_id?: string | null
  customer_id?: string | null
  supplier_id?: string | null
  invoice_id?: string | null
  purchase_invoice_id?: string | null
  party_name: string
  category?: string | null
  description: string
  reference?: string | null
  checks?: ChequeItem[]
}

/**
 * تعديل السند المحاسبي وعكس الأثر القديم بالكامل وتحديث الحسابات والخزينة والشيكات
 * لا ينشئ أي قيد مالي مكرر أو أثر مالي مضاعف
 */
export async function updateVoucher(_input: UpdateVoucherInput) {
  return { success: false, error: 'لا يجوز تعديل مبالغ أو وسائل دفع سند مُرحّل. أنشئ مستند تصحيح موثقاً.' }
}
