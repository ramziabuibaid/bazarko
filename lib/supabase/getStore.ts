import { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = ReturnType<typeof createClient>

/**
 * يجلب بيانات المتجر للمستخدم الحالي سواء كان مالكاً أو موظفاً (store_member).
 * يُستخدم بدلاً من .eq('owner_id', user.id) في كل صفحات الداشبورد.
 */
export async function getStoreForUser(
  supabase: SupabaseServerClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('store_members')
    .select('store_id')
    .eq('profile_id', userId)
    .eq('is_active', true)
    .single()
  return data?.store_id ?? null
}
