'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Supabase service role configuration is missing')
  }
  return createAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function verifyStoreAdmin(storeId: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('غير مصرح - يرجى تسجيل الدخول')

  // Check if store owner or store admin
  const { data: store } = await supabase
    .from('stores')
    .select('id, owner_id')
    .eq('id', storeId)
    .single()

  if (store && store.owner_id === user.id) {
    return { user, isOwner: true }
  }

  const { data: member } = await supabase
    .from('store_members')
    .select('role, is_active')
    .eq('store_id', storeId)
    .eq('profile_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (!member || !['owner', 'admin'].includes(member.role)) {
    throw new Error('صلاحيات غير كافية لإدارة مستخدمي المتجر')
  }

  return { user, isOwner: member.role === 'owner' }
}

export type StoreMemberRole = 'owner' | 'admin' | 'staff' | 'accountant' | 'viewer'

export interface CreateStoreUserInput {
  storeId: string
  fullName: string
  email: string
  password: string
  phone?: string
  role: StoreMemberRole
}

export async function createStoreUser(input: CreateStoreUserInput) {
  try {
    await verifyStoreAdmin(input.storeId)

    const email = input.email.trim().toLowerCase()
    const password = input.password.trim()
    const fullName = input.fullName.trim()
    const phone = input.phone?.trim() || null
    const role = input.role || 'staff'

    if (!email || !password || !fullName) {
      return { success: false, error: 'الاسم، البريد الإلكتروني، وكلمة المرور مطلوبة' }
    }
    if (password.length < 6) {
      return { success: false, error: 'كلمة المرور يجب أن لا تقل عن 6 خانات' }
    }

    const admin = getAdminSupabase()

    // 1. Check if user already exists in auth
    const { data: existingUserList } = await admin.auth.admin.listUsers()
    let targetUser = existingUserList?.users?.find(u => u.email?.toLowerCase() === email)

    if (!targetUser) {
      // Create new user in auth
      const { data: newUser, error: createAuthError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })

      if (createAuthError || !newUser?.user) {
        return { success: false, error: createAuthError?.message || 'تعذر إنشاء حساب المستخدم' }
      }
      targetUser = newUser.user
    }

    const userId = targetUser.id

    // 2. Ensure profile exists or is updated
    await admin
      .from('profiles')
      .upsert({
        id: userId,
        full_name: fullName,
        phone: phone,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })

    // 3. Check if already a member in this store
    const { data: existingMember } = await admin
      .from('store_members')
      .select('id, role, is_active')
      .eq('store_id', input.storeId)
      .eq('profile_id', userId)
      .maybeSingle()

    if (existingMember) {
      return { success: false, error: 'هذا المستخدم مضاف بالفعل إلى هذا المتجر' }
    }

    // 4. Insert into store_members
    const { error: memberError } = await admin
      .from('store_members')
      .insert({
        store_id: input.storeId,
        profile_id: userId,
        role: role,
        is_active: true,
        joined_at: new Date().toISOString(),
      })

    if (memberError) {
      return { success: false, error: 'تعذر ربط المستخدم بالمتجر: ' + memberError.message }
    }

    revalidatePath('/dashboard/settings')
    revalidatePath('/dashboard/settings/team')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'حدث خطأ غير متوقع' }
  }
}

export async function updateStoreUserPassword(storeId: string, profileId: string, newPassword: string) {
  try {
    await verifyStoreAdmin(storeId)

    if (!newPassword || newPassword.trim().length < 6) {
      return { success: false, error: 'كلمة المرور يجب أن لا تقل عن 6 خانات' }
    }

    const admin = getAdminSupabase()
    const { error } = await admin.auth.admin.updateUserById(profileId, {
      password: newPassword.trim(),
    })

    if (error) {
      return { success: false, error: 'تعذر تحديث كلمة المرور: ' + error.message }
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'حدث خطأ أثناء تعديل كلمة المرور' }
  }
}

export async function updateStoreUserRole(
  storeId: string,
  memberId: string,
  role: StoreMemberRole,
  isActive: boolean
) {
  try {
    const { user } = await verifyStoreAdmin(storeId)
    const admin = getAdminSupabase()

    // Prevent deactivating or demoting oneself if you are the one performing action
    const { data: targetMember } = await admin
      .from('store_members')
      .select('profile_id, role')
      .eq('id', memberId)
      .single()

    if (targetMember && targetMember.profile_id === user.id && (!isActive || role !== targetMember.role)) {
      return { success: false, error: 'لا يمكنك تعطيل حسابك أو تغيير دورك بنفسك' }
    }

    const { error } = await admin
      .from('store_members')
      .update({
        role,
        is_active: isActive,
      })
      .eq('id', memberId)
      .eq('store_id', storeId)

    if (error) {
      return { success: false, error: 'تعذر تعديل الصلاحية: ' + error.message }
    }

    revalidatePath('/dashboard/settings')
    revalidatePath('/dashboard/settings/team')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'حدث خطأ' }
  }
}

export async function removeStoreUser(storeId: string, memberId: string) {
  try {
    const { user } = await verifyStoreAdmin(storeId)
    const admin = getAdminSupabase()

    const { data: targetMember } = await admin
      .from('store_members')
      .select('profile_id, role')
      .eq('id', memberId)
      .single()

    if (targetMember && targetMember.profile_id === user.id) {
      return { success: false, error: 'لا يمكنك إزالة حسابك من المتجر بنفسك' }
    }

    if (targetMember?.role === 'owner') {
      return { success: false, error: 'لا يمكن إزالة مالك المتجر الأساسي' }
    }

    const { error } = await admin
      .from('store_members')
      .delete()
      .eq('id', memberId)
      .eq('store_id', storeId)

    if (error) {
      return { success: false, error: 'تعذر حذف العضو: ' + error.message }
    }

    revalidatePath('/dashboard/settings')
    revalidatePath('/dashboard/settings/team')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'حدث خطأ' }
  }
}
