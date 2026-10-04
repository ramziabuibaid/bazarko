'use server'
import {createClient} from '@/lib/supabase/server'
import {createAdminClient} from '@/lib/supabase/admin'
import {getStoreForUser} from '@/lib/supabase/getStore'
import {inspectReceiptAttachment,receiptAttachmentBucket} from '@/lib/receipts/attachment-content'
import {completeAttachmentUpload} from '@/lib/receipts/attachment-upload'
import {revalidatePath} from 'next/cache'
const uuid=/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i
export async function listReceiptAttachments(storeId:string,voucherId:string){
 const c=createClient(),{data:{user}}=await c.auth.getUser()
 if(!user||!uuid.test(storeId)||!uuid.test(voucherId)||await getStoreForUser(c,user.id)!==storeId)return {error:'غير مصرح بالمرفقات',rows:[]}
 const {data,error}=await c.from('receipt_attachments').select('id,filename,bytes,status').eq('store_id',storeId).eq('voucher_id',voucherId).order('created_at')
 return {error:error?'تعذر تحميل المرفقات؛ أعد المحاولة':null,rows:data||[]}
}
export async function uploadReceiptAttachment(storeId:string,voucherId:string,form:FormData):Promise<{ok:boolean;error?:string}>{
 try{
 const c=createClient(),{data:{user}}=await c.auth.getUser()
 if(!user||!uuid.test(storeId)||!uuid.test(voucherId)||await getStoreForUser(c,user.id)!==storeId)return {ok:false,error:'غير مصرح بالمرفقات'}
 const files=form.getAll('file');if(files.length!==1||typeof files[0]==='string'||!files[0])return {ok:false,error:'اختر ملفاً واحداً في كل طلب'}
 const file=files[0];if(file.size>5*1024*1024)return {ok:false,error:'الحد الأقصى للملف 5 ميغابايت'}
 const bytes=Buffer.from(await file.arrayBuffer()),meta=inspectReceiptAttachment(file,bytes)
 const {data:row,error}=await c.rpc('reserve_receipt_attachment',{p_store_id:storeId,p_voucher_id:voucherId,p_sha256:meta.sha256,p_filename:meta.filename,p_bytes:meta.bytes,p_content_type:meta.contentType})
 if(error||!row)return {ok:false,error:error?.message||'تعذر حجز المرفق؛ أعد رفع الملف نفسه'}
 const admin=createAdminClient(),bucket=admin.storage.from(receiptAttachmentBucket)
 await completeAttachmentUpload(row,bytes,{
 put:async()=>{const {error}=await bucket.upload(row.object_path,bytes,{contentType:meta.contentType,upsert:false,cacheControl:'0'});if(error)throw Error('تعذر الرفع')},
 read:async()=>{const {data,error}=await bucket.download(row.object_path);if(error||!data)throw Error('لم يكتمل الرفع؛ السند محفوظ، أعد رفع الملف نفسه');return Buffer.from(await data.arrayBuffer())},
 markReady:async()=>{const {error}=await admin.from('receipt_attachments').update({status:'ready',ready_at:new Date().toISOString()}).eq('id',row.id).eq('store_id',storeId).select('id').single();if(error)throw Error('تعذر تأكيد ربط المرفق؛ أعد رفع الملف نفسه')}
 })
 revalidatePath(`/dashboard/accounting/receipts/print/${voucherId}`)
 return {ok:true}
 }catch(e){return {ok:false,error:e instanceof Error?e.message:'تعذر تأكيد الرفع؛ السند محفوظ، أعد رفع الملف نفسه'}}
}
