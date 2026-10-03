import {redirect} from 'next/navigation'
import {createClient} from '@/lib/supabase/server'
import {getStoreForUser} from '@/lib/supabase/getStore'
import {loadStockStatement} from '@/lib/inventory/load-statement'
import StockStatement from '@/components/dashboard/products/StockStatement'
export const metadata={title:'طباعة كشف حركة الصنف — Bazarko'}
export default async function Page({searchParams}:{searchParams:Record<string,string>}){const supabase=createClient(),{data:{user}}=await supabase.auth.getUser();if(!user)redirect('/login');const storeId=await getStoreForUser(supabase,user.id);if(!storeId)redirect('/onboarding');const data=await loadStockStatement(supabase,storeId,user.id,searchParams.product_id,false);return <div className="p-4 sm:p-6 print:p-0"><StockStatement products={[]} product={data.product} movements={data.movements} currency={data.store.currency_code||'ILS'} storeName={data.store.name} error={data.error} filters={searchParams} printOnly/></div>}
