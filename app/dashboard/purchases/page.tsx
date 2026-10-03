import {redirect} from 'next/navigation'
import {createClient} from '@/lib/supabase/server'
import {getStoreForUser} from '@/lib/supabase/getStore'
import {allRows} from '@/lib/dashboard/load-simple-dashboard'
import {type Purchase} from '@/lib/purchases/presentation'
import PurchasesList from '@/components/dashboard/purchases/PurchasesList'
export const metadata={title:'فواتير المشتريات — Bazarko'}
export default async function Page(){const c=createClient(),{data:{user}}=await c.auth.getUser();if(!user)redirect('/login');const id=await getStoreForUser(c,user.id);if(!id)redirect('/onboarding');let rows:Purchase[]=[],error=false;try{rows=await allRows<Purchase>((a,b)=>c.from('purchase_invoices').select('id,invoice_number,supplier_invoice_number,supplier_id,invoice_date,status,payment_status,payment_method,subtotal,discount,tax_amount,total_amount,paid_amount,currency,notes,journal_entry_id,created_at,supplier:suppliers(id,name,phone)').eq('store_id',id).order('id').range(a,b))}catch{error=true}return <main className="p-4 sm:p-6"><PurchasesList rows={rows} error={error}/></main>}
