'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Zone {
  id: string
  name: string
  cost: number
  is_active: boolean
  estimated_days: string | null
  sort_order: number
}

interface Props {
  storeId: string
  currencyCode: string
  initialDeliveryEnabled: boolean
  initialFreeThreshold: number | null
  initialZones: Zone[]
}

const EMPTY_FORM = { name: '', cost: '', estimated_days: '', is_active: true }

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

export default function DeliveryManager({
  storeId, currencyCode,
  initialDeliveryEnabled, initialFreeThreshold, initialZones,
}: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [deliveryEnabled, setDeliveryEnabled] = useState(initialDeliveryEnabled)
  // treat 0 same as null — empty means "no free shipping threshold"
  const [freeThreshold, setFreeThreshold]     = useState(
    initialFreeThreshold != null && initialFreeThreshold > 0 ? String(initialFreeThreshold) : ''
  )
  const [zones, setZones]                     = useState<Zone[]>(initialZones)

  const [showModal, setShowModal]   = useState(false)
  const [editing, setEditing]       = useState<Zone | null>(null)
  const [deleteId, setDeleteId]     = useState<string | null>(null)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [saving, setSaving]         = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [savedOk, setSavedOk]       = useState(false)
  const [error, setError]           = useState('')

  // ── إعدادات المتجر ─────────────────────────────────────────

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

  // ── CRUD مناطق التوصيل ─────────────────────────────────────

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError('')
    setShowModal(true)
  }

  function openEdit(zone: Zone) {
    setEditing(zone)
    setForm({
      name:           zone.name,
      cost:           String(zone.cost),
      estimated_days: zone.estimated_days ?? '',
      is_active:      zone.is_active,
    })
    setError('')
    setShowModal(true)
  }

  async function saveZone(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('اسم المنطقة مطلوب'); return }
    const cost = parseFloat(form.cost) || 0
    if (cost < 0)          { setError('التكلفة لا يمكن أن تكون سالبة'); return }

    setSaving(true)
    const payload = {
      store_id:       storeId,
      name:           form.name.trim(),
      cost,
      estimated_days: form.estimated_days.trim() || null,
      is_active:      form.is_active,
    }

    if (editing) {
      const { error: err } = await supabase
        .from('delivery_zones')
        .update({ name: payload.name, cost: payload.cost, estimated_days: payload.estimated_days, is_active: payload.is_active })
        .eq('id', editing.id)
      if (!err) setZones(zs => zs.map(z => z.id === editing.id ? { ...z, ...payload } : z))
      else setError('حدث خطأ أثناء الحفظ')
    } else {
      const { data, error: err } = await supabase
        .from('delivery_zones')
        .insert({ ...payload, sort_order: zones.length })
        .select()
        .single()
      if (!err && data) setZones(zs => [...zs, data])
      else setError('حدث خطأ أثناء الإضافة')
    }

    setSaving(false)
    if (!error) {
      setShowModal(false)
      router.refresh()
    }
  }

  async function toggleZoneActive(zone: Zone) {
    const next = !zone.is_active
    await supabase.from('delivery_zones').update({ is_active: next }).eq('id', zone.id)
    setZones(zs => zs.map(z => z.id === zone.id ? { ...z, is_active: next } : z))
  }

  async function confirmDelete(id: string) {
    setSaving(true)
    await supabase.from('delivery_zones').delete().eq('id', id)
    setZones(zs => zs.filter(z => z.id !== id))
    setDeleteId(null)
    setSaving(false)
  }

  // ── UI ────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* إعدادات عامة */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">الإعدادات العامة</h2>

        <div className="space-y-4">
          {/* تفعيل التوصيل */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-200">تفعيل خدمة التوصيل</p>
              <p className="mt-0.5 text-xs text-slate-500">عند التعطيل لن يظهر خيار التوصيل في المتجر</p>
            </div>
            <Toggle enabled={deliveryEnabled} onChange={toggleDelivery} />
          </div>

          {/* حد الشحن المجاني */}
          <form onSubmit={saveSettings} className="flex items-end gap-3 border-t border-white/5 pt-4">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-slate-300">
                حد الشحن المجاني
              </label>
              <p className="mb-2 text-xs text-slate-500">
                أدخل الحد الأدنى لقيمة الطلب للحصول على شحن مجاني — اتركه فارغاً لتعطيل هذه الميزة
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={freeThreshold}
                  onChange={e => setFreeThreshold(e.target.value)}
                  placeholder="مثلاً: 100"
                  dir="ltr"
                  className="w-40 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                />
                <span className="text-sm text-slate-400">{currencyCode}</span>
              </div>
              {freeThreshold && parseFloat(freeThreshold) > 0 ? (
                <p className="mt-1.5 text-xs text-emerald-400">
                  ✓ الطلبيات فوق {parseFloat(freeThreshold).toLocaleString('ar')} {currencyCode} تحصل على شحن مجاني
                </p>
              ) : freeThreshold === '' ? (
                <p className="mt-1.5 text-xs text-slate-500">الشحن المجاني معطّل حالياً</p>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={savingSettings}
              className="shrink-0 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm font-medium text-sky-400 hover:bg-sky-500/20 transition-colors disabled:opacity-50"
            >
              {savingSettings ? 'جاري الحفظ...' : 'حفظ'}
            </button>
          </form>
        </div>
      </div>

      {/* مناطق التوصيل */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">
            مناطق التوصيل
            {zones.length > 0 && (
              <span className="mr-2 rounded-full bg-white/5 px-2 py-0.5 text-xs font-normal text-slate-400">
                {zones.length}
              </span>
            )}
          </h2>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2 text-sm font-medium text-sky-400 hover:bg-sky-500/20 transition-colors"
          >
            <span className="text-base leading-none">+</span>
            منطقة جديدة
          </button>
        </div>

        {zones.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 py-14 text-center">
            <p className="text-3xl">🚚</p>
            <p className="mt-3 text-sm font-medium text-slate-300">لم تُضف أي منطقة توصيل بعد</p>
            <p className="mt-1 text-xs text-slate-500">أضف المدن أو المناطق التي توصل إليها مع سعر كل منطقة</p>
            <button
              onClick={openAdd}
              className="mt-4 rounded-xl bg-sky-500/10 border border-sky-500/30 px-5 py-2 text-sm font-medium text-sky-400 hover:bg-sky-500/20"
            >
              أضف أول منطقة
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/5">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5 bg-white/3">
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">المنطقة</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">التكلفة</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 hidden sm:table-cell">وقت التوصيل</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">الحالة</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {zones.map(zone => (
                  <tr key={zone.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-white">{zone.name}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {zone.cost === 0 ? (
                        <span className="text-sm font-semibold text-emerald-400">مجاني</span>
                      ) : (
                        <span className="whitespace-nowrap text-sm font-semibold text-white" dir="ltr">
                          {zone.cost.toLocaleString('ar')} {currencyCode}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-slate-400 hidden sm:table-cell">
                      {zone.estimated_days ? `${zone.estimated_days} أيام` : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleZoneActive(zone)}>
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          zone.is_active
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-slate-700/50 text-slate-500'
                        }`}>
                          {zone.is_active ? 'نشطة' : 'متوقفة'}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(zone)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
                          title="تعديل"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => setDeleteId(zone.id)}
                          className="rounded-lg border border-red-500/25 bg-red-500/5 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 hover:border-red-500/40 transition-colors"
                        >
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal إضافة/تعديل */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="mb-5 text-lg font-semibold text-white">
              {editing ? 'تعديل المنطقة' : 'منطقة توصيل جديدة'}
            </h2>

            <form onSubmit={saveZone} className="space-y-4">
              {/* الاسم */}
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">اسم المنطقة *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="مثال: رام الله، غزة، دمشق..."
                  autoFocus
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                />
              </div>

              {/* التكلفة */}
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">
                  تكلفة التوصيل
                  <span className="mr-1.5 text-xs text-slate-500">اكتب 0 للشحن المجاني</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.cost}
                    onChange={e => setForm(f => ({ ...f, cost: e.target.value }))}
                    placeholder="0"
                    dir="ltr"
                    className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50"
                  />
                  <span className="shrink-0 text-sm text-slate-400">{currencyCode}</span>
                </div>
              </div>

              {/* وقت التوصيل */}
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">
                  وقت التوصيل المتوقع
                  <span className="mr-1.5 text-xs text-slate-500">اختياري</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={form.estimated_days}
                    onChange={e => setForm(f => ({ ...f, estimated_days: e.target.value }))}
                    placeholder="1-2"
                    dir="ltr"
                    className="w-28 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50"
                  />
                  <span className="text-sm text-slate-400">أيام عمل</span>
                </div>
              </div>

              {/* الحالة */}
              <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">المنطقة نشطة</p>
                  <p className="text-xs text-slate-500">الزبائن يمكنهم اختيار هذه المنطقة</p>
                </div>
                <Toggle
                  enabled={form.is_active}
                  onChange={v => setForm(f => ({ ...f, is_active: v }))}
                />
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400 hover:text-white transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديلات' : 'إضافة المنطقة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast نجاح الحفظ */}
      <div
        className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-slate-900 px-5 py-3 text-sm font-medium text-emerald-400 shadow-xl shadow-black/40 transition-all duration-300 ${
          savedOk ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2 8 6 12 14 4" />
        </svg>
        تم حفظ إعدادات التوصيل بنجاح
      </div>

      {/* نافذة تأكيد الحذف */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setDeleteId(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-red-500/20 bg-slate-900 p-6" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500/15">
                <span className="text-xl">🗑️</span>
              </div>
              <div>
                <p className="font-semibold text-white">حذف المنطقة</p>
                <p className="mt-0.5 text-sm text-slate-400">
                  &quot;{zones.find(z => z.id === deleteId)?.name}&quot;
                </p>
              </div>
            </div>
            <p className="mb-5 text-sm text-slate-500">هذا الإجراء لا يمكن التراجع عنه.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400 hover:text-white transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={() => confirmDelete(deleteId)}
                disabled={saving}
                className="flex-1 rounded-xl border border-red-500/40 bg-red-500/15 py-2.5 text-sm font-semibold text-red-400 hover:bg-red-500 hover:text-white hover:border-red-500 disabled:opacity-50 transition-all"
              >
                {saving ? 'جاري الحذف...' : 'تأكيد الحذف'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
