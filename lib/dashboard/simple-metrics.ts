export const BUSINESS_TIME_ZONE = 'Asia/Hebron'
export function useSimpleDashboard(plan: string, settings: unknown): boolean {
  const value = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {}
  if (value.dashboard_mode === 'advanced') return false
  if (value.dashboard_mode === 'simple') return true
  return plan === 'free'
}

export function businessDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => parts.find(p => p.type === type)!.value
  const date = `${part('year')}-${part('month')}-${part('day')}`
  function midnight(dateValue: string) {
    const target = Date.parse(`${dateValue}T00:00:00Z`)
    let utc = target
    // Resolve the zone offset at midnight, including daylight-saving transitions.
    for (let i = 0; i < 3; i++) {
      const local = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(utc))
      const val = (type: string) => local.find(p => p.type === type)!.value
      const localAsUTC = Date.parse(`${val('year')}-${val('month')}-${val('day')}T${val('hour')}:${val('minute')}:${val('second')}Z`)
      const correction = target - localAsUTC
      utc += correction
      if (!correction) break
    }
    return new Date(utc).toISOString()
  }
  const tomorrow = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
  return { date, start: midnight(date), end: midnight(tomorrow) }
}

export interface MetricInvoice { id: string; order_id: string | null; total: number; amount_paid: number; issue_date: string }
export interface MetricOrder { id: string; total_amount: number; amount_paid: number; status: string; created_at: string }
const SALES_ORDER_STATUSES = new Set(['confirmed', 'processing', 'ready', 'shipped', 'delivered'])
export function salesMetrics(invoices: MetricInvoice[], orders: MetricOrder[], day: ReturnType<typeof businessDay>) {
  const linked = new Set(invoices.map(i => i.order_id).filter(Boolean))
  const standaloneOrders = orders.filter(o => SALES_ORDER_STATUSES.has(o.status) && !linked.has(o.id))
  const todayInvoices = invoices.filter(i => i.issue_date === day.date)
  const todayOrders = standaloneOrders.filter(o => o.created_at >= day.start && o.created_at < day.end)
  const unpaid = (total: number, paid: number) => Math.max(0, Number(total) - Number(paid || 0))
  return {
    sales: todayInvoices.reduce((sum, i) => sum + Number(i.total), 0) + todayOrders.reduce((sum, o) => sum + Number(o.total_amount), 0),
    unpaid: invoices.reduce((sum, i) => sum + unpaid(i.total, i.amount_paid), 0) + standaloneOrders.reduce((sum, o) => sum + unpaid(o.total_amount, o.amount_paid), 0),
  }
}
