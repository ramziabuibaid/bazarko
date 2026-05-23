import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white" dir="rtl">

      {/* ─── Navbar ─── */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 py-3.5 flex items-center justify-between">
          <span className="text-xl font-black tracking-tight text-white">Bazarko</span>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            <a href="#features" className="rounded-lg px-3 py-1.5 text-slate-400 hover:text-white hover:bg-white/5 transition-colors no-underline">المميزات</a>
            <a href="#marketplace" className="rounded-lg px-3 py-1.5 text-slate-400 hover:text-white hover:bg-white/5 transition-colors no-underline">الأسواق</a>
            <a href="#pricing" className="rounded-lg px-3 py-1.5 text-slate-400 hover:text-white hover:bg-white/5 transition-colors no-underline">الأسعار</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login"
              className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors no-underline">
              تسجيل الدخول
            </Link>
            <Link href="/onboarding"
              className="rounded-lg bg-sky-600 hover:bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors no-underline">
              ابدأ مجاناً
            </Link>
          </div>
        </div>
      </header>

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden px-4 pt-20 pb-24 text-center">
        {/* Background glow */}
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center">
          <div className="h-[500px] w-[800px] rounded-full bg-sky-600/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-4 py-1.5 text-xs text-sky-400">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
            منصة التجارة الإلكترونية للسوق العربي
          </div>

          <h1 className="text-5xl font-black leading-tight sm:text-6xl">
            أدِر متجرك بالكامل<br />
            <span className="bg-gradient-to-l from-sky-400 to-cyan-300 bg-clip-text text-transparent">
              من مكان واحد
            </span>
          </h1>

          <p className="mx-auto max-w-xl text-lg text-slate-400 leading-relaxed">
            منصة SaaS متكاملة للتجار في فلسطين وسوريا — متجر إلكتروني، طلبيات، محاسبة،
            مخزون، زبائن، وصيانة. كل شيء جاهز من أول يوم.
          </p>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link href="/onboarding"
              className="group flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-500 px-7 py-3.5 text-base font-bold text-white transition-all shadow-lg shadow-sky-900/40 no-underline">
              أنشئ متجرك مجاناً
              <span className="transition-transform group-hover:-translate-x-1">←</span>
            </Link>
            <Link href="/marketplace/ps"
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-7 py-3.5 text-base font-semibold text-white transition-all no-underline">
              🛍️ تصفح السوق
            </Link>
          </div>

          <p className="text-xs text-slate-600">لا حاجة لبطاقة ائتمانية · مجاني للبدء · إلغاء في أي وقت</p>
        </div>
      </section>

      {/* ─── Stats Bar ─── */}
      <section className="border-y border-white/5 bg-slate-900/40 py-6">
        <div className="mx-auto max-w-4xl px-4">
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-white/5">
            {[
              { num: '٢', unit: 'دولة', label: 'فلسطين وسوريا' },
              { num: '٣٧', unit: 'صفحة', label: 'في لوحة التحكم' },
              { num: '١٠٠٪', unit: 'عربي', label: 'واجهة وبيانات' },
            ].map(({ num, unit, label }) => (
              <div key={label} className="bg-slate-900/60 py-6 text-center">
                <p className="text-3xl font-black text-white">
                  {num} <span className="text-sky-400 text-xl">{unit}</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section id="features" className="px-4 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center space-y-3">
            <p className="text-xs uppercase tracking-widest text-sky-400">كل ما تحتاجه</p>
            <h2 className="text-3xl font-black text-white sm:text-4xl">منصة واحدة لكل شيء</h2>
            <p className="mx-auto max-w-lg text-slate-400">
              من إدارة المنتجات حتى المحاسبة وخدمة ما بعد البيع — كل شيء مدمج في Bazarko
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title}
                className="group rounded-2xl border border-white/5 bg-slate-900/60 p-6 hover:border-sky-500/20 hover:bg-slate-900 transition-all">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-sky-500/10 border border-sky-500/20 text-2xl">
                  {f.icon}
                </div>
                <h3 className="font-bold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Marketplace Section ─── */}
      <section id="marketplace" className="px-4 py-20 bg-slate-900/30">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center space-y-3">
            <p className="text-xs uppercase tracking-widest text-sky-400">الأسواق الإلكترونية</p>
            <h2 className="text-3xl font-black text-white sm:text-4xl">تسوّق من أفضل المتاجر</h2>
            <p className="text-slate-400">اكتشف آلاف المنتجات من متاجر موثوقة في منطقتك</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {MARKETS.map((m) => (
              <Link key={m.href} href={m.href}
                className="group relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br p-8 hover:border-sky-500/30 transition-all no-underline"
                style={{ background: `linear-gradient(135deg, ${m.from}, ${m.to})` }}>
                <div className="relative z-10">
                  <p className="text-4xl mb-3">{m.flag}</p>
                  <h3 className="text-xl font-black text-white mb-1">{m.name}</h3>
                  <p className="text-sm text-white/60 mb-4">{m.desc}</p>
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 border border-white/10 px-4 py-1.5 text-sm font-semibold text-white group-hover:bg-white/20 transition-colors">
                    تسوق الآن ←
                  </span>
                </div>
                <div className="pointer-events-none absolute -bottom-6 -left-6 text-9xl opacity-10 select-none">
                  {m.flag}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section className="px-4 py-24">
        <div className="mx-auto max-w-4xl">
          <div className="mb-12 text-center space-y-3">
            <p className="text-xs uppercase tracking-widest text-sky-400">سهل وسريع</p>
            <h2 className="text-3xl font-black text-white sm:text-4xl">ابدأ في ٣ خطوات</h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="text-center space-y-3">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-600/20 border border-sky-500/20 text-sky-400 text-xl font-black">
                  {i + 1}
                </div>
                <h3 className="font-bold text-white">{s.title}</h3>
                <p className="text-sm text-slate-400">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing ─── */}
      <section id="pricing" className="px-4 py-24 bg-slate-900/30">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center space-y-3">
            <p className="text-xs uppercase tracking-widest text-sky-400">خطط بسيطة وشفافة</p>
            <h2 className="text-3xl font-black text-white sm:text-4xl">ابدأ مجاناً، وسِّع متى شئت</h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            {PLANS.map((p) => (
              <div key={p.name}
                className={`relative rounded-2xl border p-6 flex flex-col gap-5 ${p.highlight
                  ? 'border-sky-500/50 bg-sky-950/50 shadow-xl shadow-sky-900/20'
                  : 'border-white/5 bg-slate-900/60'}`}>
                {p.highlight && (
                  <div className="absolute -top-3 right-1/2 translate-x-1/2">
                    <span className="rounded-full bg-sky-500 px-3 py-0.5 text-xs font-bold text-white">
                      الأكثر شعبية
                    </span>
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-slate-400 mb-1">{p.name}</p>
                  <p className="text-3xl font-black text-white">{p.price}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{p.period}</p>
                </div>
                <ul className="space-y-2 flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                      <span className="text-sky-400 mt-0.5 shrink-0">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/onboarding"
                  className={`rounded-xl py-2.5 text-sm font-bold text-center transition-all no-underline ${p.highlight
                    ? 'bg-sky-600 hover:bg-sky-500 text-white'
                    : 'border border-white/10 bg-white/5 hover:bg-white/10 text-white'}`}>
                  ابدأ الآن
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="px-4 py-24">
        <div className="mx-auto max-w-3xl rounded-3xl border border-sky-500/20 bg-gradient-to-br from-sky-950/60 to-slate-900 p-12 text-center space-y-6">
          <h2 className="text-3xl font-black text-white sm:text-4xl">
            جاهز لبدء متجرك؟
          </h2>
          <p className="text-slate-400 max-w-md mx-auto">
            انضم لمئات التجار الذين يديرون أعمالهم بثقة عبر Bazarko. مجاني للبدء، لا تحتاج بطاقة ائتمانية.
          </p>
          <Link href="/onboarding"
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-500 px-8 py-4 text-base font-bold text-white transition-all shadow-xl shadow-sky-900/40 no-underline">
            أنشئ متجرك الآن — مجاناً ←
          </Link>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-white/5 px-4 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-between">
            <div className="text-center sm:text-right">
              <p className="text-lg font-black text-white">Bazarko</p>
              <p className="text-xs text-slate-600 mt-0.5">منصة التجارة الإلكترونية العربية</p>
            </div>
            <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-500">
              <Link href="/marketplace/ps" className="hover:text-white no-underline transition-colors">سوق فلسطين</Link>
              <Link href="/marketplace/sy" className="hover:text-white no-underline transition-colors">سوق سوريا</Link>
              <Link href="/login" className="hover:text-white no-underline transition-colors">تسجيل الدخول</Link>
              <Link href="/onboarding" className="hover:text-white no-underline transition-colors">إنشاء متجر</Link>
            </nav>
          </div>
          <div className="mt-8 border-t border-white/5 pt-6 text-center text-xs text-slate-700">
            © 2025 Bazarko · جميع الحقوق محفوظة · bazarko.app
          </div>
        </div>
      </footer>

    </div>
  )
}

/* ─── Data ─── */

const FEATURES = [
  {
    icon: '🛍️',
    title: 'متجر إلكتروني احترافي',
    desc: 'واجهة متجر جاهزة لزبائنك مع سلة تسوق، دفع، وتتبع الطلبيات — بدون أي إعداد تقني.',
  },
  {
    icon: '📦',
    title: 'إدارة الطلبيات والـ POS',
    desc: 'نقطة بيع (كاشير) سريعة، ذمم الزبائن، وتتبع حالة كل طلبية من الاستلام حتى التسليم.',
  },
  {
    icon: '📊',
    title: 'محاسبة متكاملة',
    desc: 'فواتير، سندات قبض وصرف، تقارير الربح والخسارة، وتدفق النقد — كل شيء في مكان واحد.',
  },
  {
    icon: '📋',
    title: 'إدارة المخزون',
    desc: 'تتبع الكميات، تنبيهات نفاد المخزون، حركات الدخول والخروج، وتقارير تفصيلية.',
  },
  {
    icon: '👥',
    title: 'إدارة الزبائن والذمم',
    desc: 'ملف كامل لكل زبون مع كشف حساب، سجل الطلبيات، والأرصدة المستحقة.',
  },
  {
    icon: '🔧',
    title: 'نظام الصيانة',
    desc: 'استلام الأجهزة، لوحة Kanban لمتابعة الإصلاحات، قطع الغيار، وتتبع الزبون بدون تسجيل دخول.',
  },
]

const MARKETS = [
  {
    href: '/marketplace/ps',
    flag: '🇵🇸',
    name: 'سوق فلسطين',
    desc: 'تسوق من أفضل المتاجر الفلسطينية بالشيكل الإسرائيلي',
    from: 'rgb(15 23 42)',
    to: 'rgb(7 89 133 / 0.4)',
  },
  {
    href: '/marketplace/sy',
    flag: '🇸🇾',
    name: 'سوق سوريا',
    desc: 'تسوق من أفضل المتاجر السورية بالليرة السورية',
    from: 'rgb(15 23 42)',
    to: 'rgb(67 20 7 / 0.4)',
  },
]

const STEPS = [
  {
    title: 'أنشئ حسابك',
    desc: 'سجّل بريدك الإلكتروني واختر اسم متجرك وعنوانه الفريد — في أقل من دقيقتين.',
  },
  {
    title: 'أضف منتجاتك',
    desc: 'أضف منتجاتك مع الصور والأسعار، ونظّمها في فئات. المتجر جاهز فوراً.',
  },
  {
    title: 'ابدأ البيع',
    desc: 'شارك رابط متجرك، واستقبل الطلبيات، وأدر كل شيء من لوحة تحكم واحدة.',
  },
]

const PLANS = [
  {
    name: 'مجاني',
    price: '٠',
    period: '/ شهرياً · دائماً مجاني',
    highlight: false,
    features: [
      'حتى ٥٠ منتج',
      'متجر إلكتروني كامل',
      'إدارة الطلبيات',
      'إدارة الزبائن',
    ],
  },
  {
    name: 'أساسي',
    price: 'قريباً',
    period: '/ شهرياً',
    highlight: true,
    features: [
      'منتجات غير محدودة',
      'المحاسبة الكاملة',
      'إدارة المخزون',
      'نظام الصيانة',
      'تقارير متقدمة',
    ],
  },
  {
    name: 'احترافي',
    price: 'قريباً',
    period: '/ شهرياً',
    highlight: false,
    features: [
      'كل مميزات الأساسي',
      'موظفون متعددون',
      'دعم أولوية',
      'تكاملات مخصصة',
    ],
  },
]
