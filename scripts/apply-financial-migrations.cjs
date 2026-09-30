const fs=require('node:fs')
const crypto=require('node:crypto')
const {Client}=require('pg')
const {loadEnvConfig}=require('@next/env')
loadEnvConfig(process.cwd())
const names=['054_atomic_journal_posting.sql','055_financial_reference_guards.sql','056_check_lifecycle.sql','057_periods_and_reversals.sql','058_atomic_storefront_checkout.sql','059_atomic_pos_sale.sql','060_atomic_purchase_receipt.sql','061_explicit_reporting_classification.sql','062_document_period_guards_and_order_reservations.sql','063_security_definer_guards.sql','064_atomic_invoice_payment.sql','065_order_email_outbox.sql','066_atomic_manual_sales_invoice.sql','067_atomic_direct_purchase.sql','068_atomic_voucher_creation.sql','069_cancel_unpaid_sales_invoice.sql','070_posted_document_immutability.sql']
async function main(){
 const apply=process.argv.includes('--apply')
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing')
 const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000})
 await client.connect()
 try{
  await client.query('BEGIN')
  await client.query("SET LOCAL lock_timeout = '5s'")
  await client.query("SET LOCAL statement_timeout = '60s'")
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('bazarko-financial-migrations',0))")
  await client.query(`CREATE TABLE IF NOT EXISTS public.bazarko_financial_migrations (
    name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`)
  for(const name of names){
   const raw=fs.readFileSync(`db/migrations/${name}`,'utf8')
   const checksum=crypto.createHash('sha256').update(raw).digest('hex')
   const previous=await client.query('SELECT checksum FROM public.bazarko_financial_migrations WHERE name=$1',[name])
   if(previous.rows.length){
    if(previous.rows[0].checksum!==checksum)throw Error(`Previously applied migration changed: ${name}`)
    console.log('Already applied',name)
    continue
   }
   const sql=raw.replace(/^\s*BEGIN\s*;/i,'').replace(/COMMIT\s*;\s*$/i,'')
   await client.query(sql)
   await client.query('INSERT INTO public.bazarko_financial_migrations(name,checksum) VALUES($1,$2)',[name,checksum])
   console.log('Validated',name)
  }
  await client.query(apply?'COMMIT':'ROLLBACK')
  console.log(apply?'Applied all financial migrations atomically.':'Dry-run succeeded; all changes rolled back.')
 }catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Migration failed:',error.code||error.message,error.message);process.exitCode=1}
 finally{await client.end()}
}
main().catch(e=>{console.error('Migration connection failed:',e.code||e.message);process.exitCode=1})
