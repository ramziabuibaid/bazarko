'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { logFinancialEvent } from '@/lib/accounting/audit'
import { revalidatePath } from 'next/cache'

export interface CreateAccountInput {
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  normal_balance?: 'debit' | 'credit'
  parent_id?: string | null
  is_group?: boolean
  is_active?: boolean
  currency?: string
  description?: string | null
}

export interface UpdateAccountInput {
  id: string
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  normal_balance?: 'debit' | 'credit'
  parent_id?: string | null
  is_group?: boolean
  is_active?: boolean
  currency?: string
  description?: string | null
}

/**
 * إنشاء حساب جديد في دليل وشجرة الحسابات
 */
export async function createAccount(input: CreateAccountInput) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    const code = input.code.trim()
    const name = input.name.trim()

    if (!code || !name) {
      return { success: false, error: 'رقم الحساب واسم الحساب مطلوبان' }
    }

    // تحقق من عدم تكرار كود الحساب داخل المتجر
    const { data: existing } = await supabase
      .from('accounts')
      .select('id')
      .eq('store_id', storeId)
      .eq('code', code)
      .maybeSingle()

    if (existing) {
      return { success: false, error: `رقم الحساب (${code}) موجود مسبقاً، يرجى اختيار رقم فريد` }
    }

    // تحديد طبيعة الرصيد التلقائية إن لم تحدد
    let normalBalance = input.normal_balance
    if (!normalBalance) {
      normalBalance = (input.type === 'asset' || input.type === 'expense') ? 'debit' : 'credit'
    }

    const payload = {
      store_id: storeId,
      code,
      name,
      type: input.type,
      normal_balance: normalBalance,
      parent_id: input.parent_id || null,
      is_group: !!input.is_group,
      is_active: input.is_active !== undefined ? input.is_active : true,
      currency: input.currency || 'ILS',
      description: input.description?.trim() || null,
      balance: 0,
    }

    const { data: newAccount, error: insertErr } = await supabase
      .from('accounts')
      .insert(payload)
      .select('*')
      .single()

    if (insertErr) throw insertErr

    await logFinancialEvent({
      storeId,
      entityType: 'voucher', // use standard audit entity
      entityId: newAccount.id,
      entityLabel: `${newAccount.code} - ${newAccount.name}`,
      action: 'create',
      actorId: user.id,
      details: { account: payload },
    })

    revalidatePath('/dashboard/accounting/accounts')
    return { success: true, account: newAccount }
  } catch (err: any) {
    console.error('Error creating account:', err)
    return { success: false, error: err.message || 'فشل إنشاء الحساب' }
  }
}

/**
 * تعديل بيانات حساب محاسبي
 */
