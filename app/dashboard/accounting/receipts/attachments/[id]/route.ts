import {createClient} from '@/lib/supabase/server'
import {createAdminClient} from '@/lib/supabase/admin'
import {getStoreForUser} from '@/lib/supabase/getStore'
import {receiptAttachmentBucket} from '@/lib/receipts/attachment-content'
export const dynamic='force-dynamic'
export async function GET(_request:Request,{params}:{params:{id:string}}){
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}
 const c=createClient(),{data:{user}}=await c.auth.getUser()
 if(!user)return new Response('يلزم تسجيل الدخول',{status:401,headers})
 if(!/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(params.id))return new Response('غير متاح',{status:404,headers})
 const storeId=await getStoreForUser(c,user.id)
 if(!storeId)return new Response('غير متاح',{status:404,headers})
 // Query through user RLS before using the service client. No public or signed URL.
 const {data:row,error}=await c.from('receipt_attachments').select('object_path,content_type,filename').eq('id',params.id).eq('store_id',storeId).eq('status','ready').maybeSingle()
 if(error||!row)return new Response('غير متاح',{status:404,headers})
 const {data,error:downloadError}=await createAdminClient().storage.from(receiptAttachmentBucket).download(row.object_path)
 if(downloadError||!data)return new Response('تعذر تحميل المرفق؛ أعد المحاولة',{status:503,headers})
 return new Response(await data.arrayBuffer(),{headers:{...headers,'Content-Type':row.content_type,'Content-Disposition':`attachment; filename="receipt-attachment"; filename*=UTF-8''${encodeURIComponent(row.filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`}})
}
