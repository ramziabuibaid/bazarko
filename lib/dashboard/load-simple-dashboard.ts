import { createClient } from '@/lib/supabase/server'
import { businessDay, salesMetrics, type MetricInvoice, type MetricOrder } from './simple-metrics'
type Client = ReturnType<typeof createClient>

export interface TodayOrder { id:string; order_number:string; customer_name:string|null; status:string; total_amount:number; created_at:string; order_items:{product_name:string;quantity:number;products:{thumbnail_url:string|null}|null}[] }
export interface SimpleDashboardData {
  loadedAt:string; date:string; pendingCount:number|null; sales:number|null; unpaid:number|null; expenses:number|null;
  orders:TodayOrder[]; orderError:boolean; productsCount:number|null; errors:boolean;
}

async function allRows<T>(query:(from:number,to:number)=>PromiseLike<{data:unknown[]|null;error:unknown}>) {
  const rows:T[]=[]
  for (let from=0;;from+=1000) {
    const result=await query(from,from+999)
    if(result.error) throw result.error
    const batch=(result.data || []) as T[]
    rows.push(...batch)
    if(batch.length<1000) return rows
  }
}

export async function loadSimpleDashboard(supabase:Client,storeId:string):Promise<SimpleDashboardData> {
  const now=new Date(), day=businessDay(now)
  const results=await Promise.allSettled([
    allRows<MetricInvoice>((from,to)=>supabase.from('invoices').select('id, order_id, total, amount_paid, issue_date').eq('store_id',storeId).not('status','in','(draft,cancelled)').order('id').range(from,to)),
    allRows<MetricOrder>((from,to)=>supabase.from('orders').select('id, total_amount, amount_paid, status, created_at').eq('store_id',storeId).in('status',['confirmed','processing','ready','shipped','delivered']).order('id').range(from,to)),
    allRows<{amount:number}>((from,to)=>supabase.from('vouchers').select('amount').eq('store_id',storeId).eq('type','payment').eq('date',day.date).not('category','is',null).neq('category','').neq('category','مشتريات').is('supplier_id',null).is('purchase_invoice_id',null).order('id').range(from,to)),
    supabase.from('orders').select('id',{count:'exact',head:true}).eq('store_id',storeId).in('status',['pending','confirmed','processing','ready','shipped']),
    supabase.from('orders').select('id, order_number, customer_name, status, total_amount, created_at, order_items(product_name, quantity, products(thumbnail_url))').eq('store_id',storeId).gte('created_at',day.start).lt('created_at',day.end).order('created_at',{ascending:false}).limit(5),
    supabase.from('products').select('id',{count:'exact',head:true}).eq('store_id',storeId).eq('is_active',true),
  ])
  const [invoices,orders,payments,pending,today,products]=results
  const metrics=invoices.status==='fulfilled'&&orders.status==='fulfilled'?salesMetrics(invoices.value,orders.value,day):null
  const pendingResult=pending.status==='fulfilled'&&!pending.value.error?pending.value.count:null
  const todayResult=today.status==='fulfilled'&&!today.value.error?today.value.data:null
  const productResult=products.status==='fulfilled'&&!products.value.error?products.value.count:null
  type RawOrder = Omit<TodayOrder, 'order_items'> & {order_items: {product_name:string;quantity:number;products:{thumbnail_url:string|null}|{thumbnail_url:string|null}[]|null}[]}
  const normalizedOrders = ((todayResult || []) as unknown as RawOrder[]).map(order => ({...order, order_items:(order.order_items || []).map(item => ({...item, products:Array.isArray(item.products)?item.products[0] || null:item.products}))}))
  return {loadedAt:now.toISOString(),date:day.date,pendingCount:pendingResult??null,sales:metrics?.sales??null,unpaid:metrics?.unpaid??null,
    expenses:payments.status==='fulfilled'?payments.value.reduce((sum,p)=>sum+Number(p.amount),0):null,
    orders:normalizedOrders,orderError:todayResult===null,productsCount:productResult??null,
    errors:!metrics||payments.status==='rejected'||pendingResult===null||todayResult===null||productResult===null}
}
