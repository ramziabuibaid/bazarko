'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { requireStorePermission } from '@/lib/supabase/permissions'
import { revalidatePath } from 'next/cache'

export async function executeBankTransferAction(payload: {
  bankId: string
  amount: number
  isDeposit: boolean
  notes?: string
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'غير مصرح' }

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

  // فرض الصلاحية المالية المركزية بالخادم
  await requireStorePermission(storeId, 'finance.write')

  if (!payload.amount || payload.amount <= 0) {
    return { ok: false, error: 'أدخل مبلغاً صحيحاً أكبر من الصفر' }
  }

  // جلب الحساب البنكي
  const { data: bank } = await supabase
    .from('bank_accounts')
    .select('id, bank_name, account_number, balance')
    .eq('id', payload.bankId)
    .eq('store_id', storeId)
    .single()

  if (!bank) return { ok: false, error: 'الحساب البنكي غير موجود' }

  // جلب الصندوق النقدي الفعال المتوافق
  const { data: cashBox } = await supabase
    .from('cash_boxes')
    .select('id, name')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .eq('type', 'cash')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!cashBox) return { ok: false, error: 'لا يوجد صندوق نقدي نشط متاح للمتجر' }

  if (!payload.isDeposit && Number(bank.balance || 0) < payload.amount) {
    return { ok: false, error: 'الرصيد في الحساب البنكي غير كافٍ لإتمام عملية السحب' }
  }

  const newBankBal = payload.isDeposit
    ? Number(bank.balance || 0) + payload.amount
    : Number(bank.balance || 0) - payload.amount

  // فحص التزامن المتفائل لمنع الكتابة فوق العمليات المتزامنة (Race Conditions)
  const { data: updatedBank, error: bankErr } = await supabase
    .from('bank_accounts')
    .update({ balance: newBankBal, updated_at: new Date().toISOString() })
    .eq('id', bank.id)
    .eq('balance', bank.balance)
    .select('id, balance')
    .maybeSingle()

  if (bankErr || !updatedBank) {
    return { ok: false, error: 'تعذر إتمام التحويل بسبب تعارض في تحديث الرصيد بالتزامن، يرجى إعادة المحاولة' }
  }

  const desc = payload.notes || (payload.isDeposit
    ? `إيداع نقدي في البنك (${bank.bank_name})`
    : `سحب نقدي من البنك (${bank.bank_name})`)

  const { error: movErr } = await supabase.from('cash_movements').insert({
    store_id: storeId,
    cash_box_id: cashBox.id,
    direction: payload.isDeposit ? 'out' : 'in',
    amount: payload.amount,
    source: 'transfer',
    party_name: `${bank.bank_name} (${bank.account_number})`,
    payment_method: 'bank',
    description: desc,
    date: new Date().toISOString().slice(0, 10),
    created_by: user.id,
  })

  if (movErr) {
    console.error('Failed to insert cash movement for bank transfer:', movErr)
    // Rollback bank balance
    await supabase
      .from('bank_accounts')
      .update({ balance: bank.balance, updated_at: new Date().toISOString() })
      .eq('id', bank.id)
    return { ok: false, error: movErr.message || 'فشل تسجيل حركة التحويل في الصندوق' }
  }

  revalidatePath('/dashboard/banks')
  revalidatePath('/dashboard/accounting/treasury')
  return { ok: true, newBalance: newBankBal }
}

export async function toggleBankAccountAction(bankId: string, nextActive: boolean) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'غير مصرح' }

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

  await requireStorePermission(storeId, 'finance.write')

  const { error } = await supabase
    .from('bank_accounts')
    .update({ is_active: nextActive, updated_at: new Date().toISOString() })
    .eq('id', bankId)
    .eq('store_id', storeId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/dashboard/banks')
  return { ok: true }
}

export async function saveBankAccountAction(bankData: {
  id?: string
  bank_code?: string
  bank_name: string
  branch_code?: string
  branch_name?: string
  account_number: string
  account_name: string
  currency: string
  iban?: string | null
  account_type?: string
  account_id?: string | null
  opening_balance?: string | number
  notes?: string | null
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'غير مصرح' }

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

  await requireStorePermission(storeId, 'finance.write')

  if (!bankData.account_number?.trim() || !bankData.account_name?.trim()) {
    return { ok: false, error: 'يرجى كتابة رقم الحساب واسم الحساب' }
  }

  const openBal = Number(bankData.opening_balance) || 0

  if (bankData.id) {
    const { data: updated, error } = await supabase
      .from('bank_accounts')
      .update({
        bank_code: bankData.bank_code,
        bank_name: bankData.bank_name,
        branch_code: bankData.branch_code,
        branch_name: bankData.branch_name,
        account_number: bankData.account_number.trim(),
        account_name: bankData.account_name.trim(),
        currency: bankData.currency,
        iban: bankData.iban?.trim() || null,
        account_type: bankData.account_type,
        account_id: bankData.account_id || null,
        notes: bankData.notes?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bankData.id)
      .eq('store_id', storeId)
      .select('*, account:accounts(id, code, name)')
      .single()

    if (error) return { ok: false, error: error.message }
    revalidatePath('/dashboard/banks')
    return { ok: true, data: updated }
  } else {
    let coaAccountId = bankData.account_id || null

    if (!coaAccountId) {
      const accountCode = `1120-${bankData.bank_code || ''}${bankData.account_number.slice(-4)}`
      const { data: coaAccount } = await supabase
        .from('accounts')
        .insert({
          store_id: storeId,
          code: accountCode,
          name: `${bankData.bank_name} - ${bankData.account_number}`,
          type: 'asset',
          is_group: false,
          currency: bankData.currency,
          balance: openBal,
        })
        .select('id, code, name')
        .single()

      if (coaAccount) coaAccountId = coaAccount.id
    }

    const { data: newBank, error } = await supabase
      .from('bank_accounts')
      .insert({
        store_id: storeId,
        bank_code: bankData.bank_code,
        bank_name: bankData.bank_name,
        branch_code: bankData.branch_code,
        branch_name: bankData.branch_name,
        account_number: bankData.account_number.trim(),
        account_name: bankData.account_name.trim(),
        currency: bankData.currency,
        iban: bankData.iban?.trim() || null,
        account_type: bankData.account_type,
        account_id: coaAccountId,
        opening_balance: openBal,
        balance: openBal,
        is_active: true,
        notes: bankData.notes?.trim() || null,
      })
      .select('*, account:accounts(id, code, name)')
      .single()

    if (error) return { ok: false, error: error.message }
    revalidatePath('/dashboard/banks')
    return { ok: true, data: newBank }
  }
}
