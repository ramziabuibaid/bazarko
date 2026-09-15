'use client'

import { createClient } from '@/lib/supabase/client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import BazarkoLogo from '@/components/ui/BazarkoLogo'

type Mode = 'login' | 'signup' | 'verify_signup_otp' | 'forgot_password' | 'verify_recovery_otp'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [mode, setMode] = useState<Mode>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Form states
  const [form, setForm] = useState({
    full_name: '',
    company_name: '',
    phone: '',
    email: '',
    password: '',
  })

  // OTP & Reset states
  const [otpCode, setOtpCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resendTimer, setResendTimer] = useState(0)

  // Countdown timer for resend OTP
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer(prev => prev - 1)
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [resendTimer])

  function update(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
    setError('')
    setSuccessMsg('')
  }

  // Handle post-login redirection
  async function handlePostAuthRedirect() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: store } = await supabase
        .from('stores')
        .select('id')
        .eq('owner_id', user.id)
        .single()

      router.push(store ? '/dashboard' : '/onboarding')
    }
  }

  // 1. Submit Login / Signup / Forgot Password
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccessMsg('')

    try {
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: form.email.trim(),
          password: form.password,
        })

        if (err) {
          if (err.message.includes('Email not confirmed')) {
            // If email is not confirmed, offer OTP verification
            setMode('verify_signup_otp')
            setSuccessMsg('يرجى تأكيد بريدك الإلكتروني أولاً. تم إرسال كود التحقق إلى بريدك.')
            setResendTimer(60)
            await supabase.auth.resend({ type: 'signup', email: form.email.trim() })
          } else {
            setError('الإيميل أو كلمة السر غير صحيحة')
          }
          setLoading(false)
          return
        }

        await handlePostAuthRedirect()

      } else if (mode === 'signup') {
        if (!form.full_name.trim()) {
          setError('يرجى إدخال اسم المستخدم أو الشخص المسؤول')
          setLoading(false)
          return
        }

        if (!form.phone.trim()) {
          setError('رقم الهاتف إلزامي لإنشاء وتفعيل الحساب')
          setLoading(false)
          return
        }

        const cleanPhone = form.phone.replace(/[^0-9+]/g, '')
        if (cleanPhone.length < 9) {
          setError('يرجى إدخال رقم هاتف صحيح (مثال: 0599123456 أو +970599123456)')
          setLoading(false)
          return
        }

        if (form.password.length < 8) {
          setError('كلمة السر يجب أن تكون 8 أحرف على الأقل')
          setLoading(false)
          return
        }

        const { data: signUpData, error: err } = await supabase.auth.signUp({
          email: form.email.trim(),
          password: form.password,
          options: {
            data: {
              full_name: form.full_name.trim(),
              company_name: form.company_name.trim(),
              phone: form.phone.trim(),
            },
          },
        })

        if (err) {
          setError(err.message === 'User already registered'
            ? 'هذا الإيميل مسجل مسبقاً، سجّل دخولك'
            : err.message)
          setLoading(false)
          return
        }

        // If email confirmation is enabled in Supabase, user session will be null or identities unconfirmed
        if (signUpData.user && (!signUpData.session || signUpData.user.identities?.length === 0)) {
          setMode('verify_signup_otp')
          setSuccessMsg(`تم إرسال رمز تحقق مكون من 6 أرقام إلى بريدك (${form.email.trim()}).`)
          setResendTimer(60)
        } else {
          // Direct login fallback if email confirmation is disabled
          await handlePostAuthRedirect()
        }

      } else if (mode === 'forgot_password') {
        if (!form.email.trim()) {
          setError('يرجى إدخال البريد الإلكتروني')
          setLoading(false)
          return
        }

        const { error: resetErr } = await supabase.auth.resetPasswordForEmail(form.email.trim())
        if (resetErr) {
          setError(resetErr.message)
          setLoading(false)
          return
        }

        setMode('verify_recovery_otp')
        setSuccessMsg(`تم إرسال رمز إعادة تعيين كلمة المرور إلى ${form.email.trim()}.`)
        setResendTimer(60)
      }
    } catch {
      setError('حدث خطأ غير متوقع، يرجى المحاولة لاحقاً')
    } finally {
      setLoading(false)
    }
  }

  // 2. Verify Signup OTP Code
  async function handleVerifySignupOtp(e: React.FormEvent) {
    e.preventDefault()
    if (!otpCode.trim() || otpCode.trim().length < 6) {
      setError('يرجى إدخال رمز التحقق المكون من 6 أرقام')
      return
    }

    setLoading(true)
    setError('')

    const { error: otpErr } = await supabase.auth.verifyOtp({
      email: form.email.trim(),
      token: otpCode.trim(),
      type: 'signup',
    })

    if (otpErr) {
      setError(otpErr.message.includes('Token has expired') ? 'انتهت صلاحية الرمز، اطلب رمزاً جديداً' : 'رمز التحقق غير صحيح، يرجى التأكد وإعادة المحاولة')
      setLoading(false)
      return
    }

    // Auto sign in with password after verification if needed
    const { data: signInData } = await supabase.auth.signInWithPassword({
      email: form.email.trim(),
      password: form.password,
    })

    if (signInData?.user) {
      // Save phone and details directly to profile for communication and support
      await supabase.from('profiles').update({
        phone: form.phone.trim(),
        full_name: form.full_name.trim(),
        company_name: form.company_name.trim(),
      }).eq('id', signInData.user.id)
    }

    await handlePostAuthRedirect()
    setLoading(false)
  }

  // 3. Verify Recovery OTP Code & Set New Password
  async function handleVerifyRecoveryOtp(e: React.FormEvent) {
    e.preventDefault()
    if (!otpCode.trim() || otpCode.trim().length < 6) {
      setError('يرجى إدخال رمز التحقق المكون من 6 أرقام')
      return
    }

    if (newPassword.length < 8) {
      setError('كلمة السر الجديدة يجب أن تكون 8 أحرف على الأقل')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('كلمتا السر غير متطابقتين')
      return
    }

    setLoading(true)
    setError('')

    // Verify recovery token
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email: form.email.trim(),
      token: otpCode.trim(),
      type: 'recovery',
    })

    if (verifyErr) {
      setError('رمز التحقق غير صحيح أو منتهي الصلاحية')
      setLoading(false)
      return
    }

    // Update to new password
    const { error: updErr } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (updErr) {
      setError(updErr.message || 'فشل تحديث كلمة السر')
      setLoading(false)
      return
    }

    setSuccessMsg('تم تغيير كلمة السر بنجاح! جاري الدخول...')
    setTimeout(async () => {
      await handlePostAuthRedirect()
    }, 1500)
    setLoading(false)
  }

  // Resend OTP code
  async function handleResendCode() {
    if (resendTimer > 0) return
    setLoading(true)
    setError('')

    try {
      if (mode === 'verify_signup_otp') {
        const { error: resendErr } = await supabase.auth.resend({
          type: 'signup',
          email: form.email.trim(),
        })
        if (resendErr) throw resendErr
        setSuccessMsg('تم إعادة إرسال رمز التحقق بنجاح.')
      } else if (mode === 'verify_recovery_otp') {
        const { error: resendErr } = await supabase.auth.resetPasswordForEmail(form.email.trim())
        if (resendErr) throw resendErr
        setSuccessMsg('تم إعادة إرسال رمز استعادة كلمة المرور.')
      }
      setResendTimer(60)
    } catch (err: any) {
      setError(err.message || 'فشل إعادة إرسال الرمز')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Logo & Platform Tagline */}
        <div className="mb-6 text-center flex flex-col items-center">
          <BazarkoLogo size="lg" variant="image" subtitle="منظومة ERP السحابية المتكاملة" href="/" className="mb-2" />
          <h1 className="mt-2 text-2xl font-bold text-white">
            {mode === 'login' && 'أهلاً بعودتك'}
            {mode === 'signup' && 'إنشاء حساب جديد'}
            {mode === 'verify_signup_otp' && 'توثيق الحساب'}
            {mode === 'forgot_password' && 'استعادة كلمة المرور'}
            {mode === 'verify_recovery_otp' && 'تعيين كلمة السر الجديدة'}
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            {mode === 'verify_signup_otp' && `أدخل رمز التحقق المرسل إلى ${form.email}`}
            {mode === 'forgot_password' && 'أدخل بريدك الإلكتروني لتلقي رمز التحقق'}
            {mode === 'verify_recovery_otp' && 'أدخل الرمز المرسل وكلمة المرور الجديدة'}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
          {/* Mode Switcher Tabs (Only on login / signup) */}
          {(mode === 'login' || mode === 'signup') && (
            <div className="mb-6 flex rounded-xl bg-slate-800 p-1">
              <button
                type="button"
                onClick={() => { setMode('login'); setError(''); setSuccessMsg('') }}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  mode === 'login' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                تسجيل الدخول
              </button>
              <button
                type="button"
                onClick={() => { setMode('signup'); setError(''); setSuccessMsg('') }}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  mode === 'signup' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                حساب جديد
              </button>
            </div>
          )}

          {/* Success Message Alert */}
          {successMsg && (
            <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300">
              {successMsg}
            </div>
          )}

          {/* Error Message Alert */}
          {error && (
            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* ────────────────────────────────────────────────────────── */}
          {/* VIEW 1 & 2: LOGIN OR SIGNUP FORM                           */}
          {/* ────────────────────────────────────────────────────────── */}
          {(mode === 'login' || mode === 'signup') && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'signup' && (
                <>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                      اسم المستخدم / الشخص المسؤول *
                    </label>
                    <input
                      type="text"
                      value={form.full_name}
                      onChange={e => update('full_name', e.target.value)}
                      placeholder="مثال: محمد أحمد"
                      required
                      className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-right text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                      اسم الشركة أو النشاط التجاري
                    </label>
                    <input
                      type="text"
                      value={form.company_name}
                      onChange={e => update('company_name', e.target.value)}
                      placeholder="مثال: شركة المنار للتجارة والتوزيع"
                      className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-right text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                      رقم الهاتف (إلزامي للتواصل والتوثيق) *
                    </label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={e => update('phone', e.target.value)}
                      placeholder="0599123456 أو +970599123456"
                      required
                      dir="ltr"
                      className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-left text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500 font-mono"
                    />
                    <span className="mt-1 block text-[11px] text-slate-400">
                      يُستخدم رقم الهاتف في ربط الحساب والتواصل الفني وأمان المنظومة.
                    </span>
                  </div>
                </>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-300">البريد الإلكتروني</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => update('email', e.target.value)}
                  placeholder="example@bazarko.app"
                  required
                  dir="ltr"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-left text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500 font-mono"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-semibold text-slate-300">كلمة المرور</label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => { setMode('forgot_password'); setError(''); setSuccessMsg('') }}
                      className="text-xs text-sky-400 hover:underline"
                    >
                      نسيت كلمة المرور؟
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => update('password', e.target.value)}
                  placeholder={mode === 'signup' ? '8 أحرف على الأقل' : '••••••••'}
                  required
                  dir="ltr"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-left text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-sky-500 py-3 text-sm font-bold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50 shadow-lg"
              >
                {loading
                  ? 'جاري التحقق...'
                  : mode === 'login' ? 'تسجيل الدخول' : 'إنشاء الحساب والمتابعة'}
              </button>
            </form>
          )}

          {/* ────────────────────────────────────────────────────────── */}
          {/* VIEW 3: VERIFY SIGNUP OTP (توثيق الحساب بكود 6 أرقام)     */}
          {/* ────────────────────────────────────────────────────────── */}
          {mode === 'verify_signup_otp' && (
            <form onSubmit={handleVerifySignupOtp} className="space-y-4">
              <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-center">
                <span className="text-2xl mb-1 block">✉️</span>
                <p className="text-xs text-slate-300">
                  تم إرسال رمز التحقق إلى:
                </p>
                <p className="font-mono text-sky-400 font-bold text-xs mt-0.5" dir="ltr">
                  {form.email}
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-center text-xs font-semibold text-slate-300">
                  رمز التحقق (OTP مكون من 6 أرقام) *
                </label>
                <input
                  type="text"
                  maxLength={6}
                  autoFocus
                  required
                  dir="ltr"
                  value={otpCode}
                  onChange={e => {
                    const val = e.target.value.replace(/[^\d]/g, '')
                    setOtpCode(val)
                    setError('')
                  }}
                  placeholder="000000"
                  className="w-full rounded-xl border-2 border-sky-500/40 bg-slate-800 py-3 text-center text-2xl font-bold tracking-[10px] text-white outline-none focus:border-sky-400 font-mono shadow-inner"
                />
              </div>

              <button
                type="submit"
                disabled={loading || otpCode.length < 6}
                className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50 shadow-lg"
              >
                {loading ? 'جارٍ التحقق...' : '✓ تأكيد وتفعيل الحساب'}
              </button>

              <div className="flex items-center justify-between pt-2 text-xs">
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(''); setSuccessMsg('') }}
                  className="text-slate-400 hover:text-white"
                >
                  ← العودة لتسجيل الدخول
                </button>

                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={resendTimer > 0 || loading}
                  className={`font-semibold ${
                    resendTimer > 0 ? 'text-slate-500 cursor-not-allowed' : 'text-sky-400 hover:underline'
                  }`}
                >
                  {resendTimer > 0 ? `إعادة الإرسال بعد (${resendTimer}ث)` : 'إعادة إرسال الرمز'}
                </button>
              </div>
            </form>
          )}

          {/* ────────────────────────────────────────────────────────── */}
          {/* VIEW 4: FORGOT PASSWORD (طلب رمز إعادة التعيين)             */}
          {/* ────────────────────────────────────────────────────────── */}
          {mode === 'forgot_password' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-300">البريد الإلكتروني المسجل</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => update('email', e.target.value)}
                  placeholder="example@bazarko.app"
                  required
                  dir="ltr"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-left text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500 font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-sky-500 py-3 text-sm font-bold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50 shadow-lg"
              >
                {loading ? 'جارٍ الإرسال...' : '📨 إرسال رمز إعادة التعيين'}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(''); setSuccessMsg('') }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  ← تذكرت كلمة المرور؟ تسجيل الدخول
                </button>
              </div>
            </form>
          )}

          {/* ────────────────────────────────────────────────────────── */}
          {/* VIEW 5: VERIFY RECOVERY OTP & SET NEW PASSWORD              */}
          {/* ────────────────────────────────────────────────────────── */}
          {mode === 'verify_recovery_otp' && (
            <form onSubmit={handleVerifyRecoveryOtp} className="space-y-4">
              <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-center">
                <p className="text-xs text-slate-300">
                  أدخل رمز الاستعادة المرسل إلى:
                </p>
                <p className="font-mono text-sky-400 font-bold text-xs mt-0.5" dir="ltr">
                  {form.email}
                </p>
              </div>

              <div>
                <label className="mb-1 block text-center text-xs font-semibold text-slate-300">
                  رمز التحقق (6 أرقام) *
                </label>
                <input
                  type="text"
                  maxLength={6}
                  required
                  dir="ltr"
                  value={otpCode}
                  onChange={e => {
                    const val = e.target.value.replace(/[^\d]/g, '')
                    setOtpCode(val)
                    setError('')
                  }}
                  placeholder="000000"
                  className="w-full rounded-xl border-2 border-sky-500/40 bg-slate-800 py-2 text-center text-xl font-bold tracking-[8px] text-white outline-none focus:border-sky-400 font-mono shadow-inner"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">كلمة المرور الجديدة *</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="8 أحرف على الأقل"
                  required
                  dir="ltr"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">تأكيد كلمة المرور الجديدة *</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="أعد إدخال كلمة المرور"
                  required
                  dir="ltr"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading || otpCode.length < 6 || !newPassword}
                className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50 shadow-lg"
              >
                {loading ? 'جارٍ الحفظ...' : '✓ حفظ كلمة المرور والدخول'}
              </button>

              <div className="flex items-center justify-between pt-1 text-xs">
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(''); setSuccessMsg('') }}
                  className="text-slate-400 hover:text-white"
                >
                  إلغاء
                </button>

                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={resendTimer > 0 || loading}
                  className={`font-semibold ${
                    resendTimer > 0 ? 'text-slate-500 cursor-not-allowed' : 'text-sky-400 hover:underline'
                  }`}
                >
                  {resendTimer > 0 ? `إعادة الإرسال بعد (${resendTimer}ث)` : 'إعادة إرسال الرمز'}
                </button>
              </div>
            </form>
          )}

        </div>
      </div>
    </main>
  )
}
