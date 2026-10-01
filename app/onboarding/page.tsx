'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import BazarkoLogo from '@/components/ui/BazarkoLogo'
import { BUSINESS_TYPES, isBusinessType, initialStoreSettings, ONBOARDING_DRAFT_KEY, type BusinessType } from '@/lib/onboarding/business-types'
import styles from './onboarding.module.css'

type Step = 1 | 2 | 3
const validSlug = (value: string) => /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(value)
const RESERVED = ['www', 'api', 'admin', 'marketplace', 'dashboard', 'mail', 'smtp', 'ps', 'sy', 'jo', 'lb']

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [businessType, setBusinessType] = useState<BusinessType>('home')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [availability, setAvailability] = useState<'available' | 'taken' | null>(null)
  const [error, setError] = useState('')
  const checkVersion = useRef(0)
  const selection = BUSINESS_TYPES.find(item => item.id === businessType)!

  useEffect(() => {
    try {
      const draft = JSON.parse(sessionStorage.getItem(ONBOARDING_DRAFT_KEY) || 'null')
      if (draft && isBusinessType(draft.businessType)) {
        setBusinessType(draft.businessType)
        if (typeof draft.name === 'string') setName(draft.name.slice(0, 60))
        if (typeof draft.slug === 'string') setSlug(draft.slug.replace(/[^a-z0-9-]/g, '').slice(0, 30))
        if (typeof draft.name === 'string' && draft.name.trim().length >= 2 && typeof draft.slug === 'string' && validSlug(draft.slug)) setStep(2)
      }
    } catch { /* Storage is optional; setup still works when unavailable. */ }
    setReady(true)
    let active = true
    const supabase = createClient()
    void (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!active) return
        setUserId(user?.id || null)
        if (user) {
          const { data } = await supabase.from('store_members').select('store_id').eq('profile_id', user.id).eq('is_active', true).limit(1).maybeSingle()
          if (active && data) router.replace('/dashboard')
        }
      } finally { if (active) setAuthReady(true) }
    })().catch(() => { if (active) setError('تعذر التحقق من الجلسة. أعد تحميل الصفحة وحاول مجدداً.') })
    return () => { active = false }
  }, [router])

  useEffect(() => {
    if (!ready) return
    try { sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({ businessType, name, slug })) } catch { /* Optional draft */ }
  }, [businessType, name, slug, ready])

  function changeSlug(value: string) {
    checkVersion.current++
    setSlug(value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30))
    setAvailability(null)
    setChecking(false)
    setError('')
  }

  async function checkSlug(): Promise<boolean> {
    const version = ++checkVersion.current
    if (!validSlug(slug) || RESERVED.includes(slug)) {
      setError('استخدم 3 إلى 30 حرفاً إنجليزياً أو رقماً، ويمكن وضع شرطة بين الأحرف. اختر اسماً غير محجوز.')
      return false
    }
    setChecking(true)
    setError('')
    try {
      const { data, error: queryError } = await createClient().from('stores').select('id').eq('subdomain', slug).eq('country_code', 'PS').maybeSingle()
      if (version !== checkVersion.current) return false
      if (queryError) throw queryError
      setAvailability(data ? 'taken' : 'available')
      if (data) setError('هذا الرابط مستخدم. اختر رابطاً آخر.')
      return !data
    } catch {
      if (version === checkVersion.current) { setAvailability(null); setError('تعذر التحقق من الرابط. حاول مجدداً.') }
      return false
    } finally { if (version === checkVersion.current) setChecking(false) }
  }

  async function nextDetails(e: React.FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) { setError('أدخل اسماً من حرفين على الأقل.'); return }
    if (await checkSlug()) setStep(3)
  }

  async function createWorkspace() {
    setLoading(true)
    setError('')
    try {
      const supabase = createClient()
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError && authError.name !== 'AuthSessionMissingError') throw authError
      if (!user) { router.push('/login?mode=signup'); return }
      // Revalidate before insertion; the database unique constraint remains authoritative.
      if (!(await checkSlug())) return
      const { data: existing, error: memberError } = await supabase.from('store_members').select('store_id').eq('profile_id', user.id).eq('is_active', true).limit(1).maybeSingle()
      if (memberError) throw memberError
      if (existing) { router.replace('/dashboard'); return }
      const { error: insertError } = await supabase.from('stores').insert({ owner_id: user.id, country_code: 'PS', currency_code: 'ILS', name: name.trim(), subdomain: slug, settings: initialStoreSettings(businessType) })
      if (insertError) { setError(insertError.code === '23505' ? 'الرابط أصبح مستخدماً. ارجع واختر رابطاً آخر.' : 'تعذر إنشاء مساحة العمل. حاول مجدداً.'); return }
      try { sessionStorage.removeItem(ONBOARDING_DRAFT_KEY) } catch { /* Optional draft */ }
      router.replace('/dashboard')
    } catch { setError('تعذر الاتصال. تحقق من اتصالك وحاول مجدداً.') }
    finally { setLoading(false) }
  }

  return <main className={styles.page} dir="rtl">
    <header className={styles.header}><BazarkoLogo size="lg" variant="vector" /><Link href="/">رجوع إلى الرئيسية ←</Link></header>
    <div className={styles.content}>
      <ol className={styles.progress} aria-label="خطوات إعداد الحساب">{['نوع النشاط', 'تفاصيل مشروعك', 'جاهز للبداية'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={step >= index + 1 ? styles.activeStep : ''}><span>{step > index + 1 ? '✓' : index + 1}</span>{label}</li>)}</ol>
      {step === 1 ? <>
        <div className={styles.heading}><span>بداية تناسب نشاطك</span><h1>خلّينا نجهّز لك البداية المناسبة</h1><p>اختر الأقرب لطبيعة شغلك. نرتّب لك خطوات البداية على هذا الأساس.</p></div>
        <fieldset className={styles.choices}><legend className={styles.srOnly}>اختر نوع نشاطك</legend>{BUSINESS_TYPES.map((item, i) => <label key={item.id} className={`${styles.choice} ${businessType === item.id ? styles.selected : ''}`}><input type="radio" name="business-type" value={item.id} checked={businessType === item.id} onChange={() => setBusinessType(item.id)} /><span className={styles.radio} aria-hidden="true">{businessType === item.id ? '✓' : ''}</span><span className={styles.art} style={{ backgroundPosition: `${i * 50}% center` }} role="img" aria-label={item.title} /><strong>{item.title}</strong><span className={styles.description}>{item.description}</span></label>)}</fieldset>
        <section className={styles.tools} aria-live="polite"><h2>{selection.intro}</h2><div>{selection.tools.map((tool, i) => <span key={tool}><span aria-hidden="true">{['◇', '▤', '◫', '▱'][i]}</span>{tool}</span>)}</div><p>{selection.detail}</p></section>
        <button className={styles.primary} onClick={() => { setError(''); setStep(2) }}>متابعة <span aria-hidden="true">←</span></button>
        <p className={styles.note}>ابدأ بالأساسيات، وأضف الأدوات عندما تحتاجها.</p>
      </> : <>
        <div className={styles.heading}><span>{selection.title}</span><h1>{step === 2 ? 'نتعرّف على مشروعك' : 'بدايتك جاهزة'}</h1><p>{step === 2 ? 'اسم واضح ورابط يسهل مشاركته مع زبائنك.' : 'راجع التفاصيل، ثم أنشئ مساحة عملك.'}</p></div>
        {step === 2 ? <form className={styles.form} onSubmit={nextDetails}>
          <label htmlFor="business-name">{selection.nameLabel}</label><input id="business-name" value={name} onChange={e => { setName(e.target.value); setError('') }} placeholder={selection.placeholder} maxLength={60} required minLength={2} autoComplete="organization" />
          <label htmlFor="business-country">البلد والعملة</label><select id="business-country" value="PS" onChange={() => {}}><option value="PS">فلسطين — شيكل ₪</option></select><p className={styles.hint}>التسجيل متاح حالياً في فلسطين.</p>
          <label htmlFor="business-slug">رابط مشروعك</label><input id="business-slug" dir="ltr" value={slug} onChange={e => changeSlug(e.target.value)} placeholder="sara-bakery" minLength={3} maxLength={30} required autoCapitalize="none" spellCheck={false} aria-describedby="slug-help" />
          <p id="slug-help" className={styles.hint}>حروف إنجليزية وأرقام، ويمكن استخدام شرطة بين الأحرف.</p><div className={styles.linkPreview} dir="ltr">{slug || 'your-project'}.ps.{process.env.NEXT_PUBLIC_DOMAIN || 'bazarko.app'}</div>
          <div className={styles.status} aria-live="polite">{checking ? 'جارٍ التحقق من الرابط…' : availability === 'available' ? '✓ الرابط متاح' : availability === 'taken' ? 'الرابط مستخدم' : ''}</div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.actions}><button type="button" className={styles.back} onClick={() => { setError(''); setStep(1) }}>رجوع</button><button className={styles.primary} type="submit" disabled={checking}> {checking ? 'جارٍ التحقق…' : 'مراجعة التفاصيل ←'}</button></div>
        </form> : <section className={styles.form}><dl className={styles.review}><div><dt>نوع النشاط</dt><dd>{selection.title}</dd></div><div><dt>{selection.nameLabel}</dt><dd>{name}</dd></div><div><dt>البلد والعملة</dt><dd>فلسطين · شيكل ₪</dd></div><div><dt>الرابط</dt><dd dir="ltr">{slug}.ps.{process.env.NEXT_PUBLIC_DOMAIN || 'bazarko.app'}</dd></div></dl><p className={styles.hint}>{selection.detail}</p>{!userId && <p className={styles.authNote}>بعد المتابعة، أنشئ حسابك أو سجّل الدخول. سنحتفظ بتفاصيل مشروعك في هذا المتصفح لتكمل الإعداد.</p>}{error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.actions}><button className={styles.back} disabled={loading} onClick={() => { setError(''); setStep(2) }}>تعديل التفاصيل</button><button className={styles.primary} onClick={createWorkspace} disabled={loading || checking || !authReady}>{loading ? 'جارٍ الإنشاء…' : userId ? 'إنشاء مساحة العمل ←' : 'إنشاء حساب ومتابعة ←'}</button></div></section>}
      </>}
      <p className={styles.login}>لديك حساب؟ <Link href="/login">تسجيل الدخول</Link></p>
    </div>
  </main>
}
