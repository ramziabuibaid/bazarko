'use client'

import { useState } from 'react'
import Link from 'next/link'

interface RepairJob {
  id: string
  job_number: string
  customer_name: string
  customer_phone: string | null
  device_type: string
  brand: string | null
  model: string | null
  status: string
  priority: string
  received_at: string
  estimated_done: string | null
  assigned_to: string | null
  estimated_cost: number | null
  final_cost: number
}

interface Props {
  jobs: RepairJob[]
  currencyCode: string
}

const COLUMNS = [
  { status: 'received',      label: 'استُلم',          color: 'amber',   icon: '📥' },
  { status: 'diagnosing',    label: 'التشخيص',          color: 'blue',    icon: '🔍' },
  { status: 'in_repair',     label: 'قيد الإصلاح',     color: 'purple',  icon: '🔧' },
  { status: 'waiting_parts', label: 'انتظار قطع',       color: 'orange',  icon: '⏳' },
  { status: 'ready',         label: 'جاهز للاستلام',   color: 'emerald', icon: '✅' },
]

const COLUMN_COLORS: Record<string, { border: string; badge: string; dot: string }> = {
  amber:   { border: 'border-amber-500/30',   badge: 'bg-amber-500/15 text-amber-300',   dot: 'bg-amber-400' },
  blue:    { border: 'border-blue-500/30',    badge: 'bg-blue-500/15 text-blue-300',     dot: 'bg-blue-400' },
  purple:  { border: 'border-purple-500/30',  badge: 'bg-purple-500/15 text-purple-300', dot: 'bg-purple-400' },
  orange:  { border: 'border-orange-500/30',  badge: 'bg-orange-500/15 text-orange-300', dot: 'bg-orange-400' },
  emerald: { border: 'border-emerald-500/30', badge: 'bg-emerald-500/15 text-emerald-300', dot: 'bg-emerald-400' },
}

const DEVICE_ICONS: Record<string, string> = {
  phone: '📱', laptop: '💻', tablet: '📟', tv: '📺',
  printer: '🖨️', camera: '📷', appliance: '🔌', other: '🔧',
}

function daysSince(date: string) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000)
}

function isOverdue(estimatedDone: string | null) {
  if (!estimatedDone) return false
  return new Date(estimatedDone) < new Date()
}

export default function RepairKanban({ jobs, currencyCode }: Props) {
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? jobs.filter(j =>
        j.job_number.toLowerCase().includes(search.toLowerCase()) ||
        j.customer_name.includes(search) ||
        (j.brand ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (j.model ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : jobs

  const urgentCount   = jobs.filter(j => j.priority === 'urgent').length
  const overdueCount  = jobs.filter(j => isOverdue(j.estimated_done)).length

  return (
    <div className="space-y-5">
      {/* ── شريط الإحصاءات ── */}
      <div className="flex flex-wrap gap-3">
        {COLUMNS.map(col => {
          const count = jobs.filter(j => j.status === col.status).length
          const clr   = COLUMN_COLORS[col.color]
          return (
            <div key={col.status} className={`flex items-center gap-2 rounded-xl border ${clr.border} bg-white/3 px-4 py-2`}>
              <span className="text-base">{col.icon}</span>
              <span className="text-sm text-slate-300">{col.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${clr.badge}`}>{count}</span>
            </div>
          )
        })}
        {urgentCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-2">
            <span className="text-base">🔴</span>
            <span className="text-sm text-red-300">{urgentCount} عاجل</span>
          </div>
        )}
        {overdueCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-2">
            <span className="text-base">⚠️</span>
            <span className="text-sm text-yellow-300">{overdueCount} متأخر</span>
          </div>
        )}
      </div>

      {/* ── بحث ── */}
      <input
        value={search} onChange={e => setSearch(e.target.value)}
        placeholder="🔍 بحث برقم الطلب، اسم الزبون، الماركة..."
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
      />

      {/* ── لوحة Kanban ── */}
      <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: '60vh' }}>
        {COLUMNS.map(col => {
          const colJobs = filtered.filter(j => j.status === col.status)
          const clr     = COLUMN_COLORS[col.color]
          return (
            <div key={col.status} className="flex w-72 flex-shrink-0 flex-col">
              {/* رأس العمود */}
              <div className={`mb-3 flex items-center gap-2 rounded-xl border ${clr.border} bg-white/3 px-3 py-2`}>
                <span className={`h-2 w-2 rounded-full ${clr.dot}`} />
                <span className="text-sm font-medium text-white">{col.label}</span>
                <span className={`mr-auto rounded-full px-2 py-0.5 text-xs font-bold ${clr.badge}`}>{colJobs.length}</span>
              </div>

              {/* البطاقات */}
              <div className="flex-1 space-y-3">
                {colJobs.length === 0 && (
                  <div className="rounded-xl border border-dashed border-white/5 py-8 text-center">
                    <p className="text-xs text-slate-600">لا طلبيات</p>
                  </div>
                )}
                {colJobs.map(job => {
                  const days    = daysSince(job.received_at)
                  const overdue = isOverdue(job.estimated_done)
                  return (
                    <Link key={job.id} href={`/dashboard/maintenance/${job.id}`}>
                      <div className={`rounded-xl border bg-slate-900 p-4 transition-all hover:border-white/20 hover:-translate-y-0.5 hover:shadow-lg cursor-pointer ${
                        job.priority === 'urgent' ? 'border-red-500/40' : 'border-white/5'
                      }`}>
                        {/* رأس البطاقة */}
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <span className="font-mono text-xs text-slate-400" dir="ltr">{job.job_number}</span>
                          <div className="flex gap-1">
                            {job.priority === 'urgent' && (
                              <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400">عاجل</span>
                            )}
                            {overdue && (
                              <span className="rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-400">متأخر</span>
                            )}
                          </div>
                        </div>

                        {/* الجهاز */}
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-xl">{DEVICE_ICONS[job.device_type] ?? '🔧'}</span>
                          <div>
                            <p className="text-sm font-medium text-white leading-tight">
                              {[job.brand, job.model].filter(Boolean).join(' ') || job.device_type}
                            </p>
                            <p className="text-xs text-slate-500">{job.customer_name}</p>
                          </div>
                        </div>

                        {/* تفاصيل */}
                        <div className="space-y-1 border-t border-white/5 pt-2">
                          {job.assigned_to && (
                            <p className="text-xs text-slate-500">👤 {job.assigned_to}</p>
                          )}
                          <div className="flex items-center justify-between">
                            <span className={`text-xs ${days > 7 ? 'text-red-400' : days > 3 ? 'text-yellow-400' : 'text-slate-500'}`}>
                              {days === 0 ? 'اليوم' : `منذ ${days} يوم`}
                            </span>
                            {(job.final_cost > 0 || job.estimated_cost) && (
                              <span className="text-xs font-semibold text-emerald-400" dir="ltr">
                                {(job.final_cost > 0 ? job.final_cost : job.estimated_cost ?? 0).toLocaleString()} {currencyCode}
                              </span>
                            )}
                          </div>
                          {job.estimated_done && (
                            <p className={`text-xs ${overdue ? 'text-red-400' : 'text-slate-500'}`}>
                              📅 {new Date(job.estimated_done).toLocaleDateString('ar', { month: 'short', day: 'numeric' })}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
