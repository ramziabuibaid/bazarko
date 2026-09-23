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
 * دالة مساعدة لضمان وجود الحساب المحاسبي في شجرة الحسابات
 */
async function getOrCreateAccount(
  supabase: any,
  storeId: string,
  code: string,
  name: string,
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense',
  normalBalance: 'debit' | 'credit' = 'debit'
): Promise<string> {
  const { data: existing } = await supabase
    .from('accounts')
    .select('id')
    .eq('store_id', storeId)
    .eq('code', code)
    .maybeSingle()

  if (existing) return existing.id

  const { data: created, error } = await supabase
    .from('accounts')
    .insert({
      store_id: storeId,
      code,
      name,
      type,
      normal_balance: normalBalance,
      currency: 'ILS',
      is_active: true,
      balance: 0,
    })
    .select('id')
    .single()

  if (error || !created) {
    // في حال حصل تعارض متزامن
    const { data: retry } = await supabase
      .from('accounts')
      .select('id')
      .eq('store_id', storeId)
      .eq('code', code)
      .single()
    return retry?.id
  }

  return created.id
}

/**
 * معاينة القيد المحاسبي قبل التنفيذ (للتأكيد من قبل المستخدم)
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

    const { data: check } = await supabase
      .from('checks')
      .select('*, customer:customers(id, name), supplier:suppliers(id, name)')
      .eq('id', input.checkId)
      .eq('store_id', storeId)
      .single()

    if (!check) return { success: false, error: 'الشيك غير موجود' }

    let debitName = ''
    let debitCode = ''
    let creditName = ''
    let creditCode = ''
    let toStatus = check.status
    let desc = ''

    const amount = Number(check.amount_ils || check.amount || 0)
    const currency = check.currency || 'ILS'
    const date = input.operationDate || new Date().toISOString().slice(0, 10)

    if (input.operationType === 'deposit') {
      toStatus = 'deposited'
      let bankTitle = 'البنك'
      if (input.targetBankAccountId) {
        const { data: bank } = await supabase.from('bank_accounts').select('bank_name, account_number').eq('id', input.targetBankAccountId).single()
        if (bank) bankTitle = `${bank.bank_name} (${bank.account_number})`
      }
      debitName = `شيكات برسم التحصيل — ${bankTitle}`
      debitCode = '1121'
      creditName = 'أوراق قبض / محفظة الشيكات الواردة'
      creditCode = '1120'
      desc = `إيداع شيك رقم ${check.check_number} برسم التحصيل لدى ${bankTitle}`
    } else if (input.operationType === 'collect') {
      toStatus = 'collected'
      let bankTitle = 'الحساب البنكي'
      if (input.targetBankAccountId) {
        const { data: bank } = await supabase.from('bank_accounts').select('bank_name, account_number').eq('id', input.targetBankAccountId).single()
        if (bank) bankTitle = `${bank.bank_name} (${bank.account_number})`
      }
      debitName = `حساب البنك الجاري — ${bankTitle}`
      debitCode = '1112'
      if (check.status === 'deposited') {
        creditName = 'شيكات برسم التحصيل'
        creditCode = '1121'
      } else {
        creditName = 'أوراق قبض / محفظة الشيكات الواردة'
        creditCode = '1120'
      }
      desc = `تحصيل وقيد شيك رقم ${check.check_number} في ${bankTitle}`
    } else if (input.operationType === 'bounce') {
      toStatus = 'bounced'
      debitName = 'شيكات راجعة ومرفوضة (تحت التحصيل القانوني)'
      debitCode = '1122'
      if (check.status === 'collected') {
        debitName = 'شيكات راجعة / ذمة العميل'
        creditName = 'حساب البنك (عكس قيد التحصيل)'
        creditCode = '1112'
      } else {
        creditName = 'شيكات برسم التحصيل'
        creditCode = '1121'
      }
      desc = `إثبات ارتداد شيك راجع رقم ${check.check_number} من ${check.bank_name}`
    } else if (input.operationType === 'return_to_customer') {
      toStatus = 'returned_to_customer'
      debitName = `ذمم العملاء — ${check.customer?.name || check.drawer_name || 'العميل'}`
      debitCode = '1131'
      creditName = 'شيكات راجعة ومرفوضة'
      creditCode = '1122'
      desc = `إعادة الشيك الراجع رقم ${check.check_number} للعميل وإثبات الذمة عليه`
    } else if (input.operationType === 'recollect') {
      toStatus = 'in_portfolio'
      debitName = 'أوراق قبض / محفظة الشيكات الواردة'
      debitCode = '1120'
      creditName = 'شيكات راجعة ومرفوضة'
      creditCode = '1122'
      desc = `إعادة استلام وقبض الشيك رقم ${check.check_number} بعد معالجة وضعه`
    } else if (input.operationType === 'endorse') {
      toStatus = 'endorsed'
      let suppName = 'المورد'
      if (input.targetSupplierId) {
        const { data: supp } = await supabase.from('suppliers').select('name').eq('id', input.targetSupplierId).single()
        if (supp) suppName = supp.name
      }
      debitName = `ذمم الموردين — تخفيض حساب ${suppName}`
      debitCode = '2111'
      creditName = 'أوراق قبض / محفظة الشيكات الواردة'
      creditCode = '1120'
      desc = `تجيير شيك رقم ${check.check_number} لصالح المورد ${suppName}`
    } else if (input.operationType === 'supplier_return') {
      toStatus = 'supplier_returned'
      let suppName = 'المورد'
      if (check.endorsed_supplier_id) {
        const { data: supp } = await supabase.from('suppliers').select('name').eq('id', check.endorsed_supplier_id).single()
        if (supp) suppName = supp.name
      }
      debitName = 'شيكات راجعة / محفظة الشيكات المرتدة'
      debitCode = '1122'
      creditName = `ذمم الموردين — إعادة قيد الذمة لصالح ${suppName}`
      creditCode = '2111'
      desc = `استلام شيك مجير راجع رقم ${check.check_number} من المورد ${suppName}`
    }

    return {
      success: true,
      preview: {
        debitAccountName: debitName,
        debitAccountCode: debitCode,
        creditAccountName: creditName,
        creditAccountCode: creditCode,
        amount,
        currency,
        date,
        description: desc,
        operationType: input.operationType,
        fromStatus: check.status,
        toStatus,
      },
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'فشل توليد معاينة القيد' }
  }
}

/**
 * تنفيذ العملية على دورة حياة الشيك وقيد اليومية المحاسبية المزدوجة
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

    const { data: check } = await supabase
      .from('checks')
      .select('*, customer:customers(id, name), supplier:suppliers(id, name)')
      .eq('id', input.checkId)
      .eq('store_id', storeId)
      .single()

    if (!check) return { success: false, error: 'الشيك غير موجود' }

    const amount = Number(check.amount_ils || check.amount || 0)
    const date = input.operationDate || new Date().toISOString().slice(0, 10)

    let debitAccountId = ''
    let creditAccountId = ''
    let nextStatus = check.status
    let targetBankId: string | null = null
    let targetSupplierId: string | null = null
    let opDesc = ''

    // 1. تحديد الحسابات والحالة القادمة وفق دورة الحياة
    if (input.operationType === 'deposit') {
      if (!input.targetBankAccountId) {
        return { success: false, error: 'يجب تحديد البنك المودع به برسم التحصيل بشكل صريح' }
      }
      nextStatus = 'deposited'
      targetBankId = input.targetBankAccountId

      const { data: bank } = await supabase.from('bank_accounts').select('*').eq('id', targetBankId).single()
      const bankTitle = bank ? `${bank.bank_name} (${bank.account_number})` : 'البنك'

      debitAccountId = await getOrCreateAccount(supabase, storeId, '1121', 'شيكات برسم التحصيل', 'asset', 'debit')
      creditAccountId = await getOrCreateAccount(supabase, storeId, '1120', 'أوراق قبض / محفظة الشيكات', 'asset', 'debit')
      opDesc = `إيداع شيك رقم ${check.check_number} برسم التحصيل لدى ${bankTitle}`
    } else if (input.operationType === 'collect') {
      if (!input.targetBankAccountId) {
        return { success: false, error: 'يجب اختيار الحساب البنكي الفعلي للتحصيل والإيداع' }
      }
      nextStatus = 'collected'
      targetBankId = input.targetBankAccountId

      const { data: bank } = await supabase.from('bank_accounts').select('*').eq('id', targetBankId).single()
      if (!bank) return { success: false, error: 'الحساب البنكي المحدد غير موجود' }

      if (bank.account_id) {
        debitAccountId = bank.account_id
      } else {
        debitAccountId = await getOrCreateAccount(
          supabase,
          storeId,
          `1112-${bank.bank_code || '01'}`,
          `بنك - ${bank.bank_name} (${bank.account_number})`,
          'asset',
          'debit'
        )
        await supabase.from('bank_accounts').update({ account_id: debitAccountId }).eq('id', bank.id)
      }

      if (check.status === 'deposited') {
        creditAccountId = await getOrCreateAccount(supabase, storeId, '1121', 'شيكات برسم التحصيل', 'asset', 'debit')
      } else {
        creditAccountId = await getOrCreateAccount(supabase, storeId, '1120', 'أوراق قبض / محفظة الشيكات', 'asset', 'debit')
      }

      // زيادة رصيد البنك
      const newBankBal = Number(bank.balance || 0) + amount
      await supabase.from('bank_accounts').update({ balance: newBankBal }).eq('id', bank.id)
      opDesc = `تحصيل وإيداع شيك رقم ${check.check_number} في بنك ${bank.bank_name} (${bank.account_number})`
    } else if (input.operationType === 'bounce') {
      nextStatus = 'bounced'
      debitAccountId = await getOrCreateAccount(supabase, storeId, '1122', 'شيكات راجعة ومرفوضة', 'asset', 'debit')

      if (check.status === 'collected' && check.deposit_bank_account_id) {
        const { data: bank } = await supabase.from('bank_accounts').select('*').eq('id', check.deposit_bank_account_id).single()
        if (bank?.account_id) {
          creditAccountId = bank.account_id
        } else {
          creditAccountId = await getOrCreateAccount(supabase, storeId, '1112', 'حسابات البنوك الجارية', 'asset', 'debit')
        }
        if (bank) {
          await supabase.from('bank_accounts').update({ balance: Number(bank.balance || 0) - amount }).eq('id', bank.id)
        }
      } else {
        creditAccountId = await getOrCreateAccount(supabase, storeId, '1121', 'شيكات برسم التحصيل', 'asset', 'debit')
      }
      opDesc = `ارتداد شيك راجع رقم ${check.check_number} من ${check.bank_name}`
    } else if (input.operationType === 'return_to_customer') {
      nextStatus = 'returned_to_customer'
      debitAccountId = await getOrCreateAccount(supabase, storeId, '1131', 'ذمم العملاء المدينين', 'asset', 'debit')
      creditAccountId = await getOrCreateAccount(supabase, storeId, '1122', 'شيكات راجعة ومرفوضة', 'asset', 'debit')

      // إعادة قيد الذمة على العميل
      if (check.customer_id) {
        const { data: cust } = await supabase.from('customers').select('balance').eq('id', check.customer_id).single()
        if (cust) {
          const newCustBal = Number(cust.balance || 0) + amount
          await supabase.from('customers').update({ balance: newCustBal }).eq('id', check.customer_id)
          await supabase.from('customer_ledger').insert({
            store_id: storeId,
            customer_id: check.customer_id,
            type: 'invoice',
            date,
            description: `إعادة قيد ذمة بسبب شيك راجع رقم ${check.check_number}`,
            debit: amount,
            credit: 0,
            balance: newCustBal,
            reference_id: check.id,
            reference_type: 'check',
            created_by: user.id,
          })
        }
      }
      opDesc = `إعادة الشيك الراجع رقم ${check.check_number} إلى العميل`
    } else if (input.operationType === 'recollect') {
      nextStatus = 'in_portfolio'
      debitAccountId = await getOrCreateAccount(supabase, storeId, '1120', 'أوراق قبض / محفظة الشيكات', 'asset', 'debit')
      creditAccountId = await getOrCreateAccount(supabase, storeId, '1122', 'شيكات راجعة ومرفوضة', 'asset', 'debit')
      opDesc = `إعادة استلام وقبض الشيك رقم ${check.check_number} في المحفظة`
    } else if (input.operationType === 'endorse') {
      if (!input.targetSupplierId) {
        return { success: false, error: 'يجب اختيار المورد الذي سيتم تجيير الشيك لصالحه صراحة' }
      }
      nextStatus = 'endorsed'
      targetSupplierId = input.targetSupplierId

      const { data: supp } = await supabase.from('suppliers').select('*').eq('id', targetSupplierId).single()
      if (!supp) return { success: false, error: 'المورد غير موجود' }

      debitAccountId = await getOrCreateAccount(supabase, storeId, '2111', 'ذمم الموردين والدائنين', 'liability', 'credit')
      creditAccountId = await getOrCreateAccount(supabase, storeId, '1120', 'أوراق قبض / محفظة الشيكات', 'asset', 'debit')

      // تخفيض ذمة المورد
      const newSuppBal = Number(supp.balance || 0) - amount
      await supabase.from('suppliers').update({ balance: newSuppBal }).eq('id', targetSupplierId)
      opDesc = `تجيير شيك رقم ${check.check_number} لصالح المورد ${supp.name}`
    } else if (input.operationType === 'supplier_return') {
      nextStatus = 'supplier_returned'
      const endorsedSuppId = check.endorsed_supplier_id || input.targetSupplierId
      targetSupplierId = endorsedSuppId

      debitAccountId = await getOrCreateAccount(supabase, storeId, '1122', 'شيكات راجعة ومرفوضة', 'asset', 'debit')
      creditAccountId = await getOrCreateAccount(supabase, storeId, '2111', 'ذمم الموردين والدائنين', 'liability', 'credit')

      // إعادة قيد الذمة للمورد
      if (endorsedSuppId) {
        const { data: supp } = await supabase.from('suppliers').select('balance, name').eq('id', endorsedSuppId).single()
        if (supp) {
          const newSuppBal = Number(supp.balance || 0) + amount
          await supabase.from('suppliers').update({ balance: newSuppBal }).eq('id', endorsedSuppId)
          opDesc = `استلام شيك مجير راجع رقم ${check.check_number} من المورد ${supp.name}`
        }
      }
    }

    // 2. إنشاء قيد اليومية المزدوج (Double-Entry Journal Entry)
    const entryNumber = `JV-CHK-${Date.now().toString().slice(-7)}`
    const { data: jEntry, error: jErr } = await supabase
      .from('journal_entries')
      .insert({
        store_id: storeId,
        entry_number: entryNumber,
        date,
        description: input.notes ? `${opDesc} — ${input.notes}` : opDesc,
        source: 'check_op',
        ref_id: check.id,
        status: 'posted',
        created_by: user.id,
      })
      .select('id')
      .single()

    if (jErr || !jEntry) {
      console.error('Failed to create journal entry for check operation:', jErr)
    }

    if (jEntry && debitAccountId && creditAccountId) {
      await supabase.from('journal_lines').insert([
        {
          journal_entry_id: jEntry.id,
          account_id: debitAccountId,
          debit: amount,
          credit: 0,
          currency: check.currency || 'ILS',
          exchange_rate: Number(check.exchange_rate || 1),
          description: opDesc,
          sort_order: 1,
        },
        {
          journal_entry_id: jEntry.id,
          account_id: creditAccountId,
          debit: 0,
          credit: amount,
          currency: check.currency || 'ILS',
          exchange_rate: Number(check.exchange_rate || 1),
          description: opDesc,
          sort_order: 2,
        },
      ])
    }

    // 3. تسجيل سجل دقيق في check_operations
    const { error: opErr } = await supabase.from('check_operations').insert({
      store_id: storeId,
      check_id: check.id,
      operation_type: input.operationType,
      from_status: check.status,
      to_status: nextStatus,
      operation_date: date,
      target_bank_account_id: targetBankId || check.deposit_bank_account_id,
      target_supplier_id: targetSupplierId || check.endorsed_supplier_id,
      journal_entry_id: jEntry?.id || null,
      notes: input.notes?.trim() || opDesc,
      performed_by: user.id,
    })

    if (opErr) console.error('check_operations insert error:', opErr)

    // 4. تحديث سجل الشيك الأصلي
    const { error: updateErr } = await supabase
      .from('checks')
      .update({
        status: nextStatus,
        deposit_bank_account_id: targetBankId || check.deposit_bank_account_id,
        endorsed_supplier_id: targetSupplierId || check.endorsed_supplier_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', check.id)

    if (updateErr) throw updateErr

    revalidatePath('/dashboard/cheques')
    revalidatePath('/dashboard/accounting/statement')
    revalidatePath('/dashboard/accounting/journal')

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
      .select('*, target_bank:bank_accounts(bank_name, account_number), target_supp:suppliers(name), journal_entry:journal_entries(entry_number)')
      .eq('check_id', checkId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return { success: true, operations: operations || [] }
  } catch (err: any) {
    return { success: false, error: err.message, operations: [] }
  }
}
