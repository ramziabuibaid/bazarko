import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import EditJournalClient from './EditJournalClient'

export const metadata = {
  title: 'تعديل قيد محاسبي — Bazarko ERP',
}

interface Props {
  params: {
    id: string
  }
}

export default async function EditJournalPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  // جلب القيد مع سطوره
  const { data: entry } = await supabase
    .from('journal_entries')
    .select(`
      *,
      lines:journal_lines(
        id,
        account_id,
        debit,
        credit,
        description,
        currency,
        exchange_rate,
        original_debit,
        original_credit,
        sort_order,
        account_tag_used,
        source_rule,
        account:accounts(id, code, name, type, normal_balance, account_tag)
      )
    `)
    .eq('id', params.id)
    .eq('store_id', storeId)
    .maybeSingle()

  if (!entry) {
    notFound()
  }

  // إذا كان مرتبطاً بسند، نجلب معلومات السند للعرض والتوضيح
  let linkedVoucher: any = null
  if (entry.source === 'voucher' && entry.ref_id) {
    const { data: v } = await supabase
      .from('vouchers')
      .select('id, voucher_number, type, party_name, amount, payment_method')
      .eq('id', entry.ref_id)
      .maybeSingle()
    linkedVoucher = v
  }

  // جلب شجرة الحسابات النشطة القابلة للترحيل
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, code, name, type, normal_balance')
    .eq('store_id', storeId)
    .eq('is_group', false)
    .eq('is_active', true)
    .order('code', { ascending: true })

  return (
    <EditJournalClient
      entry={entry}
      linkedVoucher={linkedVoucher}
      accounts={accounts || []}
    />
  )
}
