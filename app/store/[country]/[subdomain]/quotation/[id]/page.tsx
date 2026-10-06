import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import PublicQuotationInteractive from './PublicQuotationInteractive'

interface Props {
  params: {
    country: string
    subdomain: string
    id: string
  }
}

export async function generateMetadata({ params }: Props) {
  const supabase = createAdminClient()
  const { data: quote } = await supabase
    .from('quotations')
    .select('quotation_number')
    .eq('id', params.id)
    .single()

  return {
    title: `عرض سعر #${quote?.quotation_number || params.id} — بازاركو`,
  }
}

export default async function PublicQuotationPage({ params }: Props) {
  const supabase = createAdminClient()

  // 1. Fetch store
  const { data: store } = await supabase
    .from('stores')
    .select('id, name, currency_code, subdomain, country_code, logo_url, phone, address, email, tax_number')
    .eq('subdomain', params.subdomain)
    .eq('country_code', params.country.toUpperCase())
    .single()

  if (!store) notFound()

  // 2. Fetch quotation and items
  const { data: quote } = await supabase
    .from('quotations')
    .select('id, quotation_number, issue_date, valid_until, status, subtotal, discount, total_amount, currency, notes, terms, customer_id, customer:customers(id, name, phone, address), items:quotation_items(*, product:products(id, thumbnail_url, images))')
    .eq('id', params.id)
    .eq('store_id', store.id)
    .single()

  if (!quote) notFound()

  const currency = quote.currency || store.currency_code || 'ILS'
  const currencySymbol = currency === 'ILS' ? '₪' : currency === 'USD' ? '$' : currency === 'JOD' ? 'د.أ' : currency

  // Parse metadata from notes
  let meta: any = {}
  try {
    const match = (quote.notes || '').match(/\[\[META:([\s\S]*?)\]\]/)
    if (match && match[1]) {
      meta = JSON.parse(match[1])
    }
  } catch {}

  const initialGifts: Record<string, boolean> = meta.gifts || {}
  const initialSpecialDiscount: number = Number(meta.specialDiscount || 0)
  const initialSpecialDiscountType: 'amount' | 'percent' = meta.specialDiscountType === 'percent' ? 'percent' : 'amount'

  // Items formatting and sorting by saved order
  const items = (((quote.items as any[]) || []).slice())
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map(i => {
      const prod = i.product
      const prodImages: string[] = Array.isArray(prod?.images) ? prod.images.filter(Boolean) : []
      const thumb = prod?.thumbnail_url || (prodImages.length > 0 ? prodImages[0] : null)
      const allImages: string[] = prodImages.length > 0 ? prodImages : (thumb ? [thumb] : [])

      return {
        id: i.id,
        product_id: i.product_id,
        product_name: i.product_name,
        quantity: Number(i.quantity || 1),
        unit_price: Number(i.unit_price || 0),
        total_price: Number(i.total_price || 0),
        is_gift: !!initialGifts[i.id],
        cost_price: 0,
        thumbnail_url: thumb,
        images: allImages,
      }
    })

  const canEdit = !['converted', 'rejected', 'expired'].includes(quote.status)
  const customerObj = Array.isArray(quote.customer) ? quote.customer[0] : quote.customer

  // Validity calculation
  let validityDaysText = ''
  if (quote.valid_until) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const validDate = new Date(quote.valid_until)
    validDate.setHours(0, 0, 0, 0)
    const diffDays = Math.ceil((validDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays < 0) {
      validityDaysText = 'منتهي الصلاحية'
    } else if (diffDays === 0) {
      validityDaysText = 'ينتهي اليوم'
    } else if (diffDays === 1) {
      validityDaysText = 'متبقي يوم واحد'
    } else {
      validityDaysText = `متبقي ${diffDays} يوم`
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-3 sm:px-6 font-sans text-slate-900 print:bg-white print:p-0 print:m-0" dir="rtl">
      <div className="mx-auto max-w-4xl space-y-6 print:space-y-4">
        {/* ترويسة المتجر والوثيقة */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-sm print:border-none print:shadow-none print:p-0">
          <div className="flex flex-col sm:flex-row items-start justify-between gap-5 border-b border-slate-100 pb-6">
            <div className="flex items-center gap-4">
              {store.logo_url ? (
                <img
                  src={store.logo_url}
                  alt={store.name}
                  className="h-16 w-16 rounded-2xl border border-slate-200 object-contain p-1 shadow-sm"
                />
              ) : (
                <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white font-black text-2xl flex items-center justify-center shadow-sm">
                  {store.name.slice(0, 1)}
                </div>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-black text-slate-950 tracking-tight">{store.name}</h1>
                  <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded-full border border-emerald-200 print:hidden">
                    ✓ معتمد
                  </span>
                </div>
                {store.address && <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">📍 {store.address}</p>}
                {store.phone && (
                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1" dir="ltr">
                    📞 <span className="font-mono">{store.phone}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="text-right sm:text-left flex flex-col sm:items-end w-full sm:w-auto">
              <div className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3.5 py-1.5 text-xs font-black text-white shadow-sm">
                <span>📄</span>
                <span>عرض أسعار تجاري</span>
              </div>
              <p className="mt-1.5 font-mono text-base font-black text-sky-800" dir="ltr">
                #{quote.quotation_number}
              </p>
              <div className="mt-1 text-xs text-slate-500 space-y-1 font-mono">
                <div className="flex items-center justify-between sm:justify-end gap-2">
                  <span className="text-slate-400 font-sans">تاريخ الإصدار:</span>
                  <strong className="text-slate-800">{new Date(quote.issue_date).toLocaleDateString('en-GB')}</strong>
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-2">
                  <span className="text-slate-400 font-sans">ساري حتى:</span>
                  <strong className="text-slate-800">
                    {quote.valid_until ? new Date(quote.valid_until).toLocaleDateString('en-GB') : 'حسب الاتفاق'}
                  </strong>
                </div>
                {validityDaysText && (
                  <div className="text-[10px] font-sans font-bold text-sky-600 print:hidden text-left">
                    ⏱️ {validityDaysText}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* معلومات الزبون وحالة العرض */}
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl bg-slate-50/80 p-4 border border-slate-100 text-xs">
            <div>
              <span className="text-slate-400 block mb-0.5">موجه إلى العميل:</span>
              <strong className="text-slate-950 text-sm block">{customerObj?.name || 'العميل المحترم'}</strong>
              {customerObj?.phone && (
                <span className="text-slate-500 font-mono text-[11px] block mt-0.5" dir="ltr">
                  {customerObj.phone}
                </span>
              )}
            </div>

            {customerObj?.address && (
              <div>
                <span className="text-slate-400 block mb-0.5">عنوان التسليم:</span>
                <span className="text-slate-700 font-semibold">{customerObj.address}</span>
              </div>
            )}

            <div className="sm:text-left">
              <span className="text-slate-400 block mb-0.5 sm:text-left">حالة العرض:</span>
              <span className={`inline-block font-black px-3 py-1 rounded-lg text-xs ${
                quote.status === 'accepted' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                quote.status === 'converted' ? 'bg-purple-100 text-purple-800 border border-purple-200' :
                'bg-sky-100 text-sky-800 border border-sky-200'
              }`}>
                {quote.status === 'accepted' ? '✓ تم القبول والاعتماد' :
                 quote.status === 'converted' ? '🧾 تم إصدار الفاتورة' : '⏳ ساري — بانتظار الاعتماد'}
              </span>
            </div>
          </div>
        </div>

        {/* المكون التفاعلي للبنود، تعديل الكميات، واختيار الهدايا */}
        <PublicQuotationInteractive
          quote={{
            ...quote,
            customer: customerObj || null
          }}
          items={items}
          currencySymbol={currencySymbol}
          store={store}
          initialGifts={initialGifts}
          initialSpecialDiscount={initialSpecialDiscount}
          initialSpecialDiscountType={initialSpecialDiscountType}
          canEdit={canEdit}
        />

        {/* التذييل الرسمي */}
        <div className="text-center text-xs text-slate-400 py-4 print:pt-8 print:text-[10px] space-y-1">
          <p className="font-bold text-slate-500">شكراً لاهتمامكم والتعامل مع {store.name}</p>
          <p>عرض أسعار تم إنشاؤه عبر منصة بازاركو ERP لإدارة العمليات التجارية</p>
        </div>
      </div>
    </div>
  )
}
