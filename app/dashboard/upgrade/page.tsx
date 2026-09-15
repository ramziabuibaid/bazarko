import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { PLAN_COMPARISON } from '@/lib/plans'
import UpgradeRequestCard from '@/components/dashboard/UpgradeRequestCard'

export const metadata = {
  title: 'الترقية إلى النسخة الكاملة — Bazarko ERP',
  description: 'تعرف على مميزات النسخة الكاملة من منظومة بزاركو المحاسبية واطلب التفعيل الفوري',
}

export default async function UpgradePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, subdomain, plan, country_code, phone')
    .eq('id', storeId)
    .single()

  if (!store) notFound()

  const isPro = store.plan === 'pro' || store.plan === 'basic'

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-8 text-white space-y-10" dir="rtl">
      
      {/* ── Page Hero ── */}
      <div className="relative overflow-hidden rounded-3xl border border-sky-500/20 bg-gradient-to-r from-sky-950/40 via-slate-900 to-indigo-950/40 p-8 sm:p-12 shadow-2xl">
        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-1.5 text-xs font-bold text-sky-400">
            <span>🚀</span>
            <span>بزاركو ERP — المنظومة المحاسبية المتقدمة</span>
          </div>

          <h1 className="text-3xl font-black sm:text-5xl text-white tracking-tight">
            الترقية إلى <span className="bg-gradient-to-r from-sky-400 via-teal-300 to-indigo-400 bg-clip-text text-transparent">النسخة الكاملة</span>
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
            احصل على كافة الأدوات الاحترافية لإدارة التجارة، المحاسبة المتقدمة، محفظة الشيكات، الحسابات البنكية، القيود المزدوجة، الصيانة والورش، واستوديو إعلانات الواتساب بدون أي قيود.
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <span className="rounded-xl bg-white/5 border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300">
              متجرك الحالي: <strong className="text-white">{store.name}</strong>
            </span>
            <span className={`rounded-xl px-4 py-2 text-xs font-bold ${
              isPro ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
            }`}>
              الخطة الحالية: {isPro ? 'النسخة الكاملة (Pro)' : 'النسخة المجانية (Free)'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Contact & Request Upgrade Section ── */}
      <UpgradeRequestCard store={store} userEmail={user.email} />

      {/* ── Key Advanced Capabilities ── */}
      <div className="space-y-4">
        <div className="text-center sm:text-right">
          <h2 className="text-xl font-bold text-white">أبرز الوظائف الإضافية في النسخة الكاملة</h2>
          <p className="text-xs text-slate-400">كل ما يلزم الشركات والمتاجر المتقدمة للسيطرة على الحسابات والعمليات</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: '🏦',
              title: 'محفظة الشيكات والأوراق المالية',
              desc: 'إدارة الشيكات الصادرة والواردة، طباعة أصل الشيك وسند الاستلام، التظهير، التحصيل والإرجاع مع القيود المحاسبية التلقائية.',
            },
            {
              icon: '🏛️',
              title: 'الحسابات البنكية ومطابقة الكشوفات',
              desc: 'تتبع حركة حسابات الشركة البنكية، التحويلات بين الصناديق والبنوك، ومطابقة الكشف البنكي الدوري.',
            },
            {
              icon: '⚖️',
              title: 'قيود اليومية العامة وشجرة الحسابات',
              desc: 'نظام محاسبي مزدوج متكامل يطابق المعايير المحاسبية مع شجرة حسابات قابلة للتخصيص وميزان المراجعة.',
            },
            {
              icon: '🔧',
              title: 'نظام الصيانة والورش وإدارة الأجهزة',
              desc: 'استلام أجهزة الصيانة، إصدار وصولات الاستلام الرسمية، تتبع مراحل الإصلاح، وإرسال تنبيهات وتحديثات للعملاء.',
            },
            {
              icon: '📢',
              title: 'استوديو حملات وإعلانات WhatsApp',
              desc: 'تصميم عروض ترويجية وبوسترات جذابة ومشاركتها مع قاعدة زبائنك عبر الواتساب بنقرة زر واحدة.',
            },
            {
              icon: '⚡',
              title: 'مزامنة المخزون التلقائي (Sync Hub)',
              desc: 'ربط المخزون بين الفروع وتصدير وتحديث الأسعار والكميات آلياً عبر الـ API.',
            },
          ].map((card, i) => (
            <div key={i} className="rounded-2xl border border-white/5 bg-slate-900/60 p-5 hover:border-sky-500/30 transition-all">
              <span className="text-3xl mb-3 block">{card.icon}</span>
              <h3 className="font-bold text-white text-sm mb-1.5">{card.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{card.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Comparison Table (Free vs Full) ── */}
      <div className="rounded-3xl border border-white/10 bg-slate-900 overflow-hidden shadow-xl">
        <div className="p-6 border-b border-white/10 bg-slate-800/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-white">جدول المقارنة الشامل: النسخة المجانية مقابل النسخة الكاملة</h2>
            <p className="text-xs text-slate-400">تفاصيل الصلاحيات والوظائف المتاحة في كل باقة</p>
          </div>
          <span className="text-xs font-mono text-sky-400">Bazarko ERP Features Matrix</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-slate-950 text-slate-400">
                <th className="p-4 font-bold">الوظيفة / الميزة</th>
                <th className="p-4 font-bold text-center w-36 bg-slate-900/80 text-slate-300">النسخة المجانية</th>
                <th className="p-4 font-bold text-center w-48 bg-sky-950/40 text-sky-300">النسخة الكاملة (Full Pro)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-300">
              {PLAN_COMPARISON.map((feat, idx) => (
                <tr key={idx} className="hover:bg-white/[0.02]">
                  <td className="p-4">
                    <div className="font-bold text-white text-sm">{feat.name}</div>
                    {feat.description && (
                      <div className="text-[11px] text-slate-400 mt-0.5">{feat.description}</div>
                    )}
                  </td>
                  <td className="p-4 text-center font-bold bg-slate-900/30">
                    {feat.free === 'نعم' ? (
                      <span className="text-emerald-400">✓ نعم</span>
                    ) : feat.free === 'غير متاح 🔒' || feat.free === 'غير متاح' ? (
                      <span className="text-rose-400 font-semibold">{feat.free}</span>
                    ) : (
                      <span>{feat.free}</span>
                    )}
                  </td>
                  <td className="p-4 text-center font-bold bg-sky-950/20 text-sky-300">
                    <span className="inline-flex items-center gap-1">
                      <span>✓</span>
                      <span>{feat.pro}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Bottom Callout ── */}
      <div className="rounded-2xl border border-sky-500/20 bg-sky-950/20 p-6 text-center space-y-3">
        <h3 className="text-base font-bold text-white">هل لديك استفسار أو متطلبات خاصة لنشاطك التجاري؟</h3>
        <p className="text-xs text-slate-300 max-w-xl mx-auto">
          فريق بزاركو / شركة المنار جاهز لتخصيص المنظومة وتدريب طاقم العمل وتجهيز خوادم مخصصة بحسب حجم نشاطك التجاري.
        </p>
        <div className="pt-2 flex justify-center gap-4 text-xs font-semibold">
          <a href="https://wa.me/970599000000?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7%20%D8%A3%D8%B1%D8%BA%D8%A8%20%D8%A8%D8%A7%D9%84%D8%A7%D8%B3%D8%AA%D9%81%D8%B3%D8%A7%D8%B1%20%D8%B9%D9%86%20%D8%A8%D8%B2%D8%A7%D8%B1%D9%83%D9%88%20ERP" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
            واتساب: +970 59-900-0000 💬
          </a>
          <span className="text-slate-600">•</span>
          <a href="mailto:support@bazarko.app" className="text-sky-400 hover:underline">
            البريد: support@bazarko.app ✉️
          </a>
        </div>
      </div>

    </div>
  )
}
