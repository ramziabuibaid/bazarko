'use server'
import {createClient} from '@/lib/supabase/server'
import {getStoreForUser} from '@/lib/supabase/getStore'
import {revalidatePath} from 'next/cache'
import {validInvoiceInput} from '@/lib/invoices/create-presentation'
export interface SalesInvoiceInput {
 customerId:string|null;customerName:string;customerPhone:string;customerAddress:string;
 issueDate:string;dueDate:string;notes:string;discountType:'amount'|'percent';discountValue:number;
 collectionMode:'full'|'partial'|'none';amountPaid:number;cashBoxId:string|null;
 orderId:string|null;quotationId:string|null;
 items:{product_id:string|null;name:string;sku:string;quantity:number;unit_price:number}[];
}
export async function createSalesInvoice(storeId:string,requestId:string,input:SalesInvoiceInput):Promise<{ok:boolean;invoiceId?:string;error?:string;uncertain?:boolean}>{
 const supabase=createClient()
 const {data:{user}}=await supabase.auth.getUser()
 if(!user)return {ok:false,error:'يلزم تسجيل الدخول.'}
 const currentStore=await getStoreForUser(supabase,user.id)
 if(!currentStore||currentStore!==storeId)return {ok:false,error:'المتجر غير مصرح به.'}
 if(!/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(requestId))return {ok:false,error:'معرف الحفظ غير صحيح.'}
 if(!input||!Array.isArray(input.items)||input.items.length>200)return {ok:false,error:'بنود الفاتورة غير صحيحة.'}
 const validation=validInvoiceInput(input.items,input.discountType,input.discountValue,input.issueDate,input.dueDate)
 if(validation)return {ok:false,error:validation}
 try{
   const {data,error}=await supabase.rpc('create_sales_invoice_atomic',{p_store_id:storeId,p_request_id:requestId,p_payload:input})
   if(error)return {ok:false,error:error.message,uncertain:!error.code||!/^[0-9A-Z]{5}$/.test(error.code)}
   if(!data?.invoiceId)return {ok:false,error:'تعذر تأكيد نتيجة الحفظ؛ أعد المحاولة بنفس الطلب.',uncertain:true}
   // Cache invalidation must not turn a committed invoice into a failed save.
   try{revalidatePath('/dashboard/accounting/invoices');revalidatePath('/dashboard/customers/ledger');revalidatePath('/dashboard/accounting/treasury');revalidatePath('/dashboard/products')}catch{}
   return {ok:true,invoiceId:data.invoiceId}
 }catch{return {ok:false,error:'انقطع الاتصال أثناء الحفظ؛ أعد محاولة الطلب نفسه للتحقق من نتيجته.',uncertain:true}}
}

export async function getInvoiceCashBoxes(){
 const supabase=createClient()
 const {data:{user}}=await supabase.auth.getUser()
 if(!user)return []
 const storeId=await getStoreForUser(supabase,user.id)
 if(!storeId)return []
 const [{data:store},{data:member},{data:boxes,error}]=await Promise.all([
  supabase.from('stores').select('owner_id').eq('id',storeId).single(),
  supabase.from('store_members').select('role').eq('store_id',storeId).eq('profile_id',user.id).eq('is_active',true).maybeSingle(),
  supabase.from('cash_boxes').select('id,name').eq('store_id',storeId).eq('type','cash').eq('is_active',true).order('is_default',{ascending:false}).order('name'),
 ])
 if(error||!boxes)return []
 if(store?.owner_id===user.id||['owner','admin'].includes(member?.role||''))return boxes
 const {data:permissions,error:permissionError}=await supabase.from('user_cash_box_permissions').select('cash_box_id').eq('store_id',storeId).eq('user_id',user.id).eq('can_receipt',true)
 if(permissionError)return []
 const allowed=new Set((permissions||[]).map(p=>p.cash_box_id))
 return boxes.filter(b=>allowed.has(b.id))
}
