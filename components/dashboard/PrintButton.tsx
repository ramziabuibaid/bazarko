'use client'

import React from 'react'

interface PrintButtonProps {
  label?: string
  className?: string
}

export default function PrintButton({
  label = '🖨️ طباعة (PDF)',
  className = 'rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition cursor-pointer',
}: PrintButtonProps) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={className}
    >
      {label}
    </button>
  )
}
