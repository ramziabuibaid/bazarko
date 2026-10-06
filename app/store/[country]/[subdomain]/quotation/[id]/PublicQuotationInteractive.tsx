'use client'

import { useState, useEffect } from 'react'
import { calculateQuotationTotals, type QuotationLineItem } from '@/lib/quotations/presentation'

interface ItemData {
  id: string
  product_id: string | null
  product_name: string
  quantity: number
  unit_price: number
  total_price: number
  is_gift?: boolean
  cost_price?: number
  thumbnail_url?: string | null
  images?: string[] | null
}

interface Props {
  quote: {
    id: string
    quotation_number: string
    issue_date: string
    valid_until: string | null
    status: string
    subtotal: number
    discount: number
    total_amount: number
    currency: string
    notes: string | null
    terms: string | null
    customer_id?: string | null
    customer?: { id: string; name: string; phone: string | null } | null
  }
  items: ItemData[]
  currencySymbol: string
  store: { id: string; name: string; currency_code: string; subdomain?: string; phone?: string | null }
  initialGifts: Record<string, boolean>
  initialSpecialDiscount: number
  initialSpecialDiscountType: 'amount' | 'percent'
  canEdit?: boolean
}

export default function PublicQuotationInteractive({
  quote,
  items,
  currencySymbol,
  store,
  initialGifts,
  initialSpecialDiscount,
  initialSpecialDiscountType
}: Props) {
  // حالة نافذة معاينة الصور (Lightbox)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [activeItemName, setActiveItemName] = useState('')
  const [activeImages, setActiveImages] = useState<string[]>([])
  const [activeImageIndex, setActiveImageIndex] = useState(0)

  const openLightbox = (item: ItemData, startIndex = 0) => {
    const images = (item.images && item.images.length > 0)
      ? item.images
      : (item.thumbnail_url ? [item.thumbnail_url] : [])
    if (images.length === 0) return
    setActiveItemName(item.product_name)
    setActiveImages(images)
    setActiveImageIndex(startIndex)
    setLightboxOpen(true)
  }

  const closeLightbox = () => {
    setLightboxOpen(false)
  }

  const prevImage = () => {
    setActiveImageIndex(i => (i - 1 + activeImages.length) % activeImages.length)
  }

  const nextImage = () => {
    setActiveImageIndex(i => (i + 1) % activeImages.length)
  }

  // دعم مفاتيح الأسهم وEscape للتنقل في المعرض
  useEffect(() => {
    if (!lightboxOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox()
      if (e.key === 'ArrowLeft') nextImage()
      if (e.key === 'ArrowRight') prevImage()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [lightboxOpen, activeImages.length])

  // حساب الإجماليات بدقة من بيانات المتجر المعتمدة (للاطلاع فقط)
  const lineItems: QuotationLineItem[] = items.map(i => ({
    product_id: i.product_id,
    product_name: i.product_name,
    quantity: i.quantity,
    unit_price: i.unit_price,
    cost_price: i.cost_price,
    is_gift: !!initialGifts[i.id]
  }))

  const totals = calculateQuotationTotals(lineItems, initialSpecialDiscountType, initialSpecialDiscount)

  const fmt = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // رابط واتساب للتواصل وتأكيد الطلب
  const cleanPhone = (store.phone || '').replace(/[^0-9]/g, '')
  const customerName = quote.customer?.name || 'الزبون المحترم'
  const netTotalText = `${fmt(totals.netTotal)} ${currencySymbol}`

  const whatsappConfirmUrl = cleanPhone
    ? `https://wa.me/${cleanPhone.startsWith('0') ? '970' + cleanPhone.slice(1) : cleanPhone}?text=${encodeURIComponent(
        `مرحباً ${store.name}، أود تأكيد طلبي والموافقة على عرض السعر رقم #${quote.quotation_number} بمبلغ إجمالي (${netTotalText}) لحساب (${customerName}). يرجى تأكيد بدء التجهيز.`
      )}`
    : null

  const whatsappInquireUrl = cleanPhone
    ? `https://wa.me/${cleanPhone.startsWith('0') ? '970' + cleanPhone.slice(1) : cleanPhone}?text=${encodeURIComponent(
        `مرحباً ${store.name}، لدي استفسار بخصوص عرض السعر رقم #${quote.quotation_number} للزبون (${customerName}).`
      )}`
    : null

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="space-y-6">
      {/* ── شريط الإجراءات السريعة في الأعلى (طباعة، تواصل) ── */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl bg-white p-3 sm:p-4 border border-slate-200/80 shadow-sm print:hidden">
        <button
          type="button"
          onClick={handlePrint}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-700 transition shadow-sm cursor-pointer"
        >
          <span>🖨️</span>
          <span>طباعة أو حفظ كملف PDF</span>
        </button>

        <div className="flex items-center gap-2">
          {whatsappInquireUrl && (
            <a
              href={whatsappInquireUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-50 hover:bg-emerald-100 px-3.5 py-2 text-xs font-bold text-emerald-800 transition"
            >
              <span>💬</span>
              <span>استفسار عبر واتساب</span>
            </a>
          )}
          {store.phone && (
            <a
              href={`tel:${store.phone}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-700 transition"
              dir="ltr"
            >
              <span>📞</span>
              <span>اتصال هاتفي</span>
            </a>
          )}
        </div>
      </div>

      {/* ── حاوية بنود العرض ── */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm print:border-slate-300">
        <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3.5 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">📦</span>
            <h3 className="font-black text-slate-900 text-sm sm:text-base">
              قائمة الأصناف والخدمات في العرض
            </h3>
            <span className="text-xs text-slate-500 font-mono">({items.length} أصناف)</span>
          </div>
          <span className="text-[11px] bg-slate-200/70 text-slate-700 font-bold px-2.5 py-0.5 rounded-full print:hidden">
            وثيقة للاطلاع والاعتماد
          </span>
        </div>

        {/* ── 1. عرض الموبايل: بطاقات أنيقة مريحة جداً للقراءة على الشاشات الصغيرة (Mobile Cards) ── */}
        <div className="sm:hidden divide-y divide-slate-100 print:hidden">
          {items.map((item, idx) => {
            const isGift = !!initialGifts[item.id]
            const lineTotal = item.quantity * item.unit_price

            return (
              <div
                key={item.id}
                className={`p-4 space-y-2.5 ${isGift ? 'bg-amber-50/40 border-r-4 border-amber-500' : 'bg-white'}`}
              >
                {/* رأس البطاقة */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    {item.thumbnail_url ? (
                      <button
                        type="button"
                        onClick={() => openLightbox(item)}
                        className="relative group shrink-0 rounded-xl overflow-hidden border border-slate-200 hover:border-sky-500 shadow-xs transition cursor-pointer"
                        title="انقر لتكبير واستعراض الصور"
                      >
                        <img
                          src={item.thumbnail_url}
                          alt={item.product_name}
                          className="w-12 h-12 object-cover transition duration-200 group-hover:scale-105"
                        />
                        {item.images && item.images.length > 1 && (
                          <span className="absolute bottom-0.5 right-0.5 bg-black/75 text-white text-[9px] font-mono px-1 rounded font-bold">
                            +{item.images.length}
                          </span>
                        )}
                      </button>
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200/60 flex items-center justify-center shrink-0 text-base text-slate-400">
                        📦
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 font-mono text-[10px] font-black">
                          {idx + 1}
                        </span>
                        <h4 className="font-bold text-slate-950 text-sm leading-snug">
                          {item.product_name}
                        </h4>
                      </div>
                    </div>
                  </div>
                  {isGift && (
                    <span className="shrink-0 text-[10px] bg-amber-500 text-white font-black px-2 py-0.5 rounded-md shadow-xs">
                      🎁 هدية مجانية
                    </span>
                  )}
                </div>

                {/* تفاصيل السعر والكمية والإجمالي */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
                  {/* الكمية */}
                  <div>
                    <span className="text-[10px] text-slate-400 block mb-0.5">الكمية:</span>
                    <span className="inline-block rounded-md bg-slate-100 px-2.5 py-1 font-mono font-black text-slate-900 text-xs">
                      {item.quantity}
                    </span>
                  </div>

                  {/* سعر الوحدة */}
                  <div>
                    <span className="text-[10px] text-slate-400 block mb-0.5">سعر الوحدة:</span>
                    <span className="font-mono font-bold text-slate-700" dir="ltr">
                      {fmt(item.unit_price)} {currencySymbol}
                    </span>
                  </div>

                  {/* إجمالي البند */}
                  <div className="text-left">
                    <span className="text-[10px] text-slate-400 block mb-0.5">الإجمالي:</span>
                    {isGift ? (
                      <div>
                        <span className="text-slate-400 line-through text-[10px] block" dir="ltr">
                          {fmt(lineTotal)}
                        </span>
                        <span className="text-emerald-700 font-black text-sm" dir="ltr">
                          0.00 {currencySymbol}
                        </span>
                      </div>
                    ) : (
                      <span className="font-mono font-black text-slate-950 text-sm" dir="ltr">
                        {fmt(lineTotal)} {currencySymbol}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* ── 2. عرض أجهزة الكمبيوتر والطباعة: جدول تجاري كلاسيكي كامل (Desktop & Print Table) ── */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-900 text-white font-bold">
                <th className="p-3 text-center w-12">#</th>
                <th className="p-3">بيان الصنف والخدمة</th>
                <th className="p-3 text-center w-24">الكمية</th>
                <th className="p-3 text-left w-28">سعر الوحدة</th>
                <th className="p-3 text-center w-28">حالة البند</th>
                <th className="p-3 text-left w-28">الإجمالي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {items.map((item, idx) => {
                const isGift = !!initialGifts[item.id]
                const lineTotal = item.quantity * item.unit_price

                return (
                  <tr
                    key={item.id}
                    className={`transition-colors ${
                      isGift ? 'bg-amber-50/50 hover:bg-amber-50/70' : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <td className="p-3 text-center font-mono text-slate-400 font-bold">{idx + 1}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        {item.thumbnail_url ? (
                          <button
                            type="button"
                            onClick={() => openLightbox(item)}
                            className="relative group shrink-0 rounded-lg overflow-hidden border border-slate-200 hover:border-sky-500 shadow-xs transition cursor-pointer print:border-none"
                            title="انقر لعرض الصور بالحجم الكامل"
                          >
                            <img
                              src={item.thumbnail_url}
                              alt={item.product_name}
                              className="w-11 h-11 object-cover transition duration-200 group-hover:scale-105"
                            />
                            {item.images && item.images.length > 1 && (
                              <span className="absolute bottom-0.5 right-0.5 bg-black/75 text-white text-[8px] font-mono px-1 rounded font-bold print:hidden">
                                {item.images.length}
                              </span>
                            )}
                          </button>
                        ) : (
                          <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200/60 flex items-center justify-center shrink-0 text-base text-slate-400 print:hidden">
                            📦
                          </div>
                        )}
                        <div>
                          <div className="font-bold text-slate-950 text-sm flex items-center gap-2">
                            <span>{item.product_name}</span>
                            {isGift && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[11px] font-black text-amber-800">
                                🎁 هدية مجانية
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-center">
                      <span className="inline-block rounded-lg bg-slate-100 px-3 py-1 font-mono font-black text-slate-900 text-sm">
                        {item.quantity}
                      </span>
                    </td>
                    <td className="p-3 text-left font-mono font-medium text-slate-700" dir="ltr">
                      {fmt(item.unit_price)} {currencySymbol}
                    </td>
                    <td className="p-3 text-center">
                      {isGift ? (
                        <span className="inline-block font-black text-amber-800 text-xs">هدية مجانية</span>
                      ) : (
                        <span className="text-slate-500 text-xs">أساسي</span>
                      )}
                    </td>
                    <td className="p-3 text-left font-mono font-bold text-slate-950 text-sm" dir="ltr">
                      {isGift ? (
                        <div>
                          <span className="text-slate-400 line-through text-xs block">{fmt(lineTotal)}</span>
                          <span className="text-emerald-700 font-black">0.00 {currencySymbol}</span>
                        </div>
                      ) : (
                        <span>{fmt(lineTotal)} {currencySymbol}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── كشف الحساب وشروط العرض ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {/* شروط وملاحظات العرض */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 space-y-3 text-xs text-slate-700 shadow-sm print:border-slate-300">
          <h4 className="font-black text-slate-900 text-sm flex items-center gap-1.5">
            <span>📋</span>
            <span>شروط وملاحظات العرض التجاري</span>
          </h4>
          {quote.terms ? (
            <p className="whitespace-pre-line leading-relaxed text-slate-600">{quote.terms}</p>
          ) : (
            <p className="text-slate-500 leading-relaxed">
              الأسعار والكميات محددة حسب جدول العرض أعلاه وسارية حتى التاريخ الموضح.
            </p>
          )}
          {quote.notes && (
            <div className="border-t border-slate-100 pt-2 text-slate-600">
              <strong className="text-slate-900">ملاحظة:</strong>{' '}
              {quote.notes.replace(/\n?\[\[META:[\s\S]*?\]\]/g, '').trim()}
            </div>
          )}
          <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 font-mono">
            صلاحية العرض: <strong className="text-slate-800">{quote.valid_until || 'حسب الاتفاق'}</strong>
          </div>
        </div>

        {/* بطاقة الإجماليات والمبالغ المطلوبة */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 space-y-3.5 text-xs shadow-sm print:border-slate-300">
          <div className="flex justify-between items-center text-slate-600">
            <span>المجموع الأصلي للبنود:</span>
            <span className="font-mono font-bold text-slate-900 text-sm" dir="ltr">
              {fmt(totals.subtotal)} {currencySymbol}
            </span>
          </div>

          {totals.giftDiscount > 0 && (
            <div className="flex justify-between items-center text-amber-800 bg-amber-50/80 p-2.5 rounded-xl border border-amber-200/70 font-medium">
              <span className="flex items-center gap-1.5 font-bold">
                <span>🎁</span> خصم الهدايا المجانية ({totals.giftCount} أصناف):
              </span>
              <span className="font-mono font-bold" dir="ltr">
                - {fmt(totals.giftDiscount)} {currencySymbol}
              </span>
            </div>
          )}

          {totals.specialDiscount > 0 && (
            <div className="flex justify-between items-center text-rose-800 bg-rose-50/80 p-2.5 rounded-xl border border-rose-200/70 font-medium">
              <span className="flex items-center gap-1.5 font-bold">
                <span>🏷️</span> الخصم التجاري الخاص الممنوح:
                {initialSpecialDiscountType === 'percent' && (
                  <span className="text-[10px] text-rose-600 mr-1">({initialSpecialDiscount}%)</span>
                )}
              </span>
              <span className="font-mono font-bold" dir="ltr">
                - {fmt(totals.specialDiscount)} {currencySymbol}
              </span>
            </div>
          )}

          {totals.totalDiscount > 0 && (
            <div className="flex justify-between items-center text-emerald-800 bg-emerald-50/70 p-2 rounded-xl border border-emerald-200/50 text-[11px]">
              <span className="font-bold flex items-center gap-1">
                <span>✓</span> إجمالي ما وفره الزبون من الخصومات:
              </span>
              <span className="font-mono font-bold text-emerald-700" dir="ltr">
                {fmt(totals.totalDiscount)} {currencySymbol}
                {totals.subtotal > 0 && (
                  <span className="mr-1 text-[10px] text-emerald-600 font-sans">
                    ({Math.round((totals.totalDiscount / totals.subtotal) * 100)}%)
                  </span>
                )}
              </span>
            </div>
          )}

          <div className="flex justify-between items-center border-t-2 border-slate-900 pt-3 text-base font-black text-slate-950">
            <span>المبلغ الصافي المطلوب:</span>
            <span className="font-mono text-2xl text-sky-900 font-black tracking-tight" dir="ltr">
              {netTotalText}
            </span>
          </div>

          {/* ── زر تأكيد العرض الفوري عبر واتساب للزبون ── */}
          {whatsappConfirmUrl && (
            <div className="pt-2 space-y-2 print:hidden">
              <a
                href={whatsappConfirmUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-black py-3.5 text-sm shadow-md transition flex items-center justify-center gap-2 text-center"
              >
                <span>💬</span>
                <span>الموافقة وتأكيد هذا العرض عبر واتساب</span>
              </a>
              <p className="text-[11px] text-center text-slate-400">
                سيتم إرسال رسالة مباشرة للمتجر لاعتماد طلبكم والبدء في التجهيز
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── نافذة تكبير واستعراض صور الأصناف التفاعلية (Lightbox Modal) ── */}
      {lightboxOpen && activeImages.length > 0 && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-6 backdrop-blur-sm transition-opacity print:hidden"
          onClick={closeLightbox}
        >
          <div
            className="relative max-w-3xl w-full flex flex-col items-center bg-slate-900 rounded-2xl border border-white/10 p-3 sm:p-5 overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* الرأس: اسم الصنف وعداد الصور وزر الإغلاق */}
            <div className="w-full flex items-center justify-between pb-3 border-b border-white/10 text-white">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg">🖼️</span>
                <h3 className="font-bold text-sm sm:text-base truncate text-slate-100">
                  {activeItemName}
                </h3>
              </div>
              <div className="flex items-center gap-3 shrink-0 mr-3">
                {activeImages.length > 1 && (
                  <span className="text-xs font-mono text-slate-300 bg-white/10 px-2.5 py-1 rounded-full">
                    {activeImageIndex + 1} / {activeImages.length}
                  </span>
                )}
                <button
                  type="button"
                  onClick={closeLightbox}
                  className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white text-base transition cursor-pointer"
                  title="إغلاق (Esc)"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* منطقة عرض الصورة الكبيرة مع أزرار التنقل */}
            <div className="relative w-full flex items-center justify-center my-3 min-h-[260px] max-h-[68vh]">
              <img
                src={activeImages[activeImageIndex]}
                alt={`${activeItemName} - ${activeImageIndex + 1}`}
                className="max-h-[65vh] max-w-full rounded-xl object-contain shadow-lg select-none"
              />

              {activeImages.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation()
                      prevImage()
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/90 text-white text-lg border border-white/20 transition cursor-pointer shadow-lg"
                    title="الصورة السابقة (→)"
                  >
                    ❯
                  </button>
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation()
                      nextImage()
                    }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/90 text-white text-lg border border-white/20 transition cursor-pointer shadow-lg"
                    title="الصورة التالية (←)"
                  >
                    ❮
                  </button>
                </>
              )}
            </div>

            {/* شريط مصغرات الصور إذا كان للصنف عدة صور */}
            {activeImages.length > 1 && (
              <div className="w-full flex items-center justify-center gap-2 pt-2 border-t border-white/10 overflow-x-auto">
                {activeImages.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveImageIndex(idx)}
                    className={`rounded-lg overflow-hidden border-2 transition shrink-0 ${
                      activeImageIndex === idx
                        ? 'border-sky-400 scale-105 shadow-md'
                        : 'border-transparent opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img src={img} alt={`مصغرة ${idx + 1}`} className="w-12 h-12 object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
