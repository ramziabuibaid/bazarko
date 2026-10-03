export type QuoteStatus='all'|'draft'|'sent'|'accepted'|'rejected'|'converted'|'expired'
export const quoteLabels:Record<string,string>={draft:'مسودة',sent:'مرسل',accepted:'مقبول',rejected:'مرفوض',converted:'مفوترة',expired:'منتهي الصلاحية'}
export function quoteExpired(q:{status:string;valid_until:string|null},today:string){return !['draft','converted','rejected'].includes(q.status)&&!!q.valid_until&&q.valid_until<today}
export function validQuote(items:{product_name:string;quantity:number;unit_price:number}[],issue:string,until:string){
 if(!issue||!until||until<issue)return 'تاريخ انتهاء العرض يجب ألا يسبق تاريخ الإصدار'
 if(!items.length||items.some(i=>!i.product_name.trim()||!Number.isFinite(i.quantity)||i.quantity<=0||!Number.isFinite(i.unit_price)||i.unit_price<0))return 'تحقق من أسماء البنود والكميات والأسعار'
 if(items.reduce((n,i)=>n+i.quantity*i.unit_price,0)<=0)return 'يجب أن يكون إجمالي العرض أكبر من الصفر'
 return ''
}
