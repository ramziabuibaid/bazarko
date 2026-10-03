// Runs schema + fixtures inside one transaction; ALWAYS rolls back, including DDL.
const {Client}=require('pg'),fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');require('@next/env').loadEnvConfig(process.cwd())
;(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000,query_timeout:20000,application_name:'bazarko-rollback-invoice-test'});await c.connect();console.log('Connected; starting rollback test');let passed=0;try{
 await c.query('BEGIN');console.log('Transaction started');await c.query(fs.readFileSync('db/migrations/054_atomic_sales_invoice.sql','utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
 console.log('Migration compiled');
 const actor=(await c.query('select owner_id from public.stores limit 1')).rows[0]?.owner_id;if(!actor)throw Error('Existing actor required for rollback fixture');
 const store=randomUUID(),customer=randomUUID(),product=randomUUID(),box=randomUUID();
 await c.query("insert into stores(id,owner_id,country_code,name,subdomain,currency_code) values($1,$2,'PS','Rollback invoice fixture',$3,'ILS')",[store,actor,'rollback-'+store]);
 await c.query("insert into store_members(store_id,profile_id,role,is_active) values($1,$2,'owner',true) on conflict do nothing",[store,actor]);
 const tags={};for(const [i,tag,type,normal] of [[1,'CUSTOMER_RECEIVABLE','asset','debit'],[2,'SALES_REVENUE','revenue','credit'],[3,'CASH','asset','debit'],[4,'COGS','expense','debit'],[5,'INVENTORY','asset','debit']]){tags[tag]=randomUUID();await c.query('insert into accounts(id,store_id,code,name,type,normal_balance,account_tag) values($1,$2,$3,$4,$5,$6,$4)',[tags[tag],store,'TEST-'+i,tag,type,normal]);}
 await c.query("insert into cash_boxes(id,store_id,name,type,account_id) values($1,$2,'Rollback box','cash',$3)",[box,store,tags.CASH]);
 await c.query("insert into customers(id,store_id,name,balance) values($1,$2,'Rollback customer',0)",[customer,store]);
 await c.query("insert into products(id,store_id,name,slug,price,cost_price,stock_quantity,track_stock) values($1,$2,'Rollback product',($1::uuid)::text,35,20,10,true)",[product,store]);
 await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);await c.query('SET LOCAL ROLE authenticated');
 const base={issueDate:'2026-10-02',dueDate:'2026-10-10',customerId:customer,cashBoxId:box,discountType:'amount',discountValue:0,collectionMode:'partial',amountPaid:20,items:[{product_id:product,name:'Rollback product',sku:'',quantity:2,unit_price:35}]};
 const call=async(payload,key=randomUUID())=>(await c.query('select public.create_sales_invoice_atomic($1,$2,$3::jsonb) result',[store,key,JSON.stringify(payload)])).rows[0].result;
 const fail=async(payload,pattern,key)=>{await c.query('SAVEPOINT rejected');let message='';try{await call(payload,key)}catch(e){message=e.message}await c.query('ROLLBACK TO SAVEPOINT rejected');assert.match(message,pattern);passed++};
 console.log('Fixtures ready; testing atomic creation');
 const key=randomUUID(),r=await call(base,key);assert.equal(r.total,70);assert.equal(r.amountPaid,20);passed++;
 const replay=await call(base,key);assert.equal(replay.invoiceId,r.invoiceId);assert.equal(replay.replayed,true);passed++;
 await fail({...base,amountPaid:21},/سبق استخدامه/,key);
 await c.query('RESET ROLE');
 assert.equal(Number((await c.query('select stock_quantity from products where id=$1',[product])).rows[0].stock_quantity),8);
 assert.equal(Number((await c.query('select balance from customers where id=$1',[customer])).rows[0].balance),50);
 const state=(await c.query('select status,amount_paid from invoices where id=$1',[r.invoiceId])).rows[0];assert.equal(state.status,'partial');
 assert.equal((await c.query('select count(*)::int n from vouchers where invoice_id=$1',[r.invoiceId])).rows[0].n,1);
 assert.equal((await c.query('select count(*)::int n from cash_movements where ref_id=$1',[r.voucherId])).rows[0].n,1);
 const totals=(await c.query('select sum(l.debit)::numeric d,sum(l.credit)::numeric c from journal_lines l join journal_entries e on e.id=l.journal_entry_id where e.store_id=$1',[store])).rows[0];assert.equal(totals.d,totals.c);
 for(const [tag,expected] of Object.entries({CUSTOMER_RECEIVABLE:50,SALES_REVENUE:70,CASH:20,COGS:40,INVENTORY:-40})){assert.equal(Number((await c.query('select balance from accounts where id=$1',[tags[tag]])).rows[0].balance),expected)}passed++;
 await c.query('SET LOCAL ROLE authenticated');
 await fail({...base,amountPaid:71},/قيمة الدفعة/);await fail({...base,customerId:null},/زبوناً مسجلاً/);await fail({...base,cashBoxId:randomUUID()},/صندوقاً نقدياً/);
 await fail({...base,items:[{...base.items[0],quantity:99}]},/المخزون المتاح/);
 await c.query('RESET ROLE');assert.equal((await c.query('select count(*)::int n from invoices where store_id=$1',[store])).rows[0].n,1);assert.equal(Number((await c.query('select stock_quantity from products where id=$1',[product])).rows[0].stock_quantity),8);passed++;
 await c.query('SET LOCAL ROLE authenticated');
 const full=await call({...base,collectionMode:'full',customerId:null,items:[{...base.items[0],quantity:1}]});assert.equal(full.amountPaid,35);passed++;
 const unpaid=await call({...base,collectionMode:'none',cashBoxId:null,items:[{product_id:null,name:'Service',sku:'',quantity:1.5,unit_price:10}]});assert.equal(unpaid.amountPaid,0);assert.equal(unpaid.voucherId,null);passed++;
 await c.query('RESET ROLE');
 const before=(await c.query('select (select count(*) from invoices where store_id=$1) invoices,(select count(*) from vouchers where store_id=$1) vouchers,(select stock_quantity from products where id=$2) stock',( [store,product]))).rows[0];
 await c.query(`CREATE FUNCTION pg_temp.reject_invoice_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'late rollback probe'; END $$; CREATE TRIGGER rollback_invoice_probe BEFORE INSERT ON public.financial_audit_log FOR EACH ROW WHEN (NEW.store_id='${store}'::uuid) EXECUTE FUNCTION pg_temp.reject_invoice_audit()`);
 await c.query('SET LOCAL ROLE authenticated');await fail({...base,collectionMode:'full',items:[{...base.items[0],quantity:1}]},/late rollback probe/);await c.query('RESET ROLE');
 const after=(await c.query('select (select count(*) from invoices where store_id=$1) invoices,(select count(*) from vouchers where store_id=$1) vouchers,(select stock_quantity from products where id=$2) stock',[store,product])).rows[0];assert.deepEqual(after,before);passed++;
 await c.query('DROP TRIGGER rollback_invoice_probe ON public.financial_audit_log');
 await c.query("select set_config('request.jwt.claim.sub',$1,true)",[randomUUID()]);await c.query('SET LOCAL ROLE authenticated');await fail({...base},/غير مصرح/);await c.query('RESET ROLE');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
 await fail({...base,items:[{...base.items[0],product_id:randomUUID()}]},/منتج غير موجود/);
 await c.query('RESET ROLE');const quotation=randomUUID(),order=randomUUID();
 await c.query("insert into quotations(id,store_id,customer_id,quotation_number,status,subtotal,discount,tax_amount,total_amount,currency) values($1,$2,$3,'QT-ROLLBACK','sent',10,0,0,10,'ILS')",[quotation,store,customer]);
 await c.query("insert into orders(id,store_id,order_number,subtotal,total_amount,amount_paid) values($1,$2,'ORDER-ROLLBACK',1,1,1)",[order,store]);
 await c.query('SET LOCAL ROLE authenticated');
 const convertedPayload={...base,collectionMode:'none',quotationId:quotation,items:[{product_id:null,name:'Converted service',sku:'',quantity:1,unit_price:10}]};
 const converted=await call(convertedPayload);assert.ok(converted.invoiceId);passed++;
 await fail(convertedPayload,/عرض السعر غير متاح/);await fail({...base,orderId:order},/أثر مالي أو مخزني سابق/);
 await c.query('RESET ROLE');await c.query("insert into accounting_periods(store_id,period_name,start_date,end_date,is_closed) values($1,'Rollback closed','2026-10-01','2026-10-31',true)",[store]);await c.query('SET LOCAL ROLE authenticated');await fail({...base},/مقفلة/);
 console.log(JSON.stringify({passed,transactionRolledBack:true,realStoreTransactionsCreated:0}));
 }finally{await c.query('ROLLBACK');await c.end()}})().catch(e=>{console.error(e.message);process.exitCode=1})
