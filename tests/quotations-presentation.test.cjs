const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
const source=ts.transpileModule(fs.readFileSync('lib/quotations/presentation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,m={exports:{}};new Function('exports','module',source)(m.exports,m)
const {quoteExpired,validQuote,calculateQuotationTotals,formatQuoteShareMessage}=m.exports
const row={product_name:'خدمة',quantity:1,unit_price:35}
test('expiry respects end date and terminal states',()=>{assert.equal(quoteExpired({status:'sent',valid_until:'2026-10-01'},'2026-10-01'),false);assert.equal(quoteExpired({status:'sent',valid_until:'2026-09-30'},'2026-10-01'),true);for(const status of ['draft','converted','rejected'])assert.equal(quoteExpired({status,valid_until:'2026-09-30'},'2026-10-01'),false)})
test('rejects invalid quantities, prices, dates and totals',()=>{assert.equal(validQuote([row],'2026-10-01','2026-10-15'),'');for(const item of [{...row,quantity:-1},{...row,quantity:Infinity},{...row,unit_price:NaN},{...row,unit_price:-2},{...row,product_name:''}])assert.ok(validQuote([item],'2026-10-01','2026-10-15'));assert.ok(validQuote([row],'2026-10-15','2026-10-01'));assert.ok(validQuote([{...row,unit_price:0}],'2026-10-01','2026-10-15'))})
test('calculateQuotationTotals accurately computes gifts, special discounts, costs and profits',()=>{
  const testItems = [
    { product_name: 'كاميرا', quantity: 2, unit_price: 200, cost_price: 140, is_gift: false },
    { product_name: 'كابل هدية', quantity: 1, unit_price: 50, cost_price: 20, is_gift: true },
  ]
  // subtotal = 450, giftDiscount = 50, afterGifts = 400
  // special discount = 10% on 400 = 40 => totalDiscount = 90, netTotal = 360
  // totalCost = (2*140) + (1*20) = 300 => profit = 360 - 300 = 60
  const totals = calculateQuotationTotals(testItems, 'percent', 10)
  assert.equal(totals.subtotal, 450)
  assert.equal(totals.giftDiscount, 50)
  assert.equal(totals.specialDiscount, 40)
  assert.equal(totals.totalDiscount, 90)
  assert.equal(totals.netTotal, 360)
  assert.equal(totals.totalCost, 300)
  assert.equal(totals.totalProfit, 60)
  assert.equal(totals.giftCount, 1)

  // With fixed amount discount
  const totalsFixed = calculateQuotationTotals(testItems, 'amount', 30)
  assert.equal(totalsFixed.subtotal, 450)
  assert.equal(totalsFixed.giftDiscount, 50)
  assert.equal(totalsFixed.specialDiscount, 30)
  assert.equal(totalsFixed.totalDiscount, 80)
  assert.equal(totalsFixed.netTotal, 370)
  assert.equal(totalsFixed.totalCost, 300)
  assert.equal(totalsFixed.totalProfit, 70)
})
test('formatQuoteShareMessage includes quotation details, discounts and public link',()=>{
  const msg = formatQuoteShareMessage({
    storeName: 'شركة المنار',
    quotationNumber: 'QT-123456',
    customerName: 'أحمد',
    netTotal: 360,
    currency: 'ILS',
    publicUrl: 'https://bazarko.app/store/ps/almnarj/quotation/123',
    giftDiscount: 50,
    specialDiscount: 40
  })
  assert.ok(msg.includes('شركة المنار'))
  assert.ok(msg.includes('QT-123456'))
  assert.ok(msg.includes('أحمد'))
  assert.ok(msg.includes('50'))
  assert.ok(msg.includes('40'))
  assert.ok(msg.includes('https://bazarko.app/store/ps/almnarj/quotation/123'))
})
