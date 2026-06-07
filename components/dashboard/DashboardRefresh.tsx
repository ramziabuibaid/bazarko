'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export default function DashboardRefresh({ loadedAt }: { loadedAt: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    setElapsed(0)
    const loaded = new Date(loadedAt).getTime()
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - loaded) / 1000))
    }, 30000)
    return () => clearInterval(interval)
  }, [loadedAt])

  function formatElapsed(s: number) {
    if (s < 10)   return 'الآن'
    if (s < 60)   return `منذ ${s} ثانية`
    if (s < 3600) return `منذ ${Math.floor(s / 60)} دقيقة`
    return `منذ ${Math.floor(s / 3600)} ساعة`
  }

  function handleRefresh() {
    startTransition(() => { router.refresh() })
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-xs text-slate-500">{formatElapsed(elapsed)}</span>
      <button
        onClick={handleRefresh}
        disabled={isPending}
        title="تحديث البيانات"
        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300 disabled:opacity-40"
      >
        <svg
          width="14" height="14" viewBox="0 0 14 14"
          fill="none" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round"
          className={isPending ? 'animate-spin' : ''}
        >
          <path d="M12.5 7a5.5 5.5 0 1 1-1.1-3.3" />
          <polyline points="12.5 1.5 12.5 5 9 5" />
        </svg>
      </button>
    </div>
  )
}
