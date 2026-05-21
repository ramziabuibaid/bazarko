import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

const NAV = [
  { href: '/admin',         label: 'نظرة عامة',     icon: '📊' },
  { href: '/admin/stores',  label: 'المتاجر',        icon: '🏪' },
  { href: '/admin/plans',   label: 'الخطط',          icon: '💳' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin, full_name')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-slate-950 text-white flex" dir="rtl">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-l border-white/5 bg-slate-900 flex flex-col">
        <div className="px-4 py-5 border-b border-white/5">
          <p className="text-xs text-slate-500">Bazarko</p>
          <p className="text-sm font-bold text-white mt-0.5">لوحة الإدارة</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(item => (
            <Link key={item.href} href={item.href}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/5 hover:text-white transition-colors">
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-white/5 space-y-1">
          <Link href="/dashboard"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-500 hover:text-white transition-colors">
            <span>↩</span> العودة للداشبورد
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <div className="border-b border-white/5 bg-slate-900 px-6 py-3 flex items-center justify-between">
          <p className="text-xs text-slate-500">مرحباً، {profile.full_name ?? user.email}</p>
          <span className="rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-xs text-red-400 font-medium">
            Super Admin
          </span>
        </div>
        {children}
      </main>
    </div>
  )
}
