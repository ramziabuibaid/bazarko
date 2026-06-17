'use client'

import { useRouter } from 'next/navigation'

const PERIODS = [
  { key: 'today',      label: 'اليوم' },
  { key: 'week',       label: 'هذا الأسبوع' },
  { key: 'month',      label: 'هذا الشهر' },
  { key: 'last_month', label: 'الشهر الماضي' },
]

export default function AccountingPeriodFilter({ active }: { active: string }) {
  const router = useRouter()
  return (
    <div className="flex gap-1 rounded-xl border border-white/5 bg-white/3 p-1">
      {PERIODS.map(p => (
        <button
          key={p.key}
          onClick={() => router.push(`/dashboard/accounting?period=${p.key}`)}
          className={`flex-1 rounded-lg py-2 text-xs font-medium transition-colors ${
            active === p.key
              ? 'bg-slate-700 text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
