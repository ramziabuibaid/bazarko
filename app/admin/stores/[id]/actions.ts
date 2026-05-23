'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

async function assertAdmin() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) throw new Error('Forbidden')
}

export async function suspendStore(storeId: string, reason: string) {
  await assertAdmin()
  const supabase = createAdminClient()
  await supabase.from('stores').update({
    is_active: false,
    suspended_at: new Date().toISOString(),
    suspended_reason: reason || 'بدون سبب',
  }).eq('id', storeId)
  revalidatePath(`/admin/stores/${storeId}`)
  revalidatePath('/admin/stores')
  revalidatePath('/admin')
}

export async function activateStore(storeId: string) {
  await assertAdmin()
  const supabase = createAdminClient()
  await supabase.from('stores').update({
    is_active: true,
    suspended_at: null,
    suspended_reason: null,
  }).eq('id', storeId)
  revalidatePath(`/admin/stores/${storeId}`)
  revalidatePath('/admin/stores')
  revalidatePath('/admin')
}

export async function updateStorePlan(storeId: string, plan: string, expiresAt: string | null) {
  await assertAdmin()
  const supabase = createAdminClient()
  await supabase.from('stores').update({
    plan,
    plan_expires_at: expiresAt || null,
  }).eq('id', storeId)
  revalidatePath(`/admin/stores/${storeId}`)
  revalidatePath('/admin/stores')
}
