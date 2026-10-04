'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { uploadStoreImage } from '@/lib/supabase/storage'
import { useRouter } from 'next/navigation'
import { trackAction } from '@/lib/activity/track'
import { HEADER_THEMES } from '@/components/store/headerThemes'

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
  { code: '972', flag: '🇵🇸', label: 'فلسطين (+972)' },
  { code: '962', flag: '🇯🇴', label: 'الأردن (+962)' },
  { code: '20',  flag: '🇪🇬', label: 'مصر (+20)' },
  { code: '966', flag: '🇸🇦', label: 'السعودية (+966)' },
  { code: '971', flag: '🇦🇪', label: 'الإمارات (+971)' },
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

interface FooterSettings {
  tagline: string
  show_contact: boolean
  show_social: boolean
  show_hours: boolean
  show_powered_by: boolean
  copyright: string
}

interface StoreCustomerOption {
  id: string
  name: string
  shamel_code?: string | null
  phone?: string | null
}

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
  prefer_secondary: boolean | null
  map_url: string | null
  header_theme: string | null
  footer_settings: FooterSettings | null
  modules: Record<string, boolean> | null
  settings?: Record<string, any> | null
}

interface Props {
  store: Store
  customers?: StoreCustomerOption[]
  avgRating: number | null
  completedOrders: number
}

