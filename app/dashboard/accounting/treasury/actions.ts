'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { getDefaultCashBox, getCashBalance } from '@/lib/accounting/treasury'
import { logFinancialEvent } from '@/lib/accounting/audit'
import { revalidatePath } from 'next/cache'

type Result = { ok: boolean; error?: string }

async function resolve() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'غير مصرح' as const }

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return { error: 'المتجر غير موجود' as const }

  const box = await getDefaultCashBox(supabase, storeId)
  if (!box) return { error: 'تعذّر تجهيز الصندوق' as const }

  return { supabase, user, storeId, box }
}

// ── إيداع/سحب يدوي ──────────────────────────────────────────────
export async function recordManualMovement(
  direction: 'in' | 'out',
  amount: number,
  description: string,
  paymentMethod: 'cash' | 'bank' | 'card' | 'transfer' = 'cash',
): Promise<Result> {
  if (!(amount > 0)) return { ok: false, error: 'أدخل مبلغاً صحيحاً' }
  if (!description.trim()) return { ok: false, error: 'أدخل وصفاً للحركة' }

  const r = await resolve()
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
export async function setOpeningBalance(amount: number): Promise<Result> {
  if (amount < 0) return { ok: false, error: 'الرصيد لا يكون سالباً' }

  const r = await resolve()
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
): Promise<Result> {
  if (countedAmount < 0) return { ok: false, error: 'المبلغ المعدود غير صحيح' }

  const r = await resolve()
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
