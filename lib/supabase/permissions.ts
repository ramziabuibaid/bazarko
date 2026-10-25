import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type Permission =
  | 'store.read'
  | 'team.manage'
  | 'team.privileged'
  | 'settings.write'
  | 'sales.write'
  | 'sales.below_cost'
  | 'purchases.write'
  | 'inventory.write'
  | 'journal.read'
  | 'journal.write'
  | 'finance.write'
  | 'period.reopen'
  | 'subscription.write'

export async function requireStorePermission(
  storeId: string,
  permission: Permission
) {
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('يجب تسجيل الدخول')

  const { data: allowed, error } = await supabase.rpc('has_store_permission', {
    p_store_id: storeId,
    p_permission: permission,
  })

  if (error || allowed !== true) {
    throw new Error('لا تملك صلاحية هذه العملية')
  }

  return { supabase, user }
}

export async function checkStorePermission(
  storeId: string,
  permission: Permission
): Promise<boolean> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    const { data: allowed, error } = await supabase.rpc('has_store_permission', {
      p_store_id: storeId,
      p_permission: permission,
    })

    if (error || allowed !== true) return false
    return true
  } catch {
    return false
  }
}
