import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import AttributesManager from '@/components/dashboard/attributes/AttributesManager'

export default async function AttributesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const [{ data: attributes }, { data: values }] = await Promise.all([
    supabase
      .from('product_attributes')
      .select('id, name, sort_order')
      .eq('store_id', storeId)
      .order('sort_order'),
    supabase
      .from('product_attribute_values')
      .select('id, attribute_id, value, sort_order')
      .eq('store_id', storeId)
      .order('sort_order'),
  ])

  const grouped = (attributes ?? []).map(a => ({
    ...a,
    values: (values ?? []).filter(v => v.attribute_id === a.id),
  }))

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">الخصائص والفلاتر</h1>
        <p className="mt-1 text-sm text-slate-400">
          عرّف خصائص منتجاتك (مثل: اللون، المادة، الغرفة) وقيمها. تظهر تلقائياً كفلاتر في متجرك ويمكن إسنادها لكل منتج.
        </p>
      </div>

      <AttributesManager storeId={storeId} attributes={grouped} />
    </div>
  )
}
