import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'

interface Props {
  searchParams: { product?: string; type?: string }
}

const MOVEMENT_LABELS: Record<string, { label: string; color: string; sign: string }> = {
  purchase:   { label: 'استلام بضاعة',  color: 'text-emerald-400', sign: '+' },
  sale:       { label: 'بيع',           color: 'text-red-400',     sign: '−' },
  return:     { label: 'إرجاع من زبون', color: 'text-emerald-400', sign: '+' },
  adjustment: { label: 'تعديل يدوي',    color: 'text-yellow-400',  sign: '±' },
  damage:     { label: 'تالف/مفقود',    color: 'text-red-400',     sign: '−' },
  transfer:   { label: 'تحويل',         color: 'text-blue-400',    sign: '↔' },
}

export default async function MovementsPage({ searchParams }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  let query = supabase
    .from('stock_movements')
    .select('id, type, quantity, quantity_before, quantity_after, notes, created_at, products(name, sku)')
    .eq('store_id', store.id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (searchParams.type) query = query.eq('type', searchParams.type)

  const { data: movements } = await query

  const TYPES = ['purchase', 'sale', 'return', 'adjustment', 'damage']

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/dashboard/inventory" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          المخزون →
        </Link>
        <h1 className="text-xl font-semibold text-white">سجل حركات المخزون</h1>
      </div>

      {/* فلاتر النوع */}
      <div className="mb-4 flex gap-1 overflow-x-auto pb-1">
        <Link
          href="/dashboard/inventory/movements"
          className={`shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium ${!searchParams.type ? 'bg-sky-500/15 text-sky-400' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
        >
          الكل
        </Link>
        {TYPES.map(t => (
          <Link
            key={t}
            href={`/dashboard/inventory/movements?type=${t}`}
            className={`shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium ${searchParams.type === t ? 'bg-sky-500/15 text-sky-400' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
          >
            {MOVEMENT_LABELS[t]?.label ?? t}
          </Link>
        ))}
      </div>

      {(!movements || movements.length === 0) ? (
        <div className="rounded-2xl border border-white/5 bg-white/3 py-16 text-center">
          <p className="text-slate-500">لا توجد حركات مسجّلة</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/3">
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">التاريخ</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">المنتج</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">النوع</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">الكمية</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">قبل</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">بعد</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">ملاحظة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {(movements as any[]).map((m: {
                id: string
                type: string
                quantity: number
                quantity_before: number
                quantity_after: number
                notes: string | null
                created_at: string
                products: { name: string; sku: string | null } | null
              }) => {
                const ml = MOVEMENT_LABELS[m.type] ?? { label: m.type, color: 'text-white', sign: '' }
                const isPositive = m.quantity > 0
                return (
                  <tr key={m.id} className="hover:bg-white/3">
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(m.created_at).toLocaleDateString('ar', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{m.products?.name ?? '—'}</p>
                      {m.products?.sku && <p className="text-xs text-slate-500" dir="ltr">{m.products.sku}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-medium ${ml.color}`}>{ml.label}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-sm font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`} dir="ltr">
                        {isPositive ? '+' : ''}{m.quantity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-slate-400">{m.quantity_before}</td>
                    <td className="px-4 py-3 text-center text-sm font-semibold text-white">{m.quantity_after}</td>
                    <td className="px-4 py-3 text-sm text-slate-400">{m.notes ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
