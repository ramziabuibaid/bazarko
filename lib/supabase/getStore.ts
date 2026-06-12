import { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = ReturnType<typeof createClient>

/**
 * يجلب بيانات المتجر للمستخدم الحالي سواء كان مالكاً أو موظفاً (store_member).
 * يُستخدم بدلاً من .eq('owner_id', user.id) في كل صفحات الداشبورد.
 *
 * ملاحظة: لا تستخدم .single() هنا — مستخدم قد يكون عضواً في أكثر من متجر
 * (single يفشل عند تعدد الصفوف فيُعاد توجيه المستخدم خطأً لـ onboarding).
 * نأخذ أقدم عضوية نشطة (متجره الأصلي).
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
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.store_id ?? null
}
