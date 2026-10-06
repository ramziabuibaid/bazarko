export interface QuotationLineItem {
  product_id?: string | null
  product_name: string
  quantity: number
  unit_price: number
  cost_price?: number
  is_gift?: boolean
  is_custom?: boolean
  save_to_products?: boolean
}

export interface QuoteCalculations {
  subtotal: number
  giftDiscount: number
  specialDiscount: number
  totalDiscount: number
  netTotal: number
  totalCost: number
  totalProfit: number
  profitPercent: number
  giftCount: number
}

export function calculateQuotationTotals(
  items: QuotationLineItem[],
  specialDiscountType: 'amount' | 'percent' = 'amount',
  specialDiscountValue: number = 0
): QuoteCalculations {
  const subtotal = items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
    0
  )

  const giftItems = items.filter(item => item.is_gift)
  const giftDiscount = giftItems.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
    0
  )

  const afterGifts = Math.max(0, subtotal - giftDiscount)

  let specialDiscount = 0
  const discVal = Math.max(0, Number(specialDiscountValue) || 0)
  if (specialDiscountType === 'percent') {
    specialDiscount = Math.round((afterGifts * Math.min(100, discVal)) / 100 * 100) / 100
  } else {
    specialDiscount = Math.min(afterGifts, discVal)
  }

  const totalDiscount = Math.round((giftDiscount + specialDiscount) * 100) / 100
  const netTotal = Math.max(0, Math.round((subtotal - totalDiscount) * 100) / 100)

  const totalCost = items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.cost_price) || 0),
    0
  )
  const totalProfit = Math.round((netTotal - totalCost) * 100) / 100
  const profitPercent = netTotal > 0 ? Math.round((totalProfit / netTotal) * 1000) / 10 : 0

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    giftDiscount: Math.round(giftDiscount * 100) / 100,
    specialDiscount: Math.round(specialDiscount * 100) / 100,
    totalDiscount,
    netTotal,
    totalCost: Math.round(totalCost * 100) / 100,
    totalProfit,
    profitPercent,
    giftCount: giftItems.length,
  }
}

export function formatQuoteShareMessage({
  storeName,
  quotationNumber,
  customerName,
  netTotal,
  currency,
  publicUrl,
  giftDiscount,
  specialDiscount,
}: {
  storeName: string
  quotationNumber: string
  customerName?: string
  netTotal: number
  currency: string
  publicUrl: string
  giftDiscount?: number
  specialDiscount?: number
}): string {
  const lines = [
    `مرحباً ${customerName ? customerName : 'عزيزنا العميل'}،`,
    `يسرّ ${storeName} تقديم عرض السعر رقم #${quotationNumber} لك.`,
    `💰 إجمالي العرض: ${netTotal.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`,
  ]
  if (giftDiscount && giftDiscount > 0) {
    lines.push(`🎁 يشمل خصم هدايا مجانية بقيمة: ${giftDiscount.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ${currency}`)
  }
  if (specialDiscount && specialDiscount > 0) {
    lines.push(`✨ يشمل خصماً خاصاً بقيمة: ${specialDiscount.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ${currency}`)
  }
  lines.push('')
  lines.push(`🔗 يمكنك استعراض العرض وتعديله مباشرة من الرابط التالي:`)
  lines.push(publicUrl)
  lines.push('')
  lines.push('شكراً لثقتكم بنا!')
  return lines.join('\n')
}

export type QuoteStatus='all'|'draft'|'sent'|'accepted'|'rejected'|'converted'|'expired'
export const quoteLabels:Record<string,string>={draft:'مسودة',sent:'مرسل',accepted:'مقبول',rejected:'مرفوض',converted:'مفوترة',expired:'منتهي الصلاحية'}
export function quoteExpired(q:{status:string;valid_until:string|null},today:string){return !['draft','converted','rejected'].includes(q.status)&&!!q.valid_until&&q.valid_until<today}
export function validQuote(items:{product_name:string;quantity:number;unit_price:number}[],issue:string,until:string){
 if(!issue||!until||until<issue)return 'تاريخ انتهاء العرض يجب ألا يسبق تاريخ الإصدار'
 if(!items.length||items.some(i=>!i.product_name.trim()||!Number.isFinite(i.quantity)||i.quantity<=0||!Number.isFinite(i.unit_price)||i.unit_price<0))return 'تحقق من أسماء البنود والكميات والأسعار'
 if(items.reduce((n,i)=>n+i.quantity*i.unit_price,0)<=0)return 'يجب أن يكون إجمالي العرض أكبر من الصفر'
 return ''
}
