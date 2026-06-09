'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { uploadStoreImage } from '@/lib/supabase/storage'
import { useRouter } from 'next/navigation'

// ─── Types ───────────────────────────────────────────────────────────────────

type DayKey = 'sat' | 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri'

interface DayHours {
  open: boolean
  from: string
  to: string
}

type BusinessHours = Record<DayKey, DayHours>

const DEFAULT_HOURS: BusinessHours = {
  sat: { open: true,  from: '09:00', to: '22:00' },
  sun: { open: true,  from: '09:00', to: '22:00' },
  mon: { open: true,  from: '09:00', to: '22:00' },
  tue: { open: true,  from: '09:00', to: '22:00' },
  wed: { open: true,  from: '09:00', to: '22:00' },
  thu: { open: true,  from: '09:00', to: '22:00' },
  fri: { open: false, from: '09:00', to: '22:00' },
}

const DAYS: { key: DayKey; label: string }[] = [
  { key: 'sat', label: 'السبت' },
  { key: 'sun', label: 'الأحد' },
  { key: 'mon', label: 'الاثنين' },
  { key: 'tue', label: 'الثلاثاء' },
  { key: 'wed', label: 'الأربعاء' },
  { key: 'thu', label: 'الخميس' },
  { key: 'fri', label: 'الجمعة' },
]

const DIAL_CODES = [
  { code: '970', flag: '🇵🇸', label: 'فلسطين (+970)' },
  { code: '963', flag: '🇸🇾', label: 'سوريا (+963)' },
  { code: '962', flag: '🇯🇴', label: 'الأردن (+962)' },
  { code: '20',  flag: '🇪🇬', label: 'مصر (+20)' },
  { code: '966', flag: '🇸🇦', label: 'السعودية (+966)' },
  { code: '971', flag: '🇦🇪', label: 'الإمارات (+971)' },
  { code: '965', flag: '🇰🇼', label: 'الكويت (+965)' },
  { code: '961', flag: '🇱🇧', label: 'لبنان (+961)' },
  { code: '964', flag: '🇮🇶', label: 'العراق (+964)' },
]

const SECONDARY_CURRENCIES = [
  { code: 'USD', name: 'دولار أمريكي' },
  { code: 'EUR', name: 'يورو' },
  { code: 'JOD', name: 'دينار أردني' },
  { code: 'SAR', name: 'ريال سعودي' },
  { code: 'AED', name: 'درهم إماراتي' },
  { code: 'TRY', name: 'ليرة تركية' },
  { code: 'ILS', name: 'شيكل إسرائيلي' },
  { code: 'SYP', name: 'ليرة سورية' },
  { code: 'EGP', name: 'جنيه مصري' },
]

const SOCIAL_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', icon: '📷', placeholder: 'https://instagram.com/your_store' },
  { key: 'facebook',  label: 'Facebook',  icon: '👥', placeholder: 'https://facebook.com/your_store' },
  { key: 'tiktok',    label: 'TikTok',    icon: '🎵', placeholder: 'https://tiktok.com/@your_store' },
  { key: 'telegram',  label: 'Telegram',  icon: '✈️', placeholder: 'https://t.me/your_store' },
]

// ─── Store interface ──────────────────────────────────────────────────────────

interface Store {
  id: string
  name: string
  description: string | null
  logo_url: string | null
  cover_url: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  city: string | null
  address: string | null
  subdomain: string
  country_code: string
  currency_code: string
  instagram: string | null
  facebook: string | null
  tiktok: string | null
  telegram: string | null
  business_hours: BusinessHours | null
  is_verified: boolean
  secondary_currency_code: string | null
  exchange_rate: number | null
}

interface Props {
  store: Store
  avgRating: number | null
  completedOrders: number
}

