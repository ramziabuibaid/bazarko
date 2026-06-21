export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-white/5 ${className}`} />
}

/** هيكل تحميل عام لصفحات المحاسبة (بطاقات + جدول). */
export function TablePageSkeleton({ cards = 4, rows = 6 }: { cards?: number; rows?: number }) {
  return (
    <div className="space-y-5 p-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: cards }).map((_, i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <div className="space-y-2 rounded-2xl border border-white/5 p-3">
        {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-11" />)}
      </div>
    </div>
  )
}
