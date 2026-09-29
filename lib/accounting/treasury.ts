import { createClient } from '@/lib/supabase/server'
import { getCashBoxAccount } from '@/lib/accounting/engine'

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
    balance?: number
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
      account:accounts(id, code, name, balance)
    `)
    .eq('store_id', storeId)
    .eq('is_default', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (box) {
    // التأكد من ربط حساب محاسبي
    if (!box.account_id) {
      const accId = await getCashBoxAccount(supabase, storeId, box.id)
      box.account_id = accId
    }
    const rawAccount = Array.isArray(box.account) ? box.account[0] : box.account
    return {
      ...box,
      account: rawAccount ?? null,
      balance: rawAccount ? Number(rawAccount.balance || 0) : Number(box.opening_balance || 0),
    } as CashBox
  }

  // لا يوجد صندوق بعد — أنشئه عبر RPC ثم أعد الجلب
  const { data: boxId } = await supabase.rpc('ensure_cash_box', { p_store_id: storeId })
  if (!boxId) return null

  // ربط حساب محاسبي للصندوق المنشأ
  await getCashBoxAccount(supabase, storeId, boxId)

  const { data: created } = await supabase
    .from('cash_boxes')
    .select(`
      id, name, type, opening_balance, is_active, is_default, account_id,
      account:accounts(id, code, name, balance)
    `)
    .eq('id', boxId)
    .maybeSingle()

  if (!created) return null
  const rawAccount = Array.isArray(created.account) ? created.account[0] : created.account
  return {
    ...created,
    account: rawAccount ?? null,
    balance: rawAccount ? Number(rawAccount.balance || 0) : Number(created.opening_balance || 0),
  } as CashBox
}

/**
 * يجلب كافة الصناديق والخزائن للمتجر مع أرصدتها المأخوذة مباشرة من حساباتها المحاسبية في دفتر الأستاذ العام
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
      account:accounts(id, code, name, balance)
    `)
    .eq('store_id', storeId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })

  if (!boxes || boxes.length === 0) return []

  // التأكد من ربط كافة الصناديق بحسابات محاسبية نشطة
  const resultBoxes: CashBox[] = []
  for (const b of boxes as any[]) {
    let rawAccount = Array.isArray(b.account) ? b.account[0] : b.account
    let accId = b.account_id

    if (!accId || !rawAccount) {
      accId = await getCashBoxAccount(supabase, storeId, b.id)
      const { data: acc } = await supabase
        .from('accounts')
        .select('id, code, name, balance')
        .eq('id', accId)
        .maybeSingle()
      rawAccount = acc
    }

    // رصيد الخزينة = رصيد الحساب المحاسبي للصندوق
    const accountingBalance = rawAccount?.balance !== undefined ? Number(rawAccount.balance) : Number(b.opening_balance || 0)

    resultBoxes.push({
      id: b.id,
      name: b.name,
      type: b.type,
      opening_balance: Number(b.opening_balance || 0),
      is_active: b.is_active ?? true,
      is_default: b.is_default ?? false,
      account_id: accId,
      account: rawAccount ? { id: rawAccount.id, code: rawAccount.code, name: rawAccount.name, balance: accountingBalance } : null,
      balance: accountingBalance,
    })
  }

  return resultBoxes
}

/**
 * الرصيد الفعلي للصندوق مأخوذاً مباشرة من الحساب المحاسبي للصندوق في دفتر الأستاذ
 */
export async function getCashBalance(
  supabase: ReturnType<typeof createClient>,
  storeId: string,
  boxId: string,
  openingBalance: number,
): Promise<number> {
  const { data: box } = await supabase
    .from('cash_boxes')
    .select('id, account_id, opening_balance, account:accounts(id, balance)')
    .eq('id', boxId)
    .maybeSingle()

  const rawAcc = Array.isArray(box?.account) ? box?.account[0] : box?.account
  if (rawAcc?.balance !== undefined) {
    return Number(rawAcc.balance)
  }

  // إذا لم يكن الحساب جاهزاً بعد
  const accId = await getCashBoxAccount(supabase, storeId, boxId)
  const { data: acc } = await supabase
    .from('accounts')
    .select('balance')
    .eq('id', accId)
    .maybeSingle()

  if (acc?.balance !== undefined) {
    return Number(acc.balance)
  }

  return openingBalance
}