export async function updateAccount(input: UpdateAccountInput) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    // جلب الحساب الحالي
    const { data: currentAcc, error: accErr } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', input.id)
      .eq('store_id', storeId)
      .single()

    if (accErr || !currentAcc) return { success: false, error: 'الحساب غير موجود' }

    const code = input.code.trim()
    const name = input.name.trim()

    if (!code || !name) {
      return { success: false, error: 'رقم الحساب واسم الحساب مطلوبان' }
    }

    // منع الحساب من أن يكون أباً لنفسه
    if (input.parent_id && input.parent_id === input.id) {
      return { success: false, error: 'لا يمكن تعيين الحساب كأب لنفسه' }
    }

    // تحقق من عدم تكرار كود الحساب مع حساب آخر
    if (code !== currentAcc.code) {
      const { data: duplicate } = await supabase
        .from('accounts')
        .select('id')
        .eq('store_id', storeId)
        .eq('code', code)
        .neq('id', input.id)
        .maybeSingle()

      if (duplicate) {
        return { success: false, error: `رقم الحساب (${code}) مستخدم لحساب آخر بالفعل` }
      }
    }

    // التحقق من وجود حركات محاسبية سابقة
    const { count: txCount } = await supabase
      .from('journal_lines')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', input.id)

    const hasTransactions = (txCount || 0) > 0

    // قيود محاسبية صارمة إذا كان الحساب مستخدماً:
    if (hasTransactions) {
      // 1. لا يمكن تحويل حساب يحتوي على حركات إلى حساب تجميعي
      if (input.is_group && !currentAcc.is_group) {
        return {
          success: false,
          error: 'لا يمكن تحويل هذا الحساب إلى حساب تجميعي رئيسي لوجود قيود وحركات محاسبية مسجلة عليه.',
        }
      }

      // 2. لا يمكن تغيير نوع الحساب الرئيسي إذا كان مستخدماً حفاظاً على سلامة القوائم
      if (input.type !== currentAcc.type) {
        return {
          success: false,
          error: 'لا يمكن تعديل نوع الحساب (الأصل/الالتزام/الإيراد/...) لوجود حركات محاسبية مسجلة عليه حفاظاً على سلامة التقارير التاريخية.',
        }
      }
    }

    const payload: any = {
      code,
      name,
      parent_id: input.parent_id || null,
      description: input.description?.trim() || null,
      currency: input.currency || currentAcc.currency,
    }

    // إذا لم تكن هناك حركات، يسمح بتعديل النوع والطبيعة والصفة التجميعية
    if (!hasTransactions) {
      payload.type = input.type
      payload.normal_balance = input.normal_balance || (
        (input.type === 'asset' || input.type === 'expense') ? 'debit' : 'credit'
      )
      payload.is_group = !!input.is_group
    }

    if (input.is_active !== undefined) {
      payload.is_active = input.is_active
    }

    const { data: updated, error: updateErr } = await supabase
      .from('accounts')
      .update(payload)
      .eq('id', input.id)
      .select('*')
      .single()

    if (updateErr) throw updateErr

    await logFinancialEvent({
      storeId,
      entityType: 'voucher',
      entityId: updated.id,
      entityLabel: `${updated.code} - ${updated.name}`,
      action: 'update',
      actorId: user.id,
      details: { changes: payload },
    })

    revalidatePath('/dashboard/accounting/accounts')
    return { success: true, account: updated }
  } catch (err: any) {
    console.error('Error updating account:', err)
    return { success: false, error: err.message || 'فشل تعديل بيانات الحساب' }
  }
}

/**
 * تفعيل أو تعطيل حساب محاسبي
 */
export async function toggleAccountActive(id: string, isActive: boolean) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    const { data: acc, error: findErr } = await supabase
      .from('accounts')
      .select('id, code, name')
      .eq('id', id)
      .eq('store_id', storeId)
      .single()

    if (findErr || !acc) return { success: false, error: 'الحساب غير موجود' }

    const { error: updateErr } = await supabase
      .from('accounts')
      .update({ is_active: isActive })
      .eq('id', id)

    if (updateErr) throw updateErr

    await logFinancialEvent({
      storeId,
      entityType: 'voucher',
      entityId: acc.id,
      entityLabel: `${acc.code} - ${acc.name}`,
      action: 'status_change',
      actorId: user.id,
      details: { is_active: isActive },
    })

    revalidatePath('/dashboard/accounting/accounts')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'فشل تغيير حالة الحساب' }
  }
}

/**
 * حذف حساب محاسبي مع التحقق المشروط من عدم وجود عمليات أو حسابات فرعية
 */
export async function deleteAccount(id: string) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    const { data: acc, error: findErr } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', id)
      .eq('store_id', storeId)
      .single()

    if (findErr || !acc) return { success: false, error: 'الحساب غير موجود' }

    // 1. فحص هل الحساب من حسابات النظام الأساسية المحمية
    if (acc.is_system) {
      return {
        success: false,
        error: 'لا يمكن حذف حساب النظام الأساسي 🔒 لأنه مرتبط بالعمليات التشغيلية للنظام.',
      }
    }

    // 2. فحص هل يحتوي الحساب على حسابات فرعية (أبناء)
    const { count: childCount } = await supabase
      .from('accounts')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', id)

    if ((childCount || 0) > 0) {
      return {
        success: false,
        error: 'لا يمكن حذف هذا الحساب لأنه يحتوي على حسابات فرعية تابعة له. يرجى حذف أو نقل الحسابات الفرعية أولاً.',
      }
    }

    // 3. فحص هل توجد قيود يومية وحركات محاسبية مرتبطة بالحساب
    const { count: journalCount } = await supabase
      .from('journal_lines')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', id)

    if ((journalCount || 0) > 0) {
      return {
        success: false,
        error: 'لا يمكن حذف هذا الحساب لأنه مرتبط بعمليات محاسبية سابقة. يمكنك تعطيله بدلاً من حذفه للحفاظ على السجلات المالية.',
      }
    }

    // 4. فحص هل يرتبط الحساب بحساب بنكي
    const { count: bankCount } = await supabase
      .from('bank_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', id)

    if ((bankCount || 0) > 0) {
      return {
        success: false,
        error: 'لا يمكن حذف هذا الحساب لأنه مرتبط بحساب بنكي نشط في النظام.',
      }
    }

    // 5. إجراء الحذف الفعلي
    const { error: delErr } = await supabase
      .from('accounts')
      .delete()
      .eq('id', id)

    if (delErr) throw delErr

    await logFinancialEvent({
      storeId,
      entityType: 'voucher',
      entityId: acc.id,
      entityLabel: `${acc.code} - ${acc.name}`,
      action: 'delete',
      actorId: user.id,
      details: { deletedAccount: acc },
    })

    revalidatePath('/dashboard/accounting/accounts')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'فشل حذف الحساب' }
  }
}

