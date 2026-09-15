'use client'

import Link from 'next/link'

interface FeatureGateProps {
  plan?: string
  featureName: string
  featureDescription?: string
  icon?: string
  children: React.ReactNode
}

export default function FeatureGate({
  plan = 'free',
  featureName,
  featureDescription,
  icon = '🔒',
  children,
}: FeatureGateProps) {
  // If user is on pro or basic plan, render the actual feature
  if (plan === 'pro' || plan === 'basic') {
    return <>{children}</>
  }

  // Otherwise, render the official upgrade gate screen
  return (
    <div className="flex min-h-[75vh] flex-col items-center justify-center p-6 text-center" dir="rtl">
      <div className="relative mx-auto max-w-lg rounded-3xl border border-sky-500/20 bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
        
        {/* Glow effect background */}
        <div className="absolute -top-12 left-1/2 -z-10 h-32 w-64 -translate-x-1/2 rounded-full bg-sky-500/20 blur-3xl" />

        {/* Lock Icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-sky-500/30 bg-sky-500/10 text-4xl shadow-inner shadow-sky-500/20 animate-pulse">
          {icon}
        </div>

        {/* Badge */}
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1 text-xs font-bold text-amber-400">
          <span>👑</span>
          <span>ميزة حصرية في النسخة الكاملة</span>
        </div>

        {/* Title */}
        <h2 className="mb-2 text-2xl font-black text-white sm:text-3xl">
          {featureName}
        </h2>

        {/* Subtitle required by user */}
        <p className="mb-4 text-sm font-semibold text-sky-400">
          هذه الميزة متوفرة في النسخة الكاملة من Bazarko ERP.
        </p>

        {/* Feature description */}
        {featureDescription && (
          <p className="mb-8 text-xs leading-relaxed text-slate-400">
            {featureDescription}
          </p>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/dashboard/upgrade"
            className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-sky-500/25 transition-all hover:from-sky-400 hover:to-indigo-500 hover:scale-[1.02]"
          >
            <span>⚡</span>
            <span>عرض النسخة الكاملة والترقية</span>
          </Link>

          <Link
            href="/dashboard"
            className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-slate-800/80 px-5 py-3 text-sm font-semibold text-slate-300 transition-all hover:bg-slate-800 hover:text-white"
          >
            ← العودة للرئيسية
          </Link>
        </div>

        {/* Footer Contact hint */}
        <div className="mt-8 border-t border-white/5 pt-4 text-[11px] text-slate-500">
          لطلب التفعيل الفوري تواصل مع فريق المنار / بزاركو: <span dir="ltr" className="font-mono text-slate-400">support@bazarko.app</span>
        </div>

      </div>
    </div>
  )
}
