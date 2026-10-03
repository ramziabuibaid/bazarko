'use server'
import {createClient} from '@/lib/supabase/server'
import {getStoreForUser} from '@/lib/supabase/getStore'
import {revalidatePath} from 'next/cache'
export interface ReturnInput {expected_total:string;purchase_invoice_id:string;return_date:string;reason:string;method:string;cash_box_id:string;items:{purchase_item_id:string;quantity:string}[]}
export async function createPurchaseReturn(storeId:string,requestId:string,input:ReturnInput):Promise<{ok:boolean;returnId?:string;error?:string;uncertain?:boolean}>{
 const c=createClient(),{data:{user}}=await c.auth.getUser();if(!user||await getStoreForUser(c,user.id)!==storeId)return {ok:false,error:'المتجر غير مصرح به'};
 if(!/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(requestId)||!input||!Array.isArray(input.items)||input.items.length<1||input.items.length>200)return {ok:false,error:'طلب الحفظ غير صحيح'};
 try{const {data,error}=await c.rpc('create_purchase_return_atomic',{p_store_id:storeId,p_request_id:requestId,p_payload:input});if(error)return {ok:false,error:error.message,uncertain:!error.code||!/^[0-9A-Z]{5}$/.test(error.code)};if(!data?.returnId)return {ok:false,error:'تعذر تأكيد الحفظ؛ أعد الطلب نفسه',uncertain:true};try{for(const path of ['/dashboard/purchases/returns','/dashboard/purchases','/dashboard/products','/dashboard/suppliers','/dashboard/accounting/receipts','/dashboard/accounting/treasury'])revalidatePath(path)}catch{}return {ok:true,returnId:data.returnId}}catch{return {ok:false,error:'انقطع الاتصال؛ أعد المحاولة بنفس الطلب للتحقق من نتيجته',uncertain:true}}
}