/**
 * جلب كشف الحساب المباشر والتفصيلي لأي حساب من الشجرة
 */
export async function getAccountStatement(accountId: string, fromDate?: string, toDate?: string) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    // جلب الحساب
    const { data: acc, error: accErr } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .eq('store_id', storeId)
      .single()

    if (accErr || !acc) return { success: false, error: 'الحساب غير موجود' }

    let query = supabase
      .from('journal_lines')
      .select(`
        id,
        debit,
        credit,
        description,
        created_at,
        currency,
        entry:journal_entries!inner(id, entry_number, date, description, source, status, store_id)
      `)
      .eq('account_id', accountId)
      .eq('entry.store_id', storeId)
      .order('created_at', { ascending: true })

    if (fromDate) {
      query = query.gte('entry.date', fromDate)
    }
    if (toDate) {
      query = query.lte('entry.date', toDate)
    }

    const { data: lines, error: linesErr } = await query
    if (linesErr) throw linesErr

    // حساب الرصيد التراكمي بحسب طبيعة الحساب (مدين أو دائن)
    const isDebitNature = acc.normal_balance === 'debit' || acc.type === 'asset' || acc.type === 'expense'

    // 1. حساب الرصيد الافتتاحي (Opening Balance) ما قبل fromDate
    let openingBalance = 0
    if (fromDate) {
      const { data: priorLines, error: priorErr } = await supabase
        .from('journal_lines')
        .select('debit, credit, entry:journal_entries!inner(date, status, store_id)')
        .eq('account_id', accountId)
        .eq('entry.store_id', storeId)
        .lt('entry.date', fromDate)

      if (!priorErr && priorLines) {
        for (const pl of priorLines as any[]) {
          const d = Number(pl.debit || 0)
          const c = Number(pl.credit || 0)
          openingBalance += isDebitNature ? (d - c) : (c - d)
        }
      }
    }

    let runningBalance = openingBalance
    let totalDebit = 0
    let totalCredit = 0

    const statementRows = (lines || []).map((line: any) => {
      const debit = Number(line.debit || 0)
      const credit = Number(line.credit || 0)
      totalDebit += debit
      totalCredit += credit

      if (isDebitNature) {
        runningBalance += (debit - credit)
      } else {
        runningBalance += (credit - debit)
      }

      return {
        id: line.id,
        date: line.entry?.date || line.created_at?.slice(0, 10),
        entry_number: line.entry?.entry_number || 'قيد',
        entry_id: line.entry?.id,
        description: line.description || line.entry?.description || 'حركة محاسبية',
        source: line.entry?.source || 'manual',
        status: line.entry?.status || 'posted',
        debit,
        credit,
        balance: runningBalance,
      }
    })

    const lastMovementDate = statementRows.length > 0 ? statementRows[statementRows.length - 1].date : null

    return {
      success: true,
      account: acc,
      rows: statementRows,
      summary: {
        openingBalance,
        totalDebit,
        totalCredit,
        closingBalance: runningBalance,
        currentBalance: runningBalance,
        movementsCount: statementRows.length,
        lastMovementDate,
      },
    }
  } catch (err: any) {
    console.error('Error fetching statement:', err)
    return { success: false, error: err.message || 'فشل تحميل كشف الحساب' }
  }
}
