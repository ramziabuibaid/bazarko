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

  // جلب الصندوق الافتراضي
  const { data: cashBox } = await supabase
    .from('cash_boxes')
    .select('id, name')
    .eq('store_id', storeId)
    .limit(1)
    .single()

  if (!cashBox) return { ok: false, error: 'لا يوجد صندوق نقدي متاح للمتجر' }

  const newBankBal = payload.isDeposit
    ? Number(bank.balance || 0) + payload.amount
    : Number(bank.balance || 0) - payload.amount

  const { error: bankErr } = await supabase
    .from('bank_accounts')
    .update({ balance: newBankBal, updated_at: new Date().toISOString() })
    .eq('id', bank.id)

  if (bankErr) return { ok: false, error: bankErr.message || 'فشل تحديث الرصيد البنكي' }

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

export async function saveBankAccountAction(bankData: any) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'غير مصرح' }

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

  await requireStorePermission(storeId, 'finance.write')

  if (bankData.id) {
    const { error } = await supabase
      .from('bank_accounts')
      .update({
        bank_name: bankData.bank_name,
        branch_name: bankData.branch_name,
        account_number: bankData.account_number,
        currency: bankData.currency,
        iban: bankData.iban,
        notes: bankData.notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bankData.id)
      .eq('store_id', storeId)

    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await supabase
      .from('bank_accounts')
      .insert({
        store_id: storeId,
        bank_name: bankData.bank_name,
        branch_name: bankData.branch_name,
        account_number: bankData.account_number,
        currency: bankData.currency,
        iban: bankData.iban,
        balance: bankData.balance || 0,
        notes: bankData.notes,
      })

    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/dashboard/banks')
  return { ok: true }
}
