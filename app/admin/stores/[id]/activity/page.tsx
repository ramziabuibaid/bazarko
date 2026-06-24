import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import Link from 'next/link'

interface Props {
  params: { id: string }
  searchParams: { days?: string; actor?: string }
}

// ── أنواع ──────────────────────────────────────────────────────────────
type StaffRow = {
  id: string
  actor_id: string | null
  actor_name: string | null
  session_id: string
  kind: string
  action: string | null
  entity_type: string | null
  entity_label: string | null
  page_path: string | null
  details: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  browser: string | null
  os: string | null
  device_type: string | null
  screen: string | null
  viewport: string | null
  language: string | null
  timezone: string | null
  created_at: string
}

type FinRow = {
  id: string
  actor_id: string | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_label: string | null
  details: Record<string, unknown> | null
  created_at: string
}

// أقصى فجوة بين حدثين تُحتسب كوقت نشط متواصل (ثانية)
const IDLE_GAP = 90

const KIND_LABELS: Record<string, string> = {
  session_start: 'دخول', session_end: 'خروج', heartbeat: 'نبضة',
  page_view: 'تصفّح صفحة', action: 'عملية', paste: 'لصق نص',
}
const ACTION_META: Record<string, { label: string; icon: string; cls: string }> = {
  create:        { label: 'إنشاء',      icon: '➕', cls: 'bg-emerald-500/15 text-emerald-400' },
  update:        { label: 'تعديل',      icon: '✏️', cls: 'bg-sky-500/15 text-sky-400' },
  delete:        { label: 'حذف',        icon: '🗑️', cls: 'bg-red-500/15 text-red-400' },
  status_change: { label: 'تغيير حالة', icon: '🔄', cls: 'bg-amber-500/15 text-amber-400' },
  login:         { label: 'دخول',       icon: '🔐', cls: 'bg-sky-500/15 text-sky-400' },
  logout:        { label: 'خروج',       icon: '🚪', cls: 'bg-slate-500/15 text-slate-400' },
  payment:       { label: 'دفعة',       icon: '💵', cls: 'bg-emerald-500/15 text-emerald-400' },
  cancel:        { label: 'إلغاء',      icon: '🚫', cls: 'bg-red-500/15 text-red-400' },
}
const ENTITY_LABELS: Record<string, string> = {
  product: 'منتج', category: 'فئة', order: 'طلبية', offer: 'عرض',
  customer: 'زبون', repair: 'صيانة', settings: 'إعدادات',
  invoice: 'فاتورة', voucher: 'سند', cash_movement: 'حركة صندوق', cash_session: 'إغلاق صندوق',
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} ثانية`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return `${h}س ${m}د`
  return `${m} دقيقة`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('ar-u-nu-latn', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

export default async function StoreActivityPage({ params, searchParams }: Props) {
  const supabase = createAdminClient()

  const { data: store } = await supabase
    .from('stores').select('id, name, currency_code').eq('id', params.id).single()
  if (!store) notFound()

  const days = Math.max(1, Math.min(90, parseInt(searchParams.days ?? '7') || 7))
  const since = new Date(Date.now() - days * 86400_000).toISOString()

  // أعضاء المتجر (لربط actor_id بالاسم والدور)
  const { data: members } = await supabase
    .from('store_members')
    .select('profile_id, role, profiles(full_name)')
    .eq('store_id', params.id)

  const memberMeta = new Map<string, { name: string; role: string }>()
  for (const m of (members ?? []) as unknown as Array<{ profile_id: string; role: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }>) {
    const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
    memberMeta.set(m.profile_id, { name: prof?.full_name ?? 'بدون اسم', role: m.role })
  }

  // أحداث النشاط + السجل المالي ضمن الفترة
  const [{ data: staff }, { data: fin }] = await Promise.all([
    supabase.from('staff_activity')
      .select('id, actor_id, actor_name, session_id, kind, action, entity_type, entity_label, page_path, details, ip_address, user_agent, browser, os, device_type, screen, viewport, language, timezone, created_at')
      .eq('store_id', params.id).gte('created_at', since)
      .order('created_at', { ascending: true }),
    supabase.from('financial_audit_log')
      .select('id, actor_id, actor_name, action, entity_type, entity_label, details, created_at')
      .eq('store_id', params.id).gte('created_at', since)
      .order('created_at', { ascending: true }),
  ])

  const staffRows = (staff ?? []) as StaffRow[]
  const finRows = (fin ?? []) as FinRow[]

  // ── حساب الوقت النشط من الجلسات ────────────────────────────────────────
  // لكل جلسة: نجمع الفجوات بين الأحداث المتتالية بحد أقصى IDLE_GAP لكل فجوة.
  const sessions = new Map<string, StaffRow[]>()
  for (const r of staffRows) {
    if (!sessions.has(r.session_id)) sessions.set(r.session_id, [])
    sessions.get(r.session_id)!.push(r)
  }

  interface ActorStat {
    actorId: string
    name: string
    role: string
    activeSeconds: number
    sessionIds: Set<string>
    pageViews: number
    pastes: number
    actions: Record<string, number>   // action → count
    firstSeen: string | null
    lastSeen: string | null
    perDaySeconds: Record<string, number>
    ips: Map<string, number>          // IP → عدد المرات
    devices: Set<string>              // "Chrome · Windows · desktop"
    timezones: Set<string>
  }
  const stats = new Map<string, ActorStat>()
  const ensure = (actorId: string | null, fallbackName: string | null): ActorStat => {
    const key = actorId ?? 'unknown'
    if (!stats.has(key)) {
      stats.set(key, {
        actorId: key,
        name: memberMeta.get(key)?.name ?? fallbackName ?? 'غير معروف',
        role: memberMeta.get(key)?.role ?? '—',
        activeSeconds: 0, sessionIds: new Set(), pageViews: 0, pastes: 0,
        actions: {}, firstSeen: null, lastSeen: null, perDaySeconds: {},
        ips: new Map(), devices: new Set(), timezones: new Set(),
      })
    }
    return stats.get(key)!
  }

  for (const [, events] of sessions) {
    const actorId = events[0].actor_id
    const st = ensure(actorId, events[0].actor_name)
    st.sessionIds.add(events[0].session_id)
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]
      // تتبّع أول/آخر ظهور
      if (!st.firstSeen || ev.created_at < st.firstSeen) st.firstSeen = ev.created_at
      if (!st.lastSeen || ev.created_at > st.lastSeen) st.lastSeen = ev.created_at
      if (ev.kind === 'page_view') st.pageViews++
      if (ev.kind === 'paste') st.pastes++
      if (ev.kind === 'action' && ev.action) st.actions[ev.action] = (st.actions[ev.action] ?? 0) + 1
      if (ev.ip_address) st.ips.set(ev.ip_address, (st.ips.get(ev.ip_address) ?? 0) + 1)
      if (ev.browser || ev.os) st.devices.add([ev.browser, ev.os, ev.device_type].filter(Boolean).join(' · '))
      if (ev.timezone) st.timezones.add(ev.timezone)
      // الوقت النشط = الفجوة عن الحدث السابق (بحد أقصى)
      if (i > 0) {
        const gap = (new Date(ev.created_at).getTime() - new Date(events[i - 1].created_at).getTime()) / 1000
        const capped = Math.min(Math.max(gap, 0), IDLE_GAP)
        st.activeSeconds += capped
        st.perDaySeconds[dayKey(ev.created_at)] = (st.perDaySeconds[dayKey(ev.created_at)] ?? 0) + capped
      }
    }
  }

  // دمج العمليات المالية في عدّادات الأفعال
  for (const f of finRows) {
    const st = ensure(f.actor_id, f.actor_name)
    st.actions[f.action] = (st.actions[f.action] ?? 0) + 1
    if (!st.firstSeen || f.created_at < st.firstSeen) st.firstSeen = f.created_at
    if (!st.lastSeen || f.created_at > st.lastSeen) st.lastSeen = f.created_at
  }

  const actorStats = [...stats.values()].sort((a, b) => b.activeSeconds - a.activeSeconds)

  // ── تايملاين موحّد (آخر 250 حدثاً، الأحدث أولاً) ─────────────────────────
  type TimelineItem = {
    id: string; actorName: string; created_at: string
    kind: string; action: string | null; entityType: string | null
    entityLabel: string | null; pagePath: string | null; details: Record<string, unknown> | null
    ip: string | null; device: string | null
  }
  const timeline: TimelineItem[] = [
    ...staffRows
      .filter(r => r.kind !== 'heartbeat')   // النبضات ضوضاء — تُستثنى من العرض
      .map(r => ({
        id: r.id, actorName: r.actor_name ?? memberMeta.get(r.actor_id ?? '')?.name ?? 'غير معروف',
        created_at: r.created_at, kind: r.kind, action: r.action,
        entityType: r.entity_type, entityLabel: r.entity_label, pagePath: r.page_path, details: r.details,
        ip: r.ip_address, device: [r.browser, r.os].filter(Boolean).join(' · ') || null,
      })),
    ...finRows.map(f => ({
      id: f.id, actorName: f.actor_name ?? 'غير معروف', created_at: f.created_at,
      kind: 'action', action: f.action, entityType: f.entity_type,
      entityLabel: f.entity_label, pagePath: null, details: f.details,
      ip: null, device: null,
    })),
  ]
  .filter(t => !searchParams.actor || (memberMeta.get(searchParams.actor)?.name === t.actorName) || searchParams.actor === 'unknown')
  .sort((a, b) => b.created_at.localeCompare(a.created_at))
  .slice(0, 250)

  const DAY_OPTIONS = [1, 7, 14, 30]

  // أقصى دقائق يومية لرسم الأعمدة
  const maxDaySeconds = Math.max(
    1,
    ...actorStats.flatMap(s => Object.values(s.perDaySeconds)),
  )
  const lastDays = Array.from({ length: Math.min(days, 14) }, (_, i) =>
    dayKey(new Date(Date.now() - i * 86400_000).toISOString())
  ).reverse()

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/admin/stores/${params.id}`} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          ← المتجر
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-white">⏱️ نشاط الموظفين — {store.name}</h1>
          <p className="mt-0.5 text-sm text-slate-400">الوقت الفعلي النشط + كل التحركات خلال آخر {days} يوم</p>
        </div>
        <div className="flex gap-1">
          {DAY_OPTIONS.map(d => (
            <Link key={d} href={`/admin/stores/${params.id}/activity?days=${d}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                days === d ? 'bg-sky-500 text-white' : 'border border-white/10 text-slate-400 hover:text-white'
              }`}>
              {d === 1 ? 'اليوم' : `${d} يوم`}
            </Link>
          ))}
        </div>
      </div>

      {actorStats.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-white/3 py-16 text-center">
          <p className="text-4xl">🗒️</p>
          <p className="mt-3 font-medium text-slate-300">لا يوجد نشاط مسجّل في هذه الفترة</p>
          <p className="mt-1 text-sm text-slate-500">سيظهر هنا وقت كل موظف وتحركاته بعد دخوله للوحة</p>
        </div>
      ) : (
        <>
          {/* بطاقات الموظفين */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {actorStats.map(st => {
              const totalActions = Object.values(st.actions).reduce((a, b) => a + b, 0)
              const pasteRatio = totalActions > 0 ? Math.round((st.pastes / (totalActions + st.pastes)) * 100) : 0
              return (
                <div key={st.actorId} className="rounded-2xl border border-white/5 bg-slate-900 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-white">{st.name}</p>
                      <p className="text-xs text-slate-500">{st.role}</p>
                    </div>
                    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-400">
                      {st.sessionIds.size} جلسة
                    </span>
                  </div>

                  <div className="mt-3 rounded-xl bg-white/3 p-3 text-center">
                    <p className="text-2xl font-bold text-emerald-400">{fmtDuration(st.activeSeconds)}</p>
                    <p className="mt-0.5 text-xs text-slate-500">وقت نشط فعلي</p>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-white/3 py-2">
                      <p className="font-bold text-white">{totalActions}</p>
                      <p className="text-slate-500">عملية</p>
                    </div>
                    <div className="rounded-lg bg-white/3 py-2">
                      <p className="font-bold text-white">{st.pageViews}</p>
                      <p className="text-slate-500">تصفّح</p>
                    </div>
                    <div className={`rounded-lg py-2 ${pasteRatio > 40 ? 'bg-amber-500/10' : 'bg-white/3'}`}>
                      <p className={`font-bold ${pasteRatio > 40 ? 'text-amber-400' : 'text-white'}`}>{st.pastes}</p>
                      <p className="text-slate-500">لصق</p>
                    </div>
                  </div>

                  {/* تفصيل الأفعال */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(st.actions).sort((a, b) => b[1] - a[1]).map(([act, n]) => {
                      const m = ACTION_META[act] ?? { label: act, icon: '•', cls: 'bg-white/5 text-white' }
                      return (
                        <span key={act} className={`rounded-full px-2 py-0.5 text-[11px] ${m.cls}`}>
                          {m.icon} {m.label} {n}
                        </span>
                      )
                    })}
                  </div>

                  {/* أعمدة الوقت اليومي */}
                  <div className="mt-3 flex items-end gap-1" style={{ height: 44 }}>
                    {lastDays.map(d => {
                      const sec = st.perDaySeconds[d] ?? 0
                      const h = Math.round((sec / maxDaySeconds) * 40)
                      return (
                        <div key={d} className="flex-1" title={`${d}: ${fmtDuration(sec)}`}>
                          <div className="w-full rounded-sm bg-sky-500/70" style={{ height: Math.max(sec > 0 ? 3 : 0, h) }} />
                        </div>
                      )
                    })}
                  </div>

                  {/* الأجهزة والـ IP */}
                  <div className="mt-3 space-y-1.5 border-t border-white/5 pt-3">
                    <div>
                      <p className="text-[10px] text-slate-500">عناوين IP ({st.ips.size})</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {[...st.ips.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([ip, n]) => (
                          <span key={ip} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-300" dir="ltr">
                            {ip} <span className="text-slate-500">×{n}</span>
                          </span>
                        ))}
                        {st.ips.size === 0 && <span className="text-[10px] text-slate-600">—</span>}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">الأجهزة ({st.devices.size})</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {[...st.devices].slice(0, 3).map(d => (
                          <span key={d} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">{d}</span>
                        ))}
                        {st.devices.size === 0 && <span className="text-[10px] text-slate-600">—</span>}
                      </div>
                    </div>
                    {st.timezones.size > 0 && (
                      <p className="text-[10px] text-slate-500">
                        المنطقة الزمنية: <span className="text-slate-300" dir="ltr">{[...st.timezones].join('، ')}</span>
                      </p>
                    )}
                  </div>

                  <p className="mt-2 text-[11px] text-slate-500">
                    آخر ظهور: {st.lastSeen ? fmtTime(st.lastSeen) : '—'}
                  </p>
                </div>
              )
            })}
          </div>

          {/* تايملاين موحّد */}
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-300">📜 سجل التحركات التفصيلي ({timeline.length})</h2>
            <div className="space-y-1.5">
              {timeline.map(t => {
                const m = t.action ? (ACTION_META[t.action] ?? null) : null
                const icon = t.kind === 'page_view' ? '👁️' : t.kind === 'paste' ? '📋' :
                  t.kind === 'session_start' ? '🔐' : t.kind === 'session_end' ? '🚪' : (m?.icon ?? '•')
                const label =
                  t.kind === 'page_view' ? `تصفّح ${t.pagePath ?? ''}` :
                  t.kind === 'paste' ? `لصق نص (${(t.details?.length as number) ?? '?'} حرف) في ${(t.details?.field as string) ?? '—'}` :
                  t.kind === 'session_start' ? 'بدأ جلسة عمل' :
                  t.kind === 'session_end' ? 'أنهى جلسة العمل' :
                  `${m?.label ?? t.action ?? KIND_LABELS[t.kind]} ${ENTITY_LABELS[t.entityType ?? ''] ?? t.entityType ?? ''}`
                const changed = t.details?.changed as string[] | undefined
                return (
                  <div key={t.id} className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-900 px-3 py-2">
                    <span className="text-base">{icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-200">
                        {label}
                        {t.entityLabel && <span className="mr-1 font-mono text-xs text-sky-400" dir="ltr"> {t.entityLabel}</span>}
                        {changed && changed.length > 0 && (
                          <span className="mr-1 text-xs text-slate-500">— غيّر: {changed.join('، ')}</span>
                        )}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t.actorName} · {fmtTime(t.created_at)}
                        {t.ip && <span className="font-mono text-slate-600" dir="ltr"> · {t.ip}</span>}
                        {t.device && <span className="text-slate-600"> · {t.device}</span>}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
