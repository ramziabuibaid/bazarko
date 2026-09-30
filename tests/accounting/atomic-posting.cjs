const fs = require('node:fs')
const assert = require('node:assert/strict')
const { PGlite } = require(process.env.PGLITE_MODULE || '/private/tmp/bazarko-db-test/node_modules/@electric-sql/pglite')
const snapshot = require('../../docs/audit/deployed-schema.json')
const q = s => '"' + s.replaceAll('"','""') + '"'
async function main() {
 let server
 let db
 if (process.env.LOCAL_POSTGRES === '1') {
   const { default: EmbeddedPostgres } = await import('/private/tmp/bazarko-postgres/node_modules/embedded-postgres/dist/index.js')
   server = new EmbeddedPostgres({databaseDir:fs.mkdtempSync('/private/tmp/bazarko-pg-'),port:55439,user:'postgres',password:'isolated-test',persistent:false,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}})
   await server.initialise();await server.start()
   const client=server.getPgClient();await client.connect()
   db={query:(...args)=>client.query(...args),exec:sql=>client.query(sql),close:async()=>{await client.end();await server.stop()}}
 } else db = new PGlite()
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`)
 const tables = new Map()
 for(const c of snapshot.tableColumns) {
  if(!tables.has(c.table_name)) tables.set(c.table_name,[])
  let def = c.default_expression
  if(def?.includes('nextval(')) {
    const seq=def.match(/nextval\('([^']+)'/)[1]
    await db.exec(`CREATE SEQUENCE IF NOT EXISTS ${seq}`)
  }
  tables.get(c.table_name).push(`${q(c.column_name)} ${c.sql_type}${c.attgenerated ? ` GENERATED ALWAYS AS (${def}) STORED` : def ? ` DEFAULT ${def}` : ''}${c.attnotnull ? ' NOT NULL' : ''}`)
 }
 for(const [name,cols] of tables) await db.exec(`CREATE TABLE public.${q(name)} (${cols.join(',')})`)
 for(const c of snapshot.constraints.filter(c=>!c.definition.startsWith('FOREIGN KEY'))) {
   await db.exec(`ALTER TABLE ${c.relation} ADD CONSTRAINT ${q(c.conname)} ${c.definition}`)
 }
 for(const name of ['is_store_member','generate_sequence_number']) await db.exec(snapshot.functions.find(f=>f.signature.startsWith(name+'(')).definition)
 for(const name of ['create_default_accounts','ensure_full_chart_of_accounts','voucher_delete_cash_movement','handle_new_store','handle_new_user','record_offer_sale','ensure_cash_box','voucher_to_cash_movement','voucher_update_cash_movement','sync_voucher_checks_to_portfolio','sync_journal_entry_source_fields','sync_journal_line_tag']) {
   const f=snapshot.functions.find(f=>f.signature.startsWith(name+'(')); if(f) await db.exec(f.definition)
 }
 for(const path of ['054_atomic_journal_posting.sql','055_financial_reference_guards.sql','056_check_lifecycle.sql','057_periods_and_reversals.sql','058_atomic_storefront_checkout.sql','059_atomic_pos_sale.sql','060_atomic_purchase_receipt.sql','061_explicit_reporting_classification.sql','062_document_period_guards_and_order_reservations.sql','063_security_definer_guards.sql','064_atomic_invoice_payment.sql','065_order_email_outbox.sql','066_atomic_manual_sales_invoice.sql','067_atomic_direct_purchase.sql','068_atomic_voucher_creation.sql','069_cancel_unpaid_sales_invoice.sql','070_posted_document_immutability.sql']) await db.exec(fs.readFileSync('db/migrations/'+path,'utf8'))
 for(const t of snapshot.triggers.filter(t=>['trg_voucher_cash_in','trg_voucher_cash_upd','trg_voucher_sync_checks','trg_sync_journal_entry_source_fields','trg_sync_journal_line_tag'].includes(t.tgname))) await db.exec(t.definition)
 const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
 const user=id(1), store=id(2), other=id(3), debit=id(4), credit=id(5), viewer=id(6)
 await db.exec(`INSERT INTO auth.users VALUES ('${user}'),('${viewer}');
 INSERT INTO profiles(id) VALUES ('${user}'),('${viewer}');
 INSERT INTO stores(id,owner_id,country_code,currency_code,name,subdomain) VALUES ('${store}','${user}','PS','ILS','Test','test'),('${other}','${user}','PS','ILS','Other','other');
 INSERT INTO store_members(store_id,profile_id,role) VALUES ('${store}','${user}','owner'),('${store}','${viewer}','viewer');
 INSERT INTO accounts(id,store_id,code,name,type,normal_balance,is_group,is_active,balance,account_tag) VALUES
 ('${debit}','${store}','cash','Cash','asset','debit',false,true,1000,'CASH'),
 ('${credit}','${store}','sale','Sales','revenue','credit',false,true,0,'SALES_REVENUE');
 SELECT set_config('request.jwt.claim.sub','${user}',false);`)
 const payload={storeId:store,date:'2026-09-30',description:'Test',source:'manual',idempotencyKey:'test-1',lines:[
  {account_id:debit,debit:100,credit:0},{account_id:debit,debit:200,credit:0},{account_id:credit,debit:0,credit:300}]}
 const post = p=>db.query('select post_journal_entry_atomic($1::jsonb) as result',[JSON.stringify(p)])
 const balance=async()=>Number((await db.query('select balance from accounts where id=$1',[debit])).rows[0].balance)
 const counts=async()=>(await db.query('select (select count(*) from journal_entries) entries,(select count(*) from journal_lines) lines,(select count(*) from financial_audit_log) audit')).rows[0]
 const a=(await post(payload)).rows[0].result
 assert.equal(await balance(),1300)
 assert.deepEqual((await post(payload)).rows[0].result,a)
 assert.equal(await balance(),1300)
 await assert.rejects(post({...payload,description:'changed'}),/مفتاح/)
 const initial=await counts()
 await assert.rejects(post({...payload,idempotencyKey:'cross',storeId:other}),/مخول/)
 await db.exec(`SELECT set_config('request.jwt.claim.sub','${viewer}',false)`)
 await assert.rejects(post({...payload,idempotencyKey:'viewer'}),/مخول/)
 await db.exec(`SELECT set_config('request.jwt.claim.sub','${user}',false)`)
 await assert.rejects(post({...payload,idempotencyKey:'invalid',lines:[{account_id:debit,debit:1,credit:0},{account_id:credit,debit:0,credit:2}]}),/متوازن/)
 await assert.rejects(post({...payload,idempotencyKey:'missing',lines:[{account_id:id(99),debit:300,credit:0},payload.lines[2]]}),/حساب/)
 assert.deepEqual(await counts(),initial)
 // A failure after lines, balances and source binding must roll everything back.
 await db.exec(`CREATE FUNCTION fail_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$;
 CREATE TRIGGER fail_audit_test BEFORE INSERT ON financial_audit_log FOR EACH ROW EXECUTE FUNCTION fail_audit_test();`)
 await assert.rejects(post({...payload,idempotencyKey:'rollback'}),/injected audit failure/)
 assert.equal(await balance(),1300);assert.deepEqual(await counts(),initial)
 await db.exec('DROP TRIGGER fail_audit_test ON financial_audit_log')
 await db.exec(`INSERT INTO accounting_periods(store_id,period_name,start_date,end_date,is_closed) VALUES ('${store}','Closed','2026-09-01','2026-09-30',true)`)
 await assert.rejects(post({...payload,idempotencyKey:'closed'}),/مقفلة/)
 assert.equal(await balance(),1300)
 await db.exec("UPDATE accounting_periods SET is_closed=false,notes='test reopen reason'")
 await assert.rejects(db.query('select resolve_financial_account($1,$2,$3)',[store,'CASH',id(99)]),/الصندوق/)
 const spoof=(await post({...payload,idempotencyKey:'spoof',actorId:viewer})).rows[0].result
 const actor=(await db.query('select created_by from journal_entries where id=$1',[spoof.entryId])).rows[0].created_by
 assert.equal(actor,user)
 // Same-day cheque deposit and collection, state enforcement, custody without journal.
 const portfolio=id(10), collection=id(11), bounced=id(12), bankAccount=id(13), bank=id(14), cheque=id(15), box=id(16)
 await db.exec(`INSERT INTO accounts(id,store_id,code,name,type,normal_balance,is_group,is_active,balance,account_tag) VALUES
 ('${portfolio}','${store}','p','Portfolio','asset','debit',false,true,500,'CHEQUES_IN_HAND'),
 ('${collection}','${store}','u','Collection','asset','debit',false,true,0,'CHECKS_UNDER_COLLECTION'),
 ('${bounced}','${store}','b','Bounced','asset','debit',false,true,0,'CHECKS_BOUNCED'),
 ('${bankAccount}','${store}','bank','Bank','asset','debit',false,true,0,'BANK');
 INSERT INTO bank_accounts(id,store_id,bank_code,bank_name,account_number,account_id) VALUES ('${bank}','${store}','TEST','Test bank','123','${bankAccount}');
 INSERT INTO cash_boxes(id,store_id,name,account_id) VALUES ('${box}','${store}','Test cash','${debit}');
 INSERT INTO checks(id,store_id,type,check_number,bank_name,amount,amount_ils,due_date) VALUES ('${cheque}','${store}','received','123','Test bank',500,500,'2026-09-30');`)
 const op=(type,bankId=null,boxId=null)=>db.query('select execute_check_lifecycle_operation($1,$2,$3,$4,$5)',[cheque,type,'2026-09-30',bankId,boxId])
 const beforeCustody=await counts()
 await op('transfer_cashbox',null,box)
 assert.equal((await counts()).entries,beforeCustody.entries)
 await op('deposit',bank)
 await op('collect',bank)
 await assert.rejects(op('collect',bank),/الانتقال/)
 assert.equal(Number((await db.query('select balance from accounts where id=$1',[bankAccount])).rows[0].balance),500)
 assert.equal(Number((await db.query('select balance from accounts where id=$1',[collection])).rows[0].balance),0)
 await assert.rejects(db.query('delete from journal_entries where id=$1',[a.entryId]),/حذف/)
 await assert.rejects(db.query('update journal_lines set debit=debit+1 where journal_entry_id=$1',[a.entryId]),/محفوظة/)
 await assert.rejects(db.query('select update_journal_entry_with_sync($1,$2,$3,$4)',[a.entryId,'2026-09-30','changed',JSON.stringify([{account_id:debit,debit:300,credit:0},{account_id:credit,debit:0,credit:300}])]),/عكس/)
 const originalRef=id(30)
 const orig=(await post({...payload,idempotencyKey:'reversible',refId:originalRef})).rows[0].result
 const beforeReverse=await balance()
 const reversal=await db.query('select reverse_journals_for_source($1,$2,$3,$4,$5)',[store,originalRef,'manual','test reason','2026-09-30'])
 assert.equal(await balance(),beforeReverse-300)
 await db.query('select reverse_journals_for_source($1,$2,$3,$4,$5)',[store,originalRef,'manual','test reason','2026-09-30'])
 assert.equal(await balance(),beforeReverse-300)
 assert.equal((await db.query('select status from journal_entries where id=$1',[orig.entryId])).rows[0].status,'posted')
 assert.equal((await db.query('select count(*)::integer n from journal_entries where reversal_of=$1',[orig.entryId])).rows[0].n,1)
 const product=id(40)
 await db.exec(`INSERT INTO products(id,store_id,name,slug,price,cost_price,stock_quantity,status) VALUES ('${product}','${store}','Product','product',100,60,2,'active')`)
 const cart={storeId:store,items:[{productId:product,quantity:1,price:-500,name:'Fake'}],shippingCost:-500,form:{name:'Buyer',phone:'0599999999',payment_method:'online'}}
 const checkout=(body,key)=>db.query('select create_storefront_order_atomic($1,$2) result',[JSON.stringify(body),key])
 const order=(await checkout(cart,id(41))).rows[0].result
 assert.deepEqual((await checkout(cart,id(41))).rows[0].result,order)
 const saved=(await db.query('select total_amount,amount_paid,payment_status from orders where id=$1',[order.orderId])).rows[0]
 assert.equal(Number(saved.total_amount),100);assert.equal(Number(saved.amount_paid),0);assert.equal(saved.payment_status,'unpaid')
 assert.equal(Number((await db.query('select stock_reserved from products where id=$1',[product])).rows[0].stock_reserved),1)
 await assert.rejects(checkout({...cart,items:[{productId:product,quantity:2}]},id(42)),/متوفرة/)
 await assert.rejects(checkout({...cart,items:[{productId:product,quantity:-1}]},id(43)),/الكمية/)
 await assert.rejects(checkout({...cart,items:[{productId:id(99),quantity:1}]},id(44)),/المنتج/)
 await db.exec(`CREATE FUNCTION fail_order_item_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected item failure'; END $$;
 CREATE TRIGGER fail_order_item_test BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION fail_order_item_test()`)
 const orderCount=(await db.query('select count(*) n from orders')).rows[0].n
 await assert.rejects(checkout(cart,id(45)),/injected item failure/)
 assert.equal((await db.query('select count(*) n from orders')).rows[0].n,orderCount)
 assert.equal(Number((await db.query('select stock_reserved from products where id=$1',[product])).rows[0].stock_reserved),1)
 await db.exec('DROP TRIGGER fail_order_item_test ON order_items')
 const ar=id(50),cogs=id(51),inventory=id(52),customerId=id(53),posProduct=id(54)
 await db.exec(`INSERT INTO accounts(id,store_id,code,name,type,normal_balance,is_group,is_active,balance,account_tag) VALUES
 ('${ar}','${store}','ar','AR','asset','debit',false,true,0,'CUSTOMER_RECEIVABLE'),
 ('${cogs}','${store}','cogs','COGS','expense','debit',false,true,0,'COGS'),
 ('${inventory}','${store}','inventory','Inventory','asset','debit',false,true,600,'INVENTORY');
 UPDATE cash_boxes SET is_default=true WHERE id='${box}';
 INSERT INTO customers(id,store_id,name,account_id) VALUES ('${customerId}','${store}','Buyer','${ar}');
 INSERT INTO products(id,store_id,name,slug,price,cost_price,stock_quantity,status) VALUES ('${posProduct}','${store}','POS product','pos-product',1000,600,1,'active')`)
 const sale={mode:'pos',customerId,items:[{productId:posProduct,quantity:1,unitPrice:1000}],payments:[
   {method:'cash',amount:300,cashBoxId:box},{method:'check',amount:400,check:{check_number:'mixed-1',bank_name:'Test',due_date:'2026-10-10'}}]}
 const sell=(body,key)=>db.query('select create_pos_sale_atomic($1,$2,$3) result',[store,JSON.stringify(body),key])
 const cashBefore=await balance()
 const saleResult=(await sell(sale,id(55))).rows[0].result
 assert.deepEqual((await sell(sale,id(55))).rows[0].result,saleResult)
 assert.equal(await balance(),cashBefore+300)
 assert.equal(Number((await db.query('select balance from customers where id=$1',[customerId])).rows[0].balance),300)
 assert.equal(Number((await db.query('select balance from accounts where id=$1',[ar])).rows[0].balance),300)
 assert.equal(Number((await db.query('select balance from accounts where id=$1',[cogs])).rows[0].balance),600)
 assert.equal(Number((await db.query('select balance from accounts where id=$1',[inventory])).rows[0].balance),0)
 assert.equal((await db.query('select count(*)::integer n from checks where check_number=$1 and voucher_id is not null',['mixed-1'])).rows[0].n,1)
 assert.equal(Number((await db.query('select sum(amount) amount from cash_movements where source=$1',['voucher'])).rows[0].amount),300)
 await assert.rejects(sell(sale,id(56)),/متوفرة/)
 await db.exec(`UPDATE products SET cost_price=900,stock_quantity=1 WHERE id='${posProduct}'`)
 assert.equal(Number((await db.query('select cost_price from invoice_items where invoice_id=$1',[saleResult.invoiceId])).rows[0].cost_price),600)
 await db.exec(`CREATE TRIGGER fail_audit_test BEFORE INSERT ON financial_audit_log FOR EACH ROW EXECUTE FUNCTION fail_audit_test()`)
 const posOrders=(await db.query('select count(*) n from orders')).rows[0].n
 await assert.rejects(sell({...sale,payments:[{method:'cash',amount:1000}]},id(57)),/injected audit failure/)
 assert.equal((await db.query('select count(*) n from orders')).rows[0].n,posOrders)
 assert.equal((await db.query('select stock_quantity from products where id=$1',[posProduct])).rows[0].stock_quantity,1)
 await db.exec('DROP TRIGGER fail_audit_test ON financial_audit_log')
 const pay=(key,amt)=>db.query('select record_invoice_payment_atomic($1,$2,$3,$4,$5,$6,$7) result',[saleResult.invoiceId,amt,'cash',box,null,false,key])
 const invoicePayment=(await pay(id(90),100)).rows[0].result
 assert.deepEqual((await pay(id(90),100)).rows[0].result,invoicePayment)
 assert.equal(Number((await db.query('select amount_paid from invoices where id=$1',[saleResult.invoiceId])).rows[0].amount_paid),800)
 assert.equal(Number((await db.query('select balance from customers where id=$1',[customerId])).rows[0].balance),200)
 await assert.rejects(pay(id(91),250),/يتجاوز/)
 console.log('PASS: invoice cash payment atomically updates voucher, GL, customer and invoice once; overpayment rejected.')
 const supplierId=id(80),poId=id(81),receiptProduct=id(82),supplierAccount=id(83)
 await db.exec(`INSERT INTO accounts(id,store_id,code,name,type,normal_balance,is_group,is_active,balance,account_tag) VALUES ('${supplierAccount}','${store}','ap','AP','liability','credit',false,true,0,'SUPPLIER_PAYABLE');
 INSERT INTO suppliers(id,store_id,name) VALUES ('${supplierId}','${store}','Supplier');
 INSERT INTO products(id,store_id,name,slug,price,cost_price,stock_quantity,status) VALUES ('${receiptProduct}','${store}','Receipt product','receipt-product',40,10,3,'active');
 INSERT INTO purchase_orders(id,store_id,order_number,supplier_id,status,subtotal,tax_amount,discount_amount,total) VALUES
 ('${poId}','${store}','PO-1','${supplierId}','confirmed',50,0,0,50);
 INSERT INTO purchase_order_items(purchase_order_id,product_id,item_name,quantity,unit_price,total)
 VALUES ('${poId}','${receiptProduct}','Receipt product',2,25,50);`)
 const receive=()=>db.query('select receive_purchase_order_atomic($1,$2) result',[poId,true])
 const received=(await receive()).rows[0].result
 assert.deepEqual((await receive()).rows[0].result,received)
 assert.equal(Number((await db.query('select stock_quantity from products where id=$1',[receiptProduct])).rows[0].stock_quantity),5)
 assert.equal(Number((await db.query('select balance from suppliers where id=$1',[supplierId])).rows[0].balance),50)
 assert.equal(Number((await db.query('select balance from accounts where id=$1',[inventory])).rows[0].balance),50)
 assert.equal((await db.query('select count(*)::integer n from supplier_ledger where supplier_id=$1',[supplierId])).rows[0].n,1)
 console.log('PASS: confirmed PO receipt creates one invoice, stock, supplier subledger and general ledger; retry has no duplicate.')
 const manualProduct=id(100)
 await db.exec(`INSERT INTO products(id,store_id,name,slug,price,cost_price,stock_quantity,status) VALUES ('${manualProduct}','${store}','Manual product','manual-product',120,70,3,'active')`)
 const manualBody={issueDate:'2026-09-30',paymentMethod:'cash',discountType:'amount',discountValue:0,customerId,items:[{product_id:manualProduct,name:'Manual product',sku:'M-1',quantity:1,unit_price:120}]}
 const manual=(body,key)=>db.query('select create_sales_invoice_atomic($1,$2,$3) result',[store,JSON.stringify(body),key])
 const manualBefore=await balance()
 const manualResult=(await manual(manualBody,id(101))).rows[0].result
 await assert.rejects(db.query('update invoices set total=total+1 where id=$1',[manualResult.invoiceId]),/ثابتة/)
 await assert.rejects(db.query('update invoice_items set quantity=quantity+1 where invoice_id=$1',[manualResult.invoiceId]),/ثابتة/)
 assert.deepEqual((await manual(manualBody,id(101))).rows[0].result,manualResult)
 assert.equal(await balance(),manualBefore+120)
 assert.equal(Number((await db.query('select stock_quantity from products where id=$1',[manualProduct])).rows[0].stock_quantity),2)
 assert.equal((await db.query('select count(*)::integer n from vouchers where invoice_id=$1',[manualResult.invoiceId])).rows[0].n,1)
 assert.equal(Number((await db.query('select balance from customers where id=$1',[customerId])).rows[0].balance),200)
 await assert.rejects(manual({...manualBody,discountValue:1},id(101)),/مختلف/)
 await db.exec('CREATE TRIGGER fail_audit_test BEFORE INSERT ON financial_audit_log FOR EACH ROW EXECUTE FUNCTION fail_audit_test()')
 await assert.rejects(manual({...manualBody,items:[{...manualBody.items[0],quantity:1}]},id(102)),/injected audit failure/)
 assert.equal(Number((await db.query('select stock_quantity from products where id=$1',[manualProduct])).rows[0].stock_quantity),2)
 assert.equal((await db.query('select count(*)::integer n from invoices where create_key=$1',[id(102)])).rows[0].n,0)
 await db.exec('DROP TRIGGER fail_audit_test ON financial_audit_log')
 console.log('PASS: manual cash invoice is atomic across stock, voucher, GL and customer; retry and late failure are safe.')
 const oldCreditBody={...manualBody,issueDate:'2026-08-29',paymentMethod:'credit',items:[{product_id:null,name:'Service',sku:'',quantity:1,unit_price:30}]}
 const oldCredit=(await manual(oldCreditBody,id(105))).rows[0].result
 await db.exec(`INSERT INTO accounting_periods(store_id,period_name,start_date,end_date,is_closed) VALUES ('${store}','August','2026-08-01','2026-08-31',true)`)
 const oldPayment=(await db.query('select record_invoice_payment_atomic($1,$2,$3,$4,$5,$6,$7) result',[oldCredit.invoiceId,30,'cash',box,null,false,id(106)])).rows[0].result
 assert.equal(oldPayment.ok,true)
 assert.equal((await db.query('select status from invoices where id=$1',[oldCredit.invoiceId])).rows[0].status,'paid')
 await assert.rejects(db.query('update invoices set total=31 where id=$1',[oldCredit.invoiceId]),/مقفلة/)
 console.log('PASS: an open-period receipt settles an older closed-period invoice without altering its original amount.')
 const cancellable=(await manual({...manualBody,paymentMethod:'credit'},id(111))).rows[0].result
 const cancellationStock=Number((await db.query('select stock_quantity from products where id=$1',[manualProduct])).rows[0].stock_quantity)
 const cancellation=(await db.query('select cancel_unpaid_sales_invoice_atomic($1,$2) result',[cancellable.invoiceId,'Customer request'])).rows[0].result
 assert.equal(cancellation.ok,true)
 assert.equal((await db.query('select status from invoices where id=$1',[cancellable.invoiceId])).rows[0].status,'cancelled')
 assert.equal(Number((await db.query('select stock_quantity from products where id=$1',[manualProduct])).rows[0].stock_quantity),cancellationStock+1)
 assert.equal((await db.query('select count(*)::integer n from journal_entries where reversal_of=(select journal_entry_id from invoices where id=$1)',[cancellable.invoiceId])).rows[0].n,1)
 assert.equal((await db.query('select count(*)::integer n from customer_ledger where reference_id=$1 and type=$2',[cancellable.invoiceId,'return'])).rows[0].n,1)
 assert.equal((await db.query('select cancel_unpaid_sales_invoice_atomic($1,$2) result',[cancellable.invoiceId,'Customer request'])).rows[0].result.alreadyCancelled,true)
 await assert.rejects(db.query('select cancel_unpaid_sales_invoice_atomic($1,$2)',[manualResult.invoiceId,'No refund']),/المسددة/)
 console.log('PASS: unpaid manual invoice cancellation preserves original, reverses GL and customer balance, restores stock once; paid invoice rejected.')
 const directPurchaseBody={supplierId,invoiceDate:'2026-09-30',paymentMethod:'cash',supplierInvoiceNumber:'SUP-123',items:[{productId:receiptProduct,quantity:2,unitPrice:20}]}
 const directPurchase=(body,key)=>db.query('select create_purchase_invoice_atomic($1,$2,$3) result',[store,JSON.stringify(body),key])
 const purchaseCashBefore=await balance()
 const directResult=(await directPurchase(directPurchaseBody,id(103))).rows[0].result
 await assert.rejects(db.query('update purchase_invoices set total_amount=total_amount+1 where id=$1',[directResult.invoiceId]),/ثابتة/)
 await assert.rejects(db.query('delete from purchase_items where purchase_invoice_id=$1',[directResult.invoiceId]),/ثابتة/)
 assert.deepEqual((await directPurchase(directPurchaseBody,id(103))).rows[0].result,directResult)
 assert.equal(await balance(),purchaseCashBefore-40)
 assert.equal(Number((await db.query('select stock_quantity from products where id=$1',[receiptProduct])).rows[0].stock_quantity),7)
 assert.equal(Number((await db.query('select balance from suppliers where id=$1',[supplierId])).rows[0].balance),50)
 assert.equal((await db.query('select count(*)::integer n from vouchers where purchase_invoice_id=$1',[directResult.invoiceId])).rows[0].n,1)
 await db.exec('CREATE TRIGGER fail_audit_test BEFORE INSERT ON financial_audit_log FOR EACH ROW EXECUTE FUNCTION fail_audit_test()')
 await assert.rejects(directPurchase(directPurchaseBody,id(104)),/injected audit failure/)
 assert.equal(Number((await db.query('select stock_quantity from products where id=$1',[receiptProduct])).rows[0].stock_quantity),7)
 assert.equal((await db.query('select count(*)::integer n from purchase_invoices where create_key=$1',[id(104)])).rows[0].n,0)
 await db.exec('DROP TRIGGER fail_audit_test ON financial_audit_log')
 console.log('PASS: direct cash purchase is atomic across stock, supplier, payment voucher and GL; retry and rollback are safe.')
 const linkedInvoice=(await manual({...oldCreditBody,issueDate:'2026-09-30'},id(107))).rows[0].result
 const voucherBody={type:'receipt',date:'2026-09-30',payment_method:'split',amount:30,cash_amount:10,checks_amount:20,
   customer_id:customerId,invoice_id:linkedInvoice.invoiceId,party_name:'Buyer',description:'Split receipt',checks:[{check_number:'V-1',bank_name:'Bank',amount:20,due_date:'2026-10-10'}]}
 const createVoucher=(body,key)=>db.query('select create_voucher_atomic($1,$2,$3) result',[store,JSON.stringify(body),key])
 const voucherResult=(await createVoucher(voucherBody,id(108))).rows[0].result
 await assert.rejects(createVoucher({...voucherBody,type:'payment',customer_id:null,invoice_id:null,supplier_id:supplierId,payment_method:'cheque',amount:20,cash_amount:0,checks_amount:20},id(112)),/دورة إصدار وتسوية/)
 await db.exec(`SELECT set_config('request.jwt.claim.sub','${viewer}',false)`)
 await assert.rejects(createVoucher(voucherBody,id(113)),/مخول/)
 await db.exec(`SELECT set_config('request.jwt.claim.sub','${user}',false)`)
 await assert.rejects(db.query('update vouchers set amount=amount+1 where id=$1',[voucherResult.id]),/ثابتة/)
 await assert.rejects(db.query('delete from vouchers where id=$1',[voucherResult.id]),/لا يُحذف/)
 assert.deepEqual((await createVoucher(voucherBody,id(108))).rows[0].result,voucherResult)
 assert.equal(Number((await db.query('select amount_paid from invoices where id=$1',[linkedInvoice.invoiceId])).rows[0].amount_paid),30)
 assert.equal((await db.query('select count(*)::integer n from checks where voucher_id=$1',[voucherResult.id])).rows[0].n,1)
 const supplierVoucher={type:'payment',date:'2026-09-30',payment_method:'cash',amount:10,supplier_id:supplierId,
   purchase_invoice_id:received.invoiceId,party_name:'Supplier',description:'Supplier payment'}
 const supplierVoucherResult=(await createVoucher(supplierVoucher,id(109))).rows[0].result
 assert.deepEqual((await createVoucher(supplierVoucher,id(109))).rows[0].result,supplierVoucherResult)
 assert.equal(Number((await db.query('select paid_amount from purchase_invoices where id=$1',[received.invoiceId])).rows[0].paid_amount),10)
 assert.equal(Number((await db.query('select balance from suppliers where id=$1',[supplierId])).rows[0].balance),40)
 await assert.rejects(createVoucher({...voucherBody,amount:31},id(108)),/مختلف/)
 await db.exec('CREATE TRIGGER fail_audit_test BEFORE INSERT ON financial_audit_log FOR EACH ROW EXECUTE FUNCTION fail_audit_test()')
 await assert.rejects(createVoucher({...voucherBody,invoice_id:null},id(110)),/injected audit failure/)
 assert.equal((await db.query('select count(*)::integer n from vouchers where create_key=$1',[id(110)])).rows[0].n,0)
 await db.exec('DROP TRIGGER fail_audit_test ON financial_audit_log')
 console.log('PASS: linked split receipt and supplier cash payment commit all ledgers once; late failure rolls back voucher and cheque.')
 // Report must reject missing classifications and reconcile the ledger with the cash result.
 await db.exec(`UPDATE accounts SET report_section=CASE account_tag WHEN 'CASH' THEN 'current_asset' WHEN 'BANK' THEN 'current_asset' WHEN 'CUSTOMER_RECEIVABLE' THEN 'current_asset' WHEN 'SALES_REVENUE' THEN 'sales' END,
 is_cash_equivalent=account_tag IN ('CASH','BANK'),cash_flow_category=CASE account_tag WHEN 'CUSTOMER_RECEIVABLE' THEN 'customer' WHEN 'SALES_REVENUE' THEN 'customer' END`)
 await assert.rejects(db.query('select cash_flow_report_atomic($1,$2,$3)',[store,'2026-09-01','2026-09-30']),/التقرير غير مكتمل/)
 console.log('PASS: cash-flow report fails clearly for incomplete classification.')
 console.log('PASS: atomic mixed POS 300 cash + 400 cheque + 300 AR; COGS 600; linked receipt/cheque; retries; stock; historical cost; full sale rollback.')
 console.log('PASS: checkout server price/shipping; unpaid online; retry; stock reservation; overstock/negative/missing product rejection; full rollback on item failure.')
 console.log('PASS: posted history protected; financial edits rejected; original and single linked reversal retained; reversal retry has no duplicate effect.')
 console.log('PASS: same-day deposit/collect; duplicate collect rejected; custody has no journal; bank and collection balances reconcile.')
 console.log('PASS: deployed table definitions + migrations 054/055; repeated account; retry; changed retry; cross-store; role; invalid amounts/account; full rollback on audit failure; closed period; invalid cash box; actor spoofing.')
 if(server) {
   const clients=[server.getPgClient(),server.getPgClient()]
   try {
     for(const c of clients) { await c.connect();await c.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await c.query('SET ROLE authenticated') }
     const before=await balance()
     await Promise.all(clients.map((c,i)=>c.query('select post_journal_entry_atomic($1)',[JSON.stringify({...payload,idempotencyKey:'concurrent-'+i})])))
     assert.equal(await balance(),before+600)
     const results=await Promise.all(clients.map(c=>c.query('select post_journal_entry_atomic($1) result',[JSON.stringify({...payload,idempotencyKey:'same-concurrent'})])))
     assert.equal(results[0].rows[0].result.entryId,results[1].rows[0].result.entryId)
     assert.equal(await balance(),before+900)
     const lastUnit=await Promise.allSettled(clients.map((c,i)=>c.query('select create_pos_sale_atomic($1,$2,$3)',[store,JSON.stringify({...sale,payments:[{method:'cash',amount:1000}]}),id(70+i)])))
     assert.equal(lastUnit.filter(r=>r.status==='fulfilled').length,1)
     assert.equal(lastUnit.filter(r=>r.status==='rejected').length,1)
     assert.equal((await db.query('select stock_quantity from products where id=$1',[posProduct])).rows[0].stock_quantity,0)
     await clients[0].query('RESET ROLE');await clients[0].query('BEGIN')
     await clients[0].query("UPDATE accounting_periods SET is_closed=true,notes='concurrency close'")
     const blocked=clients[1].query('select post_journal_entry_atomic($1)',[JSON.stringify({...payload,idempotencyKey:'closing-race'})]).then(()=>({ok:true}),error=>({ok:false,error}))
     await clients[0].query('COMMIT')
     assert.equal((await blocked).ok,false)
     console.log('PASS: real PostgreSQL independent authenticated connections: distinct posts preserve both deltas; identical retries return one entry; last-unit sale has one winner; concurrent period closure blocks posting.')
   } finally {await Promise.all(clients.map(c=>c.end()))}
 } else console.log('NOTE: PGlite is single-connection; set LOCAL_POSTGRES=1 for real concurrency tests.')
 await db.close()
}
main().catch(e=>{console.error(e);process.exit(1)})
