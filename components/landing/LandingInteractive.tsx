'use client'

import { useState } from 'react'
import Link from 'next/link'

// ─── القطاعات وتخصيص الموديولات ──────────────────────────────
interface Industry {
  id: string
  name: string
  icon: string
  tagline: string
  description: string
  recommendedModules: string[]
  keyFeatures: string[]
  stats: { label: string; value: string }[]
}

const INDUSTRIES: Industry[] = [
  {
    id: 'retail',
    name: 'متاجر التجزئة ونقاط البيع',
    icon: '🛍️',
    tagline: 'كاشير فوري، جرد مستودع، ومتجر إلكتروني مدمج',
    description: 'صُمم خصيصاً لمتاجر الملابس، العطور، السوبرماركت، ومحلات التجزئة لتسريع عمليات البيع وإدارة الباركود والمخزون دون أي تعقيد.',
    recommendedModules: ['pos', 'inventory', 'storefront', 'customers', 'invoicing'],
    keyFeatures: [
      'نقطة بيع سريعة (POS) تدعم شاشات اللمس والباركود والطباعة الحرارية',
      'متجر إلكتروني فوري متصل بالمخزون دون الحاجة لتكرار إدخال المنتجات',
      'تنبيهات فورية عند وصول أي منتج للحد الأدنى من المخزون',
      'إدارة عروض الخصم والكوبونات ومتابعة تقييمات الزبائن',
    ],
    stats: [
      { label: 'سرعة إصدار الفاتورة', value: 'أقل من 3 ثوانٍ' },
      { label: 'دقة المخزون', value: '100% مزامنة' },
    ],
  },
  {
    id: 'maintenance',
    name: 'ورش ومراكز الصيانة',
    icon: '🔧',
    tagline: 'تتبع صيانة الأجهزة، الفنيين، وسندات الاستلام',
    description: 'نظام مخصص لمراكز صيانة الهواتف، الحواسيب، والورش الإلكترونية لإدارة استلام الأجهزة ومراحل الإصلاح وإخطار العميل بحالة جهازه.',
    recommendedModules: ['maintenance', 'accounting', 'inventory', 'customers', 'receipts'],
    keyFeatures: [
      'لوحة متابعة بصرية (Kanban) لمراحل الصيانة: قيد الفحص، بانتظار قطع، تم الإصلاح، جاهز للتسليم',
      'طباعة وصل استلام جهاز للزبون مع باركود خاص لتتبع الحالة عبر الرابط',
      'ربط قطع الغيار المستهلكة مع مخزون المتجر وتكلفتها التلقائية',
      'تسجيل عيوب الأجهزة وملاحظات الفني وتقدير التكلفة قبل البدء',
    ],
    stats: [
      { label: 'تتبع حالة الجهاز', value: 'مباشر عبر الويب' },
      { label: 'تنظيم مهام الورشة', value: 'لوحة Kanban مرئية' },
    ],
  },
  {
    id: 'wholesale',
    name: 'تجارة الجملة والمستودعات',
    icon: '📦',
    tagline: 'كشف حركات الصنف التراكمي، كشوف حسابات العملاء، ودورة المشتريات',
    description: 'حل جذري لموزعي الجملة والشركات ذات المستودعات الكبيرة لإدارة الأصناف المتعددة، الماركات، عروض الأسعار، وتسهيلات الذمم.',
    recommendedModules: ['inventory_statement', 'purchases', 'cheques', 'accounting', 'customers_ledger'],
    keyFeatures: [
      'كشف تفصيلي وتراكمي لحركات كل صنف (وارد، صادر، رصيد تراكمي وتكلفة)',
      'كشوف حسابات الزبائن والموردين مع موازين المراجعة وأعمار الديون',
      'دورة مشتريات كاملة: أوامر شراء، فواتير موردين، ومردودات مشتريات',
      'تصدير واستيراد كميات المنتجات والأسعار عبر ملفات Excel بسهولة',
    ],
    stats: [
      { label: 'أصناف ومستودعات', value: 'غير محدودة' },
      { label: 'تصدير التقارير', value: 'Excel & PDF بنقرة' },
    ],
  },
  {
    id: 'corporate',
    name: 'الشركات والخدمات المالية',
    icon: '⚖️',
    tagline: 'محاسبة مزدوجة رسمية، شيكات وسلطة النقد، وتقارير مالية',
    description: 'بيئة محاسبية احترافية متوافقة تماماً مع معايير سلطة النقد والمحاسبة المعيارية للشركات التي تتطلب دقة متناهية وسجل رقابي كامل.',
    recommendedModules: ['accounting', 'journal', 'cheques', 'pma_banks', 'audit_log'],
    keyFeatures: [
      'شجرة حسابات (Chart of Accounts) مرنة متعددة المستويات قابلة للتوسيع',
      'قيود يومية مزدوجة متزنة وسندات قبض وصرف مرتبطة بصناديق الخزينة',
      'محفظة الشيكات الواردة والصادرة مع مسارات التحصيل والإيداع والتظهير',
      'سجل تدقيق ورقابة متكامل (Audit Trail) لجميع العمليات والتحويلات المالية',
    ],
    stats: [
      { label: 'التوافق المصرفي', value: 'معايير PMA 100%' },
      { label: 'الدفتر المزدوج', value: 'تلقائي ومتوازن' },
    ],
  },
]

