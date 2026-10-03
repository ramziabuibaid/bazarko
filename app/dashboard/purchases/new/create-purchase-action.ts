'use server'
import {createClient} from '@/lib/supabase/server'
import {getStoreForUser} from '@/lib/supabase/getStore'
import {revalidatePath} from 'next/cache'
import {validatePurchase,type PurchaseRow} from '@/lib/purchases/form'
export interface PurchaseInput {invoice_number:string;invoice_date:string;supplier_id:string;supplier_number:string;cash_box_id:string;mode:'draft'|'post';method:string;paid:string;discount:string;tax:string;notes:string;items:PurchaseRow[]}
export async function createPurchase(storeId:string,requestId:string,input:PurchaseInput):Promise<{ok:boolean;invoiceId?:string;error?:string;uncertain?:boolean}>{
 const c=createClient(),{data:{user}}=await c.auth.getUser();if(!user||await getStoreForUser(c,user.id)!==storeId)return {ok:false,error:'المتجر غير مصرح به'};
 if(!/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(requestId)||!input||!Array.isArray(input.items)||input.items.length>200||!['draft','post'].includes(input.mode))return {ok:false,error:'طلب الحفظ غير صحيح'};
 const invalid=validatePurchase({...input,paid:input.mode==='draft'?'0':input.paid,method:input.mode==='draft'?'credit':input.method},input.items.map(r=>r.product_id),[input.supplier_id]);if(invalid)return {ok:false,error:invalid};
 try{const {data,error}=await c.rpc('create_purchase_invoice_atomic',{p_store_id:storeId,p_request_id:requestId,p_payload:input});if(error)return {ok:false,error:error.message,uncertain:!error.code||!/^[0-9A-Z]{5}$/.test(error.code)};if(!data?.invoiceId)return {ok:false,error:'تعذر تأكيد الحفظ؛ أعد الطلب نفسه.',uncertain:true};try{for(const path of ['/dashboard/purchases','/dashboard/products','/dashboard/suppliers','/dashboard/accounting/treasury'])revalidatePath(path)}catch{}return {ok:true,invoiceId:data.invoiceId}}catch{return {ok:false,error:'انقطع الاتصال؛ أعد المحاولة بنفس الطلب للتحقق من نتيجته.',uncertain:true}}
}
