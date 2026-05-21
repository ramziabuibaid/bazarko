'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { uploadStoreImage } from '@/lib/supabase/storage'
import { useRouter } from 'next/navigation'

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
  full_subdomain: string
}

interface Props {
  store: Store
}

export default function StoreSettingsForm({ store }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: store.name,
    description: store.description ?? '',
    phone: store.phone ?? '',
    whatsapp: store.whatsapp ?? '',
    email: store.email ?? '',
    city: store.city ?? '',
    address: store.address ?? '',
  })

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

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingLogo(true)
    try {
      const url = await uploadStoreImage(store.id, 'logo', file)
      setLogoUrl(url)
      // نحفظ فوراً
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
        name: form.name.trim(),
        description: form.description.trim() || null,
        phone: form.phone.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        email: form.email.trim() || null,
        city: form.city.trim() || null,
        address: form.address.trim() || null,
        updated_at: new Date().toISOString(),
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

  return (
    <form onSubmit={handleSave} className="space-y-6">

      {/* صور المتجر */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 overflow-hidden">
        {/* صورة الغلاف */}
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

          {/* اللوغو فوق الغلاف */}
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

      {/* معلومات المتجر */}
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
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
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

          {/* الـ Subdomain — للقراءة فقط */}
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">رابط المتجر</label>
            <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/3 px-4 py-2.5">
              <span className="text-sm text-sky-400" dir="ltr">{store.full_subdomain}</span>
              <span className="mr-auto rounded bg-white/10 px-2 py-0.5 text-xs text-slate-400">ثابت</span>
            </div>
          </div>
        </div>
      </div>

      {/* بيانات التواصل */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="mb-4 font-semibold text-white">بيانات التواصل</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">رقم الهاتف</label>
            <input
              value={form.phone}
              onChange={e => update('phone', e.target.value)}
              placeholder="0591234567"
              type="tel"
              dir="ltr"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">رقم واتساب</label>
            <input
              value={form.whatsapp}
              onChange={e => update('whatsapp', e.target.value)}
              placeholder="9720591234567 (مع رمز الدولة)"
              type="tel"
              dir="ltr"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
            />
            <p className="mt-1 text-xs text-slate-600">يظهر كزر واتساب في المتجر والمنتجات</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">البريد الإلكتروني</label>
            <input
              value={form.email}
              onChange={e => update('email', e.target.value)}
              placeholder="store@example.com"
              type="email"
              dir="ltr"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">المدينة</label>
            <input
              value={form.city}
              onChange={e => update('city', e.target.value)}
              placeholder="رام الله"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm text-slate-400">العنوان التفصيلي</label>
            <input
              value={form.address}
              onChange={e => update('address', e.target.value)}
              placeholder="شارع المدينة، بناية رقم..."
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
            />
          </div>
        </div>
      </div>

      {/* معلومات الحساب — للقراءة فقط */}
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

      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>
      )}

      {success && (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          ✓ تم حفظ الإعدادات بنجاح
        </p>
      )}

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
