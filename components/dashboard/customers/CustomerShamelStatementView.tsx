'use client'

import { Fragment, useEffect, useState } from 'react'

interface Props {
  customerCode: string
  customerName?: string
  storeName: string
  currencyCode?: string
}

interface StatementRow {
  day: string
  document: string
  line_index: number
  document_type?: string
  description?: string
  debit: number
  credit: number
  running_balance: number
  original_currency?: string
  original_amount?: number
  exchange_rate?: number
}

interface ChequeRow {
  id: string
  document: string
  cheque_number: string
  bank_code: string
  bank_name?: string
  branch_code?: string
  due_date: string | null
  amount: number
  currency: string
  status: string
  status_name: string
  target_account?: string
  target_name?: string
}

interface StatementData {
  customer: {
    code: string
    name: string
    phone?: string
    address?: string
    balance: number
    equivalent_balance?: number
  }
  has_ledger_entries: boolean
  opening_balance: number
  period_debit: number
  period_credit: number
  closing_balance: number
  currency: string
  total: number
  rows: StatementRow[]
  cheques: ChequeRow[]
}

interface DocumentDetails {
  document: string
  items: Array<{
    line_index: number
    day: string
    item_code: string
    item_name: string
    quantity: number
    price: number
    total: number
    location: number
  }>
  cheques: Array<{
    cheque_number: string
    due_date: string | null
    bank_name?: string
    amount: number
    currency: string
  }>
}

const PALESTINIAN_BANKS: Record<string, string> = {
  '0089': 'بنك فلسطين',
  '0049': 'البنك الإسلامي الفلسطيني',
  '0081': 'البنك الإسلامي العربي',
  '0027': 'البنك العربي',
  '0073': 'بنك القدس',
  '0082': 'البنك الوطني',
  '0066': 'بنك القاهرة عمان',
  '0076': 'بنك الصفا',
  '0037': 'بنك الأردن',
  '0043': 'بنك الإسكان للتجارة',
  '0067': 'البنك الأهلي الأردني',
  '0078': 'بنك الاستثمار الفلسطيني',
  '0012': 'بنك لئومي',
  '0010': 'بنك هبوعليم',
  '0011': 'بنك ديسكونت',
  '0020': 'بنك مزراحي تفاحوت',
  '0031': 'البنك الدولي الأول',
}

