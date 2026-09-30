// Read-only, no repair or deletion. Save detailed IDs locally, outside Git history.
const fs=require('node:fs')
const {Client}=require('pg')
const {loadEnvConfig}=require('@next/env')
loadEnvConfig(process.cwd())
const queries={
 incomplete_journals:`SELECT e.store_id,e.id AS source_id,e.entry_number AS reference,
   COALESCE(sum(l.debit),0)-COALESCE(sum(l.credit),0) AS difference
   FROM public.journal_entries e LEFT JOIN public.journal_lines l ON l.journal_entry_id=e.id
   WHERE e.status='posted' GROUP BY e.store_id,e.id
   HAVING count(l.id)<2 OR COALESCE(sum(l.debit),0)<>COALESCE(sum(l.credit),0) OR COALESCE(sum(l.debit),0)<=0`,
 stored_account_balance:`SELECT a.store_id,a.id AS source_id,a.code AS reference,
   COALESCE(a.balance,0)-COALESCE(sum(CASE WHEN a.normal_balance='credit' THEN l.credit-l.debit ELSE l.debit-l.credit END),0) AS difference
   FROM public.accounts a LEFT JOIN public.journal_lines l ON l.account_id=a.id
   LEFT JOIN public.journal_entries e ON e.id=l.journal_entry_id AND e.status='posted'
   WHERE a.is_group IS FALSE GROUP BY a.store_id,a.id
   HAVING abs(COALESCE(a.balance,0)-COALESCE(sum(CASE WHEN e.id IS NULL THEN 0 WHEN a.normal_balance='credit' THEN l.credit-l.debit ELSE l.debit-l.credit END),0))>=0.01`,
 duplicate_source_rule:`SELECT store_id,ref_id AS source_id,source || ':' || COALESCE(accounting_rule,'[missing]') AS reference,count(*)-1 AS difference
   FROM public.journal_entries WHERE ref_id IS NOT NULL AND status='posted' GROUP BY store_id,ref_id,source,accounting_rule HAVING count(*)>1`,
 invoice_cost_without_snapshot:`SELECT i.store_id,ii.id AS source_id,i.invoice_number AS reference,COALESCE(ii.quantity*ii.cost_price,0) AS difference
   FROM public.invoice_items ii JOIN public.invoices i ON i.id=ii.invoice_id WHERE ii.product_id IS NOT NULL AND ii.cost_snapshot_at IS NULL`,
 pos_without_invoice:`SELECT o.store_id,o.id AS source_id,o.order_number AS reference,COALESCE(o.total_amount,0) AS difference
   FROM public.orders o WHERE o.source='dashboard' AND o.status='delivered' AND NOT EXISTS(SELECT 1 FROM public.invoices i WHERE i.order_id=o.id)`,
 received_purchase_without_gl:`SELECT pi.store_id,pi.id AS source_id,pi.invoice_number AS reference,pi.total_amount AS difference
   FROM public.purchase_invoices pi WHERE pi.status='completed' AND NOT EXISTS(SELECT 1 FROM public.journal_entries e WHERE e.store_id=pi.store_id AND e.source='purchase' AND e.ref_id=pi.id AND e.status='posted')`,
 customer_ledger_balance:`SELECT c.store_id,c.id AS source_id,c.name AS reference,COALESCE(c.balance,0)-COALESCE(x.balance,0) AS difference
   FROM public.customers c LEFT JOIN LATERAL (SELECT balance FROM public.customer_ledger l WHERE l.customer_id=c.id AND l.store_id=c.store_id ORDER BY l.date DESC,l.created_at DESC,l.id DESC LIMIT 1) x ON true
   WHERE abs(COALESCE(c.balance,0)-COALESCE(x.balance,0))>=0.01`,
 check_state_mismatch:`SELECT c.store_id,c.id AS source_id,c.check_number AS reference,0::numeric AS difference
   FROM public.checks c JOIN LATERAL(SELECT to_status FROM public.check_operations o WHERE o.check_id=c.id ORDER BY o.created_at DESC,o.id DESC LIMIT 1) x ON true WHERE c.status IS DISTINCT FROM x.to_status`,
 check_voucher_mismatch:`SELECT c.store_id,c.id AS source_id,c.check_number AS reference,c.amount_ils AS difference
   FROM public.checks c JOIN public.vouchers v ON v.id=c.voucher_id WHERE c.store_id<>v.store_id OR c.customer_id IS DISTINCT FROM v.customer_id`,
 migrated_supplier_without_subledger:`SELECT s.store_id,s.id AS source_id,s.name AS reference,s.balance AS difference
   FROM public.suppliers s WHERE abs(COALESCE(s.balance,0))>=0.01 AND NOT EXISTS(SELECT 1 FROM public.supplier_ledger l WHERE l.supplier_id=s.id)`,
}
async function main(){
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing')
 const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});await client.connect()
 const result={capturedAt:new Date().toISOString(),baseline:'ed35b8e',notes:'Candidates for review; no balances were changed.',metrics:{}}
 try{await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout = '60s'")
 const {rows:columns}=await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='invoice_items' AND column_name='cost_snapshot_at') OR (table_name='supplier_ledger' AND column_name='id'))")
 const hasCost=columns.some(c=>c.table_name==='invoice_items')
 const hasSupplierLedger=columns.some(c=>c.table_name==='supplier_ledger')
 for(const [name,originalSql] of Object.entries(queries)){
  const sql=name==='invoice_cost_without_snapshot' && !hasCost ? originalSql.replace('ii.cost_snapshot_at IS NULL','TRUE') :
    name==='migrated_supplier_without_subledger' && !hasSupplierLedger ? originalSql.replace('AND NOT EXISTS(SELECT 1 FROM public.supplier_ledger l WHERE l.supplier_id=s.id)','') : originalSql
  try{const r=await client.query(sql);result.metrics[name]={status:'ok',count:r.rowCount,absoluteDifference:r.rows.reduce((sum,row)=>sum+Math.abs(Number(row.difference)||0),0),sample:r.rows.slice(0,50)}}
  catch(e){console.error('Failed metric',name,e.code,e.message);result.metrics[name]={status:'failed',error:e.code||e.message};await client.query('ROLLBACK');throw e}
 }
 await client.query('ROLLBACK')
 }finally{await client.end()}
 fs.mkdirSync('docs/audit',{recursive:true})
 fs.writeFileSync('docs/audit/historical-discrepancies.json',JSON.stringify(result,null,2)+'\n')
 const lines=['# تقرير فروقات البيانات التاريخية','',`وقت الفحص: ${result.capturedAt}`,'','هذا فحص مرشحات للمراجعة؛ لا يصحح أي سجل تلقائيًا. بعض الفروق قد تمثل أرصدة افتتاحية أو مستندات قديمة مشروعة وتتطلب تتبع المصدر.','','| الفحص | العدد | مجموع الفرق المطلق |','|---|---:|---:|']
 for(const [name,v] of Object.entries(result.metrics))lines.push(`| ${name} | ${v.count} | ${v.absoluteDifference.toFixed(2)} |`)
 lines.push('','خطة التصحيح: تثبيت نسخة احتياطية ونطاق تاريخي؛ مطابقة كل معرّف في الملف المحلي مع المستند والقيد والأستاذ المساعد؛ اعتماد سياسة أثر عكسي أو رصيد افتتاحي مصحح؛ ثم تطبيق تصحيح بمفتاح منع تكرار وإعادة تشغيل المطابقة. لا تُحذف الشيكات المصنفة مكررة بناءً على الرقم وحده.','')
 fs.writeFileSync('docs/audit/historical-discrepancies.md',lines.join('\n'))
 console.log('Read-only historical audit written; metric counts:',Object.fromEntries(Object.entries(result.metrics).map(([k,v])=>[k,v.count])))
}
main().catch(e=>{console.error('Historical audit failed:',e.code||e.message);process.exitCode=1})
