const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),m={exports:{}}
new Function('exports','module',ts.transpileModule(fs.readFileSync('lib/pos/cart.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m.exports,m)
const {allowedQuantity,cashChange,matchesProduct}=m.exports
 test('stock limits include zero, integers only',()=>{assert.equal(allowedQuantity(1,0),false);assert.equal(allowedQuantity(3,2),false);assert.equal(allowedQuantity(2,2),true);assert.equal(allowedQuantity(1.5,null),false);assert.equal(allowedQuantity(NaN,null),false)})
 test('cash change excludes excess tender from invoice payment',()=>{assert.deepEqual(cashChange(160,'200'),{received:200,valid:true,change:40});assert.equal(cashChange(160,'150').valid,false);assert.equal(cashChange(160,'').change,0);assert.equal(cashChange(160,'bad').valid,false)})
 test('search supports barcode and multiple name tokens',()=>{const p={name:'كابل شحن سريع',sku:'USB-A',barcode:'1000'};assert.equal(matchesProduct(p,'1000'),true);assert.equal(matchesProduct(p,'شحن كابل'),true);assert.equal(matchesProduct(p,'مفقود'),false)})
