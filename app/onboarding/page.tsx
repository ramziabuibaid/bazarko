'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Step = 1 | 2 | 3

interface FormData {
  country_code: string
  currency_code: string
  currency_symbol: string
  store_name: string
  subdomain: string
}

const COUNTRIES = [
  { code: 'PS', name: 'فلسطين', flag: '🇵🇸', currency_code: 'ILS', currency_symbol: '₪' },
  { code: 'SY', name: 'سوريا', flag: '🇸🇾', currency_code: 'SYP', currency_symbol: 'ل.س' },
]

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [subdomainAvailable, setSubdomainAvailable] = useState<boolean | null>(null)
  const [checkingSubdomain, setCheckingSubdomain] = useState(false)

  const [form, setForm] = useState<FormData>({
    country_code: '',
    currency_code: '',
    currency_symbol: '',
    store_name: '',
    subdomain: '',
  })

  // حماية: من لديه متجر بالفعل لا يجب أن يُنشئ متجراً ثانياً بالخطأ
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase
        .from('store_members')
        .select('store_id')
        .eq('profile_id', user.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
        .then(({ data }: { data: { store_id: string } | null }) => {
          if (data) router.replace('/dashboard')
        })
    })
  }, [router])

  function selectCountry(country: typeof COUNTRIES[0]) {
    setForm(f => ({
      ...f,
      country_code: country.code,
      currency_code: country.currency_code,
      currency_symbol: country.currency_symbol,
    }))
    setStep(2)
  }

  function handleStoreName(name: string) {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 30)

    setForm(f => ({ ...f, store_name: name, subdomain: slug }))
    setSubdomainAvailable(null)
  }

  function handleSubdomain(val: string) {
    const slug = val.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30)
    setForm(f => ({ ...f, subdomain: slug }))
    setSubdomainAvailable(null)
  }

  async function checkSubdomain() {
    if (!form.subdomain || form.subdomain.length < 3) return
    setCheckingSubdomain(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('stores')
      .select('id')
      .eq('subdomain', form.subdomain)
      .eq('country_code', form.country_code)
      .maybeSingle()
    setSubdomainAvailable(!data)
    setCheckingSubdomain(false)
  }

  async function createStore() {
    if (!form.subdomain || !subdomainAvailable) return
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { error: err } = await supabase.from('stores').insert({
      owner_id: user.id,
      country_code: form.country_code,
      name: form.store_name,
      subdomain: form.subdomain,
      currency_code: form.currency_code,
    })

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  const selectedCountry = COUNTRIES.find(c => c.code === form.country_code)

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-lg">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center gap-2">
            {[1, 2, 3].map(s => (
              <div key={s} className="flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                  s < step ? 'bg-sky-500 text-white' :
                  s === step ? 'border-2 border-sky-500 text-sky-400' :
                  'border border-slate-700 text-slate-600'
                }`}>
                  {s < step ? '✓' : s}
                </div>
                {s < 3 && (
                  <div className={`h-px flex-1 ${s < step ? 'bg-sky-500' : 'bg-slate-700'}`} style={{ width: 60 }} />
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            الخطوة {step} من 3
          </p>
        </div>

        {/* Step 1: اختيار البلد */}
        {step === 1 && (
          <div className="rounded-2xl border border-white/10 bg-slate-900 p-8 text-right">
            <h2 className="text-xl font-semibold text-white">اختر بلدك</h2>
            <p className="mt-2 text-sm text-slate-400">يحدد هذا العملة ورابط متجرك</p>
            <div className="mt-6 grid gap-3">
              {COUNTRIES.map(country => (
                <button
                  key={country.code}
                  onClick={() => selectCountry(country)}
                  className="flex items-center gap-4 rounded-xl border border-white/10 bg-slate-800 p-4 text-right transition hover:border-sky-500 hover:bg-slate-700"
                >
                  <span className="text-3xl">{country.flag}</span>
                  <div>
                    <p className="font-medium text-white">{country.name}</p>
                    <p className="text-xs text-slate-400">{country.currency_symbol} — {country.currency_code}</p>
                  </div>
                </button>
              ))}
              <button
                disabled
                className="flex items-center gap-4 rounded-xl border border-white/5 bg-slate-800/50 p-4 text-right opacity-40"
              >
                <span className="text-3xl">🌍</span>
                <div>
                  <p className="font-medium text-slate-400">دول أخرى</p>
                  <p className="text-xs text-slate-500">قريباً</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Step 2: اسم المتجر */}
        {step === 2 && (
          <div className="rounded-2xl border border-white/10 bg-slate-900 p-8 text-right">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xl">{selectedCountry?.flag}</span>
              <span className="text-sm text-slate-400">{selectedCountry?.name}</span>
            </div>
            <h2 className="text-xl font-semibold text-white">اسم متجرك</h2>
            <p className="mt-1 text-sm text-slate-400">يظهر هذا الاسم للزبائن</p>

            <div className="mt-6">
              <label className="mb-2 block text-sm text-slate-300">اسم المتجر</label>
              <input
                type="text"
                value={form.store_name}
                onChange={e => handleStoreName(e.target.value)}
                placeholder="مثال: متجر هادية للعطور"
                maxLength={60}
                className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-3 text-right text-white placeholder-slate-500 outline-none focus:border-sky-500"
              />
            </div>

            <div className="mt-4 flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="rounded-xl border border-white/10 px-5 py-2.5 text-sm text-slate-400 hover:border-white/20"
              >
                رجوع
              </button>
              <button
                onClick={() => form.store_name.length >= 2 && setStep(3)}
                disabled={form.store_name.length < 2}
                className="flex-1 rounded-xl bg-sky-500 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:opacity-40"
              >
                التالي
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Subdomain */}
        {step === 3 && (
          <div className="rounded-2xl border border-white/10 bg-slate-900 p-8 text-right">
            <h2 className="text-xl font-semibold text-white">رابط متجرك</h2>
            <p className="mt-1 text-sm text-slate-400">
              هذا هو العنوان الذي يصل منه الزبائن لمتجرك
            </p>

            <div className="mt-6">
              <label className="mb-2 block text-sm text-slate-300">الرابط المخصص</label>
              <div className="flex items-center rounded-xl border border-white/10 bg-slate-800 focus-within:border-sky-500">
                <input
                  type="text"
                  value={form.subdomain}
                  onChange={e => handleSubdomain(e.target.value)}
                  onBlur={checkSubdomain}
                  placeholder="store-name"
                  className="min-w-0 flex-1 bg-transparent px-4 py-3 text-white placeholder-slate-500 outline-none"
                  dir="ltr"
                />
                <span className="whitespace-nowrap px-3 text-sm text-slate-400">
                  .{selectedCountry?.code.toLowerCase()}.bazarko.app
                </span>
              </div>

              {/* حالة التحقق */}
              <div className="mt-2 h-5 text-xs">
                {checkingSubdomain && (
                  <span className="text-slate-400">جاري التحقق...</span>
                )}
                {!checkingSubdomain && subdomainAvailable === true && (
                  <span className="text-green-400">✓ متاح</span>
                )}
                {!checkingSubdomain && subdomainAvailable === false && (
                  <span className="text-red-400">✗ مأخوذ، جرّب اسماً آخر</span>
                )}
                {form.subdomain.length > 0 && form.subdomain.length < 3 && (
                  <span className="text-yellow-400">يجب أن يكون 3 أحرف على الأقل</span>
                )}
              </div>

              {/* معاينة الرابط */}
              {form.subdomain.length >= 3 && (
                <div className="mt-3 rounded-lg bg-slate-800/50 px-4 py-2 text-sm text-slate-400" dir="ltr">
                  {form.subdomain}.{selectedCountry?.code.toLowerCase()}.bazarko.app
                </div>
              )}
            </div>

            {error && (
              <p className="mt-3 text-sm text-red-400">{error}</p>
            )}

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => { setStep(2); setSubdomainAvailable(null) }}
                className="rounded-xl border border-white/10 px-5 py-2.5 text-sm text-slate-400 hover:border-white/20"
              >
                رجوع
              </button>
              <button
                onClick={createStore}
                disabled={loading || !subdomainAvailable || form.subdomain.length < 3}
                className="flex-1 rounded-xl bg-sky-500 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:opacity-40"
              >
                {loading ? 'جاري الإنشاء...' : 'إنشاء المتجر'}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
