'use client'

import { useRouter } from 'next/navigation'

const OPTIONS = [
  { value: 'newest',       label: 'الأحدث'        },
  { value: 'oldest',       label: 'الأقدم'        },
  { value: 'price_high',   label: 'الأعلى سعراً'  },
  { value: 'price_low',    label: 'الأقل سعراً'   },
  { value: 'best_selling', label: 'الأكثر مبيعاً' },
]

interface Props {
  current: string
  basePath: string
  category?: string
  q?: string
}

export default function SortSelect({ current, basePath, category, q }: Props) {
  const router = useRouter()

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (q)        params.set('q', q)
    if (e.target.value !== 'newest') params.set('sort', e.target.value)
    const qs = params.toString()
    router.push(`${basePath}${qs ? `?${qs}` : ''}`)
  }

  return (
    <select
      value={current}
      onChange={onChange}
      className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:focus:border-gray-600"
    >
      {OPTIONS.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
