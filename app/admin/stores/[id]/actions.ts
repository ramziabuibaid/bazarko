'use server'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function assertAdmin(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) throw new Error('Forbidden')
  return user
}

export async function suspendStore(storeId: string, reason: string) {
  const supabase = createClient()
  await assertAdmin(supabase)
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
  const supabase = createClient()
  await assertAdmin(supabase)
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
  const supabase = createClient()
  await assertAdmin(supabase)
  await supabase.from('stores').update({
    plan,
    plan_expires_at: expiresAt || null,
  }).eq('id', storeId)
  revalidatePath(`/admin/stores/${storeId}`)
  revalidatePath('/admin/stores')
}
