export function invoiceAmounts(items:{quantity:number;unit_price:number}[],kind:'amount'|'percent',discount:number,paid:number){
 const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100
 const subtotal=round(items.reduce((sum,i)=>sum+round(i.quantity*i.unit_price),0))
 const reduction=round(kind==='percent'?subtotal*discount/100:discount)
 const total=round(subtotal-reduction)
 return {subtotal,discount:reduction,total,remaining:round(total-paid)}
}
export function validInvoiceInput(items:{name:string;quantity:number;unit_price:number}[],kind:'amount'|'percent',discount:number,issue:string,due:string){
 if(!Array.isArray(items)||!items.length||items.some(i=>typeof i?.name!=='string'||!i.name.trim()||!Number.isFinite(i.quantity)||i.quantity<=0||i.quantity>1000000||Math.abs(i.quantity*100-Math.round(i.quantity*100))>1e-7||!Number.isFinite(i.unit_price)||i.unit_price<0||i.unit_price>100000000||Math.abs(i.unit_price*100-Math.round(i.unit_price*100))>1e-7))return 'تحقق من وصف البنود والكميات والأسعار.'
 const amounts=invoiceAmounts(items,kind,discount,0)
 if(!Number.isFinite(discount)||discount<0||(kind==='percent'&&discount>100)||amounts.discount>amounts.subtotal)return 'الخصم يجب ألا يتجاوز قيمة الفاتورة.'
 const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v
 if(!validDate(issue)||(due&&(!validDate(due)||due<issue)))return 'تحقق من تاريخ الإصدار والاستحقاق.'
 return ''
}