function defaultDialCode(countryCode: string) {
  if (countryCode === 'SY') return '963'
  return '970'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StoreSettingsForm({ store, customers = [], avgRating, completedOrders }: Props) {
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
    map_url:     store.map_url ?? '',
    instagram:   store.instagram ?? '',
    facebook:    store.facebook ?? '',
    tiktok:      store.tiktok ?? '',
    telegram:    store.telegram ?? '',
  })

  const [dialCode, setDialCode] = useState(defaultDialCode(store.country_code))
  const [hours, setHours] = useState<BusinessHours>(store.business_hours ?? DEFAULT_HOURS)
  const [headerTheme, setHeaderTheme] = useState(store.header_theme ?? 'classic')
  const [secondaryCurrency, setSecondaryCurrency] = useState(store.secondary_currency_code ?? '')
  const [exchangeRate, setExchangeRate] = useState(store.exchange_rate ? String(store.exchange_rate) : '')
  const [preferSecondary, setPreferSecondary] = useState(store.prefer_secondary ?? false)
  const [posDefaultCustomerId, setPosDefaultCustomerId] = useState<string>(
    store.settings?.pos_default_customer_id ?? ''
  )

  const defaultFooter: FooterSettings = {
    tagline: '', show_contact: true, show_social: true,
    show_hours: true, show_powered_by: true, copyright: '',
  }
  const [footer, setFooter] = useState<FooterSettings>({ ...defaultFooter, ...store.footer_settings })

  const [modules, setModules] = useState<Record<string, boolean>>(store.modules ?? {})
  function toggleModule(key: string) {
    setModules(m => ({ ...m, [key]: !m[key] }))
    setSuccess(false)
  }

  function updateFooter(field: keyof FooterSettings, value: string | boolean) {
    setFooter(f => ({ ...f, [field]: value }))
    setSuccess(false)
  }

  const [logoUrl, setLogoUrl] = useState<string | null>(store.logo_url)
  const [coverUrl, setCoverUrl] = useState<string | null>(store.cover_url)
  const [uploadingLogo, setUploadingLogo] = useState(false)

  // ─── درجة جودة المتجر (تُحسب من الـ state الحالي) ───────────────────────
  const qualityCriteria = [
    { key: 'logo',    label: 'الشعار',              done: !!logoUrl,                                    pts: 15 },
    { key: 'cover',   label: 'صورة الغلاف',          done: !!coverUrl,                                   pts: 10 },
    { key: 'desc',    label: 'وصف المتجر',           done: form.description.trim().length > 10,          pts: 15 },
    { key: 'phone',   label: 'رقم الهاتف',           done: form.phone.trim().length > 0,                 pts: 10 },
    { key: 'whatsapp',label: 'واتساب',               done: form.whatsapp.trim().length > 0,              pts: 10 },
    { key: 'hours',   label: 'ساعات العمل',          done: Object.values(hours).some(d => d.open),       pts: 15 },
    { key: 'social',  label: 'وسائل التواصل',        done: !!(form.instagram || form.facebook || form.tiktok || form.telegram), pts: 15 },
    { key: 'email',   label: 'البريد الإلكتروني',    done: form.email.trim().length > 0,                 pts: 5  },
    { key: 'city',    label: 'المدينة / العنوان',    done: form.city.trim().length > 0,                  pts: 5  },
  ]
  const qualityScore = qualityCriteria.reduce((s, c) => s + (c.done ? c.pts : 0), 0)
  const qualityLabel =
    qualityScore >= 90 ? { text: 'ممتاز 🌟',    color: 'text-emerald-400' } :
    qualityScore >= 75 ? { text: 'جيد جداً',     color: 'text-sky-400'     } :
    qualityScore >= 50 ? { text: 'جيد',          color: 'text-amber-400'   } :
                         { text: 'يحتاج تحسين',  color: 'text-red-400'     }
  const barColor =
    qualityScore >= 90 ? 'bg-emerald-500' :
    qualityScore >= 75 ? 'bg-sky-500'     :
    qualityScore >= 50 ? 'bg-amber-500'   :
                         'bg-red-500'
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

    const updatedSettings = {
      ...(store.settings || {}),
      pos_default_customer_id: posDefaultCustomerId || null,
    }

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
        map_url:        form.map_url.trim() || null,
        instagram:      form.instagram.trim() || null,
        facebook:       form.facebook.trim() || null,
        tiktok:         form.tiktok.trim() || null,
        telegram:       form.telegram.trim() || null,
        business_hours:          hours,
        header_theme:            headerTheme,
        secondary_currency_code: secondaryCurrency || null,
        exchange_rate:           exchangeRate ? parseFloat(exchangeRate) : null,
        prefer_secondary:        secondaryCurrency ? preferSecondary : false,
        footer_settings:         footer,
        modules:                 modules,
        settings:                updatedSettings,
        updated_at:              new Date().toISOString(),
      })
      .eq('id', store.id)

    setSaving(false)
    if (err) {
      setError('حدث خطأ أثناء الحفظ')
    } else {
      trackAction(store.id, {
        action: 'update', entityType: 'settings',
        entityId: store.id, entityLabel: form.name.trim(),
      })
      setSuccess(true)
      router.refresh()
      setTimeout(() => setSuccess(false), 3000)
    }
  }

  const inputClass = 'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50'

  return (
    <form onSubmit={handleSave} className="space-y-6">

      {/* ── درجة جودة المتجر ────────────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-white">درجة جودة المتجر</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              أكمل بيانات متجرك لزيادة الثقة لدى الزبائن
            </p>
          </div>
          <div className="text-left shrink-0">
            <span className={`text-3xl font-bold tabular-nums ${barColor.replace('bg-', 'text-')}`}>
              {qualityScore}
            </span>
            <span className="text-lg text-slate-500">/100</span>
            <p className={`mt-0.5 text-xs font-medium ${qualityLabel.color}`}>{qualityLabel.text}</p>
          </div>
        </div>

        {/* شريط التقدم */}
        <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${qualityScore}%` }}
          />
        </div>

        {/* قائمة المعايير */}
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {qualityCriteria.map(c => (
            <div key={c.key} className="flex items-center gap-2">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                c.done
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-white/5 text-slate-600'
              }`}>
                {c.done ? '✓' : '✗'}
              </span>
              <span className={`text-xs ${c.done ? 'text-slate-300' : 'text-slate-600'}`}>
                {c.label}
                {!c.done && <span className="mr-1 text-slate-700">+{c.pts}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

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

      {/* ── ثيم هيدر المتجر ──────────────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="font-semibold text-white">مظهر هيدر المتجر</h2>
        <p className="mt-0.5 mb-4 text-xs text-slate-500">
          اختر تصميم الشريط العلوي لمتجرك — ليكون شكل متجرك فريداً ومميزاً
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {HEADER_THEMES.map(t => {
            const selected = headerTheme === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { setHeaderTheme(t.id); setSuccess(false) }}
                className={`overflow-hidden rounded-xl border-2 text-right transition ${
                  selected ? 'border-sky-500 shadow-lg shadow-sky-500/10' : 'border-white/10 hover:border-white/25'
                }`}
              >
                {/* معاينة حية مصغّرة للهيدر */}
                <div className={`relative flex items-center justify-between overflow-hidden px-3 py-2.5 ${t.header} ${t.shine ? 'animate-header-shine' : ''}`}>
                  <div className="flex items-center gap-2">
                    <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${t.logoFallback} ${t.logoRing}`}>
                      {form.name.trim()[0] ?? 'م'}
                    </div>
                    <span className={`text-sm ${t.name}`}>{form.name.trim() || 'اسم متجرك'}</span>
                  </div>
                  <span className={`rounded-lg px-2 py-1 text-[10px] font-medium ${t.cartBtn}`}>🛒 السلة</span>
                </div>
                <div className="flex items-center justify-between bg-slate-950/60 px-3 py-2">
                  <div>
                    <p className={`text-sm font-medium ${selected ? 'text-sky-400' : 'text-white'}`}>{t.label}</p>
                    <p className="text-[11px] text-slate-500">{t.description}</p>
                  </div>
                  {selected && <span className="text-sky-400">✓</span>}
                </div>
              </button>
            )
          })}
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

          {/* رابط الخريطة */}
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm text-slate-400">
              رابط الموقع على الخريطة
              <span className="mr-1 text-xs text-slate-600">اختياري</span>
            </label>
            <input
              value={form.map_url}
              onChange={e => update('map_url', e.target.value)}
              placeholder="https://maps.google.com/..."
              dir="ltr"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-600">
              افتح Google Maps → اضغط على موقعك → شارك → انسخ الرابط
            </p>
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
                  {(100 * parseFloat(exchangeRate || '0')).toLocaleString('ar-u-nu-latn')} {secondaryCurrency}
                </span>
              </div>
            )}

            {/* خيار العملة الأساسية */}
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/3 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-white">اجعل {secondaryCurrency} هي العملة الأساسية</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {preferSecondary
                    ? `يُعرض السعر بـ${secondaryCurrency} أولاً (كبير) والسعر بـ${store.currency_code} ثانياً (صغير)`
                    : `يُعرض السعر بـ${store.currency_code} أولاً (كبير) والسعر بـ${secondaryCurrency} ثانياً (صغير)`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreferSecondary(v => !v)}
                className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                  preferSecondary ? 'bg-sky-600' : 'bg-slate-700'
                }`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  preferSecondary ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── إعدادات نقطة البيع (POS) والمبيعات النقدية ────────── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">🖥️</span>
          <h2 className="font-semibold text-white">إعدادات نقطة البيع (POS) والمبيعات النقدية</h2>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          حدد الزبون الافتراضي الذي يتم ربط مبيعات الكاش به في شاشة نقطة البيع وإنشاء سندات القبض باسمه تلقائياً
        </p>

        <div>
          <label className="mb-1.5 block text-sm text-slate-400">الزبون الافتراضي للمبيعات النقدية (POS)</label>
          <select
            value={posDefaultCustomerId}
            onChange={e => {
              setPosDefaultCustomerId(e.target.value)
              setSuccess(false)
            }}
            className={inputClass}
          >
            <option value="">-- بدون ربط بحساب زبون (عميل نقدي عام) --</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} {c.shamel_code ? `(كود الشامل: ${c.shamel_code})` : ''} {c.phone ? `- ${c.phone}` : ''}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-slate-500">
            عند إنشاء طلبية كاش من نقطة البيع، سيتم توجيه الفاتورة وسند القبض إلى هذا الحساب لسهولة تتبعه في كشف الحساب والتقارير المالية.
          </p>
        </div>
      </div>

      {/* ── الوحدات المُفعّلة ──────────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="font-semibold text-white">الوحدات</h2>
        <p className="mt-0.5 mb-5 text-xs text-slate-500">
          فعّل فقط ما يناسب نشاطك. وحدة الصيانة مخصّصة لمحلات تصليح الأجهزة — أوقفها إن كان متجرك للأثاث أو غيره.
        </p>
        <div className="space-y-3">
          {[
            { key: 'maintenance', label: 'وحدة الصيانة', sub: 'استلام أجهزة + لوحة صيانة + تتبّع للزبون' },
          ].map(({ key, label, sub }) => (
            <div key={key} className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-300">{label}</p>
                <p className="text-xs text-slate-600">{sub}</p>
              </div>
              <button
                type="button"
                onClick={() => toggleModule(key)}
                className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${modules[key] ? 'bg-sky-600' : 'bg-slate-700'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${modules[key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── إعدادات الـ Footer ──────────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="font-semibold text-white">تخصيص الـ Footer</h2>
        <p className="mt-0.5 mb-5 text-xs text-slate-500">
          التذييل السفلي الذي يظهر في أسفل كل صفحات المتجر
        </p>

        {/* أقسام الـ Footer */}
        <div className="mb-5 space-y-3">
          {[
            { key: 'show_contact',   label: 'معلومات التواصل',       sub: 'الهاتف والبريد والعنوان' },
            { key: 'show_social',    label: 'أيقونات التواصل الاجتماعي', sub: 'Instagram, Facebook, TikTok...' },
            { key: 'show_hours',     label: 'ساعات العمل',           sub: 'جدول يوميات الدوام' },
            { key: 'show_powered_by', label: 'شارة "مدعوم من Bazarko"', sub: 'تظهر في أسفل الـ Footer' },
          ].map(({ key, label, sub }) => (
            <div key={key} className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-300">{label}</p>
                <p className="text-xs text-slate-600">{sub}</p>
              </div>
              <button
                type="button"
                onClick={() => updateFooter(key as keyof FooterSettings, !footer[key as keyof FooterSettings])}
                className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                  footer[key as keyof FooterSettings] ? 'bg-sky-600' : 'bg-slate-700'
                }`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  footer[key as keyof FooterSettings] ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          ))}
        </div>

        <div className="space-y-4 border-t border-white/5 pt-4">
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">نص Tagline تحت اسم المتجر</label>
            <input
              value={footer.tagline}
              onChange={e => updateFooter('tagline', e.target.value)}
              placeholder="جملة قصيرة تعبّر عن متجرك — مثال: أفضل عطور العالم بين يديك"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-600">
              اتركه فارغاً لاستخدام وصف المتجر الرئيسي
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">نص حقوق النشر</label>
            <input
              value={footer.copyright}
              onChange={e => updateFooter('copyright', e.target.value)}
              placeholder={`© ${new Date().getFullYear()} ${form.name || 'اسم المتجر'} — جميع الحقوق محفوظة`}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-600">
              اتركه فارغاً للنص التلقائي: © {new Date().getFullYear()} {form.name || 'اسم المتجر'}
            </p>
          </div>
        </div>

        {/* معاينة حية للـ Footer */}
        <div className="mt-5 border-t border-white/5 pt-4">
          <p className="mb-2 text-xs font-medium text-slate-400">👁️ معاينة مباشرة</p>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950 p-5 text-right" dir="rtl">
            <p className="text-base font-bold text-white">{form.name || 'اسم المتجر'}</p>
            {(footer.tagline || form.description) && (
              <p className="mt-1 text-xs text-slate-400">{footer.tagline || form.description}</p>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {footer.show_contact && (
                <div>
                  <p className="mb-1 text-[11px] font-semibold text-slate-300">التواصل</p>
                  <p className="text-[11px] text-slate-500" dir="ltr">{form.phone || '—'}</p>
                  {form.city && <p className="text-[11px] text-slate-500">{form.city}</p>}
                </div>
              )}
              {footer.show_hours && (
                <div>
                  <p className="mb-1 text-[11px] font-semibold text-slate-300">ساعات العمل</p>
                  <p className="text-[11px] text-slate-500">السبت – الخميس</p>
                </div>
              )}
              {footer.show_social && (
                <div>
                  <p className="mb-1 text-[11px] font-semibold text-slate-300">تابعنا</p>
                  <div className="flex gap-1.5 text-sm">
                    {form.instagram && <span>📷</span>}
                    {form.facebook && <span>📘</span>}
                    {form.tiktok && <span>🎵</span>}
                    {form.telegram && <span>✈️</span>}
                    {!form.instagram && !form.facebook && !form.tiktok && !form.telegram && (
                      <span className="text-[11px] text-slate-600">لا روابط</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 border-t border-white/5 pt-3">
              <p className="text-[11px] text-slate-500">
                {footer.copyright || `© ${new Date().getFullYear()} ${form.name || 'اسم المتجر'} — جميع الحقوق محفوظة`}
              </p>
              {footer.show_powered_by && (
                <p className="mt-1 text-[10px] text-slate-600">مدعوم من Bazarko</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── معلومات الحساب (للقراءة فقط) ───────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="mb-4 font-semibold text-white">معلومات الحساب</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: 'البلد', value: '🇵🇸 فلسطين' },
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
