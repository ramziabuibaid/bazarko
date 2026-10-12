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

  // Check true owner in stores table
  const { data: store } = await supabase
    .from('stores')
    .select('id, owner_id')
    .eq('id', storeId)
    .single()

  const isRealOwner = store?.owner_id === user.id
  if (isRealOwner) {
    return { user, isOwner: true, store }
  }

  const { data: member } = await supabase
    .from('store_members')
    .select('role, is_active')
    .eq('store_id', storeId)
    .eq('profile_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (!member || member.role !== 'admin') {
    throw new Error('صلاحيات غير كافية لإدارة مستخدمي المتجر')
  }

  return { user, isOwner: false, store }
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
    const allowedRoles = ['admin', 'accountant', 'staff', 'viewer'] as const
    if (!(allowedRoles as readonly string[]).includes(input.role)) {
      return { success: false, error: 'الدور غير مسموح' }
    }

    const { isOwner } = await verifyStoreAdmin(input.storeId)
    if (!isOwner && !['staff', 'viewer'].includes(input.role)) {
      return { success: false, error: 'منح هذه الصلاحية يتطلب المالك' }
    }

    const email = input.email.trim().toLowerCase()
    const password = input.password // Do not trim password; preserve user input
    const fullName = input.fullName.trim()
    const phone = input.phone?.trim() || null
    const role = input.role

    if (!email || !password || !fullName) {
      return { success: false, error: 'الاسم، البريد الإلكتروني، وكلمة المرور مطلوبة' }
    }
    if (password.length < 8) {
      return { success: false, error: 'كلمة المرور يجب أن لا تقل عن 8 خانات' }
    }

    const admin = getAdminSupabase()

    // 1. Attempt to create the user in Auth
    const { data: newUser, error: createAuthError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })

    if (createAuthError) {
      const errMsg = createAuthError.message.toLowerCase()
      if (errMsg.includes('already registered') || errMsg.includes('already exists') || createAuthError.status === 422) {
        return {
          success: false,
          error: 'البريد الإلكتروني مرتبط بحساب مسجل مسبقاً في النظام. تتطلب إضافة مستخدم مسجل مسبقاً إرسال دعوة وقبولها حفاظاً على أمان حسابه الشخصي.',
        }
      }

      return { success: false, error: createAuthError.message || 'تعذر إنشاء حساب المستخدم' }
    }

    if (!newUser?.user) {
      return { success: false, error: 'تعذر إنشاء حساب المستخدم' }
    }

    const userId = newUser.user.id

    // 2. مطابقة مخطط profiles المعتمد (لا يحتوي على عمود email، بل في auth.users)
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({
        id: userId,
        full_name: fullName,
        phone: phone,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })

    if (profileError) {
      // Rollback Auth user creation
      await admin.auth.admin.deleteUser(userId)
      return { success: false, error: 'تعذر إنشاء ملف المستخدم: ' + profileError.message }
    }


    // 3. Insert into store_members
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
      // Rollback Auth user creation
      await admin.auth.admin.deleteUser(userId)
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
    const { isOwner } = await verifyStoreAdmin(storeId)

    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'كلمة المرور يجب أن لا تقل عن 8 خانات' }
    }

    const admin = getAdminSupabase()
    const { data: target, error: targetError } = await admin
      .from('store_members')
      .select('profile_id, role, is_active')
      .eq('store_id', storeId)
      .eq('profile_id', profileId)
      .maybeSingle()

    const { data: store, error: storeError } = await admin
      .from('stores')
      .select('owner_id')
      .eq('id', storeId)
      .single()

    if (targetError || storeError || !target || !store) {
      return { success: false, error: 'المستخدم غير تابع لهذا المتجر' }
    }

    if (profileId === store.owner_id || target.role === 'owner') {
      return { success: false, error: 'كلمة مرور المالك تُغيّر من إعدادات حسابه الشخصي' }
    }

    if (!isOwner && !['staff', 'viewer'].includes(target.role)) {
      return { success: false, error: 'إعادة ضبط هذا الحساب تتطلب المالك' }
    }

    // التحقق من تعدد المتاجر: منع إعادة ضبط كلمة المرور إدارياً إذا كان الحساب مشتركاً في متاجر أخرى
    const { count: storeCount } = await admin
      .from('store_members')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profileId)

    if (storeCount && storeCount > 1) {
      return {
        success: false,
        error: 'هذا الحساب عضو في أكثر من متجر. لا يمكن إعادة ضبط كلمة مروره إدارياً من هذا المتجر حفاظاً على خصوصية المتاجر الأخرى. يجب على صاحب الحساب استخدام ميزة استعادة كلمة المرور الشخصية.',
      }
    }

    const { error } = await admin.auth.admin.updateUserById(profileId, {
      password: newPassword,
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
    const allowedRoles = ['admin', 'accountant', 'staff', 'viewer'] as const
    if (!(allowedRoles as readonly string[]).includes(role)) {
      return { success: false, error: 'الدور غير مسموح' }
    }

    const { user, isOwner, store } = await verifyStoreAdmin(storeId)
    const admin = getAdminSupabase()

    // Query target using id AND store_id together
    const { data: targetMember, error: targetError } = await admin
      .from('store_members')
      .select('profile_id, role, is_active')
      .eq('id', memberId)
      .eq('store_id', storeId)
      .maybeSingle()

    if (targetError || !targetMember) {
      return { success: false, error: 'العضو غير موجود في هذا المتجر' }
    }

    // Disallow modifying real owner or self
    if (targetMember.profile_id === store?.owner_id || targetMember.role === 'owner') {
      return { success: false, error: 'لا يمكن تعديل دور أو حالة مالك المتجر' }
    }
    if (targetMember.profile_id === user.id) {
      return { success: false, error: 'لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك' }
    }

    // If not owner, cannot manage admins or accountants
    if (!isOwner) {
      if (!['staff', 'viewer'].includes(targetMember.role) || !['staff', 'viewer'].includes(role)) {
        return { success: false, error: 'إدارة أدوار المشرفين والمحاسبين تتطلب مالك المتجر' }
      }
    }

    const { data: updatedRows, error } = await admin
      .from('store_members')
      .update({
        role,
        is_active: isActive,
      })
      .eq('id', memberId)
      .eq('store_id', storeId)
      .select('id')

    if (error) {
      return { success: false, error: 'تعذر تعديل الصلاحية: ' + error.message }
    }

    if (!updatedRows || updatedRows.length === 0) {
      return { success: false, error: 'لم يتم العثور على العضو لتعديله' }
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
    const { user, isOwner, store } = await verifyStoreAdmin(storeId)
    const admin = getAdminSupabase()

    const { data: targetMember, error: targetError } = await admin
      .from('store_members')
      .select('profile_id, role')
      .eq('id', memberId)
      .eq('store_id', storeId)
      .maybeSingle()

    if (targetError || !targetMember) {
      return { success: false, error: 'العضو غير موجود في هذا المتجر' }
    }

    if (targetMember.profile_id === user.id) {
      return { success: false, error: 'لا يمكنك إزالة حسابك من المتجر بنفسك' }
    }

    if (targetMember.profile_id === store?.owner_id || targetMember.role === 'owner') {
      return { success: false, error: 'لا يمكن إزالة مالك المتجر الأساسي' }
    }

    if (!isOwner && !['staff', 'viewer'].includes(targetMember.role)) {
      return { success: false, error: 'إزالة المشرفين والمحاسبين تتطلب مالك المتجر' }
    }

    const { data: deletedRows, error } = await admin
      .from('store_members')
      .delete()
      .eq('id', memberId)
      .eq('store_id', storeId)
      .select('id')

    if (error) {
      return { success: false, error: 'تعذر حذف العضو: ' + error.message }
    }

    if (!deletedRows || deletedRows.length === 0) {
      return { success: false, error: 'لم يتم العثور على العضو لحذفه' }
    }

    revalidatePath('/dashboard/settings')
    revalidatePath('/dashboard/settings/team')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'حدث خطأ' }
  }
}
