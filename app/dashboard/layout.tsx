import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import DashboardShell from '@/components/dashboard/DashboardShell'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, subdomain, country_code, plan, modules, settings')
    .eq('id', storeId)
    .single()

  if (!store) redirect('/onboarding')

  // ── حساب الإشعارات (جرس الهيدر) ────────────────────────────────
  const todayDateStr = new Date().toISOString().slice(0, 10)
  const [
    { data: dueInvoices },
    { data: stockRows },
    { data: creditRows },
  ] = await Promise.all([
    supabase.from('invoices')
      .select('id, due_date, status')
      .eq('store_id', store.id)
      .not('status', 'in', '("paid","cancelled")')
      .lt('due_date', todayDateStr),
    supabase.from('products')
      .select('id, stock_quantity, low_stock_alert')
      .eq('store_id', store.id)
      .eq('track_stock', true)
      .eq('is_active', true),
    supabase.from('customers')
      .select('id, balance, credit_limit')
      .eq('store_id', store.id)
      .gt('credit_limit', 0),
  ])

  const overdueCount = (dueInvoices ?? []).length
  const lowStockCount = ((stockRows ?? []) as { stock_quantity: number; low_stock_alert: number | null }[])
    .filter(p => p.stock_quantity <= (p.low_stock_alert ?? 5)).length
  const overLimitCount = ((creditRows ?? []) as { balance: number; credit_limit: number }[])
    .filter(c => c.balance > c.credit_limit).length

  const notifications: { icon: string; text: string; href: string; tone: 'red' | 'amber' }[] = []
  if (overdueCount > 0) notifications.push({ icon: '⏰', text: `${overdueCount} فواتير مستحقة ومتأخرة`, href: '/dashboard/accounting/invoices?status=unpaid', tone: 'red' })
  if (overLimitCount > 0) notifications.push({ icon: '🚫', text: `${overLimitCount} عملاء تجاوزوا حد الدين`, href: '/dashboard/customers', tone: 'red' })
  if (lowStockCount > 0) notifications.push({ icon: '📦', text: `${lowStockCount} منتجات قاربت على النفاد`, href: '/dashboard/inventory/alerts', tone: 'amber' })

  return <DashboardShell store={store} notifications={notifications}>{children}</DashboardShell>
}
