import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/dashboard/Sidebar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // جلب بيانات المتجر
  const { data: store } = await supabase
    .from('stores')
    .select('id, name, subdomain, country_code, plan, modules, full_subdomain')
    .eq('owner_id', user.id)
    .single()

  if (!store) {
    redirect('/onboarding')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-white" dir="rtl">
      <Sidebar store={store} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