// قائمة جميع الموديولات في الـ ERP
const ALL_MODULES = [
  { key: 'accounting', name: 'اللوحة المالية وشجرة الحسابات', icon: '💰' },
  { key: 'journal', name: 'قيود اليومية المزدوجة', icon: '⚖️' },
  { key: 'cheques', name: 'محفظة الشيكات (PMA)', icon: '🏦' },
  { key: 'pma_banks', name: 'الحسابات وكشوف البنوك', icon: '🏛️' },
  { key: 'pos', name: 'نقطة البيع والكاشير السريع', icon: '🧾' },
  { key: 'invoicing', name: 'فواتير ومردودات المبيعات', icon: '📄' },
  { key: 'purchases', name: 'المشتريات وإدارة الموردين', icon: '🛒' },
  { key: 'inventory', name: 'المخزون والماركات والبراندات', icon: '📦' },
  { key: 'inventory_statement', name: 'كشف حركات الصنف التراكمي', icon: '🔍' },
  { key: 'maintenance', name: 'إدارة الورش والصيانة للأجهزة', icon: '🔧' },
  { key: 'customers', name: 'سجل الزبائن وحدود الائتمان', icon: '👥' },
  { key: 'customers_ledger', name: 'كشوف الحسابات وأعمار الديون', icon: '📋' },
  { key: 'storefront', name: 'المتجر الإلكتروني وسوق بازركو', icon: '🌐' },
  { key: 'audit_log', name: 'سجل الرقابة وتدقيق الحركات', icon: '🛡️' },
]

