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

export async function updateStoreDomain(storeId: string, newSubdomain: string) {
  await assertAdmin()
  const sanitized = newSubdomain.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!sanitized || sanitized.length < 3) throw new Error('الـ subdomain يجب أن يكون 3 أحرف على الأقل ويحتوي أحرف إنجليزية أو أرقام فقط')

  const supabase = createAdminClient()
  const { data: store } = await supabase.from('stores').select('country_code').eq('id', storeId).single()
  if (!store) throw new Error('المتجر غير موجود')

  const { data: existing } = await supabase
    .from('stores')
    .select('id')
    .eq('subdomain', sanitized)
    .eq('country_code', store.country_code)
    .neq('id', storeId)
    .maybeSingle()

  if (existing) throw new Error('هذا الـ subdomain مستخدم من متجر آخر في نفس البلد')

  const { error } = await supabase.from('stores').update({ subdomain: sanitized }).eq('id', storeId)
  if (error) throw new Error(error.message)

  revalidatePath(`/admin/stores/${storeId}`)
  revalidatePath('/admin/stores')
  revalidatePath('/admin')
}

export async function resetUserPassword(userId: string, newPassword: string) {
  await assertAdmin()
  if (newPassword.length < 8) throw new Error('كلمة السر يجب أن تكون 8 أحرف على الأقل')

  const supabase = createAdminClient()
  const { error } = await supabase.auth.admin.updateUserById(userId, { password: newPassword })
  if (error) throw new Error(error.message)
}
