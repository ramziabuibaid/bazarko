'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { getDefaultCashBox, getCashBalance } from '@/lib/accounting/treasury'
import { logFinancialEvent } from '@/lib/accounting/audit'
import { revalidatePath } from 'next/cache'

type Result = { ok: boolean; error?: string }

async function resolve(cashBoxId?: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'غير مصرح' as const }

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return { error: 'المتجر غير موجود' as const }

  let box = null
  if (cashBoxId) {
    const { data: found } = await supabase
      .from('cash_boxes')
      .select('id, name, type, opening_balance, account_id')
      .eq('id', cashBoxId)
      .eq('store_id', storeId)
      .maybeSingle()
    box = found
  }

  if (!box) {
    box = await getDefaultCashBox(supabase, storeId)
  }

  if (!box) return { error: 'تعذّر تجهيز الصندوق' as const }

  return { supabase, user, storeId, box }
}

// ── إيداع/سحب يدوي ──────────────────────────────────────────────
export async function recordManualMovement(
  direction: 'in' | 'out',
  amount: number,
  description: string,
  paymentMethod: 'cash' | 'bank' | 'card' | 'transfer' = 'cash',
  cashBoxId?: string,
): Promise<Result> {
  if (!(amount > 0)) return { ok: false, error: 'أدخل مبلغاً صحيحاً' }
  if (!description.trim()) return { ok: false, error: 'أدخل وصفاً للحركة' }

  const r = await resolve(cashBoxId)

  if ('error' in r) return { ok: false, error: r.error }
  const { supabase, user, storeId, box } = r

  const { data: mov, error } = await supabase
    .from('cash_movements')
    .insert({
      store_id:       storeId,
      cash_box_id:    box.id,
      direction,
      amount,
      source:         'manual',
      payment_method: paymentMethod,
      description:    description.trim(),
      date:           new Date().toISOString().split('T')[0],
      created_by:     user.id,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: 'فشل تسجيل الحركة' }

  await logFinancialEvent({
    storeId, entityType: 'cash_movement', entityId: mov?.id,
    entityLabel: direction === 'in' ? 'إيداع' : 'سحب',
    action: 'create', actorId: user.id,
    details: { direction, amount, description: description.trim() },
  })

  revalidatePath('/dashboard/accounting/treasury')
  return { ok: true }
}

// ── تعديل الرصيد الافتتاحي ───────────────────────────────────────
export async function setOpeningBalance(amount: number, cashBoxId?: string): Promise<Result> {
  if (amount < 0) return { ok: false, error: 'الرصيد لا يكون سالباً' }

  const r = await resolve(cashBoxId)
  if ('error' in r) return { ok: false, error: r.error }
  const { supabase, user, storeId, box } = r

  const { error } = await supabase
    .from('cash_boxes')
    .update({ opening_balance: amount })
    .eq('id', box.id)

  if (error) return { ok: false, error: 'فشل تحديث الرصيد الافتتاحي' }

  await logFinancialEvent({
    storeId, entityType: 'cash_session', entityId: box.id,
    entityLabel: 'رصيد افتتاحي', action: 'update', actorId: user.id,
    details: { from: box.opening_balance, to: amount },
  })

  revalidatePath('/dashboard/accounting/treasury')
  return { ok: true }
}

// ── إغلاق اليومية + مطابقة الرصيد الفعلي ────────────────────────
export async function closeDailySession(
  countedAmount: number,
  notes: string,
  adjustToActual: boolean,
  cashBoxId?: string,
): Promise<Result> {
  if (countedAmount < 0) return { ok: false, error: 'المبلغ المعدود غير صحيح' }

  const r = await resolve(cashBoxId)
  if ('error' in r) return { ok: false, error: r.error }
  const { supabase, user, storeId, box } = r

  const systemTotal = await getCashBalance(supabase, storeId, box.id, box.opening_balance)
  const variance = countedAmount - systemTotal

  // مجاميع اليوم
  const today = new Date().toISOString().split('T')[0]
  const { data: todays } = await supabase
    .from('cash_movements')
    .select('direction, amount')
    .eq('store_id', storeId)
    .eq('cash_box_id', box.id)
    .eq('date', today)

  const totalIn  = (todays ?? []).filter(m => m.direction === 'in').reduce((s, m) => s + m.amount, 0)
  const totalOut = (todays ?? []).filter(m => m.direction === 'out').reduce((s, m) => s + m.amount, 0)

  const { data: session, error } = await supabase
    .from('cash_sessions')
    .insert({
      store_id:       storeId,
      cash_box_id:    box.id,
      status:         'closed',
      closed_at:      new Date().toISOString(),
      opening_amount: systemTotal - totalIn + totalOut,
      total_in:       totalIn,
      total_out:      totalOut,
      system_total:   systemTotal,
      counted_amount: countedAmount,
      variance,
      notes:          notes.trim() || null,
      opened_by:      user.id,
      closed_by:      user.id,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: 'فشل إغلاق اليومية' }

  // تسوية الفرق اختيارياً: حركة تصحيح تجعل دفتر النظام = العدّ الفعلي
  if (adjustToActual && Math.abs(variance) > 0.001) {
    await supabase.from('cash_movements').insert({
      store_id:       storeId,
      cash_box_id:    box.id,
      session_id:     session?.id ?? null,
      direction:      variance > 0 ? 'in' : 'out',
      amount:         Math.abs(variance),
      source:         'closing',
      payment_method: 'cash',
      description:    variance > 0 ? 'تسوية فائض إغلاق اليومية' : 'تسوية عجز إغلاق اليومية',
      date:           today,
      created_by:     user.id,
    })
  }

  await logFinancialEvent({
    storeId, entityType: 'cash_session', entityId: session?.id,
    entityLabel: 'إغلاق يومية', action: 'create', actorId: user.id,
    details: { systemTotal, countedAmount, variance, adjusted: adjustToActual },
  })

  revalidatePath('/dashboard/accounting/treasury')
  return { ok: true }
}

// ── إدارة الصناديق وربطها بالحسابات ──────────────────────────────
export async function createCashBox(input: {
  name: string
  type: 'cash' | 'bank' | 'wallet' | 'personal' | 'checks_collection' | 'checks_received' | 'checks_issued' | 'checks_returned'
  accountId?: string | null
  openingBalance?: number
  isDefault?: boolean
}): Promise<Result & { boxId?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'غير مصرح' }

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

  if (!input.name.trim()) return { ok: false, error: 'يرجى إدخال اسم الصندوق / الخزينة' }

  const openingBalance = Math.max(0, Number(input.openingBalance || 0))

  if (input.isDefault) {
    await supabase.from('cash_boxes').update({ is_default: false }).eq('store_id', storeId)
  }

  const { data: box, error } = await supabase
    .from('cash_boxes')
    .insert({
      store_id: storeId,
      name: input.name.trim(),
      type: input.type,
      account_id: input.accountId || null,
      opening_balance: openingBalance,
      is_default: !!input.isDefault,
      is_active: true,
    })
    .select('id')
    .single()

  if (error) {
    return { ok: false, error: 'فشل إنشاء الصندوق: ' + error.message }
  }

  await logFinancialEvent({
    storeId,
    entityType: 'cash_session',
    entityId: box.id,
    entityLabel: 'إنشاء صندوق',
    action: 'create',
    actorId: user.id,
    details: { name: input.name, type: input.type, accountId: input.accountId, openingBalance },
  })

  revalidatePath('/dashboard/accounting/treasury')
  return { ok: true, boxId: box.id }
}

export async function updateCashBox(input: {
  id: string
  name: string
  type: 'cash' | 'bank' | 'wallet' | 'personal' | 'checks_collection' | 'checks_received' | 'checks_issued' | 'checks_returned'
  accountId?: string | null
  isDefault?: boolean
}): Promise<Result> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'غير مصرح' }

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

  if (!input.name.trim()) return { ok: false, error: 'يرجى إدخال اسم الصندوق' }

  if (input.isDefault) {
    await supabase.from('cash_boxes').update({ is_default: false }).eq('store_id', storeId)
  }

  const { error } = await supabase
    .from('cash_boxes')
    .update({
      name: input.name.trim(),
      type: input.type,
      account_id: input.accountId || null,
      is_default: !!input.isDefault,
    })
    .eq('id', input.id)
    .eq('store_id', storeId)

  if (error) {
    return { ok: false, error: 'فشل تعديل الصندوق: ' + error.message }
  }

  revalidatePath('/dashboard/accounting/treasury')
  return { ok: true }
}

