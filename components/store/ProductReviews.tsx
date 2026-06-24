'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { uploadReviewPhoto } from '@/lib/supabase/storage'

interface Review {
  id: string
  customer_name: string
  rating: number
  comment: string | null
  photos: string[]
  created_at: string
}

interface Props {
  productId: string
  storeId: string
  reviews: Review[]
  avg: number | null
  count: number
}

function Stars({ value, size = 'sm' }: { value: number; size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'text-xl' : 'text-sm'
  return (
    <span className={`${cls} leading-none`} dir="ltr">
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} className={n <= Math.round(value) ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'}>★</span>
      ))}
    </span>
  )
}

export default function ProductReviews({ productId, storeId, reviews, avg, count }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    setFiles(prev => [...prev, ...picked].slice(0, 4))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('أدخل اسمك'); return }
    if (rating < 1) { setError('اختر عدد النجوم'); return }
    setSubmitting(true)
    setError('')
    try {
      const photoUrls: string[] = []
      for (const f of files) {
        photoUrls.push(await uploadReviewPhoto(storeId, productId, f))
      }
      const { error: insErr } = await createClient().from('product_reviews').insert({
        store_id: storeId,
        product_id: productId,
        customer_name: name.trim(),
        rating,
        comment: comment.trim() || null,
        photos: photoUrls,
        status: 'pending',
      })
      if (insErr) throw new Error(insErr.message)
      setDone(true)
      setShowForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر إرسال التقييم')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="mt-10 border-t border-gray-100 pt-8 dark:border-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">تقييمات العملاء</h2>
        {!showForm && !done && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-gray-900"
          >
            ✍️ أضف تقييمك
          </button>
        )}
      </div>

      {/* ملخص */}
      <div className="mt-3 flex items-center gap-3">
        {count > 0 ? (
          <>
            <span className="text-2xl font-bold text-gray-900 dark:text-white">{(avg ?? 0).toFixed(1)}</span>
            <Stars value={avg ?? 0} size="lg" />
            <span className="text-sm text-gray-500 dark:text-gray-400">({count} تقييم)</span>
          </>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">لا توجد تقييمات بعد — كن أول من يقيّم هذا المنتج</p>
        )}
      </div>

      {done && (
        <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
          ✓ شكراً لك! سيظهر تقييمك بعد مراجعته من المتجر.
        </div>
      )}

      {/* نموذج التقييم */}
      {showForm && (
        <form onSubmit={submit} className="mt-4 space-y-3 rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button"
                onMouseEnter={() => setHover(n)} onClick={() => setRating(n)}
                className="text-3xl leading-none transition-transform hover:scale-110" aria-label={`${n} نجوم`}>
                <span className={(hover || rating) >= n ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'}>★</span>
              </button>
            ))}
          </div>
          <input
            value={name} onChange={e => setName(e.target.value)} placeholder="اسمك"
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
          <textarea
            value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder="شاركنا رأيك بالمنتج..."
            className="w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
          <div>
            <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-500 hover:border-gray-400 dark:border-gray-700 dark:text-gray-400">
              📷 أضف صوراً (حتى 4)
              <input type="file" accept="image/*" multiple onChange={onPickFiles} className="hidden" disabled={files.length >= 4} />
            </label>
            {files.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {files.map((f, i) => (
                  <div key={i} className="relative">
                    <img src={URL.createObjectURL(f)} alt="" className="h-16 w-16 rounded-lg object-cover" />
                    <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-xs text-white">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">إلغاء</button>
            <button type="submit" disabled={submitting}
              className="flex-1 rounded-xl bg-gray-900 py-2.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-gray-900">
              {submitting ? 'جارٍ الإرسال...' : 'إرسال التقييم'}
            </button>
          </div>
        </form>
      )}

      {/* قائمة التقييمات */}
      {reviews.length > 0 && (
        <div className="mt-6 space-y-4">
          {reviews.map(r => (
            <div key={r.id} className="rounded-2xl border border-gray-100 p-4 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <p className="font-medium text-gray-900 dark:text-white">{r.customer_name}</p>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {new Date(r.created_at).toLocaleDateString('ar-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' })}
                </span>
              </div>
              <div className="mt-1"><Stars value={r.rating} /></div>
              {r.comment && <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{r.comment}</p>}
              {r.photos.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.photos.map((p, i) => (
                    <a key={i} href={p} target="_blank" rel="noopener noreferrer">
                      <img src={p} alt="" className="h-20 w-20 rounded-lg object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
