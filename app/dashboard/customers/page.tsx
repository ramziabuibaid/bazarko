import {createClient} from '@/lib/supabase/server'
import {getStoreForUser} from '@/lib/supabase/getStore'
import {redirect} from 'next/navigation'
import {allRows} from '@/lib/dashboard/load-simple-dashboard'
import {businessDay} from '@/lib/dashboard/simple-metrics'
import type {DirectoryCustomer} from '@/lib/customers/directory'
import CustomerDirectory from '@/components/dashboard/customers/CustomerDirectory'
export default async function CustomersPage({searchParams}:{searchParams:{q?:string;type?:string;sort?:string;add?:string}}){
 const db=createClient(),{data:{user}}=await db.auth.getUser();if(!user)redirect('/login')
 const id=await getStoreForUser(db,user.id);if(!id)redirect('/onboarding')
 const {data:store}=await db.from('stores').select('id, name, currency_code, country_code').eq('id',id).single();if(!store)redirect('/onboarding')
 const [customers,orders]=await Promise.allSettled([
 allRows<DirectoryCustomer>((from,to)=>db.from('customers').select('id, name, phone, email, city, address, notes, credit_limit, social_url, balance, total_orders, customer_type, is_active, created_at, shamel_code, last_order_at, last_payment_at').eq('store_id',id).order('id').range(from,to)),
 allRows<{customer_id:string|null;created_at:string}>((from,to)=>db.from('orders').select('customer_id, created_at').eq('store_id',id).not('customer_id','is',null).order('created_at',{ascending:false}).order('id').range(from,to)),
 ])
 const last:Record<string,string>={};if(orders.status==='fulfilled')for(const row of orders.value)if(row.customer_id&&!last[row.customer_id])last[row.customer_id]=row.created_at
 return <CustomerDirectory customers={customers.status==='fulfilled'?customers.value:[]} currencyCode={store.currency_code} countryCode={store.country_code||'PS'} storeId={id} storeName={store.name} date={businessDay().date} lastOrderDates={last} loadError={customers.status==='rejected'} orderError={orders.status==='rejected'} searchQuery={searchParams.q||''} activeType={searchParams.type||'all'} sort={searchParams.sort||'created_at'} initShowAdd={searchParams.add==='true'}/>
}
