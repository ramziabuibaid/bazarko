import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import TeamManagement, { MemberItem } from '@/components/dashboard/settings/TeamManagement'

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

export default async function TeamSettingsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  // Verify permission
  const { data: store } = await supabase
    .from('stores')
    .select('id, name, owner_id')
    .eq('id', storeId)
    .single()

  if (!store) redirect('/onboarding')

  const isOwner = store.owner_id === user.id
  let isAdmin = isOwner

  if (!isAdmin) {
    const { data: currentMember } = await supabase
      .from('store_members')
      .select('role')
      .eq('store_id', storeId)
      .eq('profile_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (currentMember?.role === 'admin' || currentMember?.role === 'owner') {
      isAdmin = true
    }
  }

  if (!isAdmin) {
    redirect('/dashboard/settings')
  }

  // Fetch members with profiles and emails using admin client
  const admin = getAdminSupabase()
  const { data: membersRaw } = await admin
    .from('store_members')
    .select(`
      id, store_id, profile_id, role, is_active, joined_at, created_at,
      profiles ( id, full_name, phone )
    `)
    .eq('store_id', storeId)
    .order('created_at', { ascending: true })

  // Get user emails from auth
  const { data: authUsers } = await admin.auth.admin.listUsers()
  const userMap = new Map((authUsers?.users || []).map(u => [u.id, u.email || '']))

  const members: MemberItem[] = (membersRaw || []).map((m: any) => ({
    id: m.id,
    store_id: m.store_id,
    profile_id: m.profile_id,
    role: m.role,
    is_active: m.is_active,
    joined_at: m.joined_at,
    created_at: m.created_at,
    email: userMap.get(m.profile_id) || '—',
    full_name: m.profiles?.full_name || 'بدون اسم',
    phone: m.profiles?.phone || null,
  }))

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Navigation tabs between store settings and team */}
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white">إعدادات المتجر وفريق العمل</h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-400">إدارة تفاصيل المتجر، الصلاحيات، ومستخدمي النظام</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/settings"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs sm:text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            ⚙️ بيانات المتجر
          </Link>
          <span className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs sm:text-sm font-medium text-sky-400">
            👥 إدارة المستخدمين
          </span>
        </div>
      </div>

      <TeamManagement
        storeId={storeId}
        members={members}
        currentUserId={user.id}
      />
    </div>
  )
}
