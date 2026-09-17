'use client'

import { useState } from 'react'
import { generateAndPrintPdf } from '@/lib/pdf/printPdf'

export interface ReceiptItem {
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface ReceiptData {
  orderId: string
  orderNumber: string
  createdAt: string
  customerName?: string | null
  customerPhone?: string | null
  items: ReceiptItem[]
  subtotal: number
  discountAmount?: number
  totalAmount: number
  amountPaid: number
  paymentMethod: string
  paymentStatus: string
  storeName: string
  storePhone?: string | null
  storeAddress?: string | null
  taxNumber?: string | null
  currencyCode: string
  cashierName?: string
  receiptFooter?: string | null
  customerBalance?: number | null
}

interface Props {
  receipt: ReceiptData
  isOpen: boolean
  onClose: () => void
  onNewSale?: () => void
}

const PAYMENT_METHOD_NAMES: Record<string, { ar: string; en: string }> = {
  cash: { ar: 'نقداً', en: 'Cash' },
  credit: { ar: 'على الحساب (آجل)', en: 'On Account / Credit' },
  check: { ar: 'شيك بنكي', en: 'Cheque' },
  bank_transfer: { ar: 'تحويل بنكي', en: 'Bank Transfer' },
  card: { ar: 'بطاقة دفع / فيزا', en: 'Card' },
  online: { ar: 'دفع إلكتروني', en: 'Online' },
}

export default function PosReceiptModal({ receipt, isOpen, onClose, onNewSale }: Props) {
  const [printLayout, setPrintLayout] = useState<'thermal' | 'a4'>('thermal')
  const [printing, setPrinting] = useState(false)

  if (!isOpen) return null

  const isCash = receipt.paymentMethod === 'cash'
  const isCredit = receipt.paymentMethod === 'credit'
  const isPaid = receipt.paymentStatus === 'paid' || (receipt.amountPaid >= receipt.totalAmount)
  const isPartial = !isPaid && receipt.amountPaid > 0
  const remaining = Math.max(0, receipt.totalAmount - (receipt.amountPaid || 0))
  const changeGiven = isCash && receipt.amountPaid > receipt.totalAmount ? receipt.amountPaid - receipt.totalAmount : 0

  const fmt = (n: number) => Number(n || 0).toLocaleString('ar-u-nu-latn', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  const orderDate = new Date(receipt.createdAt)
  const dateStr = orderDate.toLocaleDateString('ar-u-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const timeStr = orderDate.toLocaleTimeString('ar-u-nu-latn', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const methodInfo = PAYMENT_METHOD_NAMES[receipt.paymentMethod] || {
    ar: receipt.paymentMethod,
    en: receipt.paymentMethod,
  }

  const handlePrint = async () => {
    setPrinting(true)
    try {
      await generateAndPrintPdf({
        elementId: 'pos-receipt-print-area',
        format: printLayout,
        filename: `receipt-${receipt.orderNumber}.pdf`,
        action: 'print',
      })
    } catch (e) {
      console.error(e)
      window.print()
    } finally {
      setPrinting(false)
    }
  }

  const handleDownloadPdf = async () => {
    setPrinting(true)
    try {
      await generateAndPrintPdf({
        elementId: 'pos-receipt-print-area',
        format: printLayout,
        filename: `receipt-${receipt.orderNumber}.pdf`,
        action: 'download',
      })
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 sm:p-4 backdrop-blur-sm print:p-0 print:bg-white print:static print:z-auto">
      {/* Container Dialog */}
      <div className="flex max-h-[95vh] w-full max-w-xl flex-col rounded-2xl border border-white/10 bg-slate-900 shadow-2xl print:max-h-none print:w-full print:border-none print:bg-white print:shadow-none">
        
        {/* Header Toolbar (Hidden when printing) */}
        <div className="flex flex-wrap items-center justify-between border-b border-white/10 px-4 py-3 text-white print:hidden">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">🧾 إيصال نقطة البيع</span>
            <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-400">
              تم بنجاح ✓
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Format toggle */}
            <div className="flex rounded-lg bg-slate-800 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setPrintLayout('thermal')}
                className={`rounded px-2.5 py-1 font-medium transition ${
                  printLayout === 'thermal'
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                حراري (80mm)
              </button>
              <button
                type="button"
                onClick={() => setPrintLayout('a4')}
                className={`rounded px-2.5 py-1 font-medium transition ${
                  printLayout === 'a4'
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                صفحة كاملة (A4)
              </button>
            </div>

            <button
              onClick={handlePrint}
              disabled={printing}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition shadow disabled:opacity-50"
            >
              <span>🖨️</span> {printing ? 'جارٍ الطباعة...' : 'طباعة (PDF)'}
            </button>

            <button
              onClick={handleDownloadPdf}
              disabled={printing}
              title="تنزيل كملف PDF"
              className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 transition"
            >
              ⬇️
            </button>

            {onNewSale && (
              <button
                onClick={onNewSale}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 transition"
              >
                ➕ بيع جديد
              </button>
            )}

            <button
              onClick={onClose}
              className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/5 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Printable Area */}
        <div className="overflow-y-auto p-4 sm:p-6 print:overflow-visible print:p-0">
          <div
            id="pos-receipt-print-area"
            className={`mx-auto bg-white text-black font-mono transition-all ${
              printLayout === 'thermal'
                ? 'w-[80mm] max-w-full p-4 border border-slate-200 shadow-sm rounded-lg print:border-none print:shadow-none print:w-[78mm] print:p-1'
                : 'w-full max-w-2xl p-6 border border-slate-200 shadow-sm rounded-lg print:border-none print:shadow-none print:p-4'
            }`}
          >
            {/* Store Branding Header */}
            <div className="text-center border-b-2 border-dashed border-black pb-3">
              <h1 className="text-xl font-black tracking-tight">{receipt.storeName}</h1>
              {receipt.storeAddress && (
                <p className="text-xs font-sans mt-0.5 text-neutral-700">{receipt.storeAddress}</p>
              )}
              {receipt.storePhone && (
                <p className="text-xs font-sans text-neutral-700">هاتف: <span dir="ltr">{receipt.storePhone}</span></p>
              )}
              {receipt.taxNumber && (
                <p className="text-[11px] font-sans text-neutral-600">الرقم الضريبي: {receipt.taxNumber}</p>
              )}
              <div className="mt-2 inline-block rounded border border-black px-3 py-0.5 text-xs font-bold tracking-wider">
                فاتورة مبيعات نقطة البيع (POS)
              </div>
            </div>

            {/* Receipt Metadata */}
            <div className="border-b border-dashed border-black py-2.5 text-xs leading-relaxed">
              <div className="flex justify-between">
                <span>رقم الفاتورة:</span>
                <span className="font-bold" dir="ltr">{receipt.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>التاريخ:</span>
                <span>{dateStr}</span>
              </div>
              <div className="flex justify-between">
                <span>الوقت:</span>
                <span dir="ltr">{timeStr}</span>
              </div>
              {receipt.cashierName && (
                <div className="flex justify-between">
                  <span>الكاشير:</span>
                  <span>{receipt.cashierName}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-dotted border-gray-400 mt-1 pt-1">
                <span>العميل:</span>
                <span className="font-semibold">
                  {receipt.customerName || (isCredit ? 'عميل على الحساب' : 'زبون نقدي')}
                </span>
              </div>
              {receipt.customerPhone && (
                <div className="flex justify-between">
                  <span>الهاتف:</span>
                  <span dir="ltr">{receipt.customerPhone}</span>
                </div>
              )}
            </div>

            {/* Items Table */}
            <div className="py-2.5 border-b border-dashed border-black text-xs">
              <div className="flex justify-between font-bold border-b border-black pb-1 mb-1">
                <span className="w-1/2 text-right">الصنف</span>
                <span className="w-1/6 text-center">الكمية</span>
                <span className="w-1/6 text-left">السعر</span>
                <span className="w-1/6 text-left">الإجمالي</span>
              </div>
              <div className="space-y-1.5 pt-1">
                {receipt.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-start leading-tight">
                    <span className="w-1/2 text-right font-sans font-medium text-[11px]">
                      {item.name}
                    </span>
                    <span className="w-1/6 text-center font-bold" dir="ltr">
                      {item.quantity}
                    </span>
                    <span className="w-1/6 text-left text-[11px]" dir="ltr">
                      {fmt(item.unitPrice)}
                    </span>
                    <span className="w-1/6 text-left font-bold" dir="ltr">
                      {fmt(item.totalPrice)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Financial Summary */}
            <div className="py-2.5 border-b-2 border-dashed border-black text-xs space-y-1">
              <div className="flex justify-between">
                <span>المجموع الفرعي:</span>
                <span dir="ltr">{fmt(receipt.subtotal)} {receipt.currencyCode}</span>
              </div>
              {Number(receipt.discountAmount || 0) > 0 && (
                <div className="flex justify-between text-neutral-800">
                  <span>الخصم الممنوح:</span>
                  <span dir="ltr">- {fmt(receipt.discountAmount!)} {receipt.currencyCode}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-sm border-t border-black pt-1 mt-1">
                <span>المجموع الإجمالي:</span>
                <span dir="ltr">{fmt(receipt.totalAmount)} {receipt.currencyCode}</span>
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════ */}
            {/* PAYMENT DETAILS SECTION — أبرز وأوضح جزء في الإيصال        */}
            {/* ══════════════════════════════════════════════════════════ */}
            <div className="my-2.5 rounded-lg border-2 border-black bg-neutral-50 p-2.5 text-xs text-black">
              <div className="flex items-center justify-between pb-1 border-b border-black mb-1.5">
                <span className="font-black uppercase tracking-wider">حالة وطريقة الدفع:</span>
                <span className="font-bold text-[11px] underline">
                  {methodInfo.ar} / {methodInfo.en}
                </span>
              </div>

              {/* Cash Paid Badge */}
              {isCash && isPaid && (
                <div className="my-1 rounded bg-black text-white text-center py-1.5 font-black text-sm tracking-wider">
                  ✓ تم الدفع / مدفوعة نقداً (PAID CASH)
                </div>
              )}

              {/* On Account / Credit Badge */}
              {isCredit && (
                <div className="my-1 rounded border-2 border-black bg-white text-center py-1.5 font-black text-sm tracking-wider">
                  ⚠️ على الحساب (غير مدفوعة) / CREDIT ON ACCOUNT
                </div>
              )}

              {/* Other payment methods */}
              {!isCash && !isCredit && (
                <div className="my-1 rounded bg-black text-white text-center py-1 font-black text-sm tracking-wider">
                  ✓ {methodInfo.ar} / {isPaid ? 'PAID' : 'PENDING'}
                </div>
              )}

              {/* Amounts Details */}
              <div className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between font-bold">
                  <span>المبلغ المستلم / المدفوع:</span>
                  <span dir="ltr">{fmt(receipt.amountPaid)} {receipt.currencyCode}</span>
                </div>

                {changeGiven > 0 && (
                  <div className="flex justify-between font-black text-sm text-neutral-900 border-t border-dotted border-black pt-1">
                    <span>الباقي المُعاد للزبون:</span>
                    <span dir="ltr">{fmt(changeGiven)} {receipt.currencyCode}</span>
                  </div>
                )}

                {remaining > 0 && (
                  <div className="flex justify-between font-black text-sm text-black border-t border-dotted border-black pt-1">
                    <span>المتبقي في الذمة:</span>
                    <span dir="ltr">{fmt(remaining)} {receipt.currencyCode}</span>
                  </div>
                )}

                {receipt.customerBalance !== undefined && receipt.customerBalance !== null && (
                  <div className="flex justify-between text-[11px] text-neutral-700 border-t border-neutral-300 pt-0.5">
                    <span>إجمالي رصيد العميل الحالي:</span>
                    <span dir="ltr" className="font-bold">{fmt(receipt.customerBalance)} {receipt.currencyCode}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Barcode & Verification */}
            <div className="py-2 text-center">
              <div className="inline-block py-1">
                {/* Visual Barcode simulation */}
                <div className="flex items-center justify-center gap-0.5 h-8">
                  {[3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1, 3, 2, 4, 1, 2, 3, 1, 2, 4].map((w, idx) => (
                    <div
                      key={idx}
                      className="bg-black h-full"
                      style={{ width: `${w}px` }}
                    />
                  ))}
                </div>
                <p className="font-mono text-[10px] tracking-widest mt-1" dir="ltr">
                  *{receipt.orderNumber}*
                </p>
              </div>
            </div>

            {/* Footer Notice & Return Policy */}
            <div className="border-t-2 border-dashed border-black pt-2 text-center text-[10px] text-neutral-700 space-y-1">
              <p className="font-semibold">{receipt.receiptFooter || 'شكراً لتعاملكم معنا ونسعد بزيارتكم دائماً'}</p>
              <p className="text-[9px]">البضاعة المباعة تستبدل خلال 3 أيام بشرط وجود الفاتورة وبحالتها الأصلية</p>
              <p className="text-[8px] text-neutral-500 font-sans mt-1">نظام Bazarko POS</p>
            </div>
          </div>
        </div>

        {/* Footer Actions (Hidden when printing) */}
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 bg-slate-900/90 rounded-b-2xl print:hidden">
          <div className="text-xs text-slate-400">
            تلميح: اضغط <strong>Ctrl+P</strong> أو زر <strong>طباعة فورية</strong> للطباعة المباشرة على طابعتك الحرارية.
          </div>
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-500 transition shadow-lg"
            >
              🖨️ طباعة الفاتورة
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition"
            >
              إغلاق
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
