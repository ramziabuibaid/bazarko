import {createHash} from 'node:crypto'
export interface AttachmentReservation {id:string;sha256:string;status:'pending'|'ready';object_path:string;bytes:number;content_type:string}
export async function completeAttachmentUpload(row:AttachmentReservation,bytes:Buffer,io:{put:()=>Promise<void>;read:()=>Promise<Buffer>;markReady:()=>Promise<void>}){
 if(bytes.length!==row.bytes||createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('المرفق لا يطابق الحجز')
 if(row.status==='ready')return
 // A timeout or duplicate-object response is inconclusive. Verify the immutable object.
 try{await io.put()}catch{}
 const stored=await io.read()
 if(stored.length!==row.bytes||createHash('sha256').update(stored).digest('hex')!==row.sha256)throw Error('تعذر مطابقة الملف المحفوظ؛ أعد رفع الملف نفسه')
 await io.markReady()
}
