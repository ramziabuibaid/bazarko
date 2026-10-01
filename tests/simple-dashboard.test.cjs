const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const assert=require('node:assert/strict')
const {test}=require('node:test')
const source=fs.readFileSync(path.join(__dirname,'../lib/dashboard/simple-metrics.ts'),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
const loaded={exports:{}}
new Function('exports','module',compiled)(loaded.exports,loaded)
const {businessDay,salesMetrics,useSimpleDashboard}=loaded.exports

test('uses the Palestinian day across a UTC midnight boundary',()=>{
  const day=businessDay(new Date('2026-10-01T23:30:00Z'))
  assert.equal(day.date,'2026-10-02')
  assert.ok(day.start<='2026-10-01T23:30:00.000Z'&&day.end>'2026-10-01T23:30:00.000Z')
  for(const instant of ['2026-03-28T12:00:00Z','2026-10-24T12:00:00Z']){
    const bounds=businessDay(new Date(instant))
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hebron',hour:'2-digit',hourCycle:'h23'}).format(new Date(bounds.start))
    assert.equal(parts,'00')
    assert.ok(Date.parse(bounds.end)>Date.parse(bounds.start))
  }
})
test('counts an invoiced order once, independent sales, and remaining balances',()=>{
  const day=businessDay(new Date('2026-10-01T12:00:00Z'))
  const invoices=[{id:'i1',order_id:'linked',total:100,amount_paid:30,issue_date:day.date},{id:'i2',order_id:null,total:50,amount_paid:60,issue_date:day.date}]
  const orders=[{id:'linked',total_amount:100,amount_paid:30,status:'confirmed',created_at:day.start},{id:'other',total_amount:40,amount_paid:10,status:'delivered',created_at:day.start},{id:'pending',total_amount:900,amount_paid:0,status:'pending',created_at:day.start},{id:'tomorrow',total_amount:10,amount_paid:0,status:'confirmed',created_at:day.end}]
  assert.deepEqual(salesMetrics(invoices,orders,day),{sales:190,unpaid:110})
})
test('an invoice on another date suppresses its linked order without adding to today sales',()=>{
  const day=businessDay(new Date('2026-10-01T12:00:00Z'))
  assert.deepEqual(salesMetrics([{id:'old',order_id:'linked',total:80,amount_paid:0,issue_date:'2026-09-30'}],[{id:'linked',total_amount:80,amount_paid:0,status:'confirmed',created_at:day.start}],day),{sales:0,unpaid:80})
})
test('honors onboarding mode and defaults existing free stores to the simple dashboard',()=>{
  assert.equal(useSimpleDashboard('free',null),true)
  assert.equal(useSimpleDashboard('free',{dashboard_mode:'advanced'}),false)
  assert.equal(useSimpleDashboard('pro',{dashboard_mode:'simple'}),true)
  assert.equal(useSimpleDashboard('pro',{}),false)
})
