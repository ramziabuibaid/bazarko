'use client'

import React, { useState } from 'react'
import { generateAndPrintPdf } from '@/lib/pdf/printPdf'

interface PrintButtonProps {
  label?: string
  className?: string
  elementId?: string
  format?: 'a4' | 'thermal'
  filename?: string
  allowDownload?: boolean
}

export default function PrintButton({
  label = '🖨️ طباعة الفاتورة (PDF)',
  className = 'rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition cursor-pointer shadow-sm',
  elementId,
  format = 'a4',
  filename = 'document.pdf',
  allowDownload = true,
}: PrintButtonProps) {
  const [loading, setLoading] = useState(false)

  const handlePrint = async () => {
    setLoading(true)
    try {
      if (elementId) {
        await generateAndPrintPdf({
          elementId,
          format,
          filename,
          action: 'print',
        })
      } else {
        window.print()
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!elementId) return
    setLoading(true)
    try {
      await generateAndPrintPdf({
        elementId,
        format,
        filename,
        action: 'download',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={handlePrint}
        disabled={loading}
        className={`${className} disabled:opacity-50`}
      >
        {loading ? 'جارٍ المعالجة... ⏳' : label}
      </button>

      {allowDownload && elementId && (
        <button
          type="button"
          onClick={handleDownload}
          disabled={loading}
          title="تنزيل كملف PDF"
          className="rounded-lg border border-white/20 bg-slate-800 px-2.5 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 transition"
        >
          ⬇️
        </button>
      )}
    </div>
  )
}
