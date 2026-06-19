import { createClient } from '@/lib/supabase/server'

export interface CashBox {
  id: string
  name: string
  type: string
  opening_balance: number
}

/**
 * يجلب الصندوق الافتراضي للمتجر (ينشئه إذا لزم عبر ensure_cash_box).
 */
export async function getDefaultCashBox(
  supabase: ReturnType<typeof createClient>,
  storeId: string,
): Promise<CashBox | null> {
  const { data: box } = await supabase
    .from('cash_boxes')
    .select('id, name, type, opening_balance')
    .eq('store_id', storeId)
    .eq('is_default', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (box) return box as CashBox

  // لا يوجد صندوق بعد — أنشئه عبر RPC ثم أعد الجلب
  const { data: boxId } = await supabase.rpc('ensure_cash_box', { p_store_id: storeId })
  if (!boxId) return null

  const { data: created } = await supabase
    .from('cash_boxes')
    .select('id, name, type, opening_balance')
    .eq('id', boxId)
    .maybeSingle()

  return (created as CashBox) ?? null
}

/**
 * الرصيد الحالي = الرصيد الافتتاحي + مجموع الداخل − مجموع الخارج.
 */
export async function getCashBalance(
  supabase: ReturnType<typeof createClient>,
  storeId: string,
  boxId: string,
  openingBalance: number,
): Promise<number> {
  const { data: movements } = await supabase
    .from('cash_movements')
    .select('direction, amount')
    .eq('store_id', storeId)
    .eq('cash_box_id', boxId)

  const totals = (movements ?? []).reduce(
    (acc, m: { direction: string; amount: number }) => {
      if (m.direction === 'in') acc.in += m.amount
      else acc.out += m.amount
      return acc
    },
    { in: 0, out: 0 },
  )

  return openingBalance + totals.in - totals.out
}
