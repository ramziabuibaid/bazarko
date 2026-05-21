import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, currency_code')
    .eq('owner_id', user!.id)
    .single()

  // إحصائيات سريعة
  const storeId = store?.id

  const [ordersRes, customersRes, productsRes, revenueRes] = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('store_id', storeId!),
    supabase.from('customers').select('id', { count: 'exact', head: true }).eq('store_id', storeId!),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('store_id', storeId!).eq('is_active', true),
    supabase.from('orders')
      .select('total_amount')
      .eq('store_id', storeId!)
      .eq('payment_status', 'paid'),
  ])

  const totalRevenue = (revenueRes.data || []).reduce((sum: number, o: { total_amount: number | null }) => sum + (o.total_amount || 0), 0)

  const stats = [
    { label: 'إجمالي الطلبيات', value: ordersRes.count ?? 0, icon: '📦', color: 'text-sky-400' },
    { label: 'الزبائن', value: customersRes.count ?? 0, icon: '👥', color: 'text-violet-400' },
    { label: 'المنتجات النشطة', value: productsRes.count ?? 0, icon: '🛍️', color: 'text-emerald-400' },
    {
      label: 'إجمالي الإيرادات',
      value: totalRevenue.toLocaleString('ar'),
      suffix: store?.currency_code,
      icon: '💰',
      color: 'text-amber-400',
    },
  ]

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">نظرة عامة</h1>
        <p className="mt-1 text-sm text-slate-400">
          {new Date().toLocaleDateString('ar', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* بطاقات الإحصائيات */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-white/5 bg-slate-900 p-5"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-500">{stat.label}</p>
                <p className={`mt-2 text-2xl font-semibold ${stat.color}`}>
                  {stat.value}
                  {stat.suffix && <span className="mr-1 text-sm font-normal text-slate-400">{stat.suffix}</span>}
                </p>
              </div>
              <span className="text-2xl">{stat.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* روابط سريعة */}
      <div className="mt-8">
        <h2 className="mb-4 text-sm font-medium text-slate-400">إجراءات سريعة</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { href: '/dashboard/orders', label: 'طلبية جديدة', icon: '➕', desc: 'من لوحة التحكم' },
            { href: '/dashboard/products/new', label: 'منتج جديد', icon: '📝', desc: 'أضف منتجاً للمتجر' },
            { href: '/dashboard/customers', label: 'زبون جديد', icon: '👤', desc: 'أضف زبوناً' },
            { href: '/dashboard/accounting/receipts/new', label: 'سند قبض', icon: '💵', desc: 'استلام دفعة' },
          ].map(action => (
            <a
              key={action.href}
              href={action.href}
              className="rounded-xl border border-white/5 bg-slate-900 p-4 transition hover:border-sky-500/30 hover:bg-slate-800"
            >
              <span className="text-2xl">{action.icon}</span>
              <p className="mt-2 font-medium text-white">{action.label}</p>
              <p className="text-xs text-slate-500">{action.desc}</p>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
