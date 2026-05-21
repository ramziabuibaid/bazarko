import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import RepairJobDetail from '@/components/dashboard/maintenance/RepairJobDetail'

interface Props { params: { id: string } }

export default async function RepairJobPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code')
    .eq('owner_id', user.id)
    .single()
  if (!store) redirect('/onboarding')

  const { data: job } = await supabase
    .from('repair_jobs')
    .select('*')
    .eq('id', params.id)
    .eq('store_id', store.id)
    .single()
  if (!job) notFound()

  const [{ data: parts }, { data: history }] = await Promise.all([
    supabase
      .from('repair_job_parts')
      .select('id, product_id, name, quantity, unit_cost, total')
      .eq('job_id', job.id)
      .order('id'),
    supabase
      .from('repair_job_history')
      .select('id, from_status, to_status, note, changed_at')
      .eq('job_id', job.id)
      .order('changed_at', { ascending: true }),
  ])

  return (
    <div className="p-6 max-w-6xl">
      <RepairJobDetail
        job={job}
        parts={parts ?? []}
        history={history ?? []}
        currencyCode={store.currency_code}
        userId={user.id}
      />
    </div>
  )
}
