'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface Review {
  id: string
  product_id: string
  customer_name: string
  rating: number
  comment: string | null
  photos: string[]
  status: string
  created_at: string
  products: { name: string; slug: string; thumbnail_url: string | null } | null
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:  { label: 'بانتظار المراجعة', cls: 'bg-amber-500/15 text-amber-400' },
  approved: { label: 'معتمد',            cls: 'bg-emerald-500/15 text-emerald-400' },
  rejected: { label: 'مرفوض',            cls: 'bg-red-500/15 text-red-400' },
}

export default function ReviewsModeration({ reviews }: { reviews: Review[] }) {
  const router = useRouter()
  const supabase = createClient()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function setStatus(id: string, status: 'approved' | 'rejected') {
    setBusyId(id)
    await supabase.from('product_reviews').update({ status }).eq('id', id)
    setBusyId(null)
    router.refresh()
  }

  async function remove(id: string) {
    if (!confirm('حذف هذا التقييم نهائياً؟')) return
    setBusyId(id)
    await supabase.from('product_reviews').delete().eq('id', id)
    setBusyId(null)
    router.refresh()
  }

  if (reviews.length === 0) {
    return <div className="rounded-2xl border border-white/5 bg-slate-900 py-12 text-center text-slate-500">لا توجد تقييمات في هذا التبويب</div>
  }

  return (
    <div className="space-y-3">
      {reviews.map(r => {
        const sm = STATUS_META[r.status] ?? { label: r.status, cls: 'bg-white/5 text-white' }
        return (
          <div key={r.id} className="rounded-2xl border border-white/5 bg-slate-900 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {r.products?.thumbnail_url && (
                  <img src={r.products.thumbnail_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{r.products?.name ?? 'منتج محذوف'}</p>
                  <p className="text-xs text-slate-500">
                    {r.customer_name} · {new Date(r.created_at).toLocaleDateString('ar-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </p>
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${sm.cls}`}>{sm.label}</span>
            </div>

            <div className="mt-2" dir="ltr">
              {[1, 2, 3, 4, 5].map(n => (
                <span key={n} className={n <= r.rating ? 'text-amber-400' : 'text-slate-600'}>★</span>
              ))}
            </div>
            {r.comment && <p className="mt-2 text-sm text-slate-300">{r.comment}</p>}
            {r.photos.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {r.photos.map((p, i) => (
                  <a key={i} href={p} target="_blank" rel="noopener noreferrer">
                    <img src={p} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  </a>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {r.status !== 'approved' && (
                <button onClick={() => setStatus(r.id, 'approved')} disabled={busyId === r.id}
                  className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50">
                  ✓ اعتماد ونشر
                </button>
              )}
              {r.status !== 'rejected' && (
                <button onClick={() => setStatus(r.id, 'rejected')} disabled={busyId === r.id}
                  className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10 disabled:opacity-50">
                  إخفاء
                </button>
              )}
              <button onClick={() => remove(r.id)} disabled={busyId === r.id}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                حذف
              </button>
              {r.products?.slug && (
                <Link href={`/dashboard/products/${r.product_id}`} className="mr-auto text-xs text-sky-400 hover:underline">
                  المنتج
                </Link>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