export function IndustriesShowcase() {
  const [activeTab, setActiveTab] = useState<string>('retail')
  const currentIndustry = INDUSTRIES.find(i => i.id === activeTab) || INDUSTRIES[0]

  return (
    <div className="space-y-10">
      {/* تبويبات القطاعات */}
      <div className="flex flex-wrap items-center justify-center gap-2 p-1.5 rounded-2xl bg-slate-900/80 border border-white/10 max-w-4xl mx-auto backdrop-blur-md">
        {INDUSTRIES.map(industry => {
          const isActive = industry.id === activeTab
          return (
            <button
              key={industry.id}
              onClick={() => setActiveTab(industry.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                isActive
                  ? 'bg-sky-600 text-white shadow-lg shadow-sky-900/40 ring-1 ring-sky-400/40'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="text-lg">{industry.icon}</span>
              <span>{industry.name}</span>
            </button>
          )
        })}
      </div>

      {/* تفاصيل القطاع المختار */}
      <div className="grid lg:grid-cols-12 gap-8 items-center rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/90 via-slate-900/60 to-slate-950 p-6 sm:p-10 shadow-2xl relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -left-24 w-96 h-96 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-cyan-500/10 blur-3xl" />

        <div className="lg:col-span-7 space-y-6 relative z-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3.5 py-1 text-xs font-semibold text-sky-400">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-ping" />
            حل مخصص لقطاع: {currentIndustry.name}
          </div>

          <h3 className="text-2xl sm:text-3xl font-black text-white leading-tight">
            {currentIndustry.tagline}
          </h3>

          <p className="text-slate-300 text-base leading-relaxed">
            {currentIndustry.description}
          </p>

          <div className="space-y-3 pt-2">
            <p className="text-xs uppercase tracking-wider font-bold text-slate-400">
              المزايا الرئيسية المفعلة في هذا التخصيص:
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {currentIndustry.keyFeatures.map((feat, idx) => (
                <div key={idx} className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-slate-800/40 p-3">
                  <span className="text-emerald-400 text-base font-bold shrink-0">✓</span>
                  <span className="text-xs sm:text-sm text-slate-300 leading-snug">{feat}</span>
                </div>
              ))}
            </div>
          </div>

          {/* إحصائيات سريعة للقطاع */}
          <div className="flex flex-wrap items-center gap-6 pt-3 border-t border-white/5">
            {currentIndustry.stats.map((stat, idx) => (
              <div key={idx} className="space-y-0.5">
                <p className="text-xs text-slate-500">{stat.label}</p>
                <p className="text-base sm:text-lg font-black text-cyan-400">{stat.value}</p>
              </div>
            ))}
            <Link
              href="/onboarding"
              className="mr-auto inline-flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-500 px-5 py-2.5 text-sm font-bold text-white transition-all shadow-md shadow-sky-900/30 no-underline"
            >
              ابدأ بهذا التخصيص الآن ←
            </Link>
          </div>
        </div>

        {/* جانب المعاينة البصرية للموديولات */}
        <div className="lg:col-span-5 relative z-10">
          <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-5 backdrop-blur-xl shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div>
                <p className="text-xs text-slate-500 font-medium">لوحة تحكم الـ ERP المخصصة</p>
                <p className="text-sm font-bold text-white mt-0.5">الوحدات النشطة لمجالك</p>
              </div>
              <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[11px] font-bold text-emerald-400">
                جاهز للعمل فوراً
              </span>
            </div>

            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              {ALL_MODULES.map(mod => {
                const isSelected = currentIndustry.recommendedModules.includes(mod.key)
                return (
                  <div
                    key={mod.key}
                    className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                      isSelected
                        ? 'border-sky-500/30 bg-sky-950/30 text-white'
                        : 'border-white/5 bg-slate-900/30 text-slate-500 opacity-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">{mod.icon}</span>
                      <span className="text-xs sm:text-sm font-semibold">{mod.name}</span>
                    </div>
                    {isSelected ? (
                      <span className="rounded-md bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold text-sky-400">
                        مفعّل
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-600">اختياري</span>
                    )}
                  </div>
                )
              })}
            </div>

            <p className="text-[11px] text-slate-400 text-center pt-2">
              💡 يمكنك في أي وقت تشغيل أو إيقاف أي وحدة من شاشة إعدادات المتجر
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── محاكي تخصيص الوحدات (Interactive Modular Simulator) ───────
export function ModularSimulator() {
  const [activeModules, setActiveModules] = useState<Record<string, boolean>>({
    accounting: true,
    pos: true,
    inventory: true,
    maintenance: true,
    cheques: true,
    storefront: true,
  })

  function toggle(key: string) {
    setActiveModules(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const activeCount = Object.values(activeModules).filter(Boolean).length

  return (
    <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 sm:p-10 backdrop-blur-xl relative overflow-hidden">
      <div className="grid lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-6 space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs font-semibold text-emerald-400">
            <span>🧩</span> معمارية معيارية 100% (Modular Architecture)
          </div>

          <h3 className="text-2xl sm:text-3xl font-black text-white leading-tight">
            جرب بنفسك: ركّب نظامك بحرية تامة دون أي قيود
          </h3>

          <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
            أنظمة الـ ERP التقليدية تجبرك على دفع مبالغ طائلة وشاشات معقدة لا تستخدمها. في بازركو، أنت من يقرر ما تراه وما يعمل خلف الكواليس.
          </p>

          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wider font-bold text-slate-400">
              انقر لتفعيل أو إيقاف أي وحدة وشاهد كيف تتكيف المنظومة:
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { key: 'accounting', label: 'المحاسبة المزدوجة', icon: '💰' },
                { key: 'pos', label: 'نقطة البيع والكاشير', icon: '🧾' },
                { key: 'inventory', label: 'المستودع والمخزون', icon: '📦' },
                { key: 'maintenance', label: 'إدارة الصيانة والورش', icon: '🔧' },
                { key: 'cheques', label: 'الشيكات وبنوك PMA', icon: '🏦' },
                { key: 'storefront', label: 'المتجر الإلكتروني العام', icon: '🌐' },
              ].map(item => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => toggle(item.key)}
                  className={`flex items-center justify-between p-3 rounded-xl border text-right transition-all ${
                    activeModules[item.key]
                      ? 'border-sky-500/50 bg-sky-950/40 text-white ring-1 ring-sky-500/30 shadow-md'
                      : 'border-white/5 bg-slate-950/40 text-slate-500 hover:border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{item.icon}</span>
                    <span className="text-xs sm:text-sm font-semibold">{item.label}</span>
                  </div>
                  <span
                    className={`h-5 w-9 rounded-full transition-colors relative flex items-center px-0.5 ${
                      activeModules[item.key] ? 'bg-sky-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`h-4 w-4 rounded-full bg-white transition-transform ${
                        activeModules[item.key] ? 'translate-x-0' : '-translate-x-4'
                      }`}
                    />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-6">
          <div className="rounded-2xl border border-white/10 bg-slate-950 p-6 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-sm font-bold text-white">النتيجة الحية لبيئة عملك</span>
              </div>
              <span className="text-xs text-sky-400 font-mono bg-sky-950/80 px-2.5 py-1 rounded-md border border-sky-800">
                {activeCount} وحدات نشطة
              </span>
            </div>

            <div className="space-y-3 text-xs sm:text-sm text-slate-300">
              <div className="p-3 rounded-xl bg-slate-900/80 border border-white/5">
                <p className="text-slate-400 text-xs mb-1">واجهة لوحة التحكم المتوقعة:</p>
                <p className="font-bold text-white">
                  {activeCount === 6
                    ? 'منظومة شاملة للشركات الكبرى (تجزئة + صيانة + محاسبة + بنوك)'
                    : activeModules.maintenance
                    ? 'بيئة متخصصة لإدارة الورش ومراكز الخدمة الفنية الميدانية'
                    : activeModules.pos
                    ? 'نظام سريع ومبسط لإدارة نقاط البيع والمتاجر'
                    : 'لوحة تحكم مالية وإدارية مصممة لاحتياجاتك بدقة'}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center pt-2">
                <div className="p-2.5 rounded-lg bg-slate-900/50 border border-white/5">
                  <p className="text-[11px] text-slate-500">حمل النظام</p>
                  <p className="font-bold text-emerald-400 text-sm mt-0.5">خفيف وفوري</p>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900/50 border border-white/5">
                  <p className="text-[11px] text-slate-500">تكلفة الإعداد</p>
                  <p className="font-bold text-sky-400 text-sm mt-0.5">0 شيكل</p>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900/50 border border-white/5">
                  <p className="text-[11px] text-slate-500">وقت التجهيز</p>
                  <p className="font-bold text-amber-400 text-sm mt-0.5">دقيقتان فقط</p>
                </div>
              </div>

              <div className="pt-4">
                <Link
                  href="/onboarding"
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 py-3 text-sm font-bold text-white transition-all shadow-lg no-underline"
                >
                  ابدأ تشغيل نظامك بهذه الإعدادات الآن ←
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── أسئلة وأجوبة تفاعلية (FAQ Accordion) ───────────────────────
const FAQS = [
  {
    q: 'هل يمكن استخدام بازركو كنظام ERP داخلي دون الحاجة لمتجر إلكتروني؟',
    a: 'نعم بكل تأكيد! بازركو مصمم كمنظومة ERP كاملة، ولديك الصلاحية الكاملة لإخفاء أو إيقاف المتجر الإلكتروني الخارجي من شاشة الإعدادات، واستخدام النظام حصرياً للمحاسبة المزدوجة، المخزون، فواتير المبيعات، ومحفظة الشيكات وإدارة الصيانة داخل شركتك.',
  },
  {
    q: 'ما معنى أن النظام "قابل للتخصيص بالكامل" (Fully Customizable ERP)؟',
    a: 'يعني أنك لست مقيداً بقالب ثابت! يمكنك تفعيل الوحدات المناسبة لمجالك (مثل وحدة الصيانة لورش الإلكترونيات، أو كشوف حركات الأصناف لمستودعات الجملة)، واختيار شجرة الحسابات، وتحديد عملات الدفع الأساسية والثانوية (شيكل، دينار، دولار)، وتخصيص الفواتير وهوية المتجر بالكامل.',
  },
  {
    q: 'هل النظام متوافق مع معايير سلطة النقد الفلسطينية (PMA)؟',
    a: 'نعم، تم بناء محفظة الشيكات والحسابات البنكية لتتوافق مع دورة حياة الشيك المصرفي المعتمدة (وارد، صادر، قيد التحصيل، مجير، مرتجع) مع إمكانية استخراج كشوفات مطابقة مصرفية دقيقة متوافقة مع المتطلبات المالية المحلية.',
  },
  {
    q: 'هل يحتاج بازركو لتثبيت أي خوادم أو برامج خاصة على أجهزتي؟',
    a: 'لا نهائياً! بازركو منصة سحابية (SaaS) متطورة تعمل مباشرة عبر متصفح الويب من أي جهاز: كمبيوتر، لابتوب، جهاز لوحي، أو حتى هاتفك المحمول، مع نسخ احتياطي وتحديثات مستمرة وتشفير أمني على أعلى مستوى دون أي تدخل منك.',
  },
  {
    q: 'كيف يمكنني استيراد منتجاتي وقوائم أسعاري الحالية؟',
    a: 'يوفر بازركو ميزة استيراد وتصدير متقدمة عبر ملفات Excel بضغطة زر واحدة، حيث يمكنك رفع آلاف المنتجات والأسعار والتصنيفات في ثوانٍ معدودة وبدء العمل فوراً.',
  },
  {
    q: 'ما هي تكلفة البدء واستخدام بازركو؟',
    a: 'يمكنك البدء مجاناً 100% دون الحاجة لإدخال أي بطاقة ائتمانية. يمنحك الحساب المجاني إمكانية إدارة منتجاتك ومبيعاتك وزبائنك للتعرف على النظام واختباره عملياً في نشاطك.',
  },
]

export function FaqAccordion() {
  const [openIdx, setOpenIdx] = useState<number | null>(0)

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {FAQS.map((faq, idx) => {
        const isOpen = openIdx === idx
        return (
          <div
            key={idx}
            className="rounded-2xl border border-white/5 bg-slate-900/60 overflow-hidden transition-all hover:border-sky-500/20"
          >
            <button
              type="button"
              onClick={() => setOpenIdx(isOpen ? null : idx)}
              className="w-full flex items-center justify-between p-5 text-right font-bold text-white transition-colors hover:text-sky-400"
            >
              <span className="text-base sm:text-lg">{faq.q}</span>
              <span
                className={`ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-sm transition-transform ${
                  isOpen ? 'rotate-180 text-sky-400 bg-sky-500/10' : 'text-slate-400'
                }`}
              >
                ▼
              </span>
            </button>
            {isOpen && (
              <div className="px-5 pb-5 text-sm sm:text-base text-slate-300 leading-relaxed border-t border-white/5 pt-4">
                {faq.a}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
