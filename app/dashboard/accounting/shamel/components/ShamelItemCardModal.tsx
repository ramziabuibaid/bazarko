'use client'

import { useEffect, useState } from 'react'

interface Props {
  isOpen: boolean
  onClose: () => void
  itemCode: string
  itemName?: string
  storeName: string
  currencyCode: string
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
    } | null
    last_purchase?: {
      day: string
      price: number
      quantity: number
      document: string
    } | null
  }
  total: number
  rows: Array<{
    document: string
    line_index: number
    day: string
    quantity: number
    price: number
    total: number
    location: number
    movement_type: string
  }>
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
      limit: '200',
    })

    fetch(`/api/shamel/query?${params.toString()}`)
      .then(async res => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || body.message || 'فشل جلب سجل حركة الصنف')
        return body as ItemCardData
      })
      .then(res => {
        setData(res)
      })
      .catch(err => {
        console.error('Item card error:', err)
        setError(err.message || 'تعذر تحميل سجل الصنف')
      })
      .finally(() => setLoading(false))
  }, [isOpen, itemCode, from, to, movementType])

  if (!isOpen) return null

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
              <div><b>سعر البيع:</b> ${money(data.item.price)} ${currencyCode}</div>
              <div><b>التكلفة:</b> ${money(data.item.cost_price)} ${currencyCode}</div>
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
              <div class="summary-title">قيمة المخزون الإجمالية</div>
              <div class="summary-val">${money(data.item.stock_quantity * (data.item.cost_price || data.item.price))} ${currencyCode}</div>
            </div>
          </div>

          ${rows.length > 0 ? `
            <table>
              <thead>
                <tr>
                  <th style="width:80px;">التاريخ</th>
                  <th style="width:85px;">المستند</th>
                  <th style="width:85px;">نوع الحركة</th>
                  <th style="width:70px; text-align:center;">الكمية</th>
                  <th style="width:90px; text-align:left;">السعر</th>
                  <th style="width:100px; text-align:left;">الإجمالي</th>
                  <th style="width:80px; text-align:center;">الموقع</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(r => `
                  <tr>
                    <td style="font-family:monospace;">${escapeHtml(r.day)}</td>
                    <td style="font-family:monospace; font-weight:bold;">${escapeHtml(r.document)}</td>
                    <td>${escapeHtml(r.movement_type)}</td>
                    <td style="text-align:center; font-family:monospace; font-weight:bold;">${num(r.quantity)}</td>
                    <td class="num">${money(r.price)}</td>
                    <td class="num" style="font-weight:bold;">${money(r.total)}</td>
                    <td style="text-align:center;">${r.location === 1 ? 'مستودع' : 'المحل'}</td>
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
      <div className="bg-slate-900 border border-white/10 text-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-white/10 bg-slate-800/70 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🏷️</span>
              <h2 className="text-lg font-bold text-white">
                بطاقة وسجل حركة الصنف: <span className="text-sky-400">{itemName || data?.item.name || itemCode}</span>
              </h2>
              <span className="font-mono text-xs bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-full font-bold">
                {itemCode}
              </span>
            </div>
            {data?.item.barcode && (
              <p className="text-xs text-slate-400 mt-1 font-mono">
                الباركود: {data.item.barcode}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={printItemCard}
              disabled={loading || printing || !data}
              className="px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold rounded-xl shadow-xs disabled:opacity-50 transition flex items-center gap-1.5"
            >
              <span>{printing ? 'جاري التجهيز...' : '🖨️ طباعة سجل الصنف'}</span>
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
        <div className="p-4 border-b border-white/10 bg-slate-950/60 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-bold">نوع الحركة:</span>
            <select
              value={movementType}
              onChange={e => setMovementType(e.target.value as any)}
              className="px-2.5 py-1.5 border border-white/10 bg-slate-900 text-white rounded-lg text-xs outline-none focus:border-sky-500"
            >
              <option value="all">كافة الحركات</option>
              <option value="sales">مبيعات فقط</option>
              <option value="purchases">مشتريات فقط</option>
              <option value="returns">مردودات</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-bold">من تاريخ:</span>
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              className="px-2.5 py-1.5 border border-white/10 bg-slate-900 text-white rounded-lg text-xs outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-bold">إلى تاريخ:</span>
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="px-2.5 py-1.5 border border-white/10 bg-slate-900 text-white rounded-lg text-xs outline-none focus:border-sky-500"
            />
          </div>

          {(from || to || movementType !== 'all') && (
            <button
              onClick={() => { setFrom(''); setTo(''); setMovementType('all') }}
              className="text-sky-400 hover:text-sky-300 font-bold text-xs"
            >
              إعادة تعيين الفلتر
            </button>
          )}
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
              جاري فحص سجل حركات الصنف في الشامل...
            </div>
          ) : data ? (
            <div className="space-y-4">
              {/* Summary Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                <div className="bg-emerald-500/10 p-3.5 rounded-xl border border-emerald-500/20">
                  <div className="text-[11px] text-emerald-400 font-bold">الكمية المتوفرة بالمخزن</div>
                  <div className="text-xl font-mono font-black text-emerald-300 mt-1">
                    {num(data.item.stock_quantity)}
                  </div>
                </div>

                <div className="bg-slate-800/60 p-3.5 rounded-xl border border-white/10">
                  <div className="text-[11px] text-slate-400 font-medium">سعر البيع الافتراضي</div>
                  <div className="text-lg font-mono font-bold text-white mt-1">
                    {money(data.item.price)} {currencyCode}
                  </div>
                </div>

                <div className="bg-slate-800/60 p-3.5 rounded-xl border border-white/10">
                  <div className="text-[11px] text-slate-400 font-medium">سعر التكلفة التقديري</div>
                  <div className="text-lg font-mono font-bold text-slate-300 mt-1">
                    {money(data.item.cost_price)} {currencyCode}
                  </div>
                </div>

                <div className="bg-sky-500/10 p-3.5 rounded-xl border border-sky-500/20">
                  <div className="text-[11px] text-sky-300 font-bold">إجمالي قيمة المخزون</div>
                  <div className="text-lg font-mono font-black text-sky-400 mt-1">
                    {money(data.item.stock_quantity * (data.item.cost_price || data.item.price))} {currencyCode}
                  </div>
                </div>
              </div>

              {/* Last Sale & Purchase info */}
              {(data.stats.last_sale || data.stats.last_purchase) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {data.stats.last_sale && (
                    <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-blue-300">آخر حركة بيع:</div>
                        <div className="text-slate-400 mt-0.5">
                          تاريخ {data.stats.last_sale.day} • فاتورة <span className="font-mono text-sky-400">{data.stats.last_sale.document}</span>
                        </div>
                      </div>
                      <div className="text-left font-mono font-bold text-blue-300">
                        {money(data.stats.last_sale.price)} {currencyCode} ({num(data.stats.last_sale.quantity)} قطعة)
                      </div>
                    </div>
                  )}

                  {data.stats.last_purchase && (
                    <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-amber-300">آخر حركة توريد / شراء:</div>
                        <div className="text-slate-400 mt-0.5">
                          تاريخ {data.stats.last_purchase.day} • سند <span className="font-mono text-amber-400">{data.stats.last_purchase.document}</span>
                        </div>
                      </div>
                      <div className="text-left font-mono font-bold text-amber-300">
                        {money(data.stats.last_purchase.price)} {currencyCode} ({num(data.stats.last_purchase.quantity)} قطعة)
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
                          <th className="py-3 px-3.5 font-bold">رقم المستند</th>
                          <th className="py-3 px-3.5 font-bold">نوع الحركة</th>
                          <th className="py-3 px-3.5 font-bold text-center">الكمية</th>
                          <th className="py-3 px-3.5 font-bold text-left">السعر</th>
                          <th className="py-3 px-3.5 font-bold text-left">الإجمالي</th>
                          <th className="py-3 px-3.5 font-bold text-center">الموقع</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-slate-200">
                        {data.rows.map((r, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/50">
                            <td className="py-2.5 px-3.5 font-mono text-slate-400">{r.day}</td>
                            <td className="py-2.5 px-3.5 font-mono font-bold text-sky-400">{r.document}</td>
                            <td className="py-2.5 px-3.5">
                              <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold border ${
                                r.movement_type === 'مبيعات' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                                r.movement_type === 'مشتريات' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                'bg-slate-800 text-slate-300 border border-white/5'
                              }`}>
                                {r.movement_type}
                              </span>
                            </td>
                            <td className="py-2.5 px-3.5 text-center font-mono font-bold text-white">
                              {num(r.quantity)}
                            </td>
                            <td className="py-2.5 px-3.5 text-left font-mono text-slate-300">
                              {money(r.price)}
                            </td>
                            <td className="py-2.5 px-3.5 text-left font-mono font-black text-white">
                              {money(r.total)}
                            </td>
                            <td className="py-2.5 px-3.5 text-center text-slate-400">
                              {r.location === 1 ? 'مستودع' : 'المحل'}
                            </td>
                          </tr>
                        ))}
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
