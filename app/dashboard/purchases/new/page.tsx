import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import {allRows} from '@/lib/dashboard/load-simple-dashboard'
import CreatePurchaseClient from './CreatePurchaseClient'

export const metadata = {
  title: 'تسجيل فاتورة شراء جديدة — Bazarko ERP',
}

export default async function NewPurchasePage({searchParams}:{searchParams?:{supplier_id?:string}}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    suppliers,
    products
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code').eq('id', storeId).single(),
    allRows<any>((a,b)=>supabase.from('suppliers').select('id,name,phone,balance').eq('store_id',storeId).order('id').range(a,b)),
    allRows<any>((a,b)=>supabase.from('products').select('id,name,sku,barcode,price,cost_price,stock_quantity').eq('store_id',storeId).order('id').range(a,b))
  ])

  if(!store)throw new Error('تعذر تحميل المتجر')
  suppliers.sort((a,b)=>a.name.localeCompare(b.name,'ar'));products.sort((a,b)=>a.name.localeCompare(b.name,'ar'))
  const {data:boxes,error:boxesError}=await supabase.from('cash_boxes').select('id,name').eq('store_id',storeId).eq('type','cash').eq('is_active',true).order('name')
  if(boxesError)throw new Error('تعذر تحميل الصناديق')
  return (
    <CreatePurchaseClient
      initialSupplier={searchParams?.supplier_id}
      cashBoxes={boxes||[]}
      store={store!}
      suppliers={suppliers || []}
      products={products || []}
    />
  )
}
