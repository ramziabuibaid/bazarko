import Link from 'next/link'
import Image from 'next/image'
import {
  IndustriesShowcase,
  ModularSimulator,
  FaqAccordion
} from '@/components/landing/LandingInteractive'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-sky-500 selection:text-white" dir="rtl">

      {/* ─── شريط التنقل العلوي (Navbar) ─── */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2.5 no-underline">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-sky-600 to-cyan-400 font-black text-white text-lg shadow-md shadow-sky-600/30">
                B
              </span>
              <span className="text-xl font-black tracking-tight text-white">Bazarko</span>
            </Link>
            <span className="hidden sm:inline-flex items-center rounded-full bg-sky-500/10 border border-sky-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-sky-400">
              نظام ERP سحابي متكامل
            </span>
          </div>

          <nav className="hidden lg:flex items-center gap-1 text-sm font-medium">
            <a href="#customization" className="rounded-lg px-3 py-1.5 text-slate-300 hover:text-white hover:bg-white/5 transition-colors no-underline">التخصيص والقطاعات</a>
            <a href="#modules" className="rounded-lg px-3 py-1.5 text-slate-300 hover:text-white hover:bg-white/5 transition-colors no-underline">وحدات الـ ERP</a>
            <a href="#architecture" className="rounded-lg px-3 py-1.5 text-slate-300 hover:text-white hover:bg-white/5 transition-colors no-underline">المعمارية المعيارية</a>
            <a href="#marketplace" className="rounded-lg px-3 py-1.5 text-slate-300 hover:text-white hover:bg-white/5 transition-colors no-underline">الأسواق</a>
            <a href="#pricing" className="rounded-lg px-3 py-1.5 text-slate-300 hover:text-white hover:bg-white/5 transition-colors no-underline">الأسعار</a>
            <a href="#faq" className="rounded-lg px-3 py-1.5 text-slate-300 hover:text-white hover:bg-white/5 transition-colors no-underline">الأسئلة الشائعة</a>
          </nav>

          <div className="flex items-center gap-2.5">
            <Link
              href="/login"
              className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/5 transition-colors no-underline"
            >
              تسجيل الدخول
            </Link>
            <Link
              href="/onboarding"
              className="rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 px-5 py-2 text-sm font-bold text-white transition-all shadow-lg shadow-sky-900/40 no-underline"
            >
              ابدأ مجاناً
            </Link>
          </div>
        </div>
      </header>

      {/* ─── القسم الرئيسي (Hero Section) ─── */}
      <section className="relative overflow-hidden px-4 pt-16 sm:pt-24 pb-20 text-center">
        {/* توهج خلفية ديناميكي */}
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center">
          <div className="h-[550px] w-[950px] rounded-full bg-gradient-to-tr from-sky-600/15 via-cyan-500/15 to-emerald-500/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-5xl space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-1.5 text-xs font-semibold text-sky-400 backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
            منظومة ERP سحابية متكاملة وقابلة للتخصيص بالكامل 100%
          </div>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-[1.15] text-white">
            نظام الـ ERP السحابي<br />
            <span className="bg-gradient-to-l from-sky-400 via-cyan-300 to-emerald-300 bg-clip-text text-transparent">
              المصمم ليتشكل حسب نشاطك
            </span>
          </h1>

          <p className="mx-auto max-w-2xl text-base sm:text-xl text-slate-300 leading-relaxed font-normal">
            سواء كنت تدير متجر تجزئة، مركز صيانة أجهزة، مستودع جملة، أو شركة خدمات — بازركو يمنحك
            المحاسبة المزدوجة، الشيكات وبنوك PMA، المخزون، ونقاط البيع في نظام موديولار تفصّله بضغطة زر.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2">
            <Link
              href="/onboarding"
              className="group flex w-full sm:w-auto items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 px-8 py-4 text-base font-bold text-white transition-all shadow-xl shadow-sky-900/50 hover:shadow-sky-800/60 no-underline"
            >
              أنشئ نظامك مجاناً الآن
              <span className="transition-transform group-hover:-translate-x-1 font-bold">←</span>
            </Link>
            <Link
              href="#customization"
              className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 hover:bg-white/10 px-7 py-4 text-base font-semibold text-white transition-all backdrop-blur-md no-underline"
            >
              🧩 استكشف التخصيص حسب مجالك
            </Link>
          </div>

          {/* مؤشرات الموثوقية */}
          <div className="flex flex-wrap items-center justify-center gap-6 pt-4 text-xs sm:text-sm text-slate-400">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 font-bold">✓</span>
              <span>متوافق 100% مع معايير سلطة النقد (PMA)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sky-400 font-bold">✓</span>
              <span>تخصيص فوري للوحدات حسب القطاع</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-cyan-400 font-bold">✓</span>
              <span>سحابي بالكامل ولا يحتاج أي تنصيب</span>
            </div>
          </div>
        </div>

        {/* ─── معاينة لوحة التحكم البصرية (Hero Mockup) ─── */}
        <div className="relative mx-auto mt-12 max-w-6xl">
          <div className="relative rounded-3xl border border-white/15 bg-slate-900/60 p-2 sm:p-3.5 shadow-2xl backdrop-blur-xl ring-1 ring-white/10">
            {/* شريط المتصفح المصغر */}
            <div className="mb-2.5 flex items-center justify-between px-3 py-1 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-red-500/80 inline-block" />
                <span className="h-3 w-3 rounded-full bg-yellow-500/80 inline-block" />
                <span className="h-3 w-3 rounded-full bg-emerald-500/80 inline-block" />
              </div>
              <div className="rounded-full bg-slate-950/70 border border-white/10 px-4 py-1 text-xs text-slate-400 font-mono flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                app.bazarko.com/dashboard/accounting
              </div>
              <div className="text-xs text-slate-500">لوحة القيادة الموحدة</div>
            </div>

            {/* الصورة المولدة من المهارات */}
            <div className="relative overflow-hidden rounded-2xl aspect-[16/9] w-full bg-slate-950">
              <Image
                src="/images/erp-dashboard.jpg"
                alt="لوحة تحكم نظام بازركو ERP المتقدمة"
                fill
                priority
                sizes="(max-width: 1200px) 100vw, 1200px"
                className="object-cover object-top hover:scale-[1.01] transition-transform duration-700"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-40" />
            </div>

            {/* شارات عائمة احترافية */}
            <div className="hidden md:flex absolute -bottom-5 -right-6 items-center gap-3 rounded-2xl border border-sky-500/30 bg-slate-900/95 px-5 py-3 shadow-2xl backdrop-blur-xl">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400 text-xl font-black">
                40+
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-white">شاشة ونظام فرعي متكامل</p>
                <p className="text-[11px] text-slate-400">محاسبة، مخزون، صيانة، شيكات، وPOS</p>
              </div>
            </div>

            <div className="hidden md:flex absolute -top-5 -left-6 items-center gap-3 rounded-2xl border border-emerald-500/30 bg-slate-900/95 px-5 py-3 shadow-2xl backdrop-blur-xl">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 text-xl font-bold">
                ✓
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-white">قيود محاسبية مزدوجة متزنة</p>
                <p className="text-[11px] text-slate-400">ترحيل فوري للفواتير وسندات القبض</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── شريط الأرقام والإحصائيات ─── */}
      <section className="border-y border-white/5 bg-slate-900/40 py-8 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { num: '100%', label: 'قابل للتخصيص', desc: 'فعّل الموديولات المناسبة لنشاطك' },
              { num: '40+', label: 'شاشة متخصصة', desc: 'في نظام الـ ERP ولوحة الإدارة' },
              { num: '100%', label: 'توافق PMA وبنوك', desc: 'إدارة شيكات متوافقة مع سلطة النقد' },
              { num: '0', label: 'تكلفة للبدء', desc: 'خطة مجانية كاملة بدون بطاقة ائتمان' },
            ].map(({ num, label, desc }) => (
              <div key={label} className="space-y-1 p-3">
                <p className="text-3xl sm:text-4xl font-black text-white bg-gradient-to-r from-sky-400 to-cyan-300 bg-clip-text text-transparent">
                  {num}
                </p>
                <p className="text-sm font-bold text-slate-200">{label}</p>
                <p className="text-xs text-slate-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── قسم التخصيص التفاعلي حسب القطاعات ─── */}
      <section id="customization" className="px-4 py-24 relative">
        <div className="mx-auto max-w-7xl">
          <div className="mb-14 text-center space-y-4 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/10 px-3.5 py-1 text-xs font-semibold text-sky-400">
              <span>🎯</span> تخصيص عميق لكل نشاط تجاري
            </div>
            <h2 className="text-3xl sm:text-5xl font-black text-white">
              نظام يتكيّف مع مجالك مهما كان
            </h2>
            <p className="text-slate-300 text-base sm:text-lg">
              لا ترغم عملك على التأقلم مع برامج جامدة. في بازركو، اختر مجالك وسيقوم النظام فوراً بتفعيل
              الشاشات والأدوات المناسبة لطبيعة أعمالك بدقة متناهية.
            </p>
          </div>

          {/* المكون التفاعلي لاختيار القطاع وموديولاته */}
          <IndustriesShowcase />

          {/* صورة القطاعات المتكاملة */}
          <div className="mt-16 rounded-3xl border border-white/10 bg-slate-900/50 p-4 sm:p-6 backdrop-blur-xl">
            <div className="grid lg:grid-cols-12 gap-6 items-center">
              <div className="lg:col-span-5 space-y-4 pr-2">
                <span className="rounded-md bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 text-xs font-bold text-cyan-400">
                  منظومة سحابية موحدة
                </span>
                <h3 className="text-2xl sm:text-3xl font-black text-white">
                  بيئة عمل واحدة تغذي كل أركان مؤسستك
                </h3>
                <p className="text-slate-300 text-sm leading-relaxed">
                  سواء كان فريقك يعمل داخل متجر التجزئة، أو في ورشة الصيانة التقنية، أو في مستودعات الجملة والشحن، أو في الإدارة المالية — الجميع يرتبط بقاعدة بيانات واحدة متزامنة لحظياً.
                </p>
                <div className="space-y-2 pt-2 text-xs sm:text-sm text-slate-300">
                  <div className="flex items-center gap-2">
                    <span className="text-sky-400">✓</span>
                    <span>مزامنة فورية بين المبيعات والمستودع والمحاسبة</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sky-400">✓</span>
                    <span>صلاحيات دقيقة لكل مستخدم وموظف وفني</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sky-400">✓</span>
                    <span>تتبع نشاط الموظفين وسجل الرقابة والأمان</span>
                  </div>
                </div>
              </div>
              <div className="lg:col-span-7">
                <div className="relative aspect-[16/9] w-full rounded-2xl overflow-hidden border border-white/10 shadow-xl">
                  <Image
                    src="/images/erp-industries.jpg"
                    alt="نظام بازركو ERP لكافة القطاعات: تجزئة، صيانة، مستودعات، ومالية"
                    fill
                    sizes="(max-width: 1024px) 100vw, 650px"
                    className="object-cover"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── قسم المعمارية المعيارية (Modular Architecture) ─── */}
      <section id="architecture" className="px-4 py-24 bg-slate-900/30 border-y border-white/5 relative">
        <div className="mx-auto max-w-7xl space-y-16">
          <div className="text-center space-y-4 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3.5 py-1 text-xs font-semibold text-emerald-400">
              <span>🧩</span> حرية التحكم الكاملة
            </div>
            <h2 className="text-3xl sm:text-5xl font-black text-white">
              فعّل ما يلزمك.. واغلق ما لا تحتاجه
            </h2>
            <p className="text-slate-300 text-base sm:text-lg">
              لماذا تشتري نظاماً يثقل كاهلك بشاشات لا تستخدمها؟ صممنا بازركو بمعمارية Plug-and-Play تتيح لك تشغيل أو إيقاف أي موديول بنقرة زر واحدة من شاشة الإعدادات.
            </p>
          </div>

          {/* محاكي تركيب الموديولات */}
          <ModularSimulator />

          {/* صورة المعمارية الثلاثية الأبعاد */}
          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-4 sm:p-6 overflow-hidden">
            <div className="grid lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-7">
                <div className="relative aspect-[16/9] w-full rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
                  <Image
                    src="/images/erp-modular.jpg"
                    alt="معمارية بازركو ERP المعيارية - موديولات مترابطة وقابلة للتخصيص"
                    fill
                    sizes="(max-width: 1024px) 100vw, 700px"
                    className="object-cover"
                  />
                </div>
              </div>
              <div className="lg:col-span-5 space-y-4">
                <span className="rounded-md bg-sky-500/10 border border-sky-500/20 px-2.5 py-1 text-xs font-bold text-sky-400">
                  بنية تحتية متطورة
                </span>
                <h3 className="text-2xl sm:text-3xl font-black text-white">
                  موديولات مستقلة ترتبط تلقائياً دون برمجة
                </h3>
                <p className="text-slate-300 text-sm leading-relaxed">
                  عند تفعيل أي وحدة جديدة، تندمج بياناتها فوراً مع باقي أجزاء النظام: فواتير المبيعات تُنشئ قيوداً محاسبية تلقائية، وأجهزة الصيانة تخصم قطع الغيار من المستودع مباشرة.
                </p>
                <div className="p-4 rounded-2xl bg-slate-950/70 border border-white/5 space-y-2">
                  <p className="text-xs font-bold text-white">⚙️ أمثلة للتخصيص السريع بنقرة زر:</p>
                  <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
                    <li>محلات الأثاث والملابس: إيقاف وحدة الصيانة بالكامل للاكتفاء بالـ POS والمخزون.</li>
                    <li>مراكز صيانة الهواتف: تشغيل لوحة الصيانة وبطاقات استلام الأجهزة.</li>
                    <li>الشركات الخدمية: إخفاء المتجر الإلكتروني الخارجي واستخدام المحاسبة والشيكات داخلياً.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── استعراض وحدات الـ ERP الرئيسية (Deep Modules) ─── */}
      <section id="modules" className="px-4 py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-14 text-center space-y-3 max-w-3xl mx-auto">
            <p className="text-xs uppercase tracking-widest font-bold text-sky-400">ترسانة أدوات متكاملة</p>
            <h2 className="text-3xl sm:text-5xl font-black text-white">كل ما يحتاجه عملك في منصة واحدة</h2>
            <p className="text-slate-300 text-base sm:text-lg">
              تصفح الوحدات والأنظمة الفرعية التي تجعل بازركو الخيار الأول للشركات والمتاجر المتقدمة
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {ERP_MODULES.map((m) => (
              <div
                key={m.title}
                className="group rounded-3xl border border-white/10 bg-slate-900/60 p-7 hover:border-sky-500/30 hover:bg-slate-900 transition-all duration-300 flex flex-col justify-between"
              >
                <div>
                  <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/10 border border-sky-500/20 text-3xl group-hover:scale-110 transition-transform">
                    {m.icon}
                  </div>
                  <div className="inline-block rounded-md bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold text-sky-400 mb-2">
                    {m.badge}
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">{m.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-5">{m.desc}</p>
                </div>

                <div className="space-y-2 border-t border-white/5 pt-4">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">أهم الإمكانيات:</p>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {m.points.map((pt, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="text-sky-400 font-bold shrink-0">✓</span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── ميزات العملات المحلية والامتثال المالي ─── */}
      <section className="px-4 py-20 bg-gradient-to-b from-slate-900/60 to-slate-950 border-t border-white/5">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-3xl border border-sky-500/20 bg-sky-950/20 p-8 sm:p-12 relative overflow-hidden">
            <div className="grid lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-7 space-y-4">
                <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-bold text-emerald-400 inline-block">
                  🇵🇸 بني خصيصاً للبيئة المحلية والأسواق العربية
                </span>
                <h3 className="text-2xl sm:text-4xl font-black text-white">
                  محاسبة دقيقة متعددة العملات مع ربط سلطة النقد (PMA)
                </h3>
                <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
                  صُمم بازركو ليفهم واقع السوق العربي بالتفصيل: تداول الشيكل الإسرائيلي، الدينار الأردني، والدولار الأمريكي مع تثبيت أسعار الصرف، ومحفظة الشيكات البنكية الرسمية، وسندات القبض والصرف المتوافقة مع القوانين الضريبية.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
                  <div className="p-3 rounded-xl bg-slate-900/80 border border-white/10 text-center">
                    <p className="text-lg font-bold text-white">ILS ₪</p>
                    <p className="text-[11px] text-slate-400">شيكل إسرائيلي</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/80 border border-white/10 text-center">
                    <p className="text-lg font-bold text-white">JOD د.أ</p>
                    <p className="text-[11px] text-slate-400">دينار أردني</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/80 border border-white/10 text-center">
                    <p className="text-lg font-bold text-white">USD $</p>
                    <p className="text-[11px] text-slate-400">دولار أمريكي</p>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-5 space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>حالة محفظة الشيكات</span>
                    <span className="text-emerald-400 font-bold">متوافقة 100%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 w-full" />
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    مسار كامل لإدارة الشيك: تسجيل رقم الشيك، البنك والفرع، تاريخ الاستحقاق، التجيير، التحصيل المباشر، أو الإيداع في الحساب البنكي مع القيود الآلية.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── قسم الأسواق الإلكترونية (Marketplace) ─── */}
      <section id="marketplace" className="px-4 py-24 bg-slate-900/30">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center space-y-3">
            <p className="text-xs uppercase tracking-widest font-bold text-sky-400">التجارة الإقليمية والمحلية</p>
            <h2 className="text-3xl sm:text-4xl font-black text-white">سوق بازركو الموحد والمتاجر المباشرة</h2>
            <p className="text-slate-300 max-w-xl mx-auto text-sm sm:text-base">
              بالإضافة إلى نظام الـ ERP الداخلي، يحصل كل تاجر على متجر إلكتروني مستقل مع إمكانية عرض المنتجات تلقائياً في سوق بازركو الإقليمي لجلب المزيد من الزبائن.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 max-w-4xl mx-auto">
            {MARKETS.map((m) => (
              <Link
                key={m.href}
                href={m.href}
                className="group relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br p-8 hover:border-sky-500/40 transition-all no-underline"
                style={{ background: `linear-gradient(135deg, ${m.from}, ${m.to})` }}
              >
                <div className="relative z-10 space-y-4">
                  <span className="text-5xl block">{m.flag}</span>
                  <div>
                    <h3 className="text-2xl font-black text-white">{m.name}</h3>
                    <p className="text-sm text-white/70 mt-1">{m.desc}</p>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 px-5 py-2 text-sm font-bold text-white transition-colors">
                    تصفح المتاجر والمنتجات ←
                  </span>
                </div>
                <div className="pointer-events-none absolute -bottom-8 -left-8 text-9xl opacity-10 select-none">
                  {m.flag}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ─── باقات الأسعار الشفافة (Pricing) ─── */}
      <section id="pricing" className="px-4 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center space-y-3">
            <p className="text-xs uppercase tracking-widest font-bold text-sky-400">خطط تناسب جميع الأحجام</p>
            <h2 className="text-3xl sm:text-4xl font-black text-white">ابدأ مجاناً 100%، وتوسّع بثقة</h2>
            <p className="text-slate-300 text-sm sm:text-base">
              أسعار واضحة بدون أي رسوم خفية أو عقود ملزمة.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3 max-w-5xl mx-auto">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={`relative rounded-3xl border p-8 flex flex-col justify-between transition-all ${
                  p.highlight
                    ? 'border-sky-500/60 bg-gradient-to-b from-sky-950/60 to-slate-900 shadow-2xl shadow-sky-900/30 ring-1 ring-sky-400/30'
                    : 'border-white/10 bg-slate-900/60 hover:border-white/20'
                }`}
              >
                {p.highlight && (
                  <div className="absolute -top-3.5 right-1/2 translate-x-1/2">
                    <span className="rounded-full bg-gradient-to-r from-sky-500 to-cyan-500 px-4 py-1 text-xs font-bold text-white shadow-md">
                      الأكثر اختياراً للشركات
                    </span>
                  </div>
                )}

                <div>
                  <p className="text-base font-bold text-slate-300 mb-2">{p.name}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-black text-white">{p.price}</span>
                    <span className="text-xs text-slate-400">{p.period}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2 mb-6">{p.desc}</p>

                  <ul className="space-y-2.5 border-t border-white/5 pt-5 mb-8">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-200">
                        <span className="text-sky-400 font-bold mt-0.5 shrink-0">✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <Link
                  href="/onboarding"
                  className={`w-full rounded-xl py-3 text-sm font-bold text-center transition-all no-underline ${
                    p.highlight
                      ? 'bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 text-white shadow-lg'
                      : 'border border-white/15 bg-white/5 hover:bg-white/10 text-white'
                  }`}
                >
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── الأسئلة الشائعة (Interactive FAQ) ─── */}
      <section id="faq" className="px-4 py-24 bg-slate-900/20 border-t border-white/5">
        <div className="mx-auto max-w-4xl">
          <div className="mb-14 text-center space-y-3">
            <p className="text-xs uppercase tracking-widest font-bold text-sky-400">إجابات فورية</p>
            <h2 className="text-3xl sm:text-4xl font-black text-white">الأسئلة الشائعة حول بازركو ERP</h2>
            <p className="text-slate-300 text-sm sm:text-base">
              كل ما تود معرفته عن التخصيص، المحاسبة، وأمان بيانات أعمالك
            </p>
          </div>

          <FaqAccordion />
        </div>
      </section>

      {/* ─── الدعوة النهائية للإجراء (Final CTA) ─── */}
      <section className="px-4 py-24">
        <div className="mx-auto max-w-4xl rounded-3xl border border-sky-500/30 bg-gradient-to-br from-sky-950/80 via-slate-900 to-slate-950 p-10 sm:p-16 text-center space-y-7 shadow-2xl relative overflow-hidden">
          <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-sky-500/20 rounded-full blur-3xl" />

          <div className="relative z-10 space-y-4">
            <span className="rounded-full bg-sky-500/10 border border-sky-500/20 px-3.5 py-1 text-xs font-bold text-sky-400 inline-block">
              🚀 انطلاقة فورية في أقل من دقيقتين
            </span>
            <h2 className="text-3xl sm:text-5xl font-black text-white leading-tight">
              جاهز لتحديث وإدارة أعمالك باحترافية؟
            </h2>
            <p className="text-slate-300 max-w-xl mx-auto text-base sm:text-lg">
              انضم لمئات التجار والشركات التي تدير مبيعاتها ومحاسبتها ومخزونها عبر بازركو. ابدأ الآن مجاناً وبدون بطاقة ائتمانية.
            </p>
          </div>

          <div className="relative z-10 flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2">
            <Link
              href="/onboarding"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 px-9 py-4 text-base font-bold text-white transition-all shadow-xl shadow-sky-900/50 no-underline"
            >
              أنشئ حسابك ونظامك الآن مجاناً ←
            </Link>
            <Link
              href="/login"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 hover:bg-white/10 px-7 py-4 text-base font-semibold text-white transition-all no-underline"
            >
              تسجيل الدخول للنظام
            </Link>
          </div>
        </div>
      </section>

      {/* ─── تذييل الصفحة (Footer) ─── */}
      <footer className="border-t border-white/10 px-4 py-12 bg-slate-950">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
            <div className="col-span-2 space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-sky-600 to-cyan-400 font-black text-white text-base">
                  B
                </span>
                <span className="text-xl font-black text-white">Bazarko ERP</span>
              </div>
              <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                منظومة تخطيط موارد المؤسسات (ERP) السحابية المتكاملة والمخصصة للشركات والمتاجر في العالم العربي — محاسبة مزدوجة، مخزون، شيكات، صيانة، وتجارة إلكترونية.
              </p>
              <p className="text-[11px] text-slate-400 pt-1">
                متوافق مع معايير سلطة النقد والمحاسبة المعيارية
              </p>
            </div>

            <div>
              <p className="text-xs font-bold text-white uppercase tracking-wider mb-3">النظام والوحدات</p>
              <ul className="space-y-2 text-xs text-slate-400">
                <li><a href="#modules" className="hover:text-white transition-colors no-underline">المحاسبة المزدوجة</a></li>
                <li><a href="#modules" className="hover:text-white transition-colors no-underline">محفظة الشيكات PMA</a></li>
                <li><a href="#modules" className="hover:text-white transition-colors no-underline">المخزون والمستودعات</a></li>
                <li><a href="#modules" className="hover:text-white transition-colors no-underline">ورش الصيانة والأجهزة</a></li>
                <li><a href="#modules" className="hover:text-white transition-colors no-underline">نقاط البيع والـ POS</a></li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-bold text-white uppercase tracking-wider mb-3">القطاعات المخصصة</p>
              <ul className="space-y-2 text-xs text-slate-400">
                <li><a href="#customization" className="hover:text-white transition-colors no-underline">متاجر التجزئة والكاشير</a></li>
                <li><a href="#customization" className="hover:text-white transition-colors no-underline">مراكز صيانة الإلكترونيات</a></li>
                <li><a href="#customization" className="hover:text-white transition-colors no-underline">تجارة الجملة والتوزيع</a></li>
                <li><a href="#customization" className="hover:text-white transition-colors no-underline">الشركات والخدمات المالية</a></li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-bold text-white uppercase tracking-wider mb-3">روابط سريعة</p>
              <ul className="space-y-2 text-xs text-slate-400">
                <li><Link href="/marketplace/ps" className="hover:text-white transition-colors no-underline">سوق فلسطين الموحد</Link></li>
                <li><Link href="/login" className="hover:text-white transition-colors no-underline">تسجيل الدخول</Link></li>
                <li><Link href="/onboarding" className="hover:text-white transition-colors no-underline">إنشاء متجر جديد</Link></li>
                <li><a href="#pricing" className="hover:text-white transition-colors no-underline">باقات الاشتراك</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/5 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
            <div>
              © 2026 Bazarko · جميع الحقوق محفوظة · bazarko.app
            </div>
            <div className="flex gap-4">
              <span>أمان سحابي SSL مشفر</span>
              <span>•</span>
              <span>نسخ احتياطي تلقائي</span>
              <span>•</span>
              <span>أرقام ومعايير دولية</span>
            </div>
          </div>
        </div>
      </footer>

    </div>
  )
}

// ─── بيانات وحدات الـ ERP (ERP Modules Data) ────────────────
const ERP_MODULES = [
  {
    icon: '📊',
    badge: 'المالية والمحاسبة',
    title: 'محاسبة مزدوجة وشجرة حسابات',
    desc: 'منظومة مالية نظامية مع قيود يومية آلية، شجرة حسابات متعددة المستويات، وميزان مراجعة وتقارير أرباح وخسائر رسمية.',
    points: [
      'شجرة حسابات (Chart of Accounts) مرنة',
      'قيود يومية مزدوجة مع موازنة تلقائية',
      'سندات قبض وصرف مرتبطة بصناديق الخزينة',
      'سجل رقابة وتدقيق (Audit Log) متقدم',
    ],
  },
  {
    icon: '🏦',
    badge: 'البنوك والامتثال',
    title: 'محفظة الشيكات وبنوك PMA',
    desc: 'إدارة دورة حياة الشيكات الواردة والصادرة وفق معايير سلطة النقد مع مسارات التجيير، التحصيل، والإيداع البنكي.',
    points: [
      'سجل كامل للشيكات الواردة والصادرة',
      'تتبع دقيق لحالات الشيك (قيد التحصيل، مجير، مرتجع)',
      'كشوفات حسابات بنكية دورية ومطابقة',
      'تنبيهات استحقاق الشيكات القادمة',
    ],
  },
  {
    icon: '📦',
    badge: 'المستودعات والمخزون',
    title: 'المخزون وكشف حركات الصنف',
    desc: 'تتبع شامل للكميات وحركات الوارد والمنصرف مع رصيد تراكمي، دليل الماركات والبراندات، وتنبيهات النواقص التلقائية.',
    points: [
      'كشف تفصيلي وتراكمي لحركة كل صنف',
      'دليل الماركات والبراندات والتصنيفات',
      'تنبيهات فورية عند وصول المنتجات للحد الأدنى',
      'تصدير واستيراد المخزون بملفات Excel',
    ],
  },
  {
    icon: '🔧',
    badge: 'الورش والخدمة',
    title: 'نظام الصيانة واستلام الأجهزة',
    desc: 'وحدة متخصصة لإدارة مراكز صيانة الأجهزة والورش الفنية مع لوحة متابعة بصرية ورابط تتبع للعميل.',
    points: [
      'استلام أجهزة جديدة وطباعة وصل بباركود',
      'لوحة Kanban مرئية لمراحل الإصلاح',
      'ربط قطع الغيار المستهلكة بتكلفة الصيانة',
      'تتبع الزبون لحالة جهازه مباشرة عبر الويب',
    ],
  },
  {
    icon: '🧾',
    badge: 'المبيعات والكاشير',
    title: 'نقاط البيع السريعة والـ POS',
    desc: 'واجهة كاشير خفيفة وفائقة السرعة تدعم أجهزة الباركود، الشاشات اللمسية، إدارة الفواتير والذمم، ومردودات المبيعات.',
    points: [
      'إصدار فواتير ومردودات مبيعات بضغطة زر',
      'دعم شاشات اللمس وقارئات الباركود',
      'عروض أسعار تتحول لفواتير رسمية فوراً',
      'جلسات كاشير يومية وإغلاق الصندوق',
    ],
  },
  {
    icon: '👥',
    badge: 'العملاء والموردين',
    title: 'دليل الزبائن والموردين والذمم',
    desc: 'ملف موحد لكل عميل ومورد مع كشف حساب تفصيلي، متابعة سقف الائتمان، وإشعارات بأعمار الديون والفواتير المستحقة.',
    points: [
      'كشوف حسابات قابلة للطباعة والمشاركة',
      'إدارة سقوف الائتمان وحدود الدين',
      'دورة مشتريات ومردودات مشتريات للموردين',
      'إشعارات ذكية بالديون المتأخرة',
    ],
  },
]

// ─── بيانات الأسواق الإلكترونية ──────────────────────────────
const MARKETS = [
  {
    href: '/marketplace/ps',
    flag: '🇵🇸',
    name: 'سوق فلسطين',
    desc: 'تسوق من أفضل الشركات والمتاجر الفلسطينية بالعملات المتداولة (شيكل، دينار، دولار)',
    from: 'rgb(15 23 42)',
    to: 'rgb(7 89 133 / 0.45)',
  },
]

// ─── خطط الاشتراك ──────────────────────────────────────────
const PLANS = [
  {
    name: 'الخطة المجانية (Free)',
    price: '0 شيكل',
    period: '/ شهرياً · دائماً مجاني',
    desc: 'مثالية للأنشطة الناشئة والمتاجر لتجربة المنظومة والتعرف على كفاءة الـ ERP.',
    highlight: false,
    cta: 'ابدأ مجاناً الآن',
    features: [
      'حتى 50 صنف ومنتج في المستودع',
      'إدارة المبيعات والزبائن ونقاط البيع',
      'متجر إلكتروني مستقل مع رابط خاص',
      'تصدير واستيراد المنتجات بـ Excel',
      'تحديثات سحابية مستمرة مجاناً',
    ],
  },
  {
    name: 'خطة الأعمال المتقدمة (Business Pro)',
    price: 'قريباً',
    period: '/ شهرياً',
    desc: 'الحل الشامل للشركات والورش والمستودعات الراغبة بالتحكم الكامل والنمو السريع.',
    highlight: true,
    cta: 'سجل لطلب وصول مسبق',
    features: [
      'منتجات وأصناف غير محدودة',
      'المحاسبة المزدوجة وشجرة الحسابات الكاملة',
      'محفظة الشيكات البنكية ومعايير PMA',
      'وحدة الصيانة والورش وإصلاح الأجهزة',
      'كشوف حركات الأصناف والمستودعات',
      'تقارير الأرباح والخسائر وموازين المراجعة',
    ],
  },
  {
    name: 'خطة المؤسسات والشركات (Enterprise)',
    price: 'مخصص',
    period: '/ تواصل معنا',
    desc: 'للشركات الكبرى وسلاسل الفروع التي تتطلب تكاملات مخصصة ودعماً فنياً على مدار الساعة.',
    highlight: false,
    cta: 'تواصل مع فريق المبيعات',
    features: [
      'كل ميزات خطة الأعمال المتقدمة',
      'تخصيص كامل للموديولات والواجهات',
      'موظفون وصلاحيات متعددة المستويات',
      'دعم فني مخصص وأولوية في المساعدة',
      'ربط API وتكاملات مخصصة حسب الطلب',
    ],
  },
]
