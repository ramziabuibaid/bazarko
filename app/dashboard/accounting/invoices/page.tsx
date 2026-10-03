import {createClient} from '@/lib/supabase/server'
import {getStoreForUser} from '@/lib/supabase/getStore'
import {redirect} from 'next/navigation'
import {allRows} from '@/lib/dashboard/load-simple-dashboard'
import {businessDay} from '@/lib/dashboard/simple-metrics'
import {type InvoiceListRow} from '@/lib/invoices/list-presentation'
import InvoicesList from '@/components/dashboard/accounting/InvoicesList'
export default async function InvoicesPage({searchParams}:{searchParams:Record<string,unknown>}){
 const supabase=createClient()
 const {data:{user}}=await supabase.auth.getUser()
 if(!user)redirect('/login')
 const storeId=await getStoreForUser(supabase,user.id)
 if(!storeId)redirect('/onboarding')
 const {data:store}=await supabase.from('stores').select('id,currency_code').eq('id',storeId).single()
 if(!store)redirect('/onboarding')
 let invoices:InvoiceListRow[]=[],error=false
 try{invoices=await allRows<InvoiceListRow>((from,to)=>supabase.from('invoices').select('id,invoice_number,customer_name,customer_id,customer_phone,issue_date,due_date,total,amount_paid,status,created_at,type').eq('store_id',storeId).or('type.in.(sale,service),type.is.null').order('id').range(from,to))}catch{error=true}
 return <main className="p-4 sm:p-6"><InvoicesList invoices={invoices} currency={store.currency_code||'ILS'} today={businessDay().date} error={error} initial={searchParams}/></main>
}
