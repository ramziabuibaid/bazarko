import {redirect} from 'next/navigation'
import {createClient} from '@/lib/supabase/server'
import {getStoreForUser} from '@/lib/supabase/getStore'
import {allRows} from '@/lib/dashboard/load-simple-dashboard'
import {type Brand} from '@/lib/brands/presentation'
import BrandsClient from './BrandsClient'
export const metadata={title:'الماركات — Bazarko'}
export default async function BrandsPage(){const c=createClient(),{data:{user}}=await c.auth.getUser();if(!user)redirect('/login');const id=await getStoreForUser(c,user.id);if(!id)redirect('/onboarding');const {data:store}=await c.from('stores').select('id,name,currency_code').eq('id',id).single();if(!store)throw Error('تعذر تحميل المتجر');let brands:Brand[]=[],counts:Record<string,number>={},loadError=false;try{brands=await allRows<Brand>((a,b)=>c.from('brands').select('id,store_id,name,slug,description,logo_url,is_active,sort_order').eq('store_id',id).order('id').range(a,b));const products=await allRows<{id:string;brand_id:string|null}>((a,b)=>c.from('products').select('id,brand_id').eq('store_id',id).order('id').range(a,b));for(const p of products)if(p.brand_id)counts[p.brand_id]=(counts[p.brand_id]||0)+1}catch{loadError=true}return <div className="p-4 sm:p-6"><BrandsClient store={store} initialBrands={brands} counts={counts} loadError={loadError}/></div>}
