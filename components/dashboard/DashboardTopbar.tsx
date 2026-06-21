'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export interface DashNotification {
  icon: string
  text: string
  href: string
  tone: 'red' | 'amber'
}

interface SearchResult {
  group: 'عملاء' | 'منتجات' | 'فواتير'
  icon: string
  label: string
  sub: string
  href: string
}

export default function DashboardTopbar({
  storeId,
  notifications,
}: {
  storeId: string
  notifications: DashNotification[]
}) {
  const router = useRouter()
  const supabase = createClient()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [showBell, setShowBell] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const bellRef = useRef<HTMLDivElement>(null)

  // إغلاق القوائم عند النقر خارجها
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowResults(false)
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setShowBell(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // بحث مع debounce
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(async () => {
      const [cust, prod, invs] = await Promise.all([
        supabase.from('customers').select('id, name, phone').eq('store_id', storeId)
          .or(`name.ilike.%${q}%,phone.ilike.%${q}%`).limit(5),
        supabase.from('products').select('id, name, sku').eq('store_id', storeId)
          .or(`name.ilike.%${q}%,sku.ilike.%${q}%`).limit(5),
        supabase.from('invoices').select('id, invoice_number, customer_name, total').eq('store_id', storeId)
          .ilike('invoice_number', `%${q}%`).limit(5),
      ])
      const out: SearchResult[] = []
      for (const c of (cust.data ?? []) as { id: string; name: string; phone: string | null }[])
        out.push({ group: 'عملاء', icon: '👤', label: c.name, sub: c.phone ?? '', href: `/dashboard/customers/${c.id}` })
      for (const p of (prod.data ?? []) as { id: string; name: string; sku: string | null }[])
        out.push({ group: 'منتجات', icon: '📦', label: p.name, sub: p.sku ?? '', href: `/dashboard/products/${p.id}` })
      for (const i of (invs.data ?? []) as { id: string; invoice_number: string; customer_name: string | null; total: number }[])
        out.push({ group: 'فواتير', icon: '🧾', label: i.invoice_number, sub: i.customer_name ?? '', href: `/dashboard/accounting/invoices/${i.id}` })
      setResults(out)
      setSearching(false)
      setShowResults(true)
    }, 280)
    return () => clearTimeout(t)
  }, [query, storeId, supabase])

  function go(href: string) {
    setShowResults(false); setQuery('')
    router.push(href)
  }

  return (
    <div className="flex flex-1 items-center gap-2">
      {/* البحث السريع */}
      <div ref={boxRef} className="relative flex-1 max-w-md">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 focus-within:border-sky-500/50">
          <span className="text-slate-500">🔍</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => query.trim().length >= 2 && setShowResults(true)}
            placeholder="بحث عن فاتورة أو عميل أو منتج..."
            className="w-full bg-transparent text-sm text-white placeholder-slate-500 outline-none"
          />
        </div>

        {showResults && (
          <div className="absolute right-0 left-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-slate-900 shadow-xl">
            {searching ? (
              <p className="px-4 py-6 text-center text-xs text-slate-500">جارٍ البحث...</p>
            ) : results.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-slate-500">لا توجد نتائج لـ &laquo;{query}&raquo;</p>
            ) : (
              ['عملاء', 'منتجات', 'فواتير'].map(group => {
                const items = results.filter(r => r.group === group)
                if (items.length === 0) return null
                return (
                  <div key={group} className="border-b border-white/5 last:border-0">
                    <p className="px-4 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600">{group}</p>
                    {items.map((r, i) => (
                      <button key={i} onClick={() => go(r.href)}
                        className="flex w-full items-center gap-3 px-4 py-2 text-right transition-colors hover:bg-white/5">
                        <span>{r.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-white">{r.label}</span>
                          {r.sub && <span className="block truncate text-[11px] text-slate-500" dir="ltr">{r.sub}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* جرس الإشعارات */}
      <div ref={bellRef} className="relative">
        <button
          onClick={() => setShowBell(s => !s)}
          className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-white/10"
          aria-label="الإشعارات"
        >
          🔔
          {notifications.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {notifications.length}
            </span>
          )}
        </button>

        {showBell && (
          <div className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-xl">
            <p className="border-b border-white/5 px-4 py-2.5 text-xs font-semibold text-white">🔔 الإشعارات</p>
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-slate-500">لا توجد تنبيهات — كل شيء على ما يُرام ✅</p>
            ) : (
              notifications.map((n, i) => (
                <Link key={i} href={n.href} onClick={() => setShowBell(false)}
                  className="flex items-center gap-3 border-b border-white/5 px-4 py-3 text-sm transition-colors last:border-0 hover:bg-white/5">
                  <span className="text-base">{n.icon}</span>
                  <span className={n.tone === 'red' ? 'text-red-300' : 'text-amber-300'}>{n.text}</span>
                </Link>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
