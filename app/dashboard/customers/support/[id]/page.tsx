import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import SupportTicketDetail from '@/components/dashboard/customers/SupportTicketDetail'

export default async function SupportTicketPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: ticket } = await supabase
    .from('support_tickets')
    .select('id, ticket_number, customer_id, customer_name, customer_phone, subject, category, status, priority, channel, assigned_to, created_at, resolved_at, rating, rating_note')
    .eq('id', params.id)
    .eq('store_id', storeId)
    .single()

  if (!ticket) notFound()

  const { data: messages } = await supabase
    .from('support_ticket_messages')
    .select('id, sender, body, created_at')
    .eq('ticket_id', ticket.id)
    .order('created_at', { ascending: true })

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/customers/support" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          ← الدعم
        </Link>
        <h1 className="text-lg font-semibold text-white">
          <span className="font-mono text-sky-400" dir="ltr">{ticket.ticket_number}</span>
        </h1>
      </div>

      <SupportTicketDetail ticket={ticket} messages={messages ?? []} userId={user!.id} />
    </div>
  )
}
