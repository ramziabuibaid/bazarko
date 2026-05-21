import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import StoreSettingsForm from '@/components/dashboard/settings/StoreSettingsForm'

export default async function SettingsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, description, logo_url, cover_url, phone, whatsapp, email, city, address, subdomain, country_code, currency_code, full_subdomain')
    .eq('owner_id', user.id)
    .single()

  if (!store) redirect('/onboarding')

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">إعدادات المتجر</h1>
        <p className="mt-1 text-sm text-slate-400">تحديث بيانات وهوية متجرك</p>
      </div>
      <div className="max-w-3xl">
        <StoreSettingsForm store={store} />
      </div>
    </div>
  )
}
