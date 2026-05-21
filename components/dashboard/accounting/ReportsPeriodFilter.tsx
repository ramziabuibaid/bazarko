'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const PERIODS = [
  { value: 'month',   label: 'هذا الشهر' },
  { value: 'quarter', label: 'هذا الربع' },
  { value: 'year',    label: 'هذه السنة' },
  { value: 'custom',  label: 'مخصص' },
]

interface Props {
  current: string
  from?: string
  to?: string
}

export default function ReportsPeriodFilter({ current, from, to }: Props) {
  const router = useRouter()
  const [fromDate, setFromDate] = useState(from ?? '')
  const [toDate, setToDate]     = useState(to ?? '')

  function setPeriod(p: string) {
    if (p !== 'custom') router.push(`?period=${p}`)
    else router.push(`?period=custom`)
  }

  function applyCustom() {
    if (!fromDate || !toDate) return
    router.push(`?period=custom&from=${fromDate}&to=${toDate}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex overflow-hidden rounded-xl border border-white/10">
        {PERIODS.map(p => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`px-4 py-2 text-sm transition-colors ${
              current === p.value
                ? 'bg-sky-600 text-white'
                : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {current === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/50"
          />
          <span className="text-slate-500">←</span>
          <input
            type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/50"
          />
          <button onClick={applyCustom}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-500 disabled:opacity-40"
            disabled={!fromDate || !toDate}
          >
            تطبيق
          </button>
        </div>
      )}
    </div>
  )
}
