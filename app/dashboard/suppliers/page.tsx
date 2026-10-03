import {redirect} from 'next/navigation'
import {createClient} from '@/lib/supabase/server'
import {getStoreForUser} from '@/lib/supabase/getStore'
import {allRows} from '@/lib/dashboard/load-simple-dashboard'
import {type Supplier} from '@/lib/suppliers/presentation'
import SuppliersClient from './SuppliersClient'
export const metadata={title:'دليل الموردين — Bazarko'}
export default async function Page(){const c=createClient(),{data:{user}}=await c.auth.getUser();if(!user)redirect('/login');const id=await getStoreForUser(c,user.id);if(!id)redirect('/onboarding');const [{data:store,error},suppliers]=await Promise.all([c.from('stores').select('id,name,currency_code').eq('id',id).single(),allRows<any>((a,b)=>c.from('suppliers').select('id,store_id,name,phone,address,notes,balance,created_at').eq('store_id',id).order('id').range(a,b))]);if(error||!store)throw Error('تعذر تحميل دليل الموردين');return <div className="p-4 sm:p-6"><SuppliersClient store={store} initialSuppliers={suppliers}/></div>}
