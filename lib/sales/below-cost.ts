export interface BelowCostItemWarning {
  productId?: string | null
  name: string
  quantity: number
  unitCost: number
  grossUnitPrice: number
  netUnitPrice: number
  unitLoss: number
  totalLoss: number
}

export interface BelowCostAnalysis {
  hasBelowCost: boolean
  items: BelowCostItemWarning[]
  totalLoss: number
  itemsHash: string
}

export function computeItemsHash(
  items: Array<{
    productId?: string | null
    product_id?: string | null
    id?: string
    name?: string
    quantity: number | string
    unitPrice?: number | string
    unit_price?: number | string
    price?: number | string
    costPrice?: number | string | null
    cost_price?: number | string | null
  }>,
  discount: number = 0
): string {
  const normalized = items
    .map(i => {
      const id = i.productId || i.product_id || i.id || i.name || ''
      const qty = Number(i.quantity || 0)
      const price = Number(i.unitPrice ?? i.unit_price ?? i.price ?? 0)
      const cost = Number(i.costPrice ?? i.cost_price ?? 0)
      return `${id}:${qty}:${price}:${cost}`
    })
    .sort()
    .join('|')
  return `${normalized}#disc:${discount}`
}

/**
 * يفحص بنود المبيعات ويكتشف الأصناف المباعة بأقل من التكلفة المعتمدة في النظام
 * مع مراعاة توزيع الخصم العام بالتناسب لاحتساب صافي سعر بيع الوحدة الحقيقي
 */
export function checkBelowCostItems(
  items: Array<any>,
  param2: number | 'amount' | 'percent' = 0,
  param3: number = 0
): BelowCostAnalysis {
  let subtotal = 0
  let discount = 0

  // استخراج البنود الموحدة
  const normalizedItems = items.map(item => ({
    productId: item.productId || item.product_id || item.id || null,
    name: item.name || '',
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.unitPrice ?? item.unit_price ?? item.price ?? 0),
    costPrice: Number(item.costPrice ?? item.cost_price ?? 0),
  }))

  const rawSubtotal = normalizedItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0)

  if (typeof param2 === 'string') {
    // تم تمرير (items, discountType, discountValue)
    subtotal = rawSubtotal
    const discountType = param2
    const discountVal = Number(param3 || 0)
    discount = discountType === 'percent' ? (subtotal * discountVal) / 100 : discountVal
  } else {
    // تم تمرير (items, subtotal, discount)
    subtotal = param2 || rawSubtotal
    discount = Number(param3 || 0)
  }

  const belowCostItems: BelowCostItemWarning[] = []
  let totalLoss = 0

  // احتساب معامل صافي السعر بعد الخصم العام
  const effectiveSubtotal = Math.max(0, subtotal)
  const effectiveDiscount = Math.max(0, Math.min(discount, effectiveSubtotal))
  const discountFactor = effectiveSubtotal > 0 ? (effectiveSubtotal - effectiveDiscount) / effectiveSubtotal : 1

  for (const item of normalizedItems) {
    const cost = item.costPrice
    const qty = item.quantity
    const grossPrice = item.unitPrice

    // إذا لم يكن للصنف تكلفة مسجلة أو الكمية صفر أو سالبة، يتم تجاوزه
    if (cost <= 0 || qty <= 0) continue

    // صافي سعر بيع الوحدة بعد توزيع الخصومات الإجمالية
    const netPrice = Math.round(grossPrice * discountFactor * 100) / 100

    if (netPrice < cost) {
      const unitLoss = Math.round((cost - netPrice) * 100) / 100
      const lineLoss = Math.round(unitLoss * qty * 100) / 100

      belowCostItems.push({
        productId: item.productId,
        name: item.name,
        quantity: qty,
        unitCost: cost,
        grossUnitPrice: grossPrice,
        netUnitPrice: netPrice,
        unitLoss,
        totalLoss: lineLoss,
      })

      totalLoss += lineLoss
    }
  }

  const itemsHash = computeItemsHash(normalizedItems, effectiveDiscount)

  return {
    hasBelowCost: belowCostItems.length > 0,
    items: belowCostItems,
    totalLoss: Math.round(totalLoss * 100) / 100,
    itemsHash,
  }
}
