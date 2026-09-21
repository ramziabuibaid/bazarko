import { createClient } from '@/lib/supabase/server'

export interface CashBox {
  id: string
  name: string
  type: string
  opening_balance: number
  is_active?: boolean
  is_default?: boolean
  account_id?: string | null
  account?: {
    id: string
    code: string
    name: string
  } | null
  balance?: number
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
    .select(`
      id, name, type, opening_balance, is_active, is_default, account_id,
      account:accounts(id, code, name)
    `)
    .eq('store_id', storeId)
    .eq('is_default', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (box) {
    const rawAccount = Array.isArray(box.account) ? box.account[0] : box.account
    return {
      ...box,
      account: rawAccount ?? null,
    } as CashBox
  }

  // لا يوجد صندوق بعد — أنشئه عبر RPC ثم أعد الجلب
  const { data: boxId } = await supabase.rpc('ensure_cash_box', { p_store_id: storeId })
  if (!boxId) return null

  const { data: created } = await supabase
    .from('cash_boxes')
    .select(`
      id, name, type, opening_balance, is_active, is_default, account_id,
      account:accounts(id, code, name)
    `)
    .eq('id', boxId)
    .maybeSingle()

  if (!created) return null
  const rawAccount = Array.isArray(created.account) ? created.account[0] : created.account
  return {
    ...created,
    account: rawAccount ?? null,
  } as CashBox
}

/**
 * يجلب كافة الصناديق والخزائن للمتجر مع أرصدتها وحساباتها المرتبطة.
 */
export async function getAllCashBoxesWithBalances(
  supabase: ReturnType<typeof createClient>,
  storeId: string,
): Promise<CashBox[]> {
  await getDefaultCashBox(supabase, storeId)

  const { data: boxes } = await supabase
    .from('cash_boxes')
    .select(`
      id, name, type, opening_balance, is_active, is_default, account_id,
      account:accounts(id, code, name)
    `)
    .eq('store_id', storeId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })

  if (!boxes || boxes.length === 0) return []

  const { data: movements } = await supabase
    .from('cash_movements')
    .select('cash_box_id, direction, amount')
    .eq('store_id', storeId)

  const balanceMap = new Map<string, number>()
  for (const m of movements ?? []) {
    const cur = balanceMap.get(m.cash_box_id) ?? 0
    balanceMap.set(
      m.cash_box_id,
      cur + (m.direction === 'in' ? Number(m.amount || 0) : -Number(m.amount || 0))
    )
  }

  return boxes.map((b: any) => {
    const delta = balanceMap.get(b.id) ?? 0
    const rawAccount = Array.isArray(b.account) ? b.account[0] : b.account
    return {
      id: b.id,
      name: b.name,
      type: b.type,
      opening_balance: Number(b.opening_balance || 0),
      is_active: b.is_active ?? true,
      is_default: b.is_default ?? false,
      account_id: b.account_id ?? null,
      account: rawAccount ? { id: rawAccount.id, code: rawAccount.code, name: rawAccount.name } : null,
      balance: Number(b.opening_balance || 0) + delta,
    }
  })
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

