import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import AccountsTreeClient from './AccountsTreeClient'

export const metadata = {
  title: 'دليل وشجرة الحسابات الهرمية — Bazarko ERP',
}

export default async function AccountsTreePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: accounts },
    { data: journalLines },
    { data: tags }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    supabase
      .from('accounts')
      .select('*')
      .eq('store_id', storeId)
      .order('code', { ascending: true }),
    supabase
      .from('journal_lines')
      .select('account_id, debit, credit, created_at, journal_entries!inner(store_id)')
      .eq('journal_entries.store_id', storeId),
    supabase
      .from('account_tags')
      .select('*')
      .eq('is_active', true)
      .order('allowed_account_type', { ascending: true })
      .order('code', { ascending: true })
  ])

  // حساب الإحصائيات والأرصدة الدفترية للحسابات
  const statsMap: Record<string, {
    totalDebit: number
    totalCredit: number
    movementsCount: number
    lastMovementDate: string | null
    calculatedBalance: number
  }> = {}

  for (const line of (journalLines || [])) {
    const accId = line.account_id
    if (!accId) continue
    if (!statsMap[accId]) {
      statsMap[accId] = {
        totalDebit: 0,
        totalCredit: 0,
        movementsCount: 0,
        lastMovementDate: null,
        calculatedBalance: 0,
      }
    }
    const debit = Number(line.debit || 0)
    const credit = Number(line.credit || 0)
    statsMap[accId].totalDebit += debit
    statsMap[accId].totalCredit += credit
    statsMap[accId].movementsCount += 1

    if (line.created_at && (!statsMap[accId].lastMovementDate || line.created_at > statsMap[accId].lastMovementDate!)) {
      statsMap[accId].lastMovementDate = line.created_at.slice(0, 10)
    }
  }

  // دمج الأرصدة المحسوبة مع الحسابات
  const enrichedAccounts = (accounts || []).map(acc => {
    const stat = statsMap[acc.id] || {
      totalDebit: 0,
      totalCredit: 0,
      movementsCount: 0,
      lastMovementDate: null,
      calculatedBalance: 0,
    }

    const isDebit = acc.normal_balance === 'debit' || acc.type === 'asset' || acc.type === 'expense'
    const journalBalance = isDebit
      ? (stat.totalDebit - stat.totalCredit)
      : (stat.totalCredit - stat.totalDebit)

    const finalBalance = (Number(acc.balance || 0)) + journalBalance

    return {
      ...acc,
      total_debit: stat.totalDebit,
      total_credit: stat.totalCredit,
      movements_count: stat.movementsCount,
      last_movement_date: stat.lastMovementDate,
      calculated_balance: finalBalance,
    }
  })

  return (
    <AccountsTreeClient
      store={store!}
      initialAccounts={enrichedAccounts}
      tags={tags || []}
    />
  )
}
