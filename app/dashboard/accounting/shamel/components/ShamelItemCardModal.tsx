'use client'

import { Fragment, useEffect, useState } from 'react'

interface Props {
  isOpen: boolean
  onClose: () => void
  itemCode: string
  itemName?: string
  storeName: string
  currencyCode: string
}

interface MovementRow {
  document: string
  line_index: number
  day: string
  quantity: number
  price: number
  total: number
  location: number
  movement_type: string
  party_type: 'customer' | 'supplier' | 'internal'
  party_code?: string | null
  party_name?: string | null
}

interface InvoiceItemDetail {
  item_code: string
  item_name: string
  quantity: number
  price: number
  total: number
}

interface DocumentDetails {
  document: string
  items: InvoiceItemDetail[]
}

interface ItemCardData {
  item: {
    code: string
    name: string
    barcode?: string
    price: number
    cost_price: number
    stock_quantity: number
  }
  stats: {
    total_stock: number
    total_sold: number
    total_purchased: number
    last_sale?: {
      day: string
      price: number
      quantity: number
      document: string
      customer_code?: string | null
      customer_name?: string | null
    } | null
    last_purchase?: {
      day: string
      price: number
      quantity: number
      document: string
      supplier_code?: string | null
      supplier_name?: string | null
    } | null
  }
  total: number
  rows: MovementRow[]
}

