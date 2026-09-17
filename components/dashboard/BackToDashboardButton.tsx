'use client'

import Link from 'next/link'

interface Props {
  href: string
  label: string
  className?: string
}

export default function BackToDashboardButton({ href, label, className = '' }: Props) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800/80 px-3.5 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition shadow-sm ${className}`}
    >
      <span className="text-sky-400">←</span>
      <span>{label}</span>
    </Link>
  )
}