const money = (n: number) =>
  Number(n || 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const escapeHtml = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

function getDefaultFromDate(): string {
  const prevYear = new Date().getFullYear() - 1
  return `${prevYear}-01-01`
}

function getTodayDate(): string {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function CustomerShamelStatementView({
  customerCode,
  customerName,
  storeName,
  currencyCode = 'NIS',
}: Props) {
  const [from, setFrom] = useState(getDefaultFromDate())
  const [to, setTo] = useState(getTodayDate())
  const [currency, setCurrency] = useState(currencyCode || 'NIS')
  const [isDetailed, setIsDetailed] = useState(true)
  const [data, setData] = useState<StatementData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)

  // Document details drilldown
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null)
  const [docDetails, setDocDetails] = useState<Record<string, DocumentDetails>>({})
  const [loadingDocDetails, setLoadingDocDetails] = useState<string | null>(null)
  const [viewTab, setViewTab] = useState<'movements' | 'cheques'>('movements')

  useEffect(() => {
    if (!customerCode) return

    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      kind: 'statement',
      code: customerCode,
      currency,
      from,
      to,
      limit: '500',
    })

    fetch(`/api/shamel/query?${params.toString()}`)
      .then(async res => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || body.message || 'فشل جلب كشف حساب الشامل')
        if (body.error) throw new Error(body.message || body.error)
        return body as StatementData
      })
      .then(stmt => {
        setData(stmt)
      })
      .catch(err => {
        console.error('Shamel customer statement error:', err)
        setData(null)
        setError(err.message || 'تعذر تحميل كشف حساب الشامل')
      })
      .finally(() => setLoading(false))
  }, [customerCode, from, to, currency])

  const toggleDocDetails = async (doc: string) => {
    if (expandedDoc === doc) {
      setExpandedDoc(null)
      return
    }
    setExpandedDoc(doc)
    if (!docDetails[doc]) {
      setLoadingDocDetails(doc)
      try {
        const res = await fetch(`/api/shamel/query?kind=details&document=${encodeURIComponent(doc)}`)
        const body = await res.json()
        if (res.ok) {
          setDocDetails(prev => ({ ...prev, [doc]: body }))
        }
      } catch (err) {
        console.error('Failed to load document details:', err)
      } finally {
        setLoadingDocDetails(null)
      }
    }
  }

  const printStatement = async (detailed = false) => {
    if (!data) return
    const win = window.open('', '_blank')
    if (!win) {
      alert('يرجى السماح بالنوافذ المنبثقة للتمكن من الطباعة.')
      return
    }
    win.document.body.textContent = 'جارٍ تجهيز كشف الحساب للطباعة...'
    setPrinting(true)

    try {
      const rows = data.rows || []
      const printDetails: Record<string, DocumentDetails> = { ...docDetails }

      if (detailed) {
        win.document.body.textContent = 'جارٍ جلب تفاصيل الفواتير والشيكات...'
        const uniqueDocs = Array.from(new Set(rows.map(r => r.document)))
        for (const d of uniqueDocs) {
          if (!printDetails[d]) {
            try {
              const res = await fetch(`/api/shamel/query?kind=details&document=${encodeURIComponent(d)}`)
              if (res.ok) {
                printDetails[d] = await res.json()
              }
            } catch {}
          }
        }
      }

      const detailedHtml = (doc: string) => {
        const d = printDetails[doc]
        if (!d) return ''
        let out = ''
        if (d.items && d.items.length > 0) {
          out += `
            <div style="margin:6px 0; padding:8px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px;">
              <b>📦 بنود الفاتورة:</b>
              <table style="margin-top:6px; font-size:11px; width:100%; border-collapse:collapse; background:#fff;">
                <thead>
                  <tr style="background:#f1f5f9; border-bottom:1px solid #cbd5e1;">
                    <th style="padding:4px 6px; text-align:right;">#</th>
                    <th style="padding:4px 6px; text-align:right;">كود الصنف</th>
                    <th style="padding:4px 6px; text-align:right;">اسم الصنف</th>
                    <th style="padding:4px 6px; text-align:center;">الكمية</th>
                    <th style="padding:4px 6px; text-align:left;">السعر</th>
                    <th style="padding:4px 6px; text-align:left;">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  ${d.items.map((it, idx) => `
                    <tr style="border-bottom:1px solid #f1f5f9;">
                      <td style="padding:4px 6px;">${idx + 1}</td>
                      <td style="padding:4px 6px; font-family:monospace;">${escapeHtml(it.item_code)}</td>
                      <td style="padding:4px 6px;">${escapeHtml(it.item_name)}</td>
                      <td style="padding:4px 6px; text-align:center;">${it.quantity}</td>
                      <td style="padding:4px 6px; text-align:left; font-family:monospace;">${money(it.price)}</td>
                      <td style="padding:4px 6px; text-align:left; font-family:monospace; font-weight:bold;">${money(it.total)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `
        }
        if (d.cheques && d.cheques.length > 0) {
          out += `
            <div style="margin:6px 0; padding:8px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px;">
              <b>🏦 بيانات الشيكات:</b>
              <table style="margin-top:6px; font-size:11px; width:100%; border-collapse:collapse; background:#fff;">
                <thead>
                  <tr style="background:#f1f5f9; border-bottom:1px solid #cbd5e1;">
                    <th style="padding:4px 6px; text-align:right;">#</th>
                    <th style="padding:4px 6px; text-align:right;">رقم الشيك</th>
                    <th style="padding:4px 6px; text-align:right;">تاريخ الاستحقاق</th>
                    <th style="padding:4px 6px; text-align:right;">البنك</th>
                    <th style="padding:4px 6px; text-align:left;">المبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  ${d.cheques.map((c, idx) => `
                    <tr style="border-bottom:1px solid #f1f5f9;">
                      <td style="padding:4px 6px;">${idx + 1}</td>
                      <td style="padding:4px 6px; font-family:monospace;">${escapeHtml(c.cheque_number)}</td>
                      <td style="padding:4px 6px;">${c.due_date ? new Date(c.due_date).toLocaleDateString('ar-u-nu-latn') : '—'}</td>
                      <td style="padding:4px 6px;">${escapeHtml(c.bank_name || 'بنك')}</td>
                      <td style="padding:4px 6px; text-align:left; font-family:monospace; font-weight:bold;">${money(c.amount)} ${c.currency}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `
        }
        return out
      }

      win.document.open()
      win.document.write(`
        <!doctype html>
        <html lang="ar" dir="rtl">
        <head>
          <meta charset="utf-8">
          <title>كشف حساب الشامل — ${escapeHtml(data?.customer?.name || customerName || customerCode)}</title>
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
            <h1>${escapeHtml(storeName)} — كشف حساب الزبون (نظام الشامل للمحاسبة) ${detailed ? '— تفصيلي' : ''}</h1>
            <div class="meta-grid">
              <div><b>الزبون:</b> ${escapeHtml(data?.customer?.name || customerName || customerCode)}</div>
              <div><b>رقم الشامل:</b> <span style="font-family:monospace; font-weight:bold;">${escapeHtml(data?.customer?.code || customerCode)}</span></div>
              <div><b>الهاتف:</b> ${escapeHtml(data?.customer?.phone || '—')}</div>
              <div><b>العنوان:</b> ${escapeHtml(data?.customer?.address || '—')}</div>
              <div><b>الفترة:</b> ${escapeHtml(from || 'من البداية')} إلى ${escapeHtml(to || 'الآن')}</div>
              <div><b>العملة:</b> ${escapeHtml(currency)}</div>
              <div><b>تاريخ الطباعة:</b> ${new Date().toLocaleDateString('ar-u-nu-latn')}</div>
            </div>
          </div>

          <div class="summary-box">
            <div>
              <div class="summary-title">الرصيد الافتتاحي / السابق</div>
              <div class="summary-val">${money(data.opening_balance)}</div>
            </div>
            <div>
              <div class="summary-title">مدين الفترة (+)</div>
              <div class="summary-val" style="color:#b91c1c;">${money(data.period_debit)}</div>
            </div>
            <div>
              <div class="summary-title">دائن الفترة (-)</div>
              <div class="summary-val" style="color:#047857;">${money(data.period_credit)}</div>
            </div>
            <div>
              <div class="summary-title">الرصيد الختامي المستحق</div>
              <div class="summary-val" style="color:#1e1b4b;">${money(data.closing_balance)}</div>
            </div>
          </div>

          ${rows.length > 0 ? `
            <table>
              <thead>
                <tr>
                  <th style="width:75px;">التاريخ</th>
                  <th style="width:80px;">المستند</th>
                  <th style="width:80px;">النوع</th>
                  <th>البيان</th>
                  <th style="width:90px; text-align:left;">مدين (+)</th>
                  <th style="width:90px; text-align:left;">دائن (-)</th>
                  <th style="width:105px; text-align:left;">الرصيد التراكمي</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(r => `
                  <tr>
                    <td>${escapeHtml(r.day)}</td>
                    <td style="font-family:monospace; font-weight:bold;">${escapeHtml(r.document)}</td>
                    <td>${escapeHtml(r.document_type || 'حركة')}</td>
                    <td>${escapeHtml(r.description || '—')}</td>
                    <td class="num">${r.debit > 0 ? money(r.debit) : '—'}</td>
                    <td class="num">${r.credit > 0 ? money(r.credit) : '—'}</td>
                    <td class="num" style="font-weight:bold;">${money(r.running_balance)}</td>
                  </tr>
                  ${detailed ? `
                    <tr>
                      <td colspan="7" style="padding:0 8px 8px 8px; border-bottom:2px solid #cbd5e1;">
                        ${detailedHtml(r.document)}
                      </td>
                    </tr>
                  ` : ''}
                `).join('')}
              </tbody>
            </table>
          ` : `
            <div style="padding:20px; text-align:center; color:#64748b; background:#f8fafc; border-radius:8px;">
              لا توجد قيود يومية تفصيلية مسجلة في هذه الفترة. رصيد الزبون المسجل في الشامل: <b>${money(data?.customer?.balance ?? 0)} ${currency}</b>.
            </div>
          `}

          ${data.cheques && data.cheques.length > 0 ? `
            <div style="margin-top:24px;">
              <h3 style="font-size:14px; margin-bottom:8px; color:#1e1b4b;">شيكات الزبون المسجلة في الشامل (${data.cheques.length} شيك)</h3>
              <table>
                <thead>
                  <tr>
                    <th>رقم الشيك</th>
                    <th>تاريخ الاستحقاق</th>
                    <th>البنك والفرع</th>
                    <th>المبلغ</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.cheques.map(c => `
                    <tr>
                      <td style="font-family:monospace; font-weight:bold;">${escapeHtml(c.cheque_number)}</td>
                      <td>${c.due_date ? new Date(c.due_date).toLocaleDateString('ar-u-nu-latn') : '—'}</td>
                      <td>${escapeHtml(c.bank_name || PALESTINIAN_BANKS[c.bank_code] || c.bank_code)}</td>
                      <td class="num" style="font-weight:bold;">${money(c.amount)} ${c.currency}</td>
                      <td>${escapeHtml(c.status_name)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : ''}

          <div style="margin-top:28px; border-top:1px solid #e2e8f0; padding-top:10px; font-size:10px; color:#64748b; display:flex; justify-content:space-between;">
            <span>ملاحظة: مستخرج من قاعدة بيانات الشامل المحاسبي للمتجر.</span>
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
      alert(`حدث خطأ أثناء إعداد الطباعة: ${err.message}`)
    } finally {
      setPrinting(false)
    }
  }

  const downloadExcel = (detailed = false) => {
    if (!data) return
    setExportingExcel(true)
    try {
      const rows = data.rows || []
      const printDetails: Record<string, DocumentDetails> = { ...docDetails }

      const excelHtml = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40" dir="rtl" lang="ar">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; }
  .num { text-align: left; direction: ltr; font-family: monospace; }
</style>
</head>
<body dir="rtl">
  <h2>${escapeHtml(storeName)} — كشف حساب الزبون (الشامل المحاسبي)</h2>
  <p>الزبون: ${escapeHtml(data.customer?.name || customerName || customerCode)} | الكود: ${escapeHtml(customerCode)} | الفترة: ${escapeHtml(from)} إلى ${escapeHtml(to)}</p>
  <table border="1">
    <thead>
      <tr style="background:#f1f5f9; font-weight:bold;">
        <th>التاريخ</th>
        <th>المستند</th>
        <th>النوع</th>
        <th>البيان</th>
        <th>مدين (+)</th>
        <th>دائن (-)</th>
        <th>الرصيد التراكمي</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(r => `
        <tr>
          <td>${escapeHtml(r.day)}</td>
          <td>${escapeHtml(r.document)}</td>
          <td>${escapeHtml(r.document_type || 'حركة')}</td>
          <td>${escapeHtml(r.description || '—')}</td>
          <td class="num">${r.debit > 0 ? money(r.debit) : '—'}</td>
          <td class="num">${r.credit > 0 ? money(r.credit) : '—'}</td>
          <td class="num">${money(r.running_balance)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</body>
</html>`

      const blob = new Blob([excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `كشف_شامل_${customerCode}_${new Date().toISOString().slice(0, 10)}.xls`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } finally {
      setExportingExcel(false)
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900 overflow-hidden shadow-xl">
      {/* Header and Action Bar */}
      <div className="p-4 sm:p-5 border-b border-white/10 bg-slate-800/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🏛️</span>
            <h3 className="text-base font-bold text-white">كشف حساب الشامل المحاسبي</h3>
            <span className="font-mono text-xs bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-full font-bold">
              رقم الشامل: {customerCode}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            سجل القيود اليومية، الفواتير، سندات القبض، والشيكات المستخرجة والمزامنة من الشامل ERP.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Detailed Toggle */}
          <button
            type="button"
            onClick={() => setIsDetailed(!isDetailed)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 ${
              isDetailed
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                : 'bg-slate-800 text-slate-400 border-white/10 hover:text-white'
            }`}
            title="تفعيل إدراج أصناف الفواتير والشيكات في الطباعة والتصدير"
          >
            <span>{isDetailed ? '☑️ كشف تفصيلي (أصناف وشيكات)' : '◻️ كشف ملخص'}</span>
          </button>

          {/* Export Excel */}
          <button
            type="button"
            onClick={() => downloadExcel(isDetailed)}
            disabled={loading || exportingExcel || !data}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-50 transition flex items-center gap-1.5"
          >
            <span>{exportingExcel ? '⏳ جاري التصدير...' : '📊 تصدير Excel'}</span>
          </button>

          {/* Print / PDF */}
          <button
            type="button"
            onClick={() => printStatement(isDetailed)}
            disabled={loading || printing || !data}
            className="px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold rounded-xl shadow-xs disabled:opacity-50 transition flex items-center gap-1.5"
          >
            <span>{printing ? '⏳ جاري الإعداد...' : '🖨️ طباعة كشف الشامل'}</span>
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="p-3.5 border-b border-white/10 bg-slate-950/60 flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 font-medium">من تاريخ:</span>
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="px-2.5 py-1.5 border border-white/10 bg-slate-900 text-white rounded-lg text-xs outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 font-medium">إلى تاريخ:</span>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="px-2.5 py-1.5 border border-white/10 bg-slate-900 text-white rounded-lg text-xs outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 font-medium">العملة:</span>
          <select
            value={currency}
            onChange={e => setCurrency(e.target.value)}
            className="px-2.5 py-1.5 border border-white/10 bg-slate-900 text-white rounded-lg text-xs outline-none focus:border-sky-500"
          >
            <option value="NIS">الشيكل NIS (موحد عام)</option>
            <option value="JOD">دينار أردني (JOD)</option>
            <option value="USD">دولار أمريكي (USD)</option>
            <option value="EUR">يورو (EUR)</option>
          </select>
        </div>

        {(from || to) && (
          <button
            type="button"
            onClick={() => { setFrom(''); setTo('') }}
            className="text-sky-400 hover:text-sky-300 font-bold text-xs"
          >
            إعادة ضبط الفترة
          </button>
        )}

        {/* View Tab selector */}
        <div className="mr-auto flex gap-1 bg-slate-800 p-0.5 rounded-lg border border-white/10">
          <button
            type="button"
            onClick={() => setViewTab('movements')}
            className={`px-3 py-1 rounded text-xs font-bold transition ${
              viewTab === 'movements' ? 'bg-sky-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            الحركات والقيود ({data?.rows.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setViewTab('cheques')}
            className={`px-3 py-1 rounded text-xs font-bold transition ${
              viewTab === 'cheques' ? 'bg-sky-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            الشيكات المسجلة ({data?.cheques.length || 0})
          </button>
        </div>
      </div>

      {/* Body Content */}
      <div className="p-4 sm:p-5 space-y-4">
        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs font-semibold">
            ⚠️ {error}
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-slate-400 text-xs">
            <div className="text-2xl animate-spin mb-2">⏳</div>
            جاري احتساب كشف الحساب من قيود الشامل...
          </div>
        ) : data ? (
          <div className="space-y-4">
            {/* 4 Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
              <div className="bg-slate-800/60 p-3.5 rounded-xl border border-white/10">
                <div className="text-[11px] text-slate-400 font-medium">الرصيد الافتتاحي / السابق</div>
                <div className="text-base sm:text-lg font-mono font-bold text-white mt-1">
                  {money(data.opening_balance)} {data.currency}
                </div>
              </div>

              <div className="bg-rose-500/10 p-3.5 rounded-xl border border-rose-500/20">
                <div className="text-[11px] text-rose-400 font-bold">مدين الفترة (+)</div>
                <div className="text-base sm:text-lg font-mono font-bold text-rose-400 mt-1">
                  {money(data.period_debit)} {data.currency}
                </div>
              </div>

              <div className="bg-emerald-500/10 p-3.5 rounded-xl border border-emerald-500/20">
                <div className="text-[11px] text-emerald-400 font-bold">دائن الفترة (-)</div>
                <div className="text-base sm:text-lg font-mono font-bold text-emerald-400 mt-1">
                  {money(data.period_credit)} {data.currency}
                </div>
              </div>

              <div className="bg-sky-500/10 p-3.5 rounded-xl border border-sky-500/20">
                <div className="text-[11px] text-sky-300 font-bold">الرصيد الختامي المستحق</div>
                <div className="text-base sm:text-lg font-mono font-black text-sky-400 mt-1">
                  {money(data.closing_balance)} {data.currency}
                </div>
              </div>
            </div>

            {/* View 1: Movements */}
            {viewTab === 'movements' && (
              <div className="border border-white/10 rounded-xl overflow-hidden shadow-xl bg-slate-900">
                {data.rows.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs">
                    {data.has_ledger_entries
                      ? 'لا توجد حركات خلال الفترة الزمنية المحددة.'
                      : 'لم يتم استيراد قيود الحركات التفصيلية (ctrans.dat) بعد. الرصيد الإجمالي للزبون مسجل في الشامل.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-slate-800/60 text-slate-400 border-b border-white/10">
                        <tr>
                          <th className="py-3 px-3 font-bold">التاريخ</th>
                          <th className="py-3 px-3 font-bold">رقم المستند</th>
                          <th className="py-3 px-3 font-bold">النوع</th>
                          <th className="py-3 px-3 font-bold">البيان</th>
                          <th className="py-3 px-3 font-bold text-left">مدين (+)</th>
                          <th className="py-3 px-3 font-bold text-left">دائن (-)</th>
                          <th className="py-3 px-3 font-bold text-left">الرصيد التراكمي</th>
                          <th className="py-3 px-3 font-bold text-center">التفاصيل</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-slate-200">
                        {data.rows.map(r => {
                          const isExpanded = expandedDoc === r.document
                          const details = docDetails[r.document]
                          const isInvoice = r.document.startsWith('I') || r.document.startsWith('فاتورة')
                          const isReceipt = r.document.startsWith('R') || r.document.startsWith('قبض')

                          return (
                            <Fragment key={`${r.document}-${r.line_index}`}>
                              <tr className={`hover:bg-slate-800/50 transition-colors ${isExpanded ? 'bg-sky-950/30' : ''}`}>
                                <td className="py-2.5 px-3 font-mono text-slate-400">{r.day}</td>
                                <td className="py-2.5 px-3 font-mono font-bold text-sky-400">{r.document}</td>
                                <td className="py-2.5 px-3">
                                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                                    isInvoice ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                                    isReceipt ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                    'bg-slate-800 text-slate-300 border border-white/5'
                                  }`}>
                                    {r.document_type || (isInvoice ? 'فاتورة' : isReceipt ? 'سند قبض' : 'قيد')}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-slate-300 max-w-xs">
                                  <div className="truncate">{r.description || '—'}</div>
                                  {r.original_currency && r.original_currency !== 'NIS' && (
                                    <div className="text-[10px] text-amber-400 mt-0.5 font-mono">
                                      (العملة الأصلية: {money(r.original_amount || 0)} {r.original_currency} @ صرف: {r.exchange_rate})
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-left font-mono font-bold text-rose-400">
                                  {r.debit > 0 ? money(r.debit) : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-left font-mono font-bold text-emerald-400">
                                  {r.credit > 0 ? money(r.credit) : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-left font-mono font-black text-white">
                                  {money(r.running_balance)}
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <button
                                    type="button"
                                    onClick={() => toggleDocDetails(r.document)}
                                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition ${
                                      isExpanded
                                        ? 'bg-sky-500 text-slate-950'
                                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10'
                                    }`}
                                  >
                                    {isExpanded ? '▲ إخفاء' : '▼ بنود'}
                                  </button>
                                </td>
                              </tr>

                              {isExpanded && (
                                <tr className="bg-slate-950/60 border-b-2 border-sky-500/30">
                                  <td colSpan={8} className="p-3">
                                    {loadingDocDetails === r.document ? (
                                      <div className="py-2 text-center text-xs text-sky-400 font-bold animate-pulse">
                                        جاري جلب تفاصيل المستند...
                                      </div>
                                    ) : details ? (
                                      <div className="space-y-3 bg-slate-900 p-3 rounded-lg border border-white/10 text-xs text-white">
                                        {details.items && details.items.length > 0 && (
                                          <div>
                                            <div className="font-bold text-slate-300 mb-1.5">📦 بنود الفاتورة ({details.items.length} صنف):</div>
                                            <table className="w-full text-right text-[11px] border border-white/10 rounded">
                                              <thead className="bg-slate-800/80 text-slate-400">
                                                <tr>
                                                  <th className="p-1.5">كود الصنف</th>
                                                  <th className="p-1.5">اسم الصنف</th>
                                                  <th className="p-1.5 text-center">الكمية</th>
                                                  <th className="p-1.5 text-left">السعر</th>
                                                  <th className="p-1.5 text-left">الإجمالي</th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y divide-white/5 text-slate-200">
                                                {details.items.map((it, idx) => (
                                                  <tr key={idx}>
                                                    <td className="p-1.5 font-mono text-sky-400">{it.item_code}</td>
                                                    <td className="p-1.5 font-bold text-white">{it.item_name}</td>
                                                    <td className="p-1.5 text-center font-mono">{it.quantity}</td>
                                                    <td className="p-1.5 text-left font-mono">{money(it.price)}</td>
                                                    <td className="p-1.5 text-left font-mono font-bold text-sky-300">{money(it.total)}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}

                                        {details.cheques && details.cheques.length > 0 && (
                                          <div>
                                            <div className="font-bold text-slate-300 mb-1.5">🏦 شيكات تابعة للسند:</div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                              {details.cheques.map((c, idx) => (
                                                <div key={idx} className="p-2 bg-slate-800/60 rounded border border-white/10 flex justify-between items-center text-xs">
                                                  <div>
                                                    <span className="font-bold text-white font-mono">{c.cheque_number}</span>
                                                    <span className="text-slate-400 mr-2">{c.bank_name || 'بنك'}</span>
                                                  </div>
                                                  <span className="font-mono font-bold text-sky-400">{money(c.amount)} {c.currency}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}

                                        {!details.items?.length && !details.cheques?.length && (
                                          <div className="text-slate-500 text-center py-1 text-xs">
                                            لا توجد تفاصيل إضافية لهذا السند.
                                          </div>
                                        )}
                                      </div>
                                    ) : null}
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
            )}

            {/* View 2: Cheques */}
            {viewTab === 'cheques' && (
              <div className="border border-white/10 rounded-xl overflow-hidden shadow-xl bg-slate-900">
                {data.cheques.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs">
                    لا توجد شيكات مرتبطة بهذا الزبون في مستودع الشامل.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-slate-800/60 text-slate-400 border-b border-white/10">
                        <tr>
                          <th className="py-3 px-3.5 font-bold">السند</th>
                          <th className="py-3 px-3.5 font-bold">رقم الشيك</th>
                          <th className="py-3 px-3.5 font-bold">البنك والفرع</th>
                          <th className="py-3 px-3.5 font-bold">تاريخ الاستحقاق</th>
                          <th className="py-3 px-3.5 font-bold text-left">المبلغ</th>
                          <th className="py-3 px-3.5 font-bold">الحالة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-slate-200">
                        {data.cheques.map(c => (
                          <tr key={c.id} className="hover:bg-slate-800/50">
                            <td className="py-2.5 px-3.5 font-mono font-bold text-slate-400">{c.document}</td>
                            <td className="py-2.5 px-3.5 font-mono font-black text-sky-400">{c.cheque_number}</td>
                            <td className="py-2.5 px-3.5 text-slate-300">
                              <div>{c.bank_name || PALESTINIAN_BANKS[c.bank_code] || `بنك (${c.bank_code})`}</div>
                              {c.branch_code && <div className="text-[10px] text-slate-500">فرع: {c.branch_code}</div>}
                            </td>
                            <td className="py-2.5 px-3.5 font-mono text-slate-400">
                              {c.due_date ? new Date(c.due_date).toLocaleDateString('ar-u-nu-latn') : '—'}
                            </td>
                            <td className="py-2.5 px-3.5 text-left font-mono font-black text-white">
                              {money(c.amount)} {c.currency}
                            </td>
                            <td className="py-2.5 px-3.5">
                              <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold border ${
                                c.status === 'collected' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                c.status === 'bounced' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                                c.status === 'endorsed' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                                'bg-sky-500/10 text-sky-400 border-sky-500/20'
                              }`}>
                                {c.status_name}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
