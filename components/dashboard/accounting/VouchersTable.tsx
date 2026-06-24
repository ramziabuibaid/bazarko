'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { recordAuditEvent } from '@/app/dashboard/accounting/audit-actions'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/Confirm'

interface Customer {
  id: string
  name: string
  phone: string | null
}

interface Voucher {
  id: string
  voucher_number: string
  type: string
  date: string
  amount: number
  party_name: string | null
  customer_id: string | null
  payment_method: string
  category: string | null
  description: string
  reference: string | null
}

interface Props {
  vouchers: Voucher[]
  type: 'receipt' | 'payment'
  storeId: string
  userId: string
  currencyCode: string
  customers: Customer[]
  storeName?: string
  storePhone?: string
}

const PAYMENT_METHODS = [
  { value: 'cash',     label: 'نقداً' },
  { value: 'bank',     label: 'تحويل بنكي' },
  { value: 'card',     label: 'بطاقة' },
  { value: 'transfer', label: 'تحويل إلكتروني' },
]

const RECEIPT_CATEGORIES = ['مبيعات', 'دفعة زبون', 'استرداد', 'إيرادات أخرى']
const PAYMENT_CATEGORIES = ['مشتريات', 'إيجار', 'رواتب', 'مصاريف تشغيل', 'فواتير', 'توصيل', 'تسويق', 'أخرى']

// ── تنسيق المبلغ أثناء الكتابة ────────────────────────────────

function formatAmountInput(val: string): { raw: string; display: string } {
  // إزالة الفواصل والأحرف غير الرقمية ما عدا النقطة
  const cleaned = val.replace(/,/g, '').replace(/[^\d.]/g, '')
  // منع أكثر من نقطة عشرية واحدة
  const dot     = cleaned.indexOf('.')
  const norm    = dot >= 0
    ? cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '')
    : cleaned
  // إضافة فواصل الآلاف
  const [intPart, decPart] = norm.split('.')
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const display = decPart !== undefined ? `${intFormatted}.${decPart.slice(0, 2)}` : intFormatted
  return { raw: norm, display }
}

// ── المكوّن ───────────────────────────────────────────────────

