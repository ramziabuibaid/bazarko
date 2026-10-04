'use server'
import {createClient} from '@/lib/supabase/server'
import {getStoreForUser} from '@/lib/supabase/getStore'
import {revalidatePath} from 'next/cache'
import {type ChequePaymentReview} from '@/lib/payments/cheque-review'
import {type CashPaymentReview} from '@/lib/payments/presentation'
export async function createCashPayment(storeId:string,requestId:string,input:CashPaymentReview):Promise<{ok:boolean;voucherId?:string;voucherNumber?:string;error?:string;uncertain?:boolean}>{
 const c=createClient(),{data:{user}}=await c.auth.getUser();if(!user)return {ok:false,error:'يلزم تسجيل الدخول'};
 if(await getStoreForUser(c,user.id)!==storeId)return {ok:false,error:'المتجر غير مصرح به'};
 if(!/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(requestId)||!input)return {ok:false,error:'طلب الحفظ غير صحيح'};
 try{const {data,error}=await c.rpc('create_cash_payment_atomic',{p_store_id:storeId,p_request_id:requestId,p_payload:input});
 if(error)return {ok:false,error:error.message,uncertain:!error.code||!/^[0-9A-Z]{5}$/.test(error.code)};
 if(!data?.voucherId)return {ok:false,error:'تعذر تأكيد نتيجة الحفظ؛ أعد محاولة الطلب نفسه',uncertain:true};
 try{for(const path of ['/dashboard/accounting/payments','/dashboard/accounting/treasury','/dashboard/accounting/journal','/dashboard/suppliers','/dashboard/purchases'])revalidatePath(path);if(input.purchaseId)revalidatePath(`/dashboard/purchases/${input.purchaseId}`);if(input.supplierId)revalidatePath(`/dashboard/suppliers/${input.supplierId}`)}catch{}
 return {ok:true,voucherId:data.voucherId,voucherNumber:data.voucherNumber};
 }catch{return {ok:false,error:'انقطع الاتصال أثناء الحفظ؛ أعد محاولة الطلب نفسه للتحقق من نتيجته',uncertain:true}}
}

export async function createChequePayment(storeId:string,requestId:string,input:ChequePaymentReview):Promise<{ok:boolean;voucherId?:string;voucherNumber?:string;error?:string;uncertain?:boolean}>{
 const c=createClient(),{data:{user}}=await c.auth.getUser();if(!user)return {ok:false,error:'يلزم تسجيل الدخول'};
 if(await getStoreForUser(c,user.id)!==storeId)return {ok:false,error:'المتجر غير مصرح به'};
 if(!/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(requestId)||!input)return {ok:false,error:'طلب الحفظ غير صحيح'};
 try{const {data,error}=await c.rpc('create_cheque_payment_atomic',{p_store_id:storeId,p_request_id:requestId,p_payload:input});
 if(error)return {ok:false,error:error.message,uncertain:!error.code||!/^[0-9A-Z]{5}$/.test(error.code)};
 if(!data?.voucherId)return {ok:false,error:'تعذر تأكيد نتيجة الحفظ؛ أعد محاولة الطلب نفسه',uncertain:true};
 try{for(const path of ['/dashboard/accounting/payments','/dashboard/accounting/treasury','/dashboard/accounting/journal','/dashboard/suppliers','/dashboard/purchases','/dashboard/cheques'])revalidatePath(path);if(input.purchaseId)revalidatePath(`/dashboard/purchases/${input.purchaseId}`);if(input.supplierId)revalidatePath(`/dashboard/suppliers/${input.supplierId}`)}catch{}
 return {ok:true,voucherId:data.voucherId,voucherNumber:data.voucherNumber};
 }catch{return {ok:false,error:'انقطع الاتصال أثناء الحفظ؛ أعد محاولة الطلب نفسه للتحقق من نتيجته',uncertain:true}}
}
