'use client'

import { useState } from 'react'
import Link from 'next/link'
import PrintButton from '@/components/dashboard/PrintButton'
import ReceiptAttachments from '@/components/dashboard/receipts/ReceiptAttachments'

interface Props {
  store: {
    id: string
    name: string
    phone?: string | null
    address?: string | null
    tax_number?: string | null
    logo_url?: string | null
    currency_code?: string | null
  }
  voucher: any
  customer?: any
  checks: any[]
  amount: number
  currency: string
  tafqeetText: string
  paymentMethodLabel: Record<string, string>
  canManageFiles: boolean
  storeId: string
}

export default function ReceiptPrintClient({
  store,
  voucher,
  customer,
  checks,
  amount,
  currency,
  tafqeetText,
  paymentMethodLabel,
  canManageFiles,
  storeId,
}: Props) {
  const [layout, setLayout] = useState<'thermal' | 'a4'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('bazarko_voucher_print_layout') as 'thermal' | 'a4') || 'thermal'
    }
    return 'thermal'
  })
  const [printing, setPrinting] = useState(false)

  const toggleLayout = (next: 'thermal' | 'a4') => {
    setLayout(next)
    try {
      localStorage.setItem('bazarko_voucher_print_layout', next)
    } catch {}
  }

  const printThermalReceipt = () => {
    const element = document.getElementById('thermal-voucher-canvas')
    if (!element) {
      window.print()
      return
    }

    let iframe = document.getElementById('pos-thermal-print-iframe') as HTMLIFrameElement | null
    if (!iframe) {
      iframe = document.createElement('iframe')
      iframe.id = 'pos-thermal-print-iframe'
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      iframe.style.visibility = 'hidden'
      document.body.appendChild(iframe)
    }

    const iframeDoc = iframe.contentWindow?.document
    if (!iframeDoc) {
      window.print()
      return
    }

    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map(node => node.outerHTML)
      .join('\n')

    const thermalCss = `
      @page {
        size: 80mm auto;
        margin: 0;
      }
      * {
        box-sizing: border-box;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: 72mm !important;
        max-width: 72mm !important;
        background: #ffffff !important;
        color: #000000 !important;
        direction: rtl !important;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 11px;
        line-height: 1.35;
      }
      #thermal-voucher-canvas {
        width: 68mm !important;
        max-width: 68mm !important;
        margin: 0 auto !important;
        padding: 1mm 2mm 2mm 5mm !important;
        box-shadow: none !important;
        border: none !important;
        box-sizing: border-box !important;
      }
      .print\\:hidden, .no-print {
        display: none !important;
      }
    `

    iframeDoc.open()
    iframeDoc.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8" />
          <title>سند قبض - ${voucher.voucher_number}</title>
          ${styles}
          <style>${thermalCss}</style>
        </head>
        <body>
          ${element.outerHTML}
        </body>
      </html>
    `)
    iframeDoc.close()

    setTimeout(() => {
      try {
        iframe?.contentWindow?.focus()
        iframe?.contentWindow?.print()
      } catch (e) {
        console.error('Thermal print error:', e)
        window.print()
      }
    }, 250)
  }

  const handlePrint = () => {
    if (layout === 'thermal') {
      printThermalReceipt()
    } else {
      window.print()
    }
  }

  const voucherDate = new Date(voucher.date)
  const dateStr = voucherDate.toLocaleDateString('ar-u-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const timeStr = new Date(voucher.created_at || voucher.date).toLocaleTimeString('ar-u-nu-latn', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="min-h-screen bg-slate-100 p-3 sm:p-6 text-slate-900 font-sans print:p-0 print:bg-white" dir="rtl">
      {/* ── Top Navigation & Toolbar ── */}
      <div className="mx-auto mb-6 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900 p-4 text-white shadow-xl print:hidden">
        <Link
          href="/dashboard/accounting/receipts"
          className="text-xs font-bold text-slate-300 hover:text-white transition flex items-center gap-1.5"
        >
          <span>←</span> العودة لسندات القبض
        </Link>

        {/* Layout Switcher */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-slate-800 p-1 text-xs">
            <button
              type="button"
              onClick={() => toggleLayout('thermal')}
              className={`rounded-lg px-3 py-1.5 font-bold transition ${
                layout === 'thermal'
                  ? 'bg-sky-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              ⚡ حراري (80mm)
            </button>
            <button
              type="button"
              onClick={() => toggleLayout('a4')}
              className={`rounded-lg px-3 py-1.5 font-bold transition ${
                layout === 'a4'
                  ? 'bg-sky-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              📄 رسمي (A4)
            </button>
          </div>

          {layout === 'thermal' ? (
            <button
              type="button"
              onClick={handlePrint}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-emerald-400 transition shadow-lg flex items-center gap-1.5"
            >
              <span>🖨️</span> طباعة حرارية فورية
            </button>
          ) : (
            <PrintButton
              elementId="receipt-print-canvas"
              filename={`سند-قبض-${voucher.voucher_number}.pdf`}
              label="🖨️ طباعة السند (A4 / PDF)"
              className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition"
            />
          )}
        </div>
      </div>

      {canManageFiles && (
        <div className="mx-auto max-w-3xl mb-6 print:hidden">
          <ReceiptAttachments storeId={storeId} voucherId={voucher.id} />
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 1. THERMAL RECEIPT VIEW (80mm / POS Format)                            */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {layout === 'thermal' && (
        <div className="flex justify-center">
          <div
            id="thermal-voucher-canvas"
            className="w-[74mm] max-w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-black shadow-md print:w-[68mm] print:border-none print:p-0 print:shadow-none"
          >
            {/* Store Header */}
            <div className="text-center border-b-2 border-dashed border-black pb-2.5">
              <h1 className="text-lg font-black tracking-tight">{store.name}</h1>
              {store.address && (
                <p className="text-[11px] font-sans mt-0.5 text-neutral-700">{store.address}</p>
              )}
              {store.phone && (
                <p className="text-[11px] font-sans text-neutral-700">هاتف: <span dir="ltr">{store.phone}</span></p>
              )}
              {store.tax_number && (
                <p className="text-[10px] font-sans text-neutral-600">الرقم الضريبي: {store.tax_number}</p>
              )}
              <div className="mt-2 inline-block rounded border border-black px-3 py-0.5 text-xs font-black tracking-wider">
                سند قبض مالي (Receipt Voucher)
              </div>
            </div>

            {/* Voucher Metadata */}
            <div className="border-b border-dashed border-black py-2 text-xs leading-relaxed">
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', direction: 'rtl' }}>
                <tbody>
                  <tr>
                    <td style={{ textAlign: 'right', padding: '1.5px 0' }} className="text-neutral-700">رقم السند:</td>
                    <td style={{ textAlign: 'left', padding: '1.5px 0 1.5px 4px' }} className="font-bold font-mono" dir="ltr">{voucher.voucher_number}</td>
                  </tr>
                  <tr>
                    <td style={{ textAlign: 'right', padding: '1.5px 0' }} className="text-neutral-700">التاريخ:</td>
                    <td style={{ textAlign: 'left', padding: '1.5px 0 1.5px 4px' }}>{dateStr}</td>
                  </tr>
                  <tr>
                    <td style={{ textAlign: 'right', padding: '1.5px 0' }} className="text-neutral-700">الوقت:</td>
                    <td style={{ textAlign: 'left', padding: '1.5px 0 1.5px 4px' }} dir="ltr">{timeStr}</td>
                  </tr>
                  <tr style={{ borderTop: '1px dotted #9ca3af' }}>
                    <td style={{ textAlign: 'right', padding: '3px 0 1.5px' }} className="text-neutral-700">المستلم منه:</td>
                    <td style={{ textAlign: 'left', padding: '3px 0 1.5px 4px' }} className="font-bold">
                      {voucher.party_name || customer?.name || 'مقبوض عام / نقدي'}
                    </td>
                  </tr>
                  {customer?.phone && (
                    <tr>
                      <td style={{ textAlign: 'right', padding: '1.5px 0' }} className="text-neutral-700">هاتف العميل:</td>
                      <td style={{ textAlign: 'left', padding: '1.5px 0 1.5px 4px' }} dir="ltr">{customer.phone}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Amount Box — أبرز عنصر في سند القبض */}
            <div className="my-2.5 rounded-lg border-2 border-black bg-neutral-50 p-2.5 text-center text-black">
              <span className="block text-[11px] font-black text-neutral-700 mb-0.5">المبلغ المقبوض:</span>
              <div className="text-xl font-black font-mono tracking-tight" dir="ltr">
                {amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
              </div>
              <div className="mt-1.5 pt-1.5 border-t border-dotted border-black/40 text-[10px] font-sans font-bold leading-relaxed text-neutral-800">
                فقط: {tafqeetText}
              </div>
            </div>

            {/* Payment Method Details */}
            <div className="border-b border-dashed border-black py-2 text-xs leading-relaxed">
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', direction: 'rtl' }}>
                <tbody>
                  <tr>
                    <td style={{ textAlign: 'right', padding: '1.5px 0' }} className="text-neutral-700">طريقة القبض:</td>
                    <td style={{ textAlign: 'left', padding: '1.5px 0 1.5px 4px' }} className="font-bold">
                      {paymentMethodLabel[voucher.payment_method] || voucher.payment_method}
                    </td>
                  </tr>
                  {voucher.cash_amount > 0 && voucher.payment_method === 'split' && (
                    <tr>
                      <td style={{ textAlign: 'right', padding: '1.5px 0' }} className="text-neutral-700">الجزء النقدي:</td>
                      <td style={{ textAlign: 'left', padding: '1.5px 0 1.5px 4px' }} className="font-bold" dir="ltr">
                        {Number(voucher.cash_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {currency}
                      </td>
                    </tr>
                  )}
                  {voucher.invoices?.invoice_number && (
                    <tr>
                      <td style={{ textAlign: 'right', padding: '1.5px 0' }} className="text-neutral-700">الفاتورة المسددة:</td>
                      <td style={{ textAlign: 'left', padding: '1.5px 0 1.5px 4px' }} className="font-bold" dir="ltr">
                        {voucher.invoices.invoice_number}
                      </td>
                    </tr>
                  )}
                  {voucher.reference && (
                    <tr>
                      <td style={{ textAlign: 'right', padding: '1.5px 0' }} className="text-neutral-700">رقم المرجع:</td>
                      <td style={{ textAlign: 'left', padding: '1.5px 0 1.5px 4px' }} dir="ltr">{voucher.reference}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Cheques Table if Cheque or Split */}
            {checks.length > 0 && (
              <div className="py-2 border-b border-dashed border-black">
                <p className="text-[11px] font-black mb-1.5">بيانات الشيكات المقبوضة ({checks.length}):</p>
                <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', direction: 'rtl', fontSize: '10px' }}>
                  <thead>
                    <tr className="border-b border-black font-bold">
                      <th style={{ textAlign: 'right', width: '30%', paddingBottom: '2px' }}>رقم الشيك</th>
                      <th style={{ textAlign: 'right', width: '35%', paddingBottom: '2px' }}>البنك / الفرع</th>
                      <th style={{ textAlign: 'left', width: '35%', paddingBottom: '2px', paddingLeft: '4px' }}>المبلغ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dotted divide-neutral-300">
                    {checks.map((chk: any, idx: number) => (
                      <tr key={idx}>
                        <td style={{ textAlign: 'right', padding: '3px 0' }} dir="ltr">{chk.check_number}</td>
                        <td style={{ textAlign: 'right', padding: '3px 0' }}>{chk.bank_name}</td>
                        <td style={{ textAlign: 'left', padding: '3px 0 3px 4px' }} className="font-bold" dir="ltr">
                          {Number(chk.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Description / Notes */}
            {voucher.description && (
              <div className="py-2 border-b border-dashed border-black text-xs leading-relaxed">
                <span className="font-bold text-neutral-700 block text-[10px]">البيان (وذلك لقاء):</span>
                <p className="mt-0.5 text-neutral-900 font-sans">{voucher.description}</p>
              </div>
            )}

            {/* Signatures */}
            <div className="pt-4 pb-2 border-b border-dashed border-black text-center text-[10px]">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-neutral-600 mb-6">أمين الصندوق / المستلم</p>
                  <p className="border-t border-dotted border-black pt-1">التوقيع والختم</p>
                </div>
                <div>
                  <p className="text-neutral-600 mb-6">المسلّم / العميل</p>
                  <p className="border-t border-dotted border-black pt-1">التوقيع</p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-2 text-center text-[9px] text-neutral-500">
              <p>سند رسمي صادر عبر نظام بازاركو (Bazarko POS)</p>
              <p className="font-mono mt-0.5">#{voucher.voucher_number}</p>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 2. OFFICIAL A4 PAPER CANVAS                                            */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {layout === 'a4' && (
        <div id="receipt-print-canvas" className="mx-auto max-w-3xl rounded-2xl border-2 border-slate-900 bg-white p-8 shadow-md print:border-none print:shadow-none print:p-4">
          {/* Header */}
          <div className="flex items-start justify-between border-b-2 border-slate-900 pb-5">
            <div className="flex items-center gap-4">
              {store.logo_url && (
                <img
                  src={store.logo_url}
                  alt={store.name}
                  className="h-16 w-16 rounded-xl object-contain border border-slate-200"
                />
              )}
              <div>
                <h1 className="text-2xl font-black text-slate-950">{store.name}</h1>
                <p className="text-xs text-slate-600 mt-0.5">{store.address || 'فلسطين'}</p>
                {store.phone && <p className="text-xs text-slate-600">هاتف: {store.phone}</p>}
              </div>
            </div>

            <div className="text-center">
              <h2 className="text-xl font-black text-emerald-900 border-2 border-emerald-900 px-6 py-1.5 rounded-xl inline-block bg-emerald-50">
                سند قبض مالي (Receipt Voucher)
              </h2>
              <p className="mt-1 font-mono text-sm font-bold text-slate-900" dir="ltr">
                No: {voucher.voucher_number}
              </p>
            </div>

            <div className="text-left text-xs space-y-1 font-mono">
              <div>التاريخ: <strong className="text-slate-900">{new Date(voucher.date).toLocaleDateString('en-GB')}</strong></div>
              <div>الوقت: <strong className="text-slate-900">{new Date(voucher.created_at || voucher.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</strong></div>
            </div>
          </div>

          {voucher.bank_accounts && (
            <p className="mx-auto max-w-3xl mb-4 rounded-xl bg-sky-50 p-4 text-sm mt-4">
              الحساب البنكي: {voucher.bank_accounts.bank_name} — {voucher.bank_accounts.account_number} · مرجع التحويل: {voucher.reference}
            </p>
          )}

          {/* Voucher Body */}
          <div className="my-6 space-y-4 text-sm">
            {/* Received From */}
            <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
              <span className="font-bold text-slate-700 min-w-36">وصلنا من السيد / السادة:</span>
              <span className="flex-1 font-bold text-base text-slate-950 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                {voucher.party_name || customer?.name || 'مقبوض عام / نقدي'}
              </span>
            </div>

            {/* Amount Number & Currency */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
                <span className="font-bold text-slate-700 min-w-36">مبلغاً وقدره بالأرقام:</span>
                <span className="font-mono font-black text-lg text-emerald-900 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200" dir="ltr">
                  {amount.toLocaleString('en-GB', { minimumFractionDigits: 2 })} {currency}
                </span>
              </div>

              <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
                <span className="font-bold text-slate-700">طريقة الدفع والقبض:</span>
                <span className="font-bold text-slate-900 bg-slate-50 px-3 py-1 rounded-lg border border-slate-200">
                  {paymentMethodLabel[voucher.payment_method] || voucher.payment_method}
                </span>
              </div>
            </div>

            {/* Breakdown for Cash & Cheques if Split or Cheque */}
            {(voucher.payment_method === 'split' || voucher.payment_method === 'cheque') && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <h4 className="text-xs font-black text-slate-800 border-b border-slate-200 pb-1.5">
                  تفاصيل وسائل القبض المرفقة بالسند:
                </h4>

                {voucher.cash_amount > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-700">المبلغ المقبوض نقداً:</span>
                    <span className="font-mono font-bold text-slate-950" dir="ltr">
                      {Number(voucher.cash_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {currency}
                    </span>
                  </div>
                )}

                {checks.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="font-bold text-xs text-slate-700 block">بيانات الشيكات:</span>
                    <table className="w-full text-right text-xs border border-slate-200 bg-white">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                          <th className="p-1.5">رقم الشيك</th>
                          <th className="p-1.5">البنك والفرع</th>
                          <th className="p-1.5">كود البنك / الفرع</th>
                          <th className="p-1.5">تاريخ الاستحقاق</th>
                          <th className="p-1.5">الساحب</th>
                          <th className="p-1.5 text-left">المبلغ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {checks.map((chk: any, idx: number) => (
                          <tr key={idx}>
                            <td className="p-1.5 font-bold" dir="ltr">{chk.check_number}</td>
                            <td className="p-1.5 font-sans">
                              <span className="font-semibold">{chk.bank_name}</span>
                              {chk.branch_name && <span className="text-slate-500 text-[11px] block">{chk.branch_name}</span>}
                            </td>
                            <td className="p-1.5 font-mono text-[11px]" dir="ltr">
                              {chk.bank_code ? (
                                <span>
                                  {chk.bank_code} {chk.branch_code ? `/ ${chk.branch_code}` : ''}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="p-1.5">{chk.due_date}</td>
                            <td className="p-1.5 font-sans">{chk.drawer_name || '—'}</td>
                            <td className="p-1.5 text-left font-bold" dir="ltr">
                              {Number(chk.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {currency}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Tafqeet Words */}
            <div className="flex items-start gap-3 border-b border-slate-200 pb-3">
              <span className="font-bold text-slate-700 min-w-36 pt-1">المبلغ كتابة بالحروف:</span>
              <span className="flex-1 font-bold text-slate-900 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 leading-relaxed">
                {tafqeetText}
              </span>
            </div>

            {/* Purpose / Description */}
            <div className="flex items-start gap-3 border-b border-slate-200 pb-3">
              <span className="font-bold text-slate-700 min-w-36 pt-1">وذلك لقاء (البيان):</span>
              <span className="flex-1 font-medium text-slate-900 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 min-h-[50px] whitespace-pre-line">
                {voucher.description || '—'}
              </span>
            </div>

            {/* Reference / Category / Linked Invoice */}
            <div className="grid grid-cols-3 gap-4 text-xs">
              {voucher.invoices?.invoice_number ? (
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-bold">الفاتورة المسددة:</span>
                  <span className="font-mono font-bold text-sky-800 bg-sky-50 px-2 py-0.5 rounded border border-sky-200" dir="ltr">
                    {voucher.invoices.invoice_number}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-bold">الربط:</span>
                  <span className="text-slate-600 font-medium">قيد مباشر على كشف الحساب</span>
                </div>
              )}
              {voucher.reference && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-bold">رقم المرجع:</span>
                  <span className="font-mono text-slate-800" dir="ltr">{voucher.reference}</span>
                </div>
              )}
              {voucher.category && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-bold">التصنيف المحاسبي:</span>
                  <span className="text-slate-800 font-semibold">{voucher.category}</span>
                </div>
              )}
            </div>
          </div>

          {/* Official Signatures Box */}
          <div className="mt-14 pt-6 border-t-2 border-slate-900 grid grid-cols-3 gap-6 text-center text-xs font-bold text-slate-800">
            <div>
              <p className="text-slate-500 mb-10">تنظيم المحاسب</p>
              <p className="border-t border-dashed border-slate-400 pt-1">التوقيع</p>
            </div>
            <div>
              <p className="text-slate-500 mb-10">أمين الصندوق / المستلم</p>
              <p className="border-t border-dashed border-slate-400 pt-1">التوقيع</p>
            </div>
            <div>
              <p className="text-slate-500 mb-10">توقيع المسلّم / الدافع</p>
              <p className="border-t border-dashed border-slate-400 pt-1">التوقيع</p>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-8 text-center text-[10px] text-slate-400 border-t border-slate-100 pt-3">
            تم إصدار هذا السند عبر نظام بازاركو (Bazarko Palestine ERP) • تاريخ الطباعة: {new Date().toLocaleDateString('en-GB')}
          </div>
        </div>
      )}
    </div>
  )
}
