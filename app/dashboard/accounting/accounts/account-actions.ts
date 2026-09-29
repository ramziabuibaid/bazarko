'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { logFinancialEvent } from '@/lib/accounting/audit'
import { revalidatePath } from 'next/cache'

export interface AccountTagItem {
  id: string
  code: string
  name_ar: string
  name_en: string
  allowed_account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  description?: string | null
  is_active: boolean
}

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
  account_tag_id?: string | null
  account_tag?: string | null
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
  account_tag_id?: string | null
  account_tag?: string | null
}

/**
 * جلب قائمة وسوم الحسابات (Account Tags) المعرفة مسبقاً في النظام
 */
export async function getAccountTags(): Promise<AccountTagItem[]> {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('account_tags')
      .select('*')
      .eq('is_active', true)
      .order('allowed_account_type', { ascending: true })
      .order('code', { ascending: true })

    if (error) throw error
    return (data || []) as AccountTagItem[]
  } catch (err) {
    console.error('Error fetching account tags:', err)
    return []
  }
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

    // التحقق من توافق الرقم مع النوع الرئيسي
    const typeLeadingDigit: Record<string, string> = {
      asset: '1',
      liability: '2',
      equity: '3',
      revenue: '4',
      expense: '5',
    }
    const expectedDigit = typeLeadingDigit[input.type]
    if (expectedDigit && !code.startsWith(expectedDigit)) {
      return {
        success: false,
        error: `رقم الحساب (${code}) يجب أن يبدأ بالرقم (${expectedDigit}) ليتوافق مع التصنيف الرئيسي للمجموعة.`,
      }
    }

    // التحقق من صحة التسلسل والترقيم بالنسبة للحساب الأب
    if (input.parent_id) {
      const { data: parentAcc } = await supabase
        .from('accounts')
        .select('code, name')
        .eq('id', input.parent_id)
        .single()

      if (parentAcc) {
        const parentPrefix = parentAcc.code.replace(/0+$/, '') || parentAcc.code[0]
        if (!code.startsWith(parentPrefix)) {
          return {
            success: false,
            error: `رقم الحساب (${code}) لا يتطابق مع تسلسل الحساب الأب (${parentAcc.code} - ${parentAcc.name}). يجب أن يبدأ بالبادئة (${parentPrefix}).`,
          }
        }
      }
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
      account_tag_id: input.account_tag_id || null,
      account_tag: input.account_tag || null,
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

    // التحقق من توافق الرقم مع النوع الرئيسي
    const typeLeadingDigit: Record<string, string> = {
      asset: '1',
      liability: '2',
      equity: '3',
      revenue: '4',
      expense: '5',
    }
    const targetType = input.type || currentAcc.type
    const expectedDigit = typeLeadingDigit[targetType]
    if (expectedDigit && !code.startsWith(expectedDigit)) {
      return {
        success: false,
        error: `رقم الحساب (${code}) يجب أن يبدأ بالرقم (${expectedDigit}) ليتوافق مع التصنيف الرئيسي للمجموعة.`,
      }
    }

    // التحقق من صحة التسلسل والترقيم بالنسبة للحساب الأب
    const targetParentId = input.parent_id !== undefined ? input.parent_id : currentAcc.parent_id
    if (targetParentId) {
      const { data: parentAcc } = await supabase
        .from('accounts')
        .select('code, name')
        .eq('id', targetParentId)
        .single()

      if (parentAcc) {
        const parentPrefix = parentAcc.code.replace(/0+$/, '') || parentAcc.code[0]
        if (!code.startsWith(parentPrefix)) {
          return {
            success: false,
            error: `رقم الحساب (${code}) لا يتطابق مع تسلسل الحساب الأب (${parentAcc.code} - ${parentAcc.name}). يجب أن يبدأ بالبادئة (${parentPrefix}).`,
          }
        }
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

    if (input.account_tag_id !== undefined) {
      payload.account_tag_id = input.account_tag_id || null
    }
    if (input.account_tag !== undefined) {
      payload.account_tag = input.account_tag || null
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
    revalidatePath('/dashboard/accounting/statement')
    revalidatePath('/dashboard/accounting/chart-of-accounts')
    revalidatePath('/dashboard/accounting/journal')
    revalidatePath('/dashboard/accounting/vouchers')
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
export async function getAccountStatement(accountId: string, fromDate?: string, toDate?: string, source?: string) {
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
        entry:journal_entries!inner(id, entry_number, ref_id, date, description, source, status, store_id, source_type, source_id, source_number, source_url)
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
    if (source && source !== 'all') {
      if (source === 'manual') {
        query = query.or('source.eq.manual,source_type.eq.manual')
      } else if (source === 'voucher') {
        query = query.or('source.eq.voucher,source_type.in.(receipt_voucher,payment_voucher)')
      } else {
        query = query.eq('entry.source', source)
      }
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

      const entry = line.entry || {}
      const rawSource = entry.source || 'manual'
      const sourceType = entry.source_type || rawSource
      const sourceId = entry.source_id || entry.ref_id || null
      const isManual = sourceType === 'manual' || (!sourceId && rawSource === 'manual')

      // Resolve URL if missing
      let sourceUrl = entry.source_url || null
      if (!sourceUrl && sourceId) {
        if (sourceType === 'receipt_voucher' || (rawSource === 'voucher' && debit === 0)) {
          sourceUrl = `/dashboard/accounting/receipts/print/${sourceId}`
        } else if (sourceType === 'payment_voucher' || rawSource === 'voucher') {
          sourceUrl = `/dashboard/accounting/payments/print/${sourceId}`
        } else if (sourceType === 'sales_invoice' || rawSource === 'invoice') {
          sourceUrl = `/dashboard/accounting/invoices/${sourceId}`
        } else if (sourceType === 'purchase_invoice' || rawSource === 'purchase') {
          sourceUrl = `/dashboard/purchases/${sourceId}`
        } else if (sourceType === 'check_operation' || rawSource === 'check_op') {
          sourceUrl = `/dashboard/cheques/print/${sourceId}`
        } else if (sourceType === 'sales_return') {
          sourceUrl = `/dashboard/invoices/returns/print/${sourceId}`
        } else if (sourceType === 'purchase_return') {
          sourceUrl = `/dashboard/purchases/returns/print/${sourceId}`
        }
      }

      return {
        id: line.id,
        date: entry.date || line.created_at?.slice(0, 10),
        entry_number: entry.entry_number || 'قيد',
        entry_id: entry.id,
        ref_id: sourceId,
        source_id: sourceId,
        source: rawSource,
        source_type: sourceType,
        source_number: entry.source_number || null,
        source_url: sourceUrl,
        description: line.description || entry.description || 'حركة محاسبية',
        status: entry.status || 'posted',
        debit,
        credit,
        balance: runningBalance,
        is_manual: isManual,
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

/**
 * جلب تفاصيل قيد اليومية بالكامل مع تفاصيل الحركة الأصلية المرتبطة به
 */
export async function getJournalEntryFullDetails(entryId: string) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    const { data: entry, error: entryErr } = await supabase
      .from('journal_entries')
      .select('*, lines:journal_lines(*, account:accounts(code, name, type, normal_balance))')
      .eq('id', entryId)
      .eq('store_id', storeId)
      .single()

    if (entryErr || !entry) {
      return { success: false, error: 'القيد المحاسبي غير موجود' }
    }

    const sourceType = entry.source_type || entry.source || 'manual'
    const sourceId = entry.source_id || entry.ref_id || null
    let originDetails: any = null

    // جلب بيانات الحركة الأصلية بحسب نوعها
    if (sourceId) {
      if (sourceType === 'receipt_voucher' || sourceType === 'payment_voucher' || entry.source === 'voucher') {
        const { data: v } = await supabase
          .from('vouchers')
          .select('id, voucher_number, type, date, amount, party_name, payment_method, category, description, cash_box_id, bank_account_id, cash_boxes(name), bank_accounts(bank_name)')
          .eq('id', sourceId)
          .maybeSingle()
        if (v) {
          originDetails = {
            kind: v.type === 'receipt' ? 'سند قبض مالي' : 'سند صرف مالي',
            number: v.voucher_number,
            date: v.date,
            party: v.party_name,
            amount: v.amount,
            method: v.payment_method,
            description: v.description,
            destination: (Array.isArray(v.cash_boxes) ? v.cash_boxes[0]?.name : (v.cash_boxes as any)?.name) ||
                         (Array.isArray(v.bank_accounts) ? v.bank_accounts[0]?.bank_name : (v.bank_accounts as any)?.bank_name) ||
                         'خزينة المتجر',
            url: v.type === 'receipt' ? `/dashboard/accounting/receipts/print/${v.id}` : `/dashboard/accounting/payments/print/${v.id}`,
            actionLabel: v.type === 'receipt' ? 'فتح سند القبض الأصلي' : 'فتح سند الصرف الأصلي',
          }
        }
      } else if (sourceType === 'sales_invoice' || entry.source === 'invoice') {
        const { data: inv } = await supabase
          .from('invoices')
          .select('id, invoice_number, issue_date, total, status, customer_name, payment_method')
          .eq('id', sourceId)
          .maybeSingle()
        if (inv) {
          originDetails = {
            kind: 'فاتورة مبيعات',
            number: inv.invoice_number,
            date: inv.issue_date,
            party: inv.customer_name || 'عميل نقدي',
            amount: inv.total,
            method: inv.payment_method,
            status: inv.status,
            url: `/dashboard/accounting/invoices/${inv.id}`,
            actionLabel: 'فتح فاتورة المبيعات الأصلية',
          }
        }
      } else if (sourceType === 'purchase_invoice' || entry.source === 'purchase') {
        const { data: p } = await supabase
          .from('purchase_invoices')
          .select('id, invoice_number, invoice_date, total_amount, payment_status, supplier_id, suppliers(name)')
          .eq('id', sourceId)
          .maybeSingle()
        if (p) {
          originDetails = {
            kind: 'فاتورة مشتريات',
            number: p.invoice_number,
            date: p.invoice_date,
            party: (p.suppliers as any)?.name || 'مورد',
            amount: p.total_amount,
            status: p.payment_status,
            url: `/dashboard/purchases/${p.id}`,
            actionLabel: 'فتح فاتورة المشتريات الأصلية',
          }
        }
      } else if (sourceType === 'sales_return') {
        const { data: sr } = await supabase
          .from('sales_returns')
          .select('id, return_number, return_date, total_amount, reason, customers(name)')
          .eq('id', sourceId)
          .maybeSingle()
        if (sr) {
          originDetails = {
            kind: 'مردود مبيعات',
            number: sr.return_number,
            date: sr.return_date,
            party: (sr.customers as any)?.name || 'العميل',
            amount: sr.total_amount,
            description: sr.reason,
            url: `/dashboard/invoices/returns/print/${sr.id}`,
            actionLabel: 'فتح مردود المبيعات الأصلي',
          }
        }
      } else if (sourceType === 'purchase_return') {
        const { data: pr } = await supabase
          .from('purchase_returns')
          .select('id, return_number, return_date, total_amount, reason, suppliers(name)')
          .eq('id', sourceId)
          .maybeSingle()
        if (pr) {
          originDetails = {
            kind: 'مردود مشتريات',
            number: pr.return_number,
            date: pr.return_date,
            party: (pr.suppliers as any)?.name || 'المورد',
            amount: pr.total_amount,
            description: pr.reason,
            url: `/dashboard/purchases/returns/print/${pr.id}`,
            actionLabel: 'فتح مردود المشتريات الأصلي',
          }
        }
      } else if (sourceType === 'check_operation' || entry.source === 'check_op') {
        const { data: c } = await supabase
          .from('checks')
          .select('id, check_number, bank_name, branch_name, amount, due_date, status, drawer_name')
          .eq('id', sourceId)
          .maybeSingle()
        if (c) {
          originDetails = {
            kind: 'حركة شيك مالي',
            number: `شيك #${c.check_number}`,
            date: c.due_date,
            party: c.drawer_name || 'الساحب',
            amount: c.amount,
            destination: `${c.bank_name} - ${c.branch_name || ''}`,
            status: c.status,
            url: `/dashboard/cheques/print/${c.id}`,
            actionLabel: 'عرض بطاقة وحركة الشيك الأصلية',
          }
        }
      } else if (sourceType === 'inventory_movement') {
        originDetails = {
          kind: 'حركة مخزون مستودعية',
          number: entry.source_number || entry.entry_number,
          date: entry.date,
          url: '/dashboard/inventory/movements',
          actionLabel: 'فتح سجل حركات المخزون',
        }
      } else if (sourceType === 'treasury_transfer') {
        originDetails = {
          kind: 'تحويل نقدي بين الصناديق',
          number: entry.source_number || entry.entry_number,
          date: entry.date,
          url: '/dashboard/accounting/treasury',
          actionLabel: 'فتح سجل الخزينة والتحويلات',
        }
      }
    }

    const isManual = sourceType === 'manual' || (!originDetails && !sourceId)

    return {
      success: true,
      entry,
      lines: entry.lines || [],
      origin: originDetails,
      isManual,
    }
  } catch (err: any) {
    console.error('Error fetching journal details:', err)
    return { success: false, error: err.message || 'فشل جلب تفاصيل القيد' }
  }
}
