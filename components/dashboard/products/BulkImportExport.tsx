'use client'

import { useRef, useState } from 'react'

type ImportResult = {
  success: boolean
  updatedCount?: number
  insertedCount?: number
  applyErrors?: string[]
  errors?: Array<{ row: number; field: string; message: string }>
  message?: string
  error?: string
}

export default function BulkImportExport() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [showPanel, setShowPanel] = useState(false)

  async function handleExport() {
    const res = await fetch('/api/products/export')
    if (!res.ok) {
      alert('فشل التصدير. حاول مرة أخرى.')
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const cd = res.headers.get('Content-Disposition') ?? ''
    const match = cd.match(/filename\*=UTF-8''([^;]+)/)
    a.download = match ? decodeURIComponent(match[1]) : 'products.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setImporting(true)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/products/import', {
        method: 'POST',
        body: formData,
      })
      const data: ImportResult = await res.json()
      setResult(data)

      // إعادة تحميل الصفحة عند النجاح
      if (data.success && (data.insertedCount ?? 0) + (data.updatedCount ?? 0) > 0) {
        setTimeout(() => window.location.reload(), 1800)
      }
    } catch {
      setResult({ success: false, error: 'خطأ في الاتصال بالخادم' })
    } finally {
      setImporting(false)
      // مسح قيمة الملف حتى يمكن رفع نفس الملف مجدداً
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="relative">
      {/* زر الفتح */}
      <button
        onClick={() => { setShowPanel(v => !v); setResult(null) }}
        className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5 flex items-center gap-2"
      >
        <span>📊</span>
        <span>Excel</span>
      </button>

      {/* لوحة التصدير/الاستيراد */}
      {showPanel && (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">استيراد / تصدير</h3>
            <button
              onClick={() => setShowPanel(false)}
              className="text-slate-500 hover:text-slate-300 text-lg leading-none"
            >×</button>
          </div>

          {/* تصدير */}
          <div className="mb-3 rounded-xl border border-white/5 bg-slate-800/50 p-3">
            <p className="mb-1 text-xs font-medium text-slate-300">تنزيل قائمة المنتجات</p>
            <p className="mb-2.5 text-xs text-slate-500">
              يصدّر جميع منتجاتك في ملف Excel جاهز للتعديل.
            </p>
            <button
              onClick={handleExport}
              className="w-full rounded-xl bg-sky-500/15 border border-sky-500/20 px-3 py-2 text-sm font-medium text-sky-400 hover:bg-sky-500/25 transition-colors"
            >
              ⬇️ تصدير Excel
            </button>
          </div>

          {/* استيراد */}
          <div className="rounded-xl border border-white/5 bg-slate-800/50 p-3">
            <p className="mb-1 text-xs font-medium text-slate-300">رفع ملف محدَّث</p>
            <p className="mb-2.5 text-xs text-slate-500">
              يُحدّث المنتجات الموجودة ويُضيف الجديدة. لا يحذف أي منتج.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="w-full rounded-xl bg-emerald-500/15 border border-emerald-500/20 px-3 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
            >
              {importing ? '⏳ جاري المعالجة...' : '⬆️ رفع Excel'}
            </button>
          </div>

          {/* نتائج */}
          {result && (
            <div className={`mt-3 rounded-xl p-3 text-xs ${
              result.success
                ? 'bg-emerald-500/10 border border-emerald-500/20'
                : 'bg-red-500/10 border border-red-500/20'
            }`}>
              {/* رسالة رئيسية */}
              <p className={`font-semibold mb-1 ${result.success ? 'text-emerald-400' : 'text-red-400'}`}>
                {result.success ? '✅' : '❌'} {result.message ?? result.error}
              </p>

              {/* إحصائيات النجاح */}
              {result.success && (
                <div className="flex gap-3 mt-1.5 text-slate-400">
                  {(result.updatedCount ?? 0) > 0 && (
                    <span>✏️ محدَّث: {result.updatedCount}</span>
                  )}
                  {(result.insertedCount ?? 0) > 0 && (
                    <span>➕ جديد: {result.insertedCount}</span>
                  )}
                </div>
              )}

              {/* أخطاء التحقق */}
              {result.errors && result.errors.length > 0 && (
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-red-300">
                      <span className="text-red-500">الصف {e.row}:</span> {e.message}
                    </div>
                  ))}
                </div>
              )}

              {/* أخطاء التطبيق */}
              {result.applyErrors && result.applyErrors.length > 0 && (
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {result.applyErrors.map((e, i) => (
                    <div key={i} className="text-amber-300">{e}</div>
                  ))}
                </div>
              )}

              {result.success && (result.insertedCount ?? 0) + (result.updatedCount ?? 0) > 0 && (
                <p className="mt-1.5 text-slate-500">يتم تحديث الصفحة...</p>
              )}
            </div>
          )}

          {/* تحذير */}
          <p className="mt-3 text-center text-[10px] text-slate-600">
            النظام يتحقق من جميع الصفوف قبل تطبيق أي تغيير
          </p>
        </div>
      )}
    </div>
  )
}