const money = (n: number) =>
  Number(n || 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const num = (n: number) =>
  Number(n || 0).toLocaleString('ar-u-nu-latn')

const escapeHtml = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export default function ShamelItemCardModal({
  isOpen,
  onClose,
  itemCode,
  itemName,
  storeName,
  currencyCode,
}: Props) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [movementType, setMovementType] = useState<'all' | 'sales' | 'purchases' | 'returns'>('all')
  const [data, setData] = useState<ItemCardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)

  // Document details drilldown
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null)
  const [docDetails, setDocDetails] = useState<Record<string, DocumentDetails>>({})
  const [loadingDoc, setLoadingDoc] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !itemCode) return

    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      kind: 'item_card',
      code: itemCode,
      from,
      to,
      type: movementType,
      limit: '300',
    })

    fetch(`/api/shamel/query?${params.toString()}`)
      .then(async res => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || body.message || 'فشل جلب سجل حركة الصنف')
        if (body.error) throw new Error(body.message || body.error)
        return body as ItemCardData
      })
      .then(res => {
        setData(res)
      })
      .catch(err => {
        console.error('Item card error:', err)
        setData(null)
        setError(err.message || 'تعذر تحميل سجل الصنف')
      })
      .finally(() => setLoading(false))
  }, [isOpen, itemCode, from, to, movementType])

  if (!isOpen) return null

  const toggleDoc = async (doc: string) => {
    if (expandedDoc === doc) {
      setExpandedDoc(null)
      return
    }
    setExpandedDoc(doc)
    if (!docDetails[doc]) {
      setLoadingDoc(doc)
      try {
        const res = await fetch(`/api/shamel/query?kind=details&document=${encodeURIComponent(doc)}`)
        const body = await res.json()
        if (res.ok) {
          setDocDetails(prev => ({ ...prev, [doc]: body }))
        }
      } catch (err) {
        console.error('Failed to load invoice details:', err)
      } finally {
        setLoadingDoc(null)
      }
    }
  }

  const printItemCard = () => {
    if (!data) return
    const win = window.open('', '_blank')
    if (!win) {
      alert('يرجى السماح بالنوافذ المنبثقة لفتح الطباعة.')
      return
    }
    setPrinting(true)

    try {
      const rows = data.rows || []

      win.document.open()
      win.document.write(`
        <!doctype html>
        <html lang="ar" dir="rtl">
        <head>
          <meta charset="utf-8">
          <title>سجل حركة صنف — ${escapeHtml(data.item.name)} (${escapeHtml(data.item.code)})</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #0f172a; padding: 24px; direction: rtl; }
            h1 { font-size: 20px; margin: 0 0 6px 0; color: #1e1b4b; }
            .header-box { border-bottom: 2px solid #e2e8f0; padding-bottom: 14px; margin-bottom: 16px; }
            .meta-grid { display: flex; flex-wrap: wrap; gap: 16px; font-size: 12px; color: #475569; }
            .summary-box { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; margin: 16px 0; text-align: center; }
            .summary-title { font-size: 11px; color: #64748b; }
            .summary-val { font-size: 16px; font-weight: bold; margin-top: 4px; font-family: monospace; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { padding: 8px 6px; border-bottom: 1px solid #cbd5e1; text-align: right; }
            th { background: #f1f5f9; color: #334155; font-weight: bold; }
            .num { direction: ltr; text-align: left; font-family: monospace; white-space: nowrap; }
            @page { size: A4 portrait; margin: 10mm; }
          </style>
        </head>
        <body>
          <div class="header-box">
            <h1>${escapeHtml(storeName)} — كشف وسجل حركة الصنف (الشامل المحاسبي)</h1>
            <div class="meta-grid">
              <div><b>اسم الصنف:</b> ${escapeHtml(data.item.name)}</div>
              <div><b>الكود:</b> <span style="font-family:monospace;">${escapeHtml(data.item.code)}</span></div>
              <div><b>الباركود:</b> ${escapeHtml(data.item.barcode || '—')}</div>
              <div><b>الكمية المتوفرة:</b> ${num(data.item.stock_quantity)}</div>
              <div><b>سعر التكلفة:</b> ${money(data.item.cost_price)} ${currencyCode}</div>
              <div><b>الفترة:</b> ${escapeHtml(from || 'من البداية')} إلى ${escapeHtml(to || 'حتى الآن')}</div>
              <div><b>تاريخ الطباعة:</b> ${new Date().toLocaleDateString('ar-u-nu-latn')}</div>
            </div>
          </div>

          <div class="summary-box">
            <div>
              <div class="summary-title">الكمية بالمخزن</div>
              <div class="summary-val" style="color:#047857;">${num(data.item.stock_quantity)}</div>
            </div>
            <div>
              <div class="summary-title">إجمالي المبيعات</div>
              <div class="summary-val" style="color:#1e1b4b;">${num(data.stats.total_sold)}</div>
            </div>
            <div>
              <div class="summary-title">إجمالي المشتريات</div>
              <div class="summary-val" style="color:#b91c1c;">${num(data.stats.total_purchased)}</div>
            </div>
            <div>
              <div class="summary-title">إجمالي الحركات</div>
              <div class="summary-val">${num(data.total)}</div>
            </div>
          </div>

          ${rows.length > 0 ? `
            <table>
              <thead>
                <tr>
                  <th style="width:85px;">التاريخ</th>
                  <th style="width:85px;">رقم الفاتورة</th>
                  <th style="width:80px;">نوع الحركة</th>
                  <th>الطرف (الزبون / المورد)</th>
                  <th style="width:65px; text-align:center;">الموقع</th>
                  <th style="width:65px; text-align:center;">الكمية</th>
                  <th style="width:85px; text-align:left;">السعر</th>
                  <th style="width:95px; text-align:left;">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(r => `
                  <tr>
                    <td style="font-family:monospace;">${escapeHtml(r.day)}</td>
                    <td style="font-family:monospace; font-weight:bold;">${escapeHtml(r.document)}</td>
                    <td>${escapeHtml(r.movement_type)}</td>
                    <td>
                      <b>${escapeHtml(r.party_name || '—')}</b>
                      ${r.party_code ? `<span style="font-size:10px; color:#64748b; font-family:monospace; margin-right:4px;">(${escapeHtml(r.party_code)})</span>` : ''}
                    </td>
                    <td style="text-align:center;">${r.location === 1 ? 'مستودع' : 'المحل'}</td>
                    <td style="text-align:center; font-family:monospace; font-weight:bold;">${num(r.quantity)}</td>
                    <td class="num">${money(r.price)}</td>
                    <td class="num" style="font-weight:bold;">${money(r.total)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : `
            <div style="padding:24px; text-align:center; color:#64748b; background:#f8fafc; border-radius:8px;">
              لا توجد حركات تفصيلية مسجلة لهذا الصنف خلال الفترة. الرصيد الحالي بالمخزن: <b>${num(data.item.stock_quantity)}</b>.
            </div>
          `}

          <div style="margin-top:28px; border-top:1px solid #e2e8f0; padding-top:10px; font-size:10px; color:#64748b; display:flex; justify-content:space-between;">
            <span>مستخرج آلياً من قاعدة بيانات الشامل المحاسبي عبر منصة بازاركو.</span>
            <span>منصة بازاركو — Bazarko ERP</span>
          </div>
        </body>
        </html>
      `)
      win.document.close()
      win.focus()
      win.print()
    } catch (err: any) {
      win.close()
      alert(`فشل إعداد الطباعة: ${err.message}`)
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 md:p-6 overflow-y-auto" dir="rtl">
      <div className="bg-slate-900 border border-white/10 text-white rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-white/10 bg-slate-800/70 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🏷️</span>
              <h2 className="text-lg font-bold text-white">
                بطاقة وسجل حركة الصنف: <span className="text-sky-400">{itemName || data?.item?.name || itemCode}</span>
              </h2>
              <span className="font-mono text-xs bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-full font-bold">
                {itemCode}
              </span>
            </div>
            {data?.item && (
              <p className="text-xs text-slate-400 mt-1">
                الباركود: <span className="font-mono text-slate-300">{data.item.barcode || '—'}</span> • سعر التكلفة:{' '}
                <span className="font-mono text-emerald-400 font-bold">{money(data.item.cost_price)} {currencyCode}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={printItemCard}
              disabled={loading || printing || !data}
              className="px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold rounded-xl shadow-xs disabled:opacity-50 transition flex items-center gap-1.5"
            >
              <span>{printing ? '⏳ جاري التجهيز...' : '🖨️ طباعة سجل الصنف'}</span>
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-sm transition border border-white/10"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="p-4 border-b border-white/10 bg-slate-950/60 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Movement Type Tabs */}
          <div className="flex gap-1 bg-slate-800 p-1 rounded-xl border border-white/10">
            {([
              ['all', 'كافة الحركات'],
              ['sales', 'فواتير المبيعات'],
              ['purchases', 'فواتير المشتريات'],
              ['returns', 'المردودات'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setMovementType(k)}
                className={`px-3 py-1.5 rounded-lg font-bold text-xs transition ${
                  movementType === k
                    ? 'bg-sky-500 text-slate-950 shadow-xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-bold">من:</span>
              <input
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                className="px-2.5 py-1.5 border border-white/10 bg-slate-900 text-white rounded-lg text-xs outline-none focus:border-sky-500"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-bold">إلى:</span>
              <input
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
                className="px-2.5 py-1.5 border border-white/10 bg-slate-900 text-white rounded-lg text-xs outline-none focus:border-sky-500"
              />
            </div>
            {(from || to) && (
              <button
                onClick={() => { setFrom(''); setTo('') }}
                className="text-sky-400 hover:text-sky-300 font-bold text-xs"
              >
                إعادة ضبط
              </button>
            )}
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs font-semibold">
              ⚠️ {error}
            </div>
          )}

          {loading ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <div className="text-2xl animate-spin mb-2">⏳</div>
              جاري فحص سجل حركات وفواتير الصنف في الشامل...
            </div>
          ) : data && data.item ? (
            <div className="space-y-4">
              {/* Summary Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                <div className="bg-emerald-500/10 p-3.5 rounded-xl border border-emerald-500/20">
                  <div className="text-[11px] text-emerald-400 font-bold">الكمية المتوفرة بالمخزن</div>
                  <div className="text-xl font-mono font-black text-emerald-300 mt-1">
                    {num(data.item.stock_quantity)}
                  </div>
                </div>

                <div className="bg-blue-500/10 p-3.5 rounded-xl border border-blue-500/20">
                  <div className="text-[11px] text-blue-300 font-bold">إجمالي المبيعات السابقة</div>
                  <div className="text-xl font-mono font-bold text-blue-400 mt-1">
                    {num(data.stats.total_sold)}
                  </div>
                </div>

                <div className="bg-amber-500/10 p-3.5 rounded-xl border border-amber-500/20">
                  <div className="text-[11px] text-amber-300 font-bold">إجمالي المشتريات السابقة</div>
                  <div className="text-xl font-mono font-bold text-amber-400 mt-1">
                    {num(data.stats.total_purchased)}
                  </div>
                </div>

                <div className="bg-sky-500/10 p-3.5 rounded-xl border border-sky-500/20">
                  <div className="text-[11px] text-sky-300 font-bold">إجمالي الحركات المسجلة</div>
                  <div className="text-xl font-mono font-black text-sky-400 mt-1">
                    {num(data.total)}
                  </div>
                </div>
              </div>

              {/* Last Sale & Purchase info with Party Name */}
              {(data.stats.last_sale || data.stats.last_purchase) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {data.stats.last_sale && (
                    <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 flex flex-col justify-between gap-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-blue-300">آخر حركة بيع:</span>
                        <span className="font-mono text-slate-400 text-[11px]">{data.stats.last_sale.day}</span>
                      </div>
                      <div className="font-bold text-white text-sm">
                        {data.stats.last_sale.customer_name || 'زبون غير مسجل'}
                        {data.stats.last_sale.customer_code && (
                          <span className="text-[11px] text-sky-400 font-mono mr-1">({data.stats.last_sale.customer_code})</span>
                        )}
                      </div>
                      <div className="text-slate-400 flex items-center justify-between mt-0.5">
                        <span>فاتورة: <button onClick={() => toggleDoc(data.stats.last_sale!.document)} className="font-mono font-bold text-sky-400 hover:underline">{data.stats.last_sale.document}</button></span>
                        <span className="font-mono font-bold text-blue-300" dir="ltr">
                          {money(data.stats.last_sale.price)} {currencyCode} ({num(data.stats.last_sale.quantity)} قطعة)
                        </span>
                      </div>
                    </div>
                  )}

                  {data.stats.last_purchase && (
                    <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 flex flex-col justify-between gap-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-amber-300">آخر حركة شراء / توريد:</span>
                        <span className="font-mono text-slate-400 text-[11px]">{data.stats.last_purchase.day}</span>
                      </div>
                      <div className="font-bold text-white text-sm">
                        {data.stats.last_purchase.supplier_name || 'مورد غير مسجل'}
                        {data.stats.last_purchase.supplier_code && (
                          <span className="text-[11px] text-amber-400 font-mono mr-1">({data.stats.last_purchase.supplier_code})</span>
                        )}
                      </div>
                      <div className="text-slate-400 flex items-center justify-between mt-0.5">
                        <span>سند شراء: <button onClick={() => toggleDoc(data.stats.last_purchase!.document)} className="font-mono font-bold text-amber-400 hover:underline">{data.stats.last_purchase.document}</button></span>
                        <span className="font-mono font-bold text-amber-300" dir="ltr">
                          {money(data.stats.last_purchase.price)} {currencyCode} ({num(data.stats.last_purchase.quantity)} قطعة)
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Movements Table */}
              <div className="border border-white/10 rounded-xl overflow-hidden shadow-xl bg-slate-900">
                {data.rows.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs">
                    لا توجد فواتير أو حركات مسجلة لهذا الصنف خلال الفترة المحددة.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-slate-800/60 text-slate-400 border-b border-white/10">
                        <tr>
                          <th className="py-3 px-3.5 font-bold">التاريخ</th>
                          <th className="py-3 px-3.5 font-bold text-center">رقم الفاتورة</th>
                          <th className="py-3 px-3.5 font-bold text-center">نوع الحركة</th>
                          <th className="py-3 px-3.5 font-bold">الطرف (الزبون / المورد)</th>
                          <th className="py-3 px-3.5 font-bold text-center">الموقع</th>
                          <th className="py-3 px-3.5 font-bold text-center">الكمية</th>
                          <th className="py-3 px-3.5 font-bold text-left">السعر</th>
                          <th className="py-3 px-3.5 font-bold text-left">الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-slate-200">
                        {data.rows.map((r, idx) => {
                          const isExpanded = expandedDoc === r.document
                          const details = docDetails[r.document]
                          const isLoadingCurrentDoc = loadingDoc === r.document

                          return (
                            <Fragment key={`${r.document}-${r.line_index}-${idx}`}>
                              <tr className="hover:bg-slate-800/50 transition-colors">
                                <td className="py-3 px-3.5 font-mono text-slate-300 text-xs">{r.day}</td>

                                {/* Invoice Document with Drilldown Toggle */}
                                <td className="py-3 px-3.5 text-center">
                                  <button
                                    onClick={() => toggleDoc(r.document)}
                                    className="font-mono font-bold px-2.5 py-1 rounded-lg border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 transition-colors inline-flex items-center gap-1.5 shadow-xs"
                                    title="عرض كافة بنود ومحتويات هذه الفاتورة"
                                  >
                                    <span>{r.document}</span>
                                    <span className="text-[10px] text-sky-400">{isExpanded ? '▲' : '▼'}</span>
                                  </button>
                                </td>

                                {/* Movement Type Badge */}
                                <td className="py-3 px-3.5 text-center">
                                  <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold border ${
                                    r.movement_type === 'مبيعات' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                                    r.movement_type === 'مشتريات' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                    r.movement_type.includes('مردود') ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                    'bg-slate-800 text-slate-300 border border-white/5'
                                  }`}>
                                    {r.movement_type}
                                  </span>
                                </td>

                                {/* Party Name & Code (Customer or Supplier) */}
                                <td className="py-3 px-3.5 min-w-56">
                                  <div className="font-bold text-white text-xs">
                                    {r.party_name || <span className="text-slate-500 font-normal">حركة داخلية / غير محدد</span>}
                                  </div>
                                  {r.party_code && (
                                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                                      {r.party_type === 'customer' ? 'الزبون: ' : r.party_type === 'supplier' ? 'المورد: ' : 'الحساب: '}
                                      <span className="text-sky-400 font-bold">{r.party_code}</span>
                                    </div>
                                  )}
                                </td>

                                {/* Location */}
                                <td className="py-3 px-3.5 text-center text-slate-400 text-xs">
                                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-white/5">
                                    {r.location === 1 ? 'مستودع (1)' : 'المحل (0)'}
                                  </span>
                                </td>

                                {/* Quantity */}
                                <td className="py-3 px-3.5 text-center font-mono font-bold text-white">
                                  {num(r.quantity)}
                                </td>

                                {/* Price */}
                                <td className="py-3 px-3.5 text-left font-mono text-slate-300" dir="ltr">
                                  {money(r.price)} {currencyCode}
                                </td>

                                {/* Total */}
                                <td className="py-3 px-3.5 text-left font-mono font-black text-white" dir="ltr">
                                  {money(r.total)} {currencyCode}
                                </td>
                              </tr>

                              {/* Expandable Invoice Details Drilldown */}
                              {isExpanded && (
                                <tr className="bg-slate-950/80 border-y border-sky-500/30">
                                  <td colSpan={8} className="p-4">
                                    <div className="space-y-3 max-w-4xl mx-auto">
                                      <div className="flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-2">
                                          <span className="font-bold text-sky-400 text-sm">
                                            📑 تفاصيل ومحتويات الفاتورة {r.document}
                                          </span>
                                          {r.party_name && (
                                            <span className="text-slate-400 text-xs">
                                              — الصادرة باسم: <b className="text-white">{r.party_name}</b>
                                            </span>
                                          )}
                                        </div>
                                        <button
                                          onClick={() => setExpandedDoc(null)}
                                          className="text-slate-400 hover:text-white text-xs font-bold"
                                        >
                                          ✕ إغلاق التفاصيل
                                        </button>
                                      </div>

                                      {isLoadingCurrentDoc ? (
                                        <div className="py-4 text-center text-slate-400 text-xs">
                                          <div className="text-lg animate-spin mb-1">⏳</div>
                                          جاري جلب بنود الفاتورة...
                                        </div>
                                      ) : details?.items && details.items.length > 0 ? (
                                        <div className="rounded-xl border border-white/10 overflow-hidden bg-slate-900 shadow-lg">
                                          <table className="w-full text-xs text-right">
                                            <thead className="bg-slate-800 text-slate-400 border-b border-white/10">
                                              <tr>
                                                <th className="py-2.5 px-3">#</th>
                                                <th className="py-2.5 px-3">كود الصنف</th>
                                                <th className="py-2.5 px-3">اسم الصنف</th>
                                                <th className="py-2.5 px-3 text-center">الكمية</th>
                                                <th className="py-2.5 px-3 text-left">السعر</th>
                                                <th className="py-2.5 px-3 text-left">الإجمالي</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5 text-slate-200">
                                              {details.items.map((it, itemIdx) => {
                                                const isCurrent = it.item_code === data.item.code

                                                return (
                                                  <tr
                                                    key={itemIdx}
                                                    className={isCurrent ? 'bg-sky-500/10 font-bold' : 'hover:bg-slate-800/40'}
                                                  >
                                                    <td className="py-2 px-3 text-slate-400 font-mono text-[11px]">{itemIdx + 1}</td>
                                                    <td className="py-2 px-3 font-mono text-sky-400">{it.item_code}</td>
                                                    <td className="py-2 px-3 text-white">
                                                      {it.item_name}
                                                      {isCurrent && (
                                                        <span className="mr-2 text-[10px] bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-full font-bold">
                                                          الصنف الحالي
                                                        </span>
                                                      )}
                                                    </td>
                                                    <td className="py-2 px-3 text-center font-mono font-bold">{num(it.quantity)}</td>
                                                    <td className="py-2 px-3 text-left font-mono" dir="ltr">{money(it.price)}</td>
                                                    <td className="py-2 px-3 text-left font-mono font-black text-white" dir="ltr">
                                                      {money(it.total)}
                                                    </td>
                                                  </tr>
                                                )
                                              })}
                                            </tbody>
                                          </table>
                                        </div>
                                      ) : (
                                        <div className="py-3 text-slate-400 text-xs text-center bg-slate-900 rounded-xl border border-white/5">
                                          لا توجد بنود إضافية مسجلة لهذه الفاتورة في المستودع.
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-white/10 bg-slate-800/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition border border-white/10"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  )
}
