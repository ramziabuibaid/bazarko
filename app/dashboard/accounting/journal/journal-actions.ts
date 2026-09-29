'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { revalidatePath } from 'next/cache'

export interface JournalLineUpdateInput {
  account_id: string
  debit: number
  credit: number
  description?: string
  currency?: string
  exchange_rate?: number
  original_debit?: number
  original_credit?: number
  account_tag_used?: string | null
  source_rule?: string | null
}

export interface UpdateJournalEntryInput {
  entryId: string
  date: string
  description: string
  lines: JournalLineUpdateInput[]
}

/**
 * تعديل قيد محاسبي مع المزامنة العكسية الكاملة لدفتر الأستاذ العام
 * والأرصدة والمستندات المرتبطة (سندات، خزن، كشف حساب العميل)
 */
export async function updateJournalEntryAction(input: UpdateJournalEntryInput) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    if (!input.entryId) return { success: false, error: 'معرف القيد مطلوب' }
    if (!input.date) return { success: false, error: 'تاريخ القيد مطلوب' }
    if (!input.description?.trim()) return { success: false, error: 'بيان القيد مطلوب' }
    if (!input.lines || input.lines.length < 2) {
      return { success: false, error: 'يجب أن يحتوي القيد على طرفين على الأقل (مدين ودائن)' }
    }

    // التحقق من توازن القيد
    const totalDebit = input.lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0)
    const totalCredit = input.lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0)
    const diff = Math.abs(totalDebit - totalCredit)

    if (diff > 0.01 || totalDebit <= 0) {
      return {
        success: false,
        error: `القيد غير متوازن! إجمالي المدين (${totalDebit.toFixed(2)}) لا يتطابق مع إجمالي الدائن (${totalCredit.toFixed(2)})`,
      }
    }

    // التحقق من أن القيد يتبع لنفس المتجر
    const { data: entry, error: entryErr } = await supabase
      .from('journal_entries')
      .select('id, store_id, entry_number, status')
      .eq('id', input.entryId)
      .eq('store_id', storeId)
      .single()

    if (entryErr || !entry) {
      return { success: false, error: 'القيد المحاسبي غير موجود أو لا تملك صلاحية تعديله' }
    }

    if (entry.status === 'voided') {
      return { success: false, error: 'لا يمكن تعديل قيد ملغي' }
    }

    // استدعاء الإجراء المخزن الذري لتطبيق التعديل والعكس والمزامنة
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('update_journal_entry_with_sync', {
      p_entry_id: input.entryId,
      p_date: input.date,
      p_description: input.description.trim(),
      p_lines: input.lines,
      p_actor_id: user.id,
    })

    if (rpcErr) {
      console.error('Error in update_journal_entry_with_sync RPC:', rpcErr)
      return { success: false, error: rpcErr.message || 'فشل تعديل القيد المحاسبي' }
    }

    // إعادة تحديث كل المسارات المتأثرة
    revalidatePath('/dashboard')
    revalidatePath('/dashboard/accounting')
    revalidatePath('/dashboard/accounting-hub')
    revalidatePath('/dashboard/accounting/journal')
    revalidatePath(`/dashboard/accounting/journal/${input.entryId}/edit`)
    revalidatePath('/dashboard/accounting/vouchers')
    revalidatePath('/dashboard/accounting/receipts')
    revalidatePath('/dashboard/accounting/payments')
    revalidatePath('/dashboard/customers')
    revalidatePath('/dashboard/suppliers')
    revalidatePath('/dashboard/finance')

    return {
      success: true,
      data: rpcRes,
    }
  } catch (err: any) {
    console.error('Exception in updateJournalEntryAction:', err)
    return { success: false, error: err?.message || 'حدث خطأ غير متوقع أثناء تعديل القيد' }
  }
}