export async function linkCashBoxAccount(boxId: string, accountId: string | null): Promise<Result> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'غير مصرح' }

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

  const { error } = await supabase
    .from('cash_boxes')
    .update({ account_id: accountId || null })
    .eq('id', boxId)
    .eq('store_id', storeId)

  if (error) {
    return { ok: false, error: 'فشل ربط الصندوق بالحساب: ' + error.message }
  }

  revalidatePath('/dashboard/accounting/treasury')
  return { ok: true }
}

// ── إدارة صلاحيات الصناديق للمستخدمين ───────────────────────────
export async function getStoreMembersForPermissions() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return []

  const { data: members } = await supabase
    .from('store_members')
    .select(`
      id, role, profile_id,
      profile:profiles(id, full_name, email, phone)
    `)
    .eq('store_id', storeId)
    .eq('is_active', true)

  return (members || []).map((m: any) => {
    const prof = Array.isArray(m.profile) ? m.profile[0] : m.profile
    return {
      id: m.id,
      role: m.role,
      user_id: m.profile_id,
      name: prof?.full_name || 'مستخدم',
      email: prof?.email || '',
      phone: prof?.phone || '',
    }
  })
}

export async function getUserCashBoxPermissions(userId: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return []

  const { data: perms } = await supabase
    .from('user_cash_box_permissions')
    .select('cash_box_id, can_receipt, can_payment')
    .eq('store_id', storeId)
    .eq('user_id', userId)

  return perms || []
}

