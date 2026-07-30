'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export type Period = 'today' | 'week' | 'month' | 'year' | 'all'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'اليوم' },
  { value: 'week', label: 'هذا الأسبوع' },
  { value: 'month', label: 'هذا الشهر' },
  { value: 'year', label: 'هذا العام' },
  { value: 'all', label: 'الكل' },
]

export default function TimeFilter() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentPeriod = (searchParams.get('period') as Period) || 'month'

  const handlePeriodChange = (period: Period) => {
    const params = new URLSearchParams(searchParams.toString())
    if (period === 'month') {
      params.delete('period') // month is default
    } else {
      params.set('period', period)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PERIODS.map(p => (
        <button
          key={p.value}
          onClick={() => handlePeriodChange(p.value)}
          className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
            currentPeriod === p.value
              ? 'bg-sky-500 text-white'
              : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
