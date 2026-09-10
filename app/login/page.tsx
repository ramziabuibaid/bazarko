'use client'

import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import BazarkoLogo from '@/components/ui/BazarkoLogo'

type Mode = 'login' | 'signup'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
  })

  function update(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()

    if (mode === 'login') {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      })

      if (err) {
        setError('الإيميل أو كلمة السر غير صحيحة')
        setLoading(false)
        return
      }

      // تحقق إذا لديه متجر
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: store } = await supabase
          .from('stores')
          .select('id')
          .eq('owner_id', user.id)
          .single()

        router.push(store ? '/dashboard' : '/onboarding')
      }

    } else {
      // إنشاء حساب جديد
      if (form.password.length < 8) {
        setError('كلمة السر يجب أن تكون 8 أحرف على الأقل')
        setLoading(false)
        return
      }

      const { error: err } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: { full_name: form.full_name },
        },
      })

      if (err) {
        setError(err.message === 'User already registered'
          ? 'هذا الإيميل مسجل مسبقاً، سجّل دخولك'
          : err.message)
        setLoading(false)
        return
      }

      // تسجيل دخول مباشر بعد إنشاء الحساب
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      })

      if (!loginErr) {
        router.push('/onboarding')
      } else {
        setError('تم إنشاء الحساب، سجّل دخولك الآن')
        setMode('login')
      }
    }

    setLoading(false)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center flex flex-col items-center">
          <BazarkoLogo size="lg" variant="image" subtitle="منظومة ERP السحابية المتكاملة" href="/" className="mb-2" />
          <h1 className="mt-2 text-2xl font-semibold text-white">
            {mode === 'login' ? 'أهلاً بعودتك' : 'إنشاء حساب جديد'}
          </h1>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900 p-6">
          {/* Toggle */}
          <div className="mb-6 flex rounded-xl bg-slate-800 p-1">
            <button
              onClick={() => { setMode('login'); setError('') }}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                mode === 'login' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              تسجيل الدخول
            </button>
            <button
              onClick={() => { setMode('signup'); setError('') }}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                mode === 'signup' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              حساب جديد
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">الاسم الكامل</label>
                <input
                  type="text"
                  value={form.full_name}
                  onChange={e => update('full_name', e.target.value)}
                  placeholder="محمد علي"
                  required
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-right text-white placeholder-slate-500 outline-none focus:border-sky-500"
                />
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm text-slate-300">الإيميل</label>
              <input
                type="email"
                value={form.email}
                onChange={e => update('email', e.target.value)}
                placeholder="example@gmail.com"
                required
                dir="ltr"
                className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-left text-white placeholder-slate-500 outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-slate-300">كلمة السر</label>
              <input
                type="password"
                value={form.password}
                onChange={e => update('password', e.target.value)}
                placeholder={mode === 'signup' ? '8 أحرف على الأقل' : '••••••••'}
                required
                dir="ltr"
                className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-left text-white placeholder-slate-500 outline-none focus:border-sky-500"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-sky-500 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
            >
              {loading
                ? 'جاري...'
                : mode === 'login' ? 'تسجيل الدخول' : 'إنشاء الحساب'}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
