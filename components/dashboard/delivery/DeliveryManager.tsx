'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface ShippingMethod {
  id: string
  name: string
  cost: number
  min_days: number | null
  max_days: number | null
  is_active: boolean
  sort_order: number
}

interface Zone {
  id: string
  name: string
  cost: number
  is_active: boolean
  estimated_days: string | null
  sort_order: number
  shipping_methods: ShippingMethod[]
}

interface Props {
  storeId: string
  currencyCode: string
  initialDeliveryEnabled: boolean
  initialFreeThreshold: number | null
  initialZones: Zone[]
}

const EMPTY_ZONE   = { name: '', cost: '', estimated_days: '', is_active: true }
const EMPTY_METHOD = { name: '', cost: '', min_days: '', max_days: '', is_active: true }

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      dir="ltr"
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        enabled ? 'bg-sky-500' : 'bg-white/10'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
        enabled ? 'translate-x-6' : 'translate-x-1'
      }`} />
    </button>
  )
}

const inp = 'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50'

export default function DeliveryManager({
  storeId, currencyCode,
  initialDeliveryEnabled, initialFreeThreshold, initialZones,
}: Props) {
  const router   = useRouter()
  const supabase = createClient()

  const [deliveryEnabled, setDeliveryEnabled] = useState(initialDeliveryEnabled)
  const [freeThreshold, setFreeThreshold]     = useState(
    initialFreeThreshold != null && initialFreeThreshold > 0 ? String(initialFreeThreshold) : ''
  )
  const [zones, setZones] = useState<Zone[]>(initialZones)

  const [expandedZoneId, setExpandedZoneId] = useState<string | null>(null)
  const [zoneModal,   setZoneModal]   = useState<{ open: boolean; editing: Zone | null }>({ open: false, editing: null })
  const [methodModal, setMethodModal] = useState<{ open: boolean; zoneId: string | null; editing: ShippingMethod | null }>({ open: false, zoneId: null, editing: null })
  const [deleteZone,   setDeleteZone]   = useState<string | null>(null)
  const [deleteMethod, setDeleteMethod] = useState<{ methodId: string; zoneId: string } | null>(null)

  const [zoneForm,   setZoneForm]   = useState(EMPTY_ZONE)
  const [methodForm, setMethodForm] = useState(EMPTY_METHOD)
  const [saving,         setSaving]         = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [savedOk,        setSavedOk]        = useState(false)
  const [error,          setError]          = useState('')

  // ── إعدادات عامة ──────────────────────────────────────────

  async function toggleDelivery(enabled: boolean) {
    setDeliveryEnabled(enabled)
    await supabase.from('stores').update({ delivery_enabled: enabled }).eq('id', storeId)
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSavingSettings(true)
    const parsed    = parseFloat(freeThreshold)
    const threshold = freeThreshold.trim() && parsed > 0 ? parsed : null
    await supabase.from('stores').update({ free_delivery_threshold: threshold }).eq('id', storeId)
    setSavingSettings(false)
    setSavedOk(true)
    setTimeout(() => setSavedOk(false), 3000)
    router.refresh()
  }

  // ── CRUD المحافظات ────────────────────────────────────────

  function openAddZone() {
    setZoneForm(EMPTY_ZONE); setError('')
    setZoneModal({ open: true, editing: null })
  }

  function openEditZone(z: Zone) {
    setZoneForm({ name: z.name, cost: String(z.cost), estimated_days: z.estimated_days ?? '', is_active: z.is_active })
    setError('')
    setZoneModal({ open: true, editing: z })
  }

  async function saveZone(e: React.FormEvent) {
    e.preventDefault()
    if (!zoneForm.name.trim()) { setError('اسم المنطقة مطلوب'); return }
    setSaving(true); setError('')
    const payload = {
      store_id: storeId, name: zoneForm.name.trim(),
      cost: parseFloat(zoneForm.cost) || 0,
      estimated_days: zoneForm.estimated_days.trim() || null,
      is_active: zoneForm.is_active,
    }
    const { editing } = zoneModal
    if (editing) {
      const { error: err } = await supabase.from('delivery_zones')
        .update({ name: payload.name, cost: payload.cost, estimated_days: payload.estimated_days, is_active: payload.is_active })
        .eq('id', editing.id)
      if (!err) setZones(zs => zs.map(z => z.id === editing.id ? { ...z, ...payload } : z))
      else { setError('حدث خطأ'); setSaving(false); return }
    } else {
      const { data, error: err } = await supabase.from('delivery_zones')
        .insert({ ...payload, sort_order: zones.length }).select().single()
      if (!err && data) setZones(zs => [...zs, { ...data, shipping_methods: [] }])
      else { setError('حدث خطأ'); setSaving(false); return }
    }
    setSaving(false)
    setZoneModal({ open: false, editing: null })
    router.refresh()
  }

  async function toggleZoneActive(zone: Zone) {
    const next = !zone.is_active
    await supabase.from('delivery_zones').update({ is_active: next }).eq('id', zone.id)
    setZones(zs => zs.map(z => z.id === zone.id ? { ...z, is_active: next } : z))
  }

  async function confirmDeleteZone(id: string) {
    setSaving(true)
    await supabase.from('delivery_zones').delete().eq('id', id)
    setZones(zs => zs.filter(z => z.id !== id))
    setDeleteZone(null); setSaving(false)
  }

  // ── CRUD أنواع الشحن ──────────────────────────────────────

  function openAddMethod(zoneId: string) {
    setMethodForm(EMPTY_METHOD); setError('')
    setMethodModal({ open: true, zoneId, editing: null })
  }

  function openEditMethod(zoneId: string, m: ShippingMethod) {
    setMethodForm({
      name: m.name, cost: String(m.cost),
      min_days: m.min_days != null ? String(m.min_days) : '',
      max_days: m.max_days != null ? String(m.max_days) : '',
      is_active: m.is_active,
    })
    setError('')
    setMethodModal({ open: true, zoneId, editing: m })
  }

  async function saveMethod(e: React.FormEvent) {
    e.preventDefault()
    if (!methodForm.name.trim()) { setError('اسم نوع الشحن مطلوب'); return }
    const { zoneId, editing } = methodModal
    if (!zoneId) return
    setSaving(true); setError('')
    const payload = {
      zone_id: zoneId, store_id: storeId,
      name: methodForm.name.trim(),
      cost: parseFloat(methodForm.cost) || 0,
      min_days: methodForm.min_days ? parseInt(methodForm.min_days) : null,
      max_days: methodForm.max_days ? parseInt(methodForm.max_days) : null,
      is_active: methodForm.is_active,
    }
    if (editing) {
      const { error: err } = await supabase.from('shipping_methods')
        .update({ name: payload.name, cost: payload.cost, min_days: payload.min_days, max_days: payload.max_days, is_active: payload.is_active })
        .eq('id', editing.id)
      if (!err) {
        setZones(zs => zs.map(z => z.id === zoneId
          ? { ...z, shipping_methods: z.shipping_methods.map(m => m.id === editing.id ? { ...m, ...payload } : m) }
          : z))
      } else { setError('حدث خطأ'); setSaving(false); return }
    } else {
      const zone = zones.find(z => z.id === zoneId)!
      const { data, error: err } = await supabase.from('shipping_methods')
        .insert({ ...payload, sort_order: zone.shipping_methods.length }).select().single()
      if (!err && data) {
        setZones(zs => zs.map(z => z.id === zoneId
          ? { ...z, shipping_methods: [...z.shipping_methods, data] }
          : z))
      } else { setError('حدث خطأ'); setSaving(false); return }
    }
    setSaving(false)
    setMethodModal({ open: false, zoneId: null, editing: null })
  }

  async function toggleMethodActive(zoneId: string, method: ShippingMethod) {
    const next = !method.is_active
    await supabase.from('shipping_methods').update({ is_active: next }).eq('id', method.id)
    setZones(zs => zs.map(z => z.id === zoneId
      ? { ...z, shipping_methods: z.shipping_methods.map(m => m.id === method.id ? { ...m, is_active: next } : m) }
      : z))
  }

  async function confirmDeleteMethod(methodId: string, zoneId: string) {
    setSaving(true)
    await supabase.from('shipping_methods').delete().eq('id', methodId)
    setZones(zs => zs.map(z => z.id === zoneId
      ? { ...z, shipping_methods: z.shipping_methods.filter(m => m.id !== methodId) }
      : z))
    setDeleteMethod(null); setSaving(false)
  }

  // ── UI رئيسي ─────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* الإعدادات العامة */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">الإعدادات العامة</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-200">تفعيل خدمة التوصيل</p>
              <p className="mt-0.5 text-xs text-slate-500">عند التعطيل لن يظهر قسم الشحن في المتجر</p>
            </div>
            <Toggle enabled={deliveryEnabled} onChange={toggleDelivery} />
          </div>

          <form onSubmit={saveSettings} className="flex items-end gap-3 border-t border-white/5 pt-4">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-slate-300">حد الشحن المجاني</label>
              <p className="mb-2 text-xs text-slate-500">
                الطلبيات فوق هذا المبلغ تحصل على شحن مجاني تلقائياً — اتركه فارغاً للتعطيل
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="1" step="0.01"
                  value={freeThreshold}
                  onChange={e => setFreeThreshold(e.target.value)}
                  placeholder="مثال: 150"
                  dir="ltr"
                  className="w-36 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                />
                <span className="text-sm text-slate-400">{currencyCode}</span>
              </div>
              {freeThreshold && parseFloat(freeThreshold) > 0 && (
                <p className="mt-1.5 text-xs text-emerald-400">
                  ✓ الطلبيات فوق {parseFloat(freeThreshold).toLocaleString('ar')} {currencyCode} → شحن مجاني
                </p>
              )}
            </div>
            <button
              type="submit" disabled={savingSettings}
              className="shrink-0 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm font-medium text-sky-400 hover:bg-sky-500/20 transition-colors disabled:opacity-50"
            >
              {savingSettings ? '...' : 'حفظ'}
            </button>
          </form>
        </div>
      </div>

      {/* المحافظات */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">
              المحافظات وأنواع الشحن
              {zones.length > 0 && (
                <span className="mr-2 rounded-full bg-white/5 px-2 py-0.5 text-xs font-normal text-slate-400">{zones.length}</span>
              )}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">أضف محافظة ← ثم أضف داخلها أنواع الشحن وأسعارها</p>
          </div>
          <button
            onClick={openAddZone}
            className="flex items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2 text-sm font-medium text-sky-400 hover:bg-sky-500/20 transition-colors"
          >
            <span className="text-base leading-none">+</span> إضافة محافظة
          </button>
        </div>

        {zones.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 py-14 text-center">
            <p className="text-4xl">🚚</p>
            <p className="mt-3 text-sm font-medium text-slate-300">لم تُضف أي محافظة بعد</p>
            <p className="mt-1 text-xs text-slate-500">أضف المحافظات التي توصل إليها ← ثم أنواع الشحن داخل كل محافظة</p>
            <button onClick={openAddZone}
              className="mt-5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-5 py-2 text-sm font-medium text-sky-400 hover:bg-sky-500/20">
              أضف أول محافظة
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {zones.map(zone => {
              const isOpen  = expandedZoneId === zone.id
              const methods = zone.shipping_methods ?? []

              return (
                <div key={zone.id} className={`overflow-hidden rounded-2xl border transition-colors ${
                  isOpen ? 'border-sky-500/20 bg-slate-900' : 'border-white/5 bg-slate-900'
                }`}>
                  {/* رأس المحافظة */}
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <button
                      onClick={() => setExpandedZoneId(isOpen ? null : zone.id)}
                      className="flex flex-1 items-center gap-3 text-right min-w-0"
                    >
                      <span className={`shrink-0 text-xs text-slate-500 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white">{zone.name}</span>
                          {!zone.is_active && (
                            <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] text-slate-400">متوقفة</span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {methods.length > 0
                            ? `${methods.filter(m => m.is_active).length} / ${methods.length} نوع شحن نشط`
                            : zone.cost > 0
                              ? `تكلفة افتراضية: ${zone.cost.toLocaleString('ar')} ${currencyCode}`
                              : 'اضغط لإضافة أنواع الشحن'}
                        </p>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <Toggle enabled={zone.is_active} onChange={() => toggleZoneActive(zone)} />
                      <button onClick={() => openEditZone(zone)}
                        className="rounded-lg p-1.5 text-slate-400 hover:text-white transition-colors" title="تعديل">
                        ✏️
                      </button>
                      <button onClick={() => setDeleteZone(zone.id)}
                        className="rounded-lg border border-red-500/25 bg-red-500/5 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/20">
                        حذف
                      </button>
                    </div>
                  </div>

                  {/* أنواع الشحن */}
                  {isOpen && (
                    <div className="border-t border-white/5 bg-white/[0.02] px-4 pb-4 pt-3">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">أنواع الشحن</p>
                        <button
                          onClick={() => openAddMethod(zone.id)}
                          className="flex items-center gap-1 rounded-lg border border-sky-500/25 bg-sky-500/8 px-2.5 py-1.5 text-xs font-medium text-sky-400 hover:bg-sky-500/15 transition-colors"
                        >
                          + إضافة نوع
                        </button>
                      </div>

                      {methods.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-white/8 py-5 text-center">
                          <p className="text-xs text-slate-500">لا توجد أنواع شحن — أضف (عادي، سريع...)</p>
                          <button onClick={() => openAddMethod(zone.id)}
                            className="mt-1.5 text-xs text-sky-400 hover:underline">
                            + إضافة نوع شحن
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {methods.map(m => (
                            <div key={m.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
                              m.is_active ? 'border-white/8 bg-white/3' : 'border-white/5 opacity-50'
                            }`}>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-white">{m.name}</p>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                                  <span className={m.cost === 0 ? 'font-medium text-emerald-400' : ''}>
                                    {m.cost === 0 ? 'مجاني' : `${m.cost.toLocaleString('ar')} ${currencyCode}`}
                                  </span>
                                  {(m.min_days || m.max_days) && (
                                    <span>• {m.min_days && m.max_days ? `${m.min_days}–${m.max_days}` : (m.min_days ?? m.max_days)} أيام</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Toggle enabled={m.is_active} onChange={() => toggleMethodActive(zone.id, m)} />
                                <button onClick={() => openEditMethod(zone.id, m)}
                                  className="p-1 text-slate-400 hover:text-white text-sm transition-colors">✏️</button>
                                <button
                                  onClick={() => setDeleteMethod({ methodId: m.id, zoneId: zone.id })}
                                  className="rounded-md border border-red-500/20 px-2 py-1 text-xs text-red-400 hover:bg-red-500/15 transition-colors">
                                  حذف
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Modal محافظة ── */}
      {zoneModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setZoneModal({ open: false, editing: null })}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6"
            onClick={e => e.stopPropagation()}>
            <h2 className="mb-5 text-lg font-semibold text-white">
              {zoneModal.editing ? 'تعديل المحافظة' : 'محافظة جديدة'}
            </h2>
            <form onSubmit={saveZone} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">اسم المحافظة *</label>
                <input autoFocus value={zoneForm.name}
                  onChange={e => setZoneForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="مثال: رام الله، نابلس، دمشق..." className={inp} />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-300">تكلفة افتراضية</label>
                <p className="mb-1.5 text-xs text-slate-500">تُستخدم إذا لم تُضف أنواع شحن — اكتب 0 للشحن المجاني</p>
                <div className="flex items-center gap-2">
                  <input type="number" min="0" step="0.01" value={zoneForm.cost}
                    onChange={e => setZoneForm(f => ({ ...f, cost: e.target.value }))}
                    placeholder="0" dir="ltr" className={`${inp} flex-1`} />
                  <span className="shrink-0 text-sm text-slate-400">{currencyCode}</span>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">
                  وقت التوصيل الافتراضي
                  <span className="mr-1.5 text-xs text-slate-500">اختياري</span>
                </label>
                <div className="flex items-center gap-2">
                  <input type="text" value={zoneForm.estimated_days}
                    onChange={e => setZoneForm(f => ({ ...f, estimated_days: e.target.value }))}
                    placeholder="1-2" dir="ltr"
                    className="w-24 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
                  <span className="text-sm text-slate-400">أيام عمل</span>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">المحافظة نشطة</p>
                  <p className="text-xs text-slate-500">الزبائن يمكنهم اختيارها</p>
                </div>
                <Toggle enabled={zoneForm.is_active} onChange={v => setZoneForm(f => ({ ...f, is_active: v }))} />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setZoneModal({ open: false, editing: null })}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400 hover:text-white">إلغاء</button>
                <button type="submit" disabled={saving}
                  className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                  {saving ? '...' : zoneModal.editing ? 'حفظ التعديلات' : 'إضافة المحافظة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal نوع شحن ── */}
      {methodModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setMethodModal({ open: false, zoneId: null, editing: null })}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6"
            onClick={e => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-semibold text-white">
              {methodModal.editing ? 'تعديل نوع الشحن' : 'نوع شحن جديد'}
            </h2>
            <p className="mb-5 text-sm text-slate-500">
              {zones.find(z => z.id === methodModal.zoneId)?.name}
            </p>
            <form onSubmit={saveMethod} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-slate-300">اسم نوع الشحن *</label>
                <p className="mb-1.5 text-xs text-slate-500">مثال: توصيل عادي، توصيل سريع، شحن منزلي...</p>
                <input autoFocus value={methodForm.name}
                  onChange={e => setMethodForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="توصيل عادي" className={inp} />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-300">التكلفة</label>
                <p className="mb-1.5 text-xs text-slate-500">اكتب 0 للشحن المجاني لهذا النوع</p>
                <div className="flex items-center gap-2">
                  <input type="number" min="0" step="0.01" value={methodForm.cost}
                    onChange={e => setMethodForm(f => ({ ...f, cost: e.target.value }))}
                    placeholder="15" dir="ltr" className={`${inp} flex-1`} />
                  <span className="shrink-0 text-sm text-slate-400">{currencyCode}</span>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">
                  وقت التوصيل <span className="text-xs text-slate-500">اختياري</span>
                </label>
                <div className="flex items-center gap-2">
                  <input type="number" min="0" value={methodForm.min_days}
                    onChange={e => setMethodForm(f => ({ ...f, min_days: e.target.value }))}
                    placeholder="1" dir="ltr"
                    className="w-20 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
                  <span className="text-slate-500">—</span>
                  <input type="number" min="0" value={methodForm.max_days}
                    onChange={e => setMethodForm(f => ({ ...f, max_days: e.target.value }))}
                    placeholder="3" dir="ltr"
                    className="w-20 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
                  <span className="text-sm text-slate-400">أيام</span>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">نوع الشحن نشط</p>
                  <p className="text-xs text-slate-500">الزبائن يمكنهم اختياره</p>
                </div>
                <Toggle enabled={methodForm.is_active} onChange={v => setMethodForm(f => ({ ...f, is_active: v }))} />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setMethodModal({ open: false, zoneId: null, editing: null })}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400 hover:text-white">إلغاء</button>
                <button type="submit" disabled={saving}
                  className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                  {saving ? '...' : methodModal.editing ? 'حفظ التعديلات' : 'إضافة نوع الشحن'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* تأكيد حذف محافظة */}
      {deleteZone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setDeleteZone(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-red-500/20 bg-slate-900 p-6" onClick={e => e.stopPropagation()}>
            <p className="font-semibold text-white">حذف المحافظة</p>
            <p className="mt-1 text-sm text-slate-400">
              &quot;{zones.find(z => z.id === deleteZone)?.name}&quot; وجميع أنواع الشحن داخلها
            </p>
            <p className="mt-3 text-sm text-slate-500">هذا الإجراء لا يمكن التراجع عنه.</p>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setDeleteZone(null)}
                className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400">إلغاء</button>
              <button onClick={() => confirmDeleteZone(deleteZone)} disabled={saving}
                className="flex-1 rounded-xl border border-red-500/40 bg-red-500/15 py-2.5 text-sm font-semibold text-red-400 hover:bg-red-500 hover:text-white disabled:opacity-50">
                {saving ? '...' : 'حذف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* تأكيد حذف نوع شحن */}
      {deleteMethod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setDeleteMethod(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-red-500/20 bg-slate-900 p-6" onClick={e => e.stopPropagation()}>
            <p className="font-semibold text-white">حذف نوع الشحن</p>
            <p className="mt-1 text-sm text-slate-400">
              &quot;{zones.find(z => z.id === deleteMethod.zoneId)?.shipping_methods.find(m => m.id === deleteMethod.methodId)?.name}&quot;
            </p>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setDeleteMethod(null)}
                className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400">إلغاء</button>
              <button onClick={() => confirmDeleteMethod(deleteMethod.methodId, deleteMethod.zoneId)} disabled={saving}
                className="flex-1 rounded-xl border border-red-500/40 bg-red-500/15 py-2.5 text-sm font-semibold text-red-400 hover:bg-red-500 hover:text-white disabled:opacity-50">
                {saving ? '...' : 'حذف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-slate-900 px-5 py-3 text-sm font-medium text-emerald-400 shadow-xl shadow-black/40 transition-all duration-300 ${
        savedOk ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'
      }`}>
        ✓ تم حفظ إعدادات التوصيل
      </div>
    </div>
  )
}
