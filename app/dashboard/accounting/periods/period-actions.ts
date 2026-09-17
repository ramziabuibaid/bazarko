'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { logFinancialEvent } from '@/lib/accounting/audit'
import { revalidatePath } from 'next/cache'

export interface AccountingPeriod {
  id: string
  store_id: string
  period_name: string
  start_date: string
  end_date: string
  is_closed: boolean
  closed_at: string | null
  closed_by: string | null
  notes: string | null
  created_at: string
}

/**
 * فحص هل التاريخ يقع ضمن فترة محاسبية مغلقة
 * يمنع التعديل، الحذف، أو إنشاء مستندات جديدة في الفترات المقفلة
 */
export async function checkIsPeriodClosed(storeId: string, dateStr: string): Promise<{ isClosed: boolean; periodName?: string }> {
  try {
    const supabase = createClient()
    const { data: period } = await supabase
      .from('accounting_periods')
      .select('period_name')
      .eq('store_id', storeId)
      .eq('is_closed', true)
      .lte('start_date', dateStr)
      .gte('end_date', dateStr)
      .maybeSingle()

    if (period) {
      return { isClosed: true, periodName: period.period_name }
    }
    return { isClosed: false }
  } catch (err) {
    console.error('Error checking closed period:', err)
    return { isClosed: false }
  }
}

/**
 * جلب جميع الفترات المحاسبية للمتجر
 */
export async function getAccountingPeriods(storeId: string): Promise<AccountingPeriod[]> {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('accounting_periods')
      .select('*')
      .eq('store_id', storeId)
      .order('start_date', { ascending: false })

    if (error) throw error
    return data || []
  } catch (err) {
    console.error('Error fetching periods:', err)
    return []
  }
}

/**
 * إنشاء فترة محاسبية جديدة (شهرية، ربع سنوية، أو سنوية)
 */
export async function createAccountingPeriod(input: {
  period_name: string
  start_date: string
  end_date: string
  notes?: string
}) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    if (!input.period_name?.trim()) {
      return { success: false, error: 'يرجى إدخال اسم الفترة المحاسبية' }
    }
    if (!input.start_date || !input.end_date) {
      return { success: false, error: 'تاريخ بداية ونهاية الفترة مطلوبان' }
    }
    if (input.start_date > input.end_date) {
      return { success: false, error: 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية' }
    }

    const { data: period, error: insErr } = await supabase
      .from('accounting_periods')
      .insert({
        store_id: storeId,
        period_name: input.period_name.trim(),
        start_date: input.start_date,
        end_date: input.end_date,
        notes: input.notes?.trim() || null,
        is_closed: false,
      })
      .select('*')
      .single()

    if (insErr) {
      if (insErr.code === '23505') {
        return { success: false, error: 'توجد فترة محاسبية مسجلة مسبقاً بنفس نطاق التواريخ' }
      }
      throw insErr
    }

    await logFinancialEvent({
      storeId,
      entityType: 'voucher',
      entityId: period.id,
      entityLabel: period.period_name,
      action: 'create',
      actorId: user.id,
      details: { action: 'create_period', period: input },
    })

    revalidatePath('/dashboard/accounting/periods')
    revalidatePath('/dashboard/accounting-hub')
    return { success: true, period }
  } catch (err: any) {
    return { success: false, error: err.message || 'فشل إنشاء الفترة المحاسبية' }
  }
}

/**
 * إغلاق الفترة المحاسبية وقفل كافة العمليات والقيود التاريخية
 */
export async function closePeriod(periodId: string, notes?: string) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    const { data: period, error: findErr } = await supabase
      .from('accounting_periods')
      .select('*')
      .eq('id', periodId)
      .eq('store_id', storeId)
      .single()

    if (findErr || !period) return { success: false, error: 'الفترة غير موجودة' }

    const { error: updErr } = await supabase
      .from('accounting_periods')
      .update({
        is_closed: true,
        closed_at: new Date().toISOString(),
        closed_by: user.id,
        notes: notes ? `${period.notes ? period.notes + ' | ' : ''}${notes}` : period.notes,
      })
      .eq('id', periodId)

    if (updErr) throw updErr

    await logFinancialEvent({
      storeId,
      entityType: 'voucher',
      entityId: period.id,
      entityLabel: period.period_name,
      action: 'status_change',
      actorId: user.id,
      details: { action: 'close_period', period_name: period.period_name },
    })

    revalidatePath('/dashboard/accounting/periods')
    revalidatePath('/dashboard/accounting-hub')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'فشل إغلاق الفترة المحاسبية' }
  }
}

/**
 * إعادة فتح فترة محاسبية مغلقة (خاص بصلاحية الإدارة)
 */
export async function reopenPeriod(periodId: string) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    const { data: period, error: findErr } = await supabase
      .from('accounting_periods')
      .select('*')
      .eq('id', periodId)
      .eq('store_id', storeId)
      .single()

    if (findErr || !period) return { success: false, error: 'الفترة غير موجودة' }

    const { error: updErr } = await supabase
      .from('accounting_periods')
      .update({
        is_closed: false,
        closed_at: null,
        closed_by: null,
      })
      .eq('id', periodId)

    if (updErr) throw updErr

    await logFinancialEvent({
      storeId,
      entityType: 'voucher',
      entityId: period.id,
      entityLabel: period.period_name,
      action: 'status_change',
      actorId: user.id,
      details: { action: 'reopen_period', period_name: period.period_name },
    })

    revalidatePath('/dashboard/accounting/periods')
    revalidatePath('/dashboard/accounting-hub')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'فشل إعادة فتح الفترة' }
  }
}
