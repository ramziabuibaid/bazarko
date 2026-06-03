export default function DashboardLoading() {
  return (
    <div className="animate-pulse p-6 space-y-6">
      {/* عنوان الصفحة */}
      <div className="h-7 w-48 rounded-lg bg-white/5" />

      {/* بطاقات إحصاء */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border border-white/5 bg-slate-900 p-4 space-y-3">
            <div className="h-4 w-24 rounded bg-white/5" />
            <div className="h-8 w-16 rounded bg-white/5" />
          </div>
        ))}
      </div>

      {/* محتوى رئيسي */}
      <div className="rounded-xl border border-white/5 bg-slate-900 p-4 space-y-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-4 w-4 rounded-full bg-white/5 shrink-0" />
            <div className="h-4 flex-1 rounded bg-white/5" />
            <div className="h-4 w-20 rounded bg-white/5" />
            <div className="h-4 w-16 rounded bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  )
}
