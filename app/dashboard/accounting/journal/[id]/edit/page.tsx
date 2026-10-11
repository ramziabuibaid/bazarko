import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { checkStorePermission } from '@/lib/supabase/permissions'
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

  const hasWrite = await checkStorePermission(storeId, 'journal.write')
  if (!hasWrite) {
    return (
      <div className="p-8 text-center" dir="rtl">
        <div className="mx-auto max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-300">
          <div className="text-3xl mb-2">🚫</div>
          <h2 className="text-lg font-bold text-white mb-2">غير مصرح</h2>
          <p className="text-xs text-slate-300 mb-4">لا تملك صلاحية تعديل قيود اليومية. هذه العملية مقتصرة على دور المحاسب والمالك.</p>
          <Link href="/dashboard/accounting/journal" className="inline-block rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 transition">
            ← العودة لقيود اليومية
          </Link>
        </div>
      </div>
    )
  }

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
