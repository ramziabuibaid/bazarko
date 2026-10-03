const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),m={exports:{}}
new Function('exports','module',ts.transpileModule(fs.readFileSync('lib/invoices/create-presentation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m.exports,m)
const {invoiceAmounts,validInvoiceInput}=m.exports
const items=[{name:'كابل',quantity:2,unit_price:35},{name:'شاحن',quantity:1,unit_price:90}]
test('fixed and percentage discounts produce correct amounts',()=>{assert.deepEqual(invoiceAmounts(items,'amount',10,50),{subtotal:160,discount:10,total:150,remaining:100});assert.equal(invoiceAmounts(items,'percent',10,0).total,144)})
test('currency rounding and fractional service quantities',()=>assert.equal(invoiceAmounts([{quantity:1.5,unit_price:9.99}],'amount',0,0).total,14.99))
test('rejects invalid items discounts and reversed dates',()=>{assert.ok(validInvoiceInput([{name:'a',quantity:NaN,unit_price:4}],'amount',0,'2026-10-01',''));assert.ok(validInvoiceInput(items,'percent',101,'2026-10-01',''));assert.ok(validInvoiceInput(items,'amount',161,'2026-10-01',''));assert.ok(validInvoiceInput(items,'amount',0,'2026-10-01','2026-09-01'));assert.ok(validInvoiceInput(items,'amount',0,'2026-02-30',''));assert.equal(validInvoiceInput(items,'amount',10,'2026-10-01','2026-10-02'),'')})

test('rounds each invoice line before summing, matching database',()=>assert.equal(invoiceAmounts([{quantity:0.55,unit_price:0.01},{quantity:0.55,unit_price:0.01}],'amount',0,0).subtotal,0.02))