function defaultDialCode(countryCode: string) {
  if (countryCode === 'SY') return '963'
  return '970'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StoreSettingsForm({ store, avgRating, completedOrders }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name:        store.name,
    description: store.description ?? '',
    phone:       store.phone ?? '',
    whatsapp:    store.whatsapp ?? '',
    email:       store.email ?? '',
    city:        store.city ?? '',
    address:     store.address ?? '',
    instagram:   store.instagram ?? '',
    facebook:    store.facebook ?? '',
    tiktok:      store.tiktok ?? '',
    telegram:    store.telegram ?? '',
  })

  const [dialCode, setDialCode] = useState(defaultDialCode(store.country_code))
  const [hours, setHours] = useState<BusinessHours>(store.business_hours ?? DEFAULT_HOURS)
  const [secondaryCurrency, setSecondaryCurrency] = useState(store.secondary_currency_code ?? '')
  const [exchangeRate, setExchangeRate] = useState(store.exchange_rate ? String(store.exchange_rate) : '')

  const [logoUrl, setLogoUrl] = useState<string | null>(store.logo_url)
  const [coverUrl, setCoverUrl] = useState<string | null>(store.cover_url)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)

  const logoRef = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)

  function update(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
    setSuccess(false)
    setError('')
  }

  function updateHour(day: DayKey, field: keyof DayHours, value: string | boolean) {
    setHours(h => ({ ...h, [day]: { ...h[day], [field]: value } }))
  }

  // نسخ رقم الهاتف إلى واتساب مع إضافة رمز الدولة
  function copyPhoneToWhatsapp() {
    const num = form.phone.replace(/\D/g, '').replace(/^0/, '')
    if (num) update('whatsapp', dialCode + num)
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingLogo(true)
    try {
      const url = await uploadStoreImage(store.id, 'logo', file)
      setLogoUrl(url)
      await createClient().from('stores').update({ logo_url: url }).eq('id', store.id)
      router.refresh()
    } catch {
      setError('فشل رفع اللوغو')
    } finally {
      setUploadingLogo(false)
    }
  }

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingCover(true)
    try {
      const url = await uploadStoreImage(store.id, 'cover', file)
      setCoverUrl(url)
      await createClient().from('stores').update({ cover_url: url }).eq('id', store.id)
      router.refresh()
    } catch {
      setError('فشل رفع صورة الغلاف')
    } finally {
      setUploadingCover(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('اسم المتجر مطلوب'); return }
    setSaving(true)
    setError('')

    const { error: err } = await createClient()
      .from('stores')
      .update({
        name:           form.name.trim(),
        description:    form.description.trim() || null,
        phone:          form.phone.trim() || null,
        whatsapp:       form.whatsapp.trim() || null,
        email:          form.email.trim() || null,
        city:           form.city.trim() || null,
        address:        form.address.trim() || null,
        instagram:      form.instagram.trim() || null,
        facebook:       form.facebook.trim() || null,
        tiktok:         form.tiktok.trim() || null,
        telegram:       form.telegram.trim() || null,
        business_hours:          hours,
        secondary_currency_code: secondaryCurrency || null,
        exchange_rate:           exchangeRate ? parseFloat(exchangeRate) : null,
        updated_at:              new Date().toISOString(),
      })
      .eq('id', store.id)

    setSaving(false)
    if (err) {
      setError('حدث خطأ أثناء الحفظ')
    } else {
      setSuccess(true)
      router.refresh()
      setTimeout(() => setSuccess(false), 3000)
    }
  }

  const inputClass = 'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50'

  return (
    <form onSubmit={handleSave} className="space-y-6">

      {/* ── صور المتجر ──────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 overflow-hidden">
        <div className="relative">
          <div
            className="h-36 w-full bg-slate-800 cursor-pointer group overflow-hidden"
            onClick={() => coverRef.current?.click()}
          >
            {coverUrl ? (
              <img src={coverUrl} alt="غلاف" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-slate-600">
                <span className="text-sm">صورة الغلاف</span>
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
              {uploadingCover
                ? <span className="text-white text-sm">جاري الرفع...</span>
                : <span className="text-white text-sm font-medium">📷 تغيير الغلاف</span>
              }
            </div>
          </div>
          <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />

          <div className="absolute -bottom-10 right-5">
            <div
              className="relative h-20 w-20 cursor-pointer overflow-hidden rounded-2xl border-4 border-slate-900 bg-slate-800 group"
              onClick={() => logoRef.current?.click()}
            >
              {logoUrl ? (
                <img src={logoUrl} alt="لوغو" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-3xl">🏪</div>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl">
                {uploadingLogo
                  ? <span className="text-white text-xs">...</span>
                  : <span className="text-white text-lg">📷</span>
                }
              </div>
            </div>
            <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </div>
        </div>
        <div className="px-5 pt-14 pb-5">
          <p className="text-xs text-slate-500">اضغط على اللوغو أو الغلاف لتغييرهما</p>
        </div>
      </div>

      {/* ── شارات المتجر ─────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="mb-3 font-semibold text-white">شارات المتجر</h2>
        <div className="flex flex-wrap gap-3">
          {store.is_verified ? (
            <span className="flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-400">
              ✓ متجر موثّق
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-500">
              متجر غير موثّق
            </span>
          )}

          {avgRating !== null ? (
            <span className="flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-400">
              ⭐ {avgRating.toFixed(1)} / 5
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-500">
              ⭐ لا يوجد تقييم بعد
            </span>
          )}

          <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-400">
            ✓ {completedOrders} طلب منجز
          </span>
        </div>
        {!store.is_verified && (
          <p className="mt-3 text-xs text-slate-600">
            التوثيق يُمنح من قِبل فريق Bazarko بعد مراجعة المتجر
          </p>
        )}
      </div>

      {/* ── معلومات المتجر ───────────────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="mb-4 font-semibold text-white">معلومات المتجر</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">اسم المتجر *</label>
            <input
              value={form.name}
              onChange={e => update('name', e.target.value)}
              required
              placeholder="اسم متجرك"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">وصف المتجر</label>
            <textarea
              value={form.description}
              onChange={e => update('description', e.target.value)}
              rows={3}
              placeholder="اكتب وصفاً مختصراً لمتجرك..."
              className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">رابط المتجر</label>
            <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/3 px-4 py-2.5">
              <span className="text-sm text-sky-400" dir="ltr">{store.subdomain}.{process.env.NEXT_PUBLIC_DOMAIN ?? 'bazarko.app'}</span>
              <span className="mr-auto rounded bg-white/10 px-2 py-0.5 text-xs text-slate-400">ثابت</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── بيانات التواصل ───────────────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="mb-4 font-semibold text-white">بيانات التواصل</h2>
        <div className="grid gap-4 sm:grid-cols-2">

          {/* رقم الهاتف مع اختيار رمز الدولة */}
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">رقم الهاتف</label>
            <div className="flex gap-2">
              <select
                value={dialCode}
                onChange={e => setDialCode(e.target.value)}
                className="rounded-xl border border-white/10 bg-white/5 px-2 py-2.5 text-sm text-white outline-none focus:border-sky-500/50"
                dir="ltr"
              >
                {DIAL_CODES.map(d => (
                  <option key={d.code} value={d.code} className="bg-slate-800">
                    {d.flag} +{d.code}
                  </option>
                ))}
              </select>
              <input
                value={form.phone}
                onChange={e => update('phone', e.target.value)}
                placeholder="0591234567"
                type="tel"
                dir="ltr"
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
              />
            </div>
          </div>

          {/* واتساب مع زر نسخ */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm text-slate-400">رقم واتساب</label>
              <button
                type="button"
                onClick={copyPhoneToWhatsapp}
                className="text-xs text-sky-400 hover:text-sky-300 transition-colors"
              >
                نسخ من الهاتف ↑
              </button>
            </div>
            <input
              value={form.whatsapp}
              onChange={e => update('whatsapp', e.target.value)}
              placeholder="9720591234567"
              type="tel"
              dir="ltr"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-600">بدون + أو 00 — مثال: 9720591234567</p>
          </div>

          {/* البريد الإلكتروني */}
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">البريد الإلكتروني</label>
            <input
              value={form.email}
              onChange={e => update('email', e.target.value)}
              placeholder="store@example.com"
              type="email"
              dir="ltr"
              className={inputClass}
            />
          </div>

          {/* المدينة */}
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">المدينة</label>
            <input
              value={form.city}
              onChange={e => update('city', e.target.value)}
              placeholder="رام الله"
              className={inputClass}
            />
          </div>

          {/* العنوان */}
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm text-slate-400">العنوان التفصيلي</label>
            <input
              value={form.address}
              onChange={e => update('address', e.target.value)}
              placeholder="شارع المدينة، بناية رقم..."
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* ── وسائل التواصل الاجتماعي ──────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="mb-4 font-semibold text-white">وسائل التواصل الاجتماعي</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {SOCIAL_PLATFORMS.map(p => (
            <div key={p.key}>
              <label className="mb-1.5 flex items-center gap-2 text-sm text-slate-400">
                <span>{p.icon}</span>
                <span>{p.label}</span>
              </label>
              <input
                value={form[p.key as keyof typeof form]}
                onChange={e => update(p.key, e.target.value)}
                placeholder={p.placeholder}
                dir="ltr"
                className={inputClass}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── ساعات العمل ──────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="mb-4 font-semibold text-white">ساعات العمل</h2>
        <div className="space-y-3">
          {DAYS.map(({ key, label }) => {
            const day = hours[key]
            return (
              <div key={key} className="flex items-center gap-3">
                {/* toggle open/closed */}
                <button
                  type="button"
                  onClick={() => updateHour(key, 'open', !day.open)}
                  className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                    day.open ? 'bg-sky-600' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      day.open ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>

                {/* اسم اليوم */}
                <span className={`w-20 text-sm ${day.open ? 'text-white' : 'text-slate-500'}`}>
                  {label}
                </span>

                {day.open ? (
                  <div className="flex items-center gap-2" dir="ltr">
                    <input
                      type="time"
                      value={day.from}
                      onChange={e => updateHour(key, 'from', e.target.value)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:border-sky-500/50"
                    />
                    <span className="text-slate-500 text-xs">—</span>
                    <input
                      type="time"
                      value={day.to}
                      onChange={e => updateHour(key, 'to', e.target.value)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:border-sky-500/50"
                    />
                  </div>
                ) : (
                  <span className="text-xs text-slate-600">مغلق</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── العملة الثانوية ──────────────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-white">العملة الثانوية</h2>
            <p className="mt-0.5 text-xs text-slate-500">عرض سعر المنتج بعملتين في المتجر</p>
          </div>
          <button
            type="button"
            onClick={() => setSecondaryCurrency(v => v ? '' : 'USD')}
            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
              secondaryCurrency ? 'bg-sky-600' : 'bg-slate-700'
            }`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              secondaryCurrency ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </button>
        </div>

        {secondaryCurrency && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-slate-400">العملة الثانوية</label>
              <select
                value={secondaryCurrency}
                onChange={e => setSecondaryCurrency(e.target.value)}
                className={inputClass}
              >
                {SECONDARY_CURRENCIES
                  .filter(c => c.code !== store.currency_code)
                  .map(c => (
                    <option key={c.code} value={c.code} className="bg-slate-800">
                      {c.code} — {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-slate-400">
                سعر الصرف — 1 {store.currency_code} يساوي كم {secondaryCurrency}؟
              </label>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={exchangeRate}
                onChange={e => setExchangeRate(e.target.value)}
                placeholder="مثال: 0.27"
                dir="ltr"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-slate-600">
                حدّث هذه القيمة يومياً من إعدادات المتجر حسب سعر الصرف الحالي
              </p>
            </div>
            {exchangeRate && (
              <div className="rounded-xl bg-sky-500/5 border border-sky-500/10 px-4 py-3 text-sm text-sky-400">
                مثال: منتج بسعر 100 {store.currency_code} سيظهر بـ{' '}
                <span className="font-semibold">
                  {(100 * parseFloat(exchangeRate || '0')).toLocaleString('ar')} {secondaryCurrency}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── معلومات الحساب (للقراءة فقط) ───────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="mb-4 font-semibold text-white">معلومات الحساب</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: 'البلد', value: store.country_code === 'PS' ? '🇵🇸 فلسطين' : '🇸🇾 سوريا' },
            { label: 'العملة', value: store.currency_code },
            { label: 'الـ Subdomain', value: store.subdomain },
          ].map(item => (
            <div key={item.label} className="rounded-xl bg-white/3 px-4 py-3">
              <p className="text-xs text-slate-500">{item.label}</p>
              <p className="mt-1 text-sm font-medium text-white" dir="ltr">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── رسائل الحالة ─────────────────────────────────────── */}
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>
      )}
      {success && (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          ✓ تم حفظ الإعدادات بنجاح
        </p>
      )}

      {/* ── أزرار الحفظ ──────────────────────────────────────── */}
      <div className="flex justify-end gap-3">
        <a
          href={`/store/${store.country_code.toLowerCase()}/${store.subdomain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border border-white/10 px-5 py-2.5 text-sm text-slate-300 hover:bg-white/5"
        >
          👁️ معاينة المتجر
        </a>
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-sky-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
        </button>
      </div>
    </form>
  )
}
