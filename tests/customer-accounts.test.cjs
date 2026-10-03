const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),m={exports:{}}
new Function('exports','module',ts.transpileModule(fs.readFileSync('lib/customers/accounts.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m.exports,m)
const {accountStats,calculateStatement,validStatementRange}=m.exports
const tx=(id,date,debit,credit)=>({id,date,debit,credit,type:'حركة',doc_no:id,description:''})
test('keeps creditor and debtor totals separate',()=>assert.deepEqual(accountStats([{balance:200},{balance:-150},{balance:0}]),{totalDebt:200,totalCredit:150,debtorsCount:1,creditorsCount:1,clearedCount:1,totalCount:3}))
test('opening balance plus period movement equals closing, excluding later movements',()=>{const r=calculateStatement([tx('3','2026-10-04',40,0),tx('1','2026-09-30',500,0),tx('2','2026-10-01',0,150)],'2026-10-01','2026-10-01');assert.equal(r.openingBalance,500);assert.equal(r.totalCredit,150);assert.equal(r.closingBalance,350);assert.equal(r.rows.length,1)})
test('same date order is stable and empty period preserves prior balance',()=>{const a=tx('a','2026-10-01',100,0),b=tx('b','2026-10-01',0,20);assert.deepEqual(calculateStatement([b,a]).rows.map(r=>r.balance),[100,80]);assert.equal(calculateStatement([a,b],'2026-10-03','2026-10-04').closingBalance,80)})
test('rejects reversed or invalid date ranges',()=>{assert.equal(validStatementRange('2026-10-02','2026-10-01'),false);assert.equal(validStatementRange('2026-02-30',''),false);assert.equal(validStatementRange('',''),true)})