export async function saveUserCashBoxPermissions(
  targetUserId: string,
  permissions: Array<{ cashBoxId: string; canReceipt: boolean; canPayment: boolean }>,
): Promise<Result> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'غير مصرح' }

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

  // التحقق من أن المستخدم الحالي إما مالك أو مدير
  const { data: currentMember } = await supabase
    .from('store_members')
    .select('role')
    .eq('store_id', storeId)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (currentMember?.role !== 'owner' && currentMember?.role !== 'admin') {
    return { ok: false, error: 'هذه الصلاحية متاحة للمالك والمدير فقط' }
  }

  // حذف الصلاحيات القديمة للمستخدم المحدد في هذا المتجر
  await supabase
    .from('user_cash_box_permissions')
    .delete()
    .eq('store_id', storeId)
    .eq('user_id', targetUserId)

  // إذا تم تمرير صلاحيات جديدة، يتم إدراجها
  if (permissions.length > 0) {
    const rows = permissions.map(p => ({
      store_id: storeId,
      user_id: targetUserId,
      cash_box_id: p.cashBoxId,
      can_receipt: p.canReceipt,
      can_payment: p.canPayment,
    }))

    const { error } = await supabase.from('user_cash_box_permissions').insert(rows)
    if (error) {
      return { ok: false, error: 'فشل حفظ الصلاحيات: ' + error.message }
    }
  }

  revalidatePath('/dashboard/accounting/receipts')
  revalidatePath('/dashboard/accounting/payments')
  revalidatePath('/dashboard/accounting/treasury')
  return { ok: true }
}

