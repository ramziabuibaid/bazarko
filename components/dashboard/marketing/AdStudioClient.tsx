'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface Product {
  id: string
  name: string
  price: number
  compare_price?: number | null
  thumbnail_url?: string | null
  images?: string[] | null
  slug: string
}

interface Customer {
  id: string
  name: string
  phone: string | null
  email: string | null
  balance: number
}

interface AdCampaign {
  id: string
  title: string
  message_template: string
  product_id?: string | null
  image_url?: string | null
  action_url?: string | null
  discount_badge?: string | null
  price?: number | null
  compare_price?: number | null
  total_sent: number
  last_sent_at?: string | null
  created_at: string
}

interface Props {
  store: {
    id: string
    name: string
    subdomain: string
    country_code: string
    currency_code: string
  }
  products: Product[]
  customers: Customer[]
  initialCampaigns: AdCampaign[]
}

const TEMPLATES = [
  {
    name: '🔥 عرض خاص وخصم حصري',
    badge: 'خصم خاص',
    text: `مرحباً {customer_name} 👋\nيسرنا في {store_name} تقديم عرض خاص وحصري لك!\n\n✨ {product_name}\n💰 السعر الآن: {price} {currency} فقط (بدلاً من {compare_price} {currency})\n\nسارع بالطلب فالكمية محدودة ⏳\nرابط الشراء المباشر: {link}`,
  },
  {
    name: '✨ وصل حديثاً تشكيلة مميزة',
    badge: 'وصل حديثاً',
    text: `أهلاً بك {customer_name} 🌟\nوصلتنا تشكيلة جديدة ومميزة قد تنال إعجابك في {store_name}:\n\n🛍️ {product_name}\n💵 السعر: {price} {currency}\n\nتسوّق الآن واكتشف المزيد:\n{link}`,
  },
  {
    name: '⏳ تصفية وكمية محدودة',
    badge: 'كمية محدودة',
    text: `فرصة لا تفوت يا {customer_name} ⚡\nآخر قطع متبقية في متجر {store_name} بسعر التصفية!\n\n🏷️ {product_name}\n💸 السعر: {price} {currency}\n\nاطلب الآن قبل نفاد الكمية:\n{link}`,
  },
]

