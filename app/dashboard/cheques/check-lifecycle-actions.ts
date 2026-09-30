'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { revalidatePath } from 'next/cache'

export interface CheckOperationInput {
  checkId: string
  operationType:
    | 'deposit'
    | 'collect'
    | 'bounce'
    | 'return_to_customer'
    | 'recollect'
    | 'endorse'
    | 'supplier_return'
    | 'transfer_cashbox'
  targetBankAccountId?: string | null
  targetCashBoxId?: string | null
  targetSupplierId?: string | null
  operationDate: string
  notes?: string
}

export interface CheckAccountingPreview {
  debitAccountName: string
  debitAccountCode: string
  creditAccountName: string
  creditAccountCode: string
  amount: number
  currency: string
  date: string
  description: string
  operationType: string
  fromStatus: string
  toStatus: string
}

/**
 * معاينة القيد المحاسبي قبل التنفيذ (لتأكيد المستخدم وفق شجرة الحسابات الحقيقية)
 */
export async function previewCheckAccounting(
  input: CheckOperationInput
): Promise<{ success: boolean; preview?: CheckAccountingPreview; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    const { data: preview, error } = await supabase.rpc('preview_check_lifecycle_operation', {
      p_check_id: input.checkId,
      p_op_type: input.operationType,
      p_date: input.operationDate || new Date().toISOString().slice(0, 10),
      p_target_bank_id: input.targetBankAccountId || null,
      p_target_cashbox_id: input.targetCashBoxId || null,
      p_target_supplier_id: input.targetSupplierId || null,
    })
    if (error || !preview) return { success: false, error: error?.message || 'تعذر توليد المعاينة' }
    return { success: true, preview }
  } catch (err: any) {
    return { success: false, error: err.message || 'فشل توليد معاينة القيد' }
  }
}

/**
 * تنفيذ العملية على دورة حياة الشيك عبر الإجراء الذري المحاسبي المزدوج في قاعدة البيانات
 */
export async function executeCheckOperation(
  input: CheckOperationInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    // التحقق من الصلاحيات ووجود الشيك
    const { data: check } = await supabase
      .from('checks')
      .select('id, check_number, amount')
      .eq('id', input.checkId)
      .eq('store_id', storeId)
      .single()

    if (!check) return { success: false, error: 'الشيك غير موجود' }

    // استدعاء الإجراء المخزن الذري
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('execute_check_lifecycle_operation', {
      p_check_id: input.checkId,
      p_op_type: input.operationType,
      p_date: input.operationDate || new Date().toISOString().slice(0, 10),
      p_target_bank_id: input.targetBankAccountId || null,
      p_target_cashbox_id: input.targetCashBoxId || null,
      p_target_supplier_id: input.targetSupplierId || null,
      p_notes: input.notes?.trim() || null,
      p_actor_id: user.id,
    })

    if (rpcErr || !rpcRes?.success) {
      console.error('execute_check_lifecycle_operation RPC error:', rpcErr)
      return { success: false, error: rpcErr?.message || 'فشل تنفيذ عملية الشيك' }
    }

    revalidatePath('/dashboard/cheques')
    revalidatePath('/dashboard/accounting/statement')
    revalidatePath('/dashboard/accounting/journal')
    revalidatePath('/dashboard/finance')
    revalidatePath('/dashboard/customers')
    revalidatePath('/dashboard/suppliers')

    return { success: true }
  } catch (err: any) {
    console.error('executeCheckOperation error:', err)
    return { success: false, error: err.message || 'فشل تنفيذ عملية الشيك' }
  }
}

/**
 * جلب سجل الحركات التاريخية لشيك معين
 */
export async function getCheckAuditHistory(checkId: string) {
  try {
    const supabase = createClient()
    const { data: operations, error } = await supabase
      .from('check_operations')
      .select('*, target_bank:bank_accounts(bank_name, account_number), target_supp:suppliers(name), target_cashbox:cash_boxes(name), journal_entry:journal_entries(entry_number)')
      .eq('check_id', checkId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return { success: true, operations: operations || [] }
  } catch (err: any) {
    return { success: false, error: err.message, operations: [] }
  }
}
