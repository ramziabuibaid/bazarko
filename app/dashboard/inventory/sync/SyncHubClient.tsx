'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface SyncLog {
  id: string
  created_at: string
  source: string
  status: string
  items_processed: number
  items_updated: number
  items_created: number
  errors: any[]
}

interface Props {
  store: {
    id: string
    name: string
    api_sync_key: string | null
    currency_code: string
  }
  initialLogs: SyncLog[]
  totalProductsCount: number
}

export default function SyncHubClient({ store, initialLogs, totalProductsCount }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [syncKey, setSyncKey] = useState(store.api_sync_key || '')
  const [copied, setCopied] = useState(false)
  const [generatingKey, setGeneratingKey] = useState(false)

  // Manual Sync State
  const [jsonInput, setJsonInput] = useState('')
  const [autoIngest, setAutoIngest] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string; details?: any } | null>(null)

  // Ingest Existing Images State
  const [ingesting, setIngesting] = useState(false)
  const [ingestStatus, setIngestStatus] = useState<string | null>(null)

  // Generate / Refresh API Key
  const handleGenerateApiKey = async () => {
    setGeneratingKey(true)
    const newKey = `bazarko_sync_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    const { error } = await supabase
      .from('stores')
      .update({ api_sync_key: newKey })
      .eq('id', store.id)

    if (!error) {
      setSyncKey(newKey)
    }
    setGeneratingKey(false)
  }

  const handleCopyKey = () => {
    navigator.clipboard.writeText(syncKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Execute manual JSON sync
  const handleManualSync = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!jsonInput.trim()) return

    setSyncing(true)
    setSyncResult(null)

    try {
      let parsed = JSON.parse(jsonInput)
      if (!Array.isArray(parsed)) {
        if (parsed.products && Array.isArray(parsed.products)) {
          parsed = parsed.products
        } else {
          parsed = [parsed]
        }
      }

      const res = await fetch('/api/inventory/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: parsed,
          source: 'manual_hub',
          autoIngestImages: autoIngest,
        }),
      })

      const data = await res.json()
      if (res.ok) {
        setSyncResult({ ok: true, message: data.message, details: data })
        setJsonInput('')
        router.refresh()
      } else {
        setSyncResult({ ok: false, message: data.error || 'فشلت عملية المزامنة' })
      }
    } catch {
      setSyncResult({ ok: false, message: 'تنسيق JSON غير صحيح. تأكد من صحة النص المُدخل.' })
    } finally {
      setSyncing(false)
    }
  }

  // Scan & Ingest all external images of existing products
  const handleIngestAllImages = async () => {
    setIngesting(true)
    setIngestStatus('جارٍ فحص صور المنتجات في النظام...')

    try {
      const { data: products } = await supabase
        .from('products')
        .select('id, name, images')
        .eq('store_id', store.id)

      if (!products || products.length === 0) {
        setIngestStatus('لا توجد منتجات في المتجر')
        setIngesting(false)
        return
      }

      const toProcess: Array<{ id: string; name: string; externalUrls: string[] }> = []

      for (const p of products) {
        if (p.images && Array.isArray(p.images)) {
          const external = p.images.filter((url: string) =>
            typeof url === 'string' &&
            url.startsWith('http') &&
            !url.includes('product-images')
          )
          if (external.length > 0) {
            toProcess.push({ id: p.id, name: p.name, externalUrls: external })
          }
        }
      }

      if (toProcess.length === 0) {
        setIngestStatus('✅ ممتاز! جميع صور المنتجات الحالية مخزنة ومثبتة سحابياً بنجاح ولا توجد روابط خارجية مهددة بالزوال.')
        setIngesting(false)
        return
      }

      setIngestStatus(`تم العثور على ${toProcess.length} منتجات بروابط صور خارجية. جارٍ سحبها وحفظها سحابياً...`)

      // Trigger sync endpoint for these products
      const payload = toProcess.map(p => ({
        id: p.id,
        name: p.name,
        image_urls: p.externalUrls,
        stock_quantity: undefined, // keep stock intact
      }))

      const res = await fetch('/api/inventory/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: payload,
          source: 'image_ingest_tool',
          autoIngestImages: true,
        }),
      })

      if (res.ok) {
        setIngestStatus(`✅ تم حفظ وتحويل صور ${toProcess.length} منتج إلى صور دائمة ومخزنة سحابياً بنجاح!`)
        router.refresh()
      } else {
        setIngestStatus('حدث خطأ أثناء حفظ الصور سحابياً.')
      }
    } catch {
      setIngestStatus('تعذّر الاتصال بخادم التخزين.')
    } finally {
      setIngesting(false)
    }
  }

  const sampleJson = `[
  {
    "sku": "ITEM-101",
    "barcode": "6251234567890",
    "name": "حذاء رياضي برو",
    "price": 149.99,
    "cost_price": 90.00,
    "stock_quantity": 35,
    "category_name": "أحذية رياضية",
    "image_url": "https://example.com/shoe.jpg"
  }
]`

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <span>🔄</span> مركز مزامنة وربط المخزون مع البرنامج الرئيسي
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          تحديث مباشر وآلي للكميات والأسعار من برنامج الشركة مع حفظ وتخزين صور الأصناف سحابياً لمنع فقدانها
        </p>
      </div>

      {/* ── Stats & Status ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">إجمالي الأصناف في النظام</p>
          <p className="mt-2 text-3xl font-black text-white font-mono" dir="ltr">{totalProductsCount}</p>
          <p className="mt-1 text-xs text-slate-500">جاهزة للمزامنة والتحديث اللحظي</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">حالة الربط الآلي (API Endpoint)</p>
          <p className="mt-2 text-base font-bold text-emerald-400">✅ نشط وجاهز للاستقبال</p>
          <p className="mt-1 text-xs text-slate-500">يدعم برامج الشامل، بيسان، الأصيل، وأي نظام REST</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">حماية صور الأصناف</p>
          <p className="mt-2 text-base font-bold text-sky-400">🛡️ تخزين سحابي دائم</p>
          <p className="mt-1 text-xs text-slate-500">يتم تحميل وتخزين الصور محلياً حتى لا تختفي</p>
        </div>
      </div>

      {/* ── API Configuration Card ── */}
      <div className="rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4 mb-5">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>🔑</span> مفتاح الربط والتعليمات البرمجية للمزامنة
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              شارك هذا الرابط والمفتاح مع مسؤول تكنولوجيا المعلومات أو المبرمج لربط برنامج الشركة بنظام المتجر
            </p>
          </div>

          <button
            onClick={handleGenerateApiKey}
            disabled={generatingKey}
            className="rounded-xl bg-slate-800 border border-white/10 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 transition"
          >
            {generatingKey ? 'جارٍ التوليد...' : syncKey ? '🔄 إعادة توليد المفتاح' : '➕ توليد مفتاح API'}
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 text-xs">
          <div>
            <label className="block text-slate-400 mb-1 font-semibold">نقطة نهاية المزامنة (POST Endpoint):</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                dir="ltr"
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/inventory/sync`}
                className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2.5 font-mono text-sky-400 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-semibold">مفتاح المزامنة الخاص بالمتجر (API Key):</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                dir="ltr"
                value={syncKey || 'لم يتم توليد مفتاح بعد — اضغط زر التوليد بالأعلى'}
                className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2.5 font-mono text-emerald-400 text-xs"
              />
              {syncKey && (
                <button
                  onClick={handleCopyKey}
                  className="shrink-0 rounded-xl bg-sky-500 px-3 py-2.5 font-bold text-slate-950 hover:bg-sky-400 transition"
                >
                  {copied ? '✓ نُسخ' : 'نسخ'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Instructions toggle / sample */}
        <div className="mt-4 rounded-xl border border-white/5 bg-slate-950/60 p-4">
          <p className="font-bold text-white text-xs mb-2">مثال على استدعاء cURL للمزامنة الآلية:</p>
          <pre className="overflow-x-auto text-[11px] font-mono text-slate-300 p-2 bg-slate-900 rounded-lg" dir="ltr">
{`curl -X POST "${typeof window !== 'undefined' ? window.location.origin : 'https://your-store.bazarko.com'}/api/inventory/sync" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${syncKey || 'YOUR_API_KEY'}" \\
  -d '${sampleJson.replace(/\n/g, '').replace(/\s+/g, ' ')}'`}
          </pre>
        </div>
      </div>

      {/* ── Image Permanent Storage Tool ── */}
      <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-950/30 to-indigo-950/20 p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>🖼️</span> أداة سحب وتثبيت صور الأصناف سحابياً (Permanent Image Ingestion)
            </h2>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              إذا كانت بعض الأصناف تحتوي على روابط صور خارجية قد تتعطل أو تُحذف في حال تغيّر الرابط، تتيح لك هذه الأداة سحب جميع الصور الخارجية وتخزينها كملفات فعلية داخل مساحة التخزين الخاصة بنظامك فوراً لضمان عدم اختفائها نهائياً.
            </p>
          </div>

          <button
            onClick={handleIngestAllImages}
            disabled={ingesting}
            className="shrink-0 rounded-xl bg-sky-500 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition shadow"
          >
            {ingesting ? 'جارٍ السحب والحفظ...' : '⚡ فحص وتثبيت الصور سحابياً'}
          </button>
        </div>

        {ingestStatus && (
          <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/80 p-3 text-xs text-slate-200">
            {ingestStatus}
          </div>
        )}
      </div>

      {/* ── Manual Instant Sync Tool ── */}
      <div className="rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl">
        <h2 className="text-base font-bold text-white mb-2 flex items-center gap-2">
          <span>⚡</span> المزامنة اليدوية الفورية (Manual JSON Import)
        </h2>
        <p className="text-xs text-slate-400 mb-4">
          يمكنك لصق كود JSON للأصناف والكميات من ملف إكسل أو تصدير البرنامج الرئيسي للمزامنة الفورية
        </p>

        <form onSubmit={handleManualSync} className="space-y-4">
          <div>
            <textarea
              rows={6}
              dir="ltr"
              value={jsonInput}
              onChange={e => setJsonInput(e.target.value)}
              placeholder={sampleJson}
              className="w-full rounded-xl border border-white/10 bg-slate-950 p-4 font-mono text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoIngest}
                onChange={e => setAutoIngest(e.target.checked)}
                className="rounded border-white/20 bg-slate-800 text-sky-500 focus:ring-0"
              />
              <span>تحميل وتخزين الصور سحابياً تلقائياً عند وجود روابط خارجية</span>
            </label>

            <button
              type="submit"
              disabled={syncing || !jsonInput.trim()}
              className="rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 transition shadow"
            >
              {syncing ? 'جارٍ المزامنة والتحديث...' : '🚀 بدء المزامنة الفورية'}
            </button>
          </div>

          {syncResult && (
            <div className={`rounded-xl border p-4 text-xs ${
              syncResult.ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}>
              <p className="font-bold">{syncResult.message}</p>
              {syncResult.details && (
                <div className="mt-2 flex gap-4 text-[11px] text-slate-300">
                  <span>تمت المعالجة: {syncResult.details.processed}</span>
                  <span>تم التحديث: {syncResult.details.updated}</span>
                  <span>تم الإنشاء: {syncResult.details.created}</span>
                  <span>الأخطاء: {syncResult.details.errorsCount}</span>
                </div>
              )}
            </div>
          )}
        </form>
      </div>

      {/* ── Sync Activity Logs Table ── */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
        <div className="border-b border-white/10 px-5 py-4 flex items-center justify-between">
          <h2 className="font-bold text-white text-base">سجل عمليات المزامنة الأخيرة</h2>
          <span className="text-xs text-slate-400">تتبع تلقائي لكل عملية ربط أو تحديث مخزون</span>
        </div>

        {initialLogs.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            لم تسجل أي عمليات مزامنة سابقة بعد.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-white/10 bg-slate-800/50 text-slate-400">
                <tr>
                  <th className="p-3.5">التاريخ والوقت</th>
                  <th className="p-3.5">المصدر</th>
                  <th className="p-3.5">الحالة</th>
                  <th className="p-3.5">المعالج</th>
                  <th className="p-3.5">المحدث</th>
                  <th className="p-3.5">الجديد</th>
                  <th className="p-3.5">الأخطاء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300 font-mono">
                {initialLogs.map(log => (
                  <tr key={log.id} className="hover:bg-white/[0.02]">
                    <td className="p-3.5 text-slate-300 font-sans">
                      {new Date(log.created_at).toLocaleString('ar-u-nu-latn')}
                    </td>
                    <td className="p-3.5">
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                        {log.source === 'api' ? 'API آلي' : log.source === 'manual_hub' ? 'يدوي' : log.source}
                      </span>
                    </td>
                    <td className="p-3.5 font-sans">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        log.status === 'success'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : log.status === 'partial'
                          ? 'bg-amber-500/15 text-amber-400'
                          : 'bg-red-500/15 text-red-400'
                      }`}>
                        {log.status === 'success' ? 'ناجح' : log.status === 'partial' ? 'جزئي' : 'فشل'}
                      </span>
                    </td>
                    <td className="p-3.5">{log.items_processed}</td>
                    <td className="p-3.5 text-sky-400 font-bold">{log.items_updated}</td>
                    <td className="p-3.5 text-emerald-400 font-bold">{log.items_created}</td>
                    <td className="p-3.5">
                      {log.errors && log.errors.length > 0 ? (
                        <span className="text-red-400 font-bold">{log.errors.length}</span>
                      ) : (
                        <span className="text-slate-500">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