export default function AdStudioClient({ store, products, customers, initialCampaigns }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [campaigns, setCampaigns] = useState<AdCampaign[]>(initialCampaigns)
  const [selectedProductId, setSelectedProductId] = useState<string>('')
  const [title, setTitle] = useState('عرض منتج مميز')
  const [discountBadge, setDiscountBadge] = useState('عرض محدود')
  const [message, setMessage] = useState(TEMPLATES[0].text)
  const [customPrice, setCustomPrice] = useState('')
  const [customComparePrice, setCustomComparePrice] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [customActionUrl, setCustomActionUrl] = useState('')

  // Target customer selection
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('')
  const [manualPhone, setManualPhone] = useState('')

  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const storeUrl = `https://${store.subdomain}.${process.env.NEXT_PUBLIC_DOMAIN ?? 'bazarko.com'}`

  // Product selection handler
  const handleProductChange = (productId: string) => {
    setSelectedProductId(productId)
    const p = products.find(prod => prod.id === productId)
    if (p) {
      setTitle(`إعلان: ${p.name}`)
      setCustomPrice(String(p.price))
      setCustomComparePrice(p.compare_price ? String(p.compare_price) : '')
      const primaryImg = p.thumbnail_url || (p.images && p.images[0]) || ''
      setImageUrl(primaryImg)
      setCustomActionUrl(`${storeUrl}/product/${p.slug}`)
    }
  }

  // Apply template
  const handleApplyTemplate = (tmpl: typeof TEMPLATES[0]) => {
    setMessage(tmpl.text)
    setDiscountBadge(tmpl.badge)
  }

  // Resolve personalized WhatsApp text for a specific customer
  const getPersonalizedText = (custName?: string) => {
    const selectedProd = products.find(p => p.id === selectedProductId)
    const prodName = selectedProd?.name || 'منتج مميز'
    const prc = customPrice || (selectedProd?.price ? String(selectedProd.price) : '0')
    const cmpPrc = customComparePrice || (selectedProd?.compare_price ? String(selectedProd.compare_price) : '')
    const lnk = customActionUrl || storeUrl

    return message
      .replace(/{customer_name}/g, custName ? custName.trim() : 'عزيزنا الزبون')
      .replace(/{store_name}/g, store.name)
      .replace(/{product_name}/g, prodName)
      .replace(/{price}/g, prc)
      .replace(/{compare_price}/g, cmpPrc)
      .replace(/{currency}/g, store.currency_code)
      .replace(/{link}/g, lnk)
  }

  const activeCustomer = customers.find(c => c.id === selectedCustomerId)
  const targetPhone = activeCustomer?.phone || manualPhone
  const previewText = getPersonalizedText(activeCustomer?.name)

  // Save Campaign to Database
  const handleSaveCampaign = async () => {
    setSaving(true)
    setSaveSuccess(false)
    try {
      const { data: newCamp, error } = await supabase
        .from('ads_campaigns')
        .insert({
          store_id: store.id,
          title,
          message_template: message,
          product_id: selectedProductId || null,
          image_url: imageUrl || null,
          action_url: customActionUrl || null,
          discount_badge: discountBadge || null,
          price: customPrice ? parseFloat(customPrice) : null,
          compare_price: customComparePrice ? parseFloat(customComparePrice) : null,
          status: 'active',
        })
        .select('*')
        .single()

      if (!error && newCamp) {
        setCampaigns(prev => [newCamp, ...prev])
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 3000)
      }
    } finally {
      setSaving(false)
    }
  }

  // Send via WhatsApp
  const handleSendWhatsApp = async () => {
    const cleanPhone = targetPhone.replace(/[^\d]/g, '').replace(/^00/, '')
    if (!cleanPhone) {
      alert('يرجى تحديد زبون له رقم هاتف أو إدخال رقم الهاتف يدوياً')
      return
    }

    const textToSend = getPersonalizedText(activeCustomer?.name)
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(textToSend)}`

    // Open WhatsApp
    window.open(waUrl, '_blank')

    // Track total_sent in background if saved campaign exists
    const matching = campaigns.find(c => c.title === title)
    if (matching) {
      await supabase
        .from('ads_campaigns')
        .update({
          total_sent: (matching.total_sent || 0) + 1,
          last_sent_at: new Date().toISOString(),
        })
        .eq('id', matching.id)

      setCampaigns(prev => prev.map(c => c.id === matching.id ? { ...c, total_sent: (c.total_sent || 0) + 1 } : c))
    }
  }

  const handleCopyText = () => {
    navigator.clipboard.writeText(previewText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.phone && c.phone.includes(customerSearch))
  ).slice(0, 15)

  return (
    <div className="space-y-6">
      {/* ── Top Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>📢</span> استوديو تصميم الإعلانات وحملات WhatsApp
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            صمم إعلاناتك وعروضك بسهولة، عاين شكلها على واتساب، وأرسلها مباشرة لزبائنك بضغطة زر واحدة
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveCampaign}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-xl bg-slate-800 border border-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 transition"
          >
            {saving ? 'جارٍ الحفظ...' : saveSuccess ? '✓ تم حفظ الإعلان' : '💾 حفظ الإعلان في السجل'}
          </button>
        </div>
      </div>

      {/* ── Main Studio Grid: 3 Columns ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* ── Column 1: Ad Designer Form (5 cols) ── */}
        <div className="lg:col-span-5 space-y-4 rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-xl">
          <h2 className="text-base font-bold text-white flex items-center gap-2 border-b border-white/10 pb-3">
            <span>🎨</span> محرر ومصمم الإعلان
          </h2>

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">عنوان الإعلان / الحملة</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="مثال: عرض نهاية الأسبوع على الأحذية"
              className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Select Product */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              ربط بمنتج من المتجر (تعبئة تلقائية للبيانات والصورة)
            </label>
            <select
              value={selectedProductId}
              onChange={e => handleProductChange(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
            >
              <option value="">-- اختر منتجاً أو ادخل البيانات يدوياً --</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.price} {store.currency_code})
                </option>
              ))}
            </select>
          </div>

          {/* Ready Templates */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">نماذج تسويقية جاهزة:</label>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((tmpl, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleApplyTemplate(tmpl)}
                  className="rounded-lg border border-white/10 bg-slate-800/80 px-2.5 py-1 text-[11px] text-slate-300 hover:border-sky-500/40 hover:text-white transition"
                >
                  {tmpl.name}
                </button>
              ))}
            </div>
          </div>

          {/* Prices & Badges */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">السعر المعروض</label>
              <input
                type="text"
                dir="ltr"
                value={customPrice}
                onChange={e => setCustomPrice(e.target.value)}
                placeholder="100"
                className="w-full rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1.5 text-xs text-white font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">السعر السابق</label>
              <input
                type="text"
                dir="ltr"
                value={customComparePrice}
                onChange={e => setCustomComparePrice(e.target.value)}
                placeholder="150"
                className="w-full rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1.5 text-xs text-white font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">شارة العرض</label>
              <input
                type="text"
                value={discountBadge}
                onChange={e => setDiscountBadge(e.target.value)}
                placeholder="خصم 30%"
                className="w-full rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1.5 text-xs text-white"
              />
            </div>
          </div>

          {/* Image URL / Upload */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">رابط صورة الإعلان</label>
            <input
              type="text"
              dir="ltr"
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
              placeholder="https://... رابط الصورة"
              className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Call to action URL */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">رابط الشراء أو صفحة العرض</label>
            <input
              type="text"
              dir="ltr"
              value={customActionUrl}
              onChange={e => setCustomActionUrl(e.target.value)}
              placeholder={storeUrl}
              className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Message Template Textarea */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-semibold text-slate-400">نص رسالة WhatsApp الإعلانية</label>
              <span className="text-[10px] text-slate-500">يدعم المتغيرات والرموز التعبيرية</span>
            </div>
            <textarea
              rows={7}
              value={message}
              onChange={e => setMessage(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-xs leading-relaxed text-slate-200 focus:outline-none focus:border-sky-500 font-sans"
            />
            <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">
              <span>المتغيرات المتاحة:</span>
              <code className="bg-slate-800 text-sky-400 px-1 rounded">{'{customer_name}'}</code>
              <code className="bg-slate-800 text-sky-400 px-1 rounded">{'{product_name}'}</code>
              <code className="bg-slate-800 text-sky-400 px-1 rounded">{'{price}'}</code>
              <code className="bg-slate-800 text-sky-400 px-1 rounded">{'{compare_price}'}</code>
              <code className="bg-slate-800 text-sky-400 px-1 rounded">{'{store_name}'}</code>
              <code className="bg-slate-800 text-sky-400 px-1 rounded">{'{link}'}</code>
            </div>
          </div>
        </div>

        {/* ── Column 2: Live WhatsApp Simulator & Visual Card (4 cols) ── */}
        <div className="lg:col-span-4 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-xl">
            <h2 className="text-base font-bold text-white flex items-center gap-2 border-b border-white/10 pb-3 mb-4">
              <span>📱</span> المعاينة الحية على WhatsApp
            </h2>

            {/* Realistic WhatsApp Chat Box */}
            <div className="rounded-2xl overflow-hidden border border-slate-700 shadow-2xl bg-[#0b141a]">
              {/* WhatsApp Chat Header */}
              <div className="bg-[#202c33] px-3.5 py-2.5 flex items-center justify-between text-white border-b border-white/5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-emerald-700 flex items-center justify-center font-bold text-xs">
                    {store.name.slice(0, 1)}
                  </div>
                  <div>
                    <p className="text-xs font-bold leading-none">{store.name}</p>
                    <p className="text-[10px] text-emerald-400 leading-none mt-1">متصل الآن (Official)</p>
                  </div>
                </div>
                <span className="text-xs text-slate-400">WhatsApp</span>
              </div>

              {/* Chat Canvas with Wallpaper */}
              <div
                className="p-3.5 min-h-[380px] flex flex-col justify-end"
                style={{
                  backgroundImage: 'radial-gradient(#1f2c34 1px, transparent 1px)',
                  backgroundSize: '16px 16px',
                }}
              >
                {/* Message Bubble */}
                <div className="max-w-[92%] self-start rounded-2xl rounded-tr-sm bg-[#005c4b] p-3 text-white shadow-md text-xs leading-relaxed">
                  {/* Attached Image inside Bubble */}
                  {imageUrl && (
                    <div className="mb-2 overflow-hidden rounded-xl bg-black/40 border border-white/10 max-h-48">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageUrl} alt="Ad Visual" className="w-full h-full object-cover" />
                    </div>
                  )}

                  {/* Badge */}
                  {discountBadge && (
                    <span className="inline-block mb-1.5 rounded bg-emerald-950/80 border border-emerald-400/40 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      🏷️ {discountBadge}
                    </span>
                  )}

                  {/* Message Text with preserved line breaks */}
                  <div className="whitespace-pre-wrap text-[11px] font-sans text-neutral-100">
                    {previewText}
                  </div>

                  {/* Timestamp & double check */}
                  <div className="mt-1.5 flex items-center justify-end gap-1 text-[9px] text-emerald-200/70">
                    <span>{new Date().toLocaleTimeString('ar-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span>✓✓</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Copy Tool */}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleCopyText}
                className="flex-1 rounded-xl bg-slate-800 border border-white/10 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
              >
                {copied ? '✓ نُسخ النص' : '📋 نسخ نص الرسالة'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Column 3: Audience & 1-Click WhatsApp Sender (3 cols) ── */}
        <div className="lg:col-span-3 space-y-4 rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-slate-900 to-emerald-950/20 p-5 shadow-xl">
          <h2 className="text-base font-bold text-white flex items-center gap-2 border-b border-white/10 pb-3">
            <span>🎯</span> إرسال الإعلان للزبون
          </h2>

          {/* Search Customers */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              اختر الزبون المستهدف ({customers.length} عملاء)
            </label>
            <input
              type="text"
              value={customerSearch}
              onChange={e => setCustomerSearch(e.target.value)}
              placeholder="🔍 ابحث بالاسم أو الهاتف..."
              className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Customer list selector */}
          <div className="max-h-48 overflow-y-auto space-y-1 rounded-xl border border-white/5 bg-slate-950 p-1.5">
            {filteredCustomers.length === 0 ? (
              <p className="p-3 text-center text-xs text-slate-500">لا يوجد عملاء مطابقين</p>
            ) : (
              filteredCustomers.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelectedCustomerId(c.id)
                    setManualPhone(c.phone || '')
                  }}
                  className={`w-full text-right p-2 rounded-lg text-xs transition flex justify-between items-center ${
                    selectedCustomerId === c.id
                      ? 'bg-emerald-600/30 border border-emerald-500/50 text-white'
                      : 'hover:bg-white/5 text-slate-300'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-bold truncate">{c.name}</p>
                    <p className="text-[10px] text-slate-400 font-mono" dir="ltr">{c.phone || 'بدون هاتف'}</p>
                  </div>
                  {c.phone && <span className="text-emerald-400 text-xs">📱</span>}
                </button>
              ))
            )}
          </div>

          {/* Manual Phone Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">أو رقم هاتف مخصص مباشرة</label>
            <input
              type="tel"
              dir="ltr"
              value={manualPhone}
              onChange={e => {
                setManualPhone(e.target.value)
                setSelectedCustomerId('')
              }}
              placeholder="0599000000 أو 970599000000"
              className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Active Target Summary */}
          {targetPhone && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-xs text-emerald-300 space-y-0.5">
              <p className="font-bold">المستلم: {activeCustomer?.name || 'مخصص'}</p>
              <p className="font-mono text-[11px]" dir="ltr">{targetPhone}</p>
            </div>
          )}

          {/* Big Green Send Button */}
          <button
            type="button"
            onClick={handleSendWhatsApp}
            className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-3 text-sm transition shadow-lg flex items-center justify-center gap-2"
          >
            <span>📱</span> إرسال عبر WhatsApp فوراً
          </button>

          <p className="text-[11px] text-slate-400 text-center leading-relaxed">
            يفتح واتساب مع الرسالة والنص والرابط جاهزاً للإرسال دون الحاجة لكتابة أي شيء.
          </p>
        </div>

      </div>

      {/* ── Bottom Section: Saved Campaigns Library ── */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
        <div className="border-b border-white/10 px-5 py-4 flex items-center justify-between">
          <h2 className="font-bold text-white text-base">سجل الإعلانات والحملات المحفوظة ({campaigns.length})</h2>
          <span className="text-xs text-slate-400">إعادة استخدام وإرسال أي إعلان سابق لزبائن جدد بضغطة زر</span>
        </div>

        {campaigns.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            لا توجد إعلانات محفوظة بعد. اضغط «حفظ الإعلان في السجل» بالأعلى لحفظ أول إعلان.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-white/10 bg-slate-800/50 text-slate-400">
                <tr>
                  <th className="p-3.5">عنوان الإعلان</th>
                  <th className="p-3.5">شارة العرض</th>
                  <th className="p-3.5">السعر</th>
                  <th className="p-3.5">مرات الإرسال</th>
                  <th className="p-3.5">تاريخ الإنشاء</th>
                  <th className="p-3.5 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {campaigns.map(c => (
                  <tr key={c.id} className="hover:bg-white/[0.02]">
                    <td className="p-3.5 font-bold text-white">{c.title}</td>
                    <td className="p-3.5">
                      <span className="rounded bg-sky-500/10 px-2 py-0.5 text-sky-300 font-medium">
                        {c.discount_badge || 'إعلان عام'}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono text-white">
                      {c.price ? `${c.price} ${store.currency_code}` : '—'}
                    </td>
                    <td className="p-3.5 font-mono font-bold text-emerald-400">
                      {c.total_sent || 0} مرة
                    </td>
                    <td className="p-3.5 text-slate-400">
                      {new Date(c.created_at).toLocaleDateString('ar-u-nu-latn')}
                    </td>
                    <td className="p-3.5 text-center">
                      <button
                        onClick={() => {
                          setTitle(c.title)
                          setMessage(c.message_template)
                          setDiscountBadge(c.discount_badge || '')
                          if (c.price) setCustomPrice(String(c.price))
                          if (c.compare_price) setCustomComparePrice(String(c.compare_price))
                          if (c.image_url) setImageUrl(c.image_url)
                          if (c.action_url) setCustomActionUrl(c.action_url)
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                        className="rounded-lg bg-sky-500/10 border border-sky-500/20 px-3 py-1 text-xs font-bold text-sky-400 hover:bg-sky-500/20 transition"
                      >
                        تحميل وتعديل للإرسال ↺
                      </button>
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
