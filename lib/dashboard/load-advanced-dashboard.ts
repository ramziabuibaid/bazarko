import { createClient } from '@/lib/supabase/server'
import { allRows, loadSimpleDashboard } from './load-simple-dashboard'
import { businessDay } from './simple-metrics'
export async function loadAdvancedDashboard(db:ReturnType<typeof createClient>, id:string) {
  const day=businessDay(), end=new Date(`${day.date}T12:00:00Z`); end.setUTCDate(end.getUTCDate()+7)
  const results=await Promise.allSettled([
    loadSimpleDashboard(db,id),
    allRows<{type:string;amount:number}>((from,to)=>db.from('vouchers').select('type, amount').eq('store_id',id).eq('date',day.date).order('id').range(from,to)),
    db.from('cash_boxes').select('name, account:accounts(balance)').eq('store_id',id).eq('is_default',true).eq('is_active',true).order('created_at').limit(1).maybeSingle(),
    allRows<{stock_quantity:number;low_stock_alert:number|null}>((from,to)=>db.from('products').select('stock_quantity, low_stock_alert').eq('store_id',id).eq('is_active',true).order('id').range(from,to)),
    db.from('checks').select('id',{count:'exact',head:true}).eq('store_id',id).eq('status','in_portfolio').gte('due_date',day.date).lte('due_date',end.toISOString().slice(0,10)),
    db.from('accounts').select('id',{count:'exact',head:true}).eq('store_id',id),
    db.from('customers').select('id',{count:'exact',head:true}).eq('store_id',id),
    db.from('invoices').select('id',{count:'exact',head:true}).eq('store_id',id).not('status','in','(draft,cancelled)'),
  ])
  const [simple,vouchers,box,products,checks,accounts,customers,invoices]=results
  const count=(r:typeof checks)=>r.status==='fulfilled'&&!r.value.error?r.value.count:null
  const cash=box.status==='fulfilled'&&!box.value.error?box.value.data:null
  const raw=cash?.account, account=Array.isArray(raw)?raw[0]:raw
  return {sales:simple.status==='fulfilled'?simple.value.sales:null,unpaid:simple.status==='fulfilled'?simple.value.unpaid:null,
    receipts:vouchers.status==='fulfilled'?vouchers.value.filter(v=>v.type==='receipt').reduce((n,v)=>n+Number(v.amount),0):null,
    payments:vouchers.status==='fulfilled'?vouchers.value.filter(v=>v.type==='payment').reduce((n,v)=>n+Number(v.amount),0):null,
    cashBalance:account?.balance!=null?Number(account.balance):null,cashName:cash?.name||null,
    lowStock:products.status==='fulfilled'?products.value.filter(p=>p.stock_quantity<=(p.low_stock_alert??5)).length:null,
    productsCount:products.status==='fulfilled'?products.value.length:null,checks:count(checks),accounts:count(accounts),customers:count(customers),invoices:count(invoices),date:day.date}
}
export type AdvancedData=Awaited<ReturnType<typeof loadAdvancedDashboard>>