export default function VouchersTable({ vouchers, type, storeId, userId, currencyCode, customers, storeName, storePhone }: Props) {
  const router   = useRouter()
  const supabase = createClient()
  const toast    = useToast()
  const confirm  = useConfirm()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [showModal, setShowModal]           = useState(false)
  const [date, setDate]                     = useState(new Date().toISOString().slice(0, 10))
  const [amountRaw, setAmountRaw]           = useState('')
  const [amountDisplay, setAmountDisplay]   = useState('')
  const [paymentMethod, setPaymentMethod]   = useState('cash')
  const [category, setCategory]             = useState('')
  const [description, setDescription]       = useState('')
  const [reference, setReference]           = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [partyName, setPartyName]           = useState('')
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState('')

  const categories  = type === 'receipt' ? RECEIPT_CATEGORIES : PAYMENT_CATEGORIES
  const fmt         = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })
  const totalAmount = vouchers.reduce((s, v) => s + v.amount, 0)
  const isReceipt   = type === 'receipt'
  const icon        = isReceipt ? '💵' : '💸'

  function handleAmountChange(val: string) {
    const { raw, display } = formatAmountInput(val)
    setAmountRaw(raw)
    setAmountDisplay(display)
  }

  function resetForm() {
    setDate(new Date().toISOString().slice(0, 10))
    setAmountRaw(''); setAmountDisplay('')
    setPaymentMethod('cash'); setCategory('')
    setDescription(''); setReference('')
    setSelectedCustomer(''); setPartyName('')
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const amt = parseFloat(amountRaw)
    if (!amt || amt <= 0) { setError('أدخل مبلغاً موجباً وصحيحاً'); return }
    if (!description.trim()) { setError('الوصف / السبب مطلوب'); return }

    setSaving(true); setError('')

    const { count } = await supabase
      .from('vouchers')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('type', type)

    const prefix        = isReceipt ? 'RCP' : 'PMT'
    const voucherNumber = `${prefix}-${String((count ?? 0) + 1).padStart(4, '0')}`
    const customer      = customers.find(c => c.id === selectedCustomer)

    const { error: err } = await supabase.from('vouchers').insert({
      store_id:       storeId,
      voucher_number: voucherNumber,
      type,
      date,
      amount:         amt,
      customer_id:    selectedCustomer || null,
      party_name:     (customer?.name ?? partyName.trim()) || null,
      payment_method: paymentMethod,
      category:       category || null,
      description:    description.trim(),
      reference:      reference.trim() || null,
      created_by:     userId,
    })

    setSaving(false)
    if (err) { setError('حدث خطأ أثناء الحفظ'); return }

    await recordAuditEvent({
      entityType: 'voucher', entityLabel: voucherNumber,
      action: 'create',
      details: { type, amount: amt, party: (customer?.name ?? partyName.trim()) || null, method: paymentMethod },
    })

    setShowModal(false)
    resetForm()
    toast(`تم حفظ سند ${isReceipt ? 'القبض' : 'الصرف'} ${voucherNumber} بنجاح`)
    router.refresh()
  }

  // ── حذف سند (مع تأكيد) ────────────────────────────────────────
  async function handleDelete(v: Voucher) {
    const ok = await confirm({
      title: `حذف سند ${isReceipt ? 'القبض' : 'الصرف'}`,
      message: `هل تريد حذف السند ${v.voucher_number} بمبلغ ${fmt(v.amount)} ${currencyCode}؟ سيُعكَس أثره على رصيد الصندوق ولا يمكن التراجع.`,
      confirmLabel: 'حذف نهائي',
      danger: true,
    })
    if (!ok) return
    setDeletingId(v.id)
    const { error: err } = await supabase.from('vouchers').delete().eq('id', v.id)
    setDeletingId(null)
    if (err) { toast('تعذّر حذف السند', 'error'); return }
    await recordAuditEvent({
      entityType: 'voucher', entityLabel: v.voucher_number,
      action: 'delete', details: { type: v.type, amount: v.amount },
    })
    toast(`تم حذف السند ${v.voucher_number}`)
    router.refresh()
  }

  // ── رقم هاتف الجهة (للواتساب) ─────────────────────────────────
  function partyPhone(v: Voucher): string | null {
    const c = customers.find(x => x.id === v.customer_id)
    return c?.phone ? c.phone.replace(/[^\d]/g, '') : null
  }

  // ── مشاركة السند عبر واتساب ────────────────────────────────────
  function shareWhatsApp(v: Voucher) {
    const phone = partyPhone(v)
    if (!phone) { toast('لا يوجد رقم هاتف مسجّل لهذه الجهة', 'error'); return }
    const head = isReceipt ? 'سند قبض' : 'سند صرف'
    const msg =
      `*${storeName ?? ''}*\n` +
      `${head}: ${v.voucher_number}\n` +
      `التاريخ: ${new Date(v.date).toLocaleDateString('ar-u-nu-latn')}\n` +
      `المبلغ: ${fmt(v.amount)} ${currencyCode}\n` +
      `بخصوص: ${v.description}` +
      (isReceipt ? '\n\nشكراً لتعاملكم معنا 🌟' : '')
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  // ── طباعة السند (نافذة مستقلة → PDF) ──────────────────────────
  function printVoucher(v: Voucher) {
    const w = window.open('', '_blank', 'width=460,height=640')
    if (!w) { toast('فضلاً اسمح بالنوافذ المنبثقة للطباعة', 'error'); return }
    const methodLabel = PAYMENT_METHODS.find(m => m.value === v.payment_method)?.label ?? v.payment_method
    const head = isReceipt ? 'سند قبض' : 'سند صرف'
    const partyLabel = isReceipt ? 'استلمنا من' : 'صرفنا إلى'
    const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
      <title>${esc(v.voucher_number)}</title>
      <style>
        *{box-sizing:border-box;font-family:'Segoe UI',Tahoma,Arial,sans-serif}
        body{margin:0;padding:28px;color:#0f172a}
        .card{border:2px solid #0f172a;border-radius:14px;padding:24px;max-width:400px;margin:0 auto}
        .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px dashed #cbd5e1;padding-bottom:14px;margin-bottom:14px}
        .store{font-size:18px;font-weight:700}
        .phone{font-size:12px;color:#64748b;direction:ltr;text-align:left}
        .badge{background:${isReceipt ? '#dcfce7' : '#fee2e2'};color:${isReceipt ? '#166534' : '#991b1b'};border-radius:8px;padding:4px 10px;font-size:12px;font-weight:700}
        .num{font-family:monospace;color:#0369a1;direction:ltr}
        .row{display:flex;justify-content:space-between;font-size:13px;margin:8px 0}
        .label{color:#64748b}
        .amount{text-align:center;margin:18px 0;padding:14px;background:#f1f5f9;border-radius:10px}
        .amount .v{font-size:26px;font-weight:800;direction:ltr}
        .desc{font-size:13px;background:#f8fafc;border-radius:8px;padding:10px;margin-top:10px}
        .sign{display:flex;justify-content:space-between;margin-top:32px;font-size:12px;color:#64748b}
        .sign div{border-top:1px solid #94a3b8;padding-top:6px;width:40%;text-align:center}
        @media print{body{padding:0}}
      </style></head><body>
      <div class="card">
        <div class="head">
          <div><div class="store">${esc(storeName ?? 'المتجر')}</div>
          ${storePhone ? `<div class="phone">${esc(storePhone)}</div>` : ''}</div>
          <div class="badge">${head}</div>
        </div>
        <div class="row"><span class="label">رقم السند</span><span class="num">${esc(v.voucher_number)}</span></div>
        <div class="row"><span class="label">التاريخ</span><span>${new Date(v.date).toLocaleDateString('ar-u-nu-latn')}</span></div>
        <div class="row"><span class="label">${partyLabel}</span><span>${esc(v.party_name ?? '—')}</span></div>
        <div class="row"><span class="label">طريقة الدفع</span><span>${esc(methodLabel)}</span></div>
        ${v.category ? `<div class="row"><span class="label">التصنيف</span><span>${esc(v.category)}</span></div>` : ''}
        <div class="amount"><div class="label" style="font-size:12px">المبلغ</div><div class="v">${fmt(v.amount)} ${esc(currencyCode)}</div></div>
        <div class="desc"><b>بخصوص:</b> ${esc(v.description)}</div>
        ${v.reference ? `<div class="row" style="margin-top:10px"><span class="label">مرجع</span><span class="num">${esc(v.reference)}</span></div>` : ''}
        <div class="sign"><div>توقيع المستلم</div><div>توقيع المسؤول</div></div>
      </div>
      <script>window.onload=function(){window.print()}</script>
      </body></html>`)
    w.document.close()
  }

  // ── تصدير Excel (CSV بترميز UTF-8) ────────────────────────────
  function exportExcel() {
    if (vouchers.length === 0) { toast('لا توجد بيانات للتصدير', 'error'); return }
    const headers = ['رقم السند', 'التاريخ', isReceipt ? 'مصدر القبض' : 'الجهة', 'الوصف', 'التصنيف', 'طريقة الدفع', 'المبلغ', 'مرجع']
    const cell = (s: string | number | null) => `"${String(s ?? '').replace(/"/g, '""')}"`
    const rows = vouchers.map(v => [
      v.voucher_number, v.date, v.party_name ?? '', v.description, v.category ?? '',
      PAYMENT_METHODS.find(m => m.value === v.payment_method)?.label ?? v.payment_method,
      v.amount, v.reference ?? '',
    ].map(cell).join(','))
    const csv = '﻿' + [headers.map(cell).join(','), ...rows].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${isReceipt ? 'receipts' : 'payments'}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast('تم تصدير الملف بنجاح')
  }

  return (
    <div className="space-y-5">

      {/* رأس */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">{icon} إجمالي {isReceipt ? 'المقبوضات' : 'المدفوعات'}</p>
          <p className={`text-2xl font-bold tabular-nums ${isReceipt ? 'text-sky-400' : 'text-red-400'}`} dir="ltr">
            {fmt(totalAmount)} {currencyCode}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportExcel}
            className="rounded-xl border border-white/10 px-3 py-2.5 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10"
          >
            ⬇️ تصدير Excel
          </button>
          <button
            onClick={() => setShowModal(true)}
            className={`rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-colors ${
              isReceipt ? 'bg-sky-600 hover:bg-sky-500' : 'bg-red-700 hover:bg-red-600'
            }`}
          >
            ➕ سند {isReceipt ? 'قبض' : 'صرف'} جديد
          </button>
        </div>
      </div>

      {/* الجدول */}
      {vouchers.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-slate-900 py-16 text-center">
          <p className="text-4xl">{icon}</p>
          <p className="mt-3 text-slate-300 font-medium">لا توجد سندات مسجّلة</p>
          <p className="mt-1 text-sm text-slate-500">ابدأ بتسجيل أول سند {isReceipt ? 'قبض' : 'صرف'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/5">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-slate-900">
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">رقم السند</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">التاريخ</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">
                  {isReceipt ? 'مصدر القبض' : 'الجهة'}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الوصف</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">التصنيف</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">طريقة الدفع</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">المبلغ</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-slate-900/60">
              {vouchers.map((v: Voucher) => (
                <tr key={v.id} className="transition-colors hover:bg-white/[0.03]">
                  <td className="px-4 py-3 font-mono text-xs text-slate-400" dir="ltr">{v.voucher_number}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {new Date(v.date).toLocaleDateString('ar-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-sm text-white">{v.party_name ?? '—'}</td>
                  <td className="max-w-[180px] truncate px-4 py-3 text-sm text-slate-300">{v.description}</td>
                  <td className="px-4 py-3">
                    {v.category && (
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-400">{v.category}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-slate-400">
                    {PAYMENT_METHODS.find(m => m.value === v.payment_method)?.label ?? v.payment_method}
                  </td>
                  <td className="px-4 py-3 text-left">
                    <span
                      className={`whitespace-nowrap font-bold tabular-nums ${isReceipt ? 'text-emerald-400' : 'text-red-400'}`}
                      dir="ltr"
                    >
                      {isReceipt ? '+' : '−'}{fmt(v.amount)} {currencyCode}
                    </span>
                    {v.reference && <p className="text-xs text-slate-600" dir="ltr">{v.reference}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => printVoucher(v)} title="طباعة السند"
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white">🖨️</button>
                      {partyPhone(v) && (
                        <button onClick={() => shareWhatsApp(v)} title="إرسال عبر واتساب"
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-400">📲</button>
                      )}
                      <button onClick={() => handleDelete(v)} disabled={deletingId === v.id} title="حذف السند"
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40">🗑️</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal إضافة سند ── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          onClick={() => { setShowModal(false); resetForm() }}
        >
          <div
            className="w-full max-h-[90vh] overflow-y-auto rounded-t-2xl border border-white/10 bg-slate-900 p-6 sm:max-w-md sm:rounded-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="mb-5 text-lg font-semibold text-white">
              {icon} سند {isReceipt ? 'قبض' : 'صرف'} جديد
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">

              {/* التاريخ — سطر مستقل */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">التاريخ *</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  required
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-sky-500/50 [color-scheme:dark]"
                />
              </div>

              {/* المبلغ — سطر مستقل مع العملة داخل الحقل */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">المبلغ *</label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amountDisplay}
                    onChange={e => handleAmountChange(e.target.value)}
                    placeholder="0"
                    dir="ltr"
                    required
                    className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-4 pr-16 text-left text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                    {currencyCode}
                  </span>
                </div>
                {amountRaw && parseFloat(amountRaw) > 0 && (
                  <p className="mt-1 text-xs text-slate-500" dir="ltr">
                    = {parseFloat(amountRaw).toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })} {currencyCode}
                  </p>
                )}
              </div>

              {/* مصدر القبض / الجهة المدفوع لها */}
              {isReceipt ? (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">مصدر القبض</label>
                  <select
                    value={selectedCustomer}
                    onChange={e => setSelectedCustomer(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-3 text-sm text-white outline-none focus:border-sky-500/50"
                  >
                    <option value="">اختر زبوناً من القائمة...</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {!selectedCustomer && (
                    <input
                      value={partyName}
                      onChange={e => setPartyName(e.target.value)}
                      placeholder="أو اكتب اسم الجهة الدافعة (شركة / شخص)..."
                      className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                    />
                  )}
                </div>
              ) : (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">الجهة المدفوع لها</label>
                  <input
                    value={partyName}
                    onChange={e => setPartyName(e.target.value)}
                    placeholder="مورد، موظف، جهة..."
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                </div>
              )}

              {/* الوصف */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">الوصف / السبب *</label>
                <input
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder={isReceipt ? 'دفعة على فاتورة، استلام بضاعة...' : 'إيجار الشهر، رواتب...'}
                  required
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                />
              </div>

              {/* التصنيف وطريقة الدفع — عمودان */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">التصنيف</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50"
                  >
                    <option value="">بدون تصنيف</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">طريقة الدفع</label>
                  <select
                    value={paymentMethod}
                    onChange={e => setPaymentMethod(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50"
                  >
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>

              {/* رقم مرجعي */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  رقم مرجعي
                  <span className="mr-1 font-normal text-slate-600">(اختياري)</span>
                </label>
                <input
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                  placeholder="رقم الفاتورة، رقم الطلبية..."
                  dir="ltr"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                />
              </div>

              {error && (
                <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
                  {error}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); resetForm() }}
                  className="flex-1 rounded-xl border border-white/10 py-3 text-sm text-slate-400 transition-colors hover:text-white"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={`flex-1 rounded-xl py-3 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                    isReceipt ? 'bg-sky-600 hover:bg-sky-500' : 'bg-red-700 hover:bg-red-600'
                  }`}
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ السند'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
