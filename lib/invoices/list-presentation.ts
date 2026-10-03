export interface InvoiceListRow {id:string;invoice_number:string;customer_id:string|null;customer_name:string|null;customer_phone:string|null;issue_date:string;due_date:string|null;total:number;amount_paid:number;status:string;created_at:string;type?:string|null}
export const invoiceTabs=['all','paid','partial','unpaid','overdue','draft','cancelled'] as const
export type InvoiceTab=typeof invoiceTabs[number]
export interface InvoiceFilters {q:string;customer:string;month:string;status:InvoiceTab;page:number;size:number;ascending:boolean}
export function normalizeInvoiceFilters(input:Record<string,unknown>):InvoiceFilters {
 const text=(key:string)=>typeof input[key]==='string'?input[key] as string:''
 const size=Number(text('size'))
 return {q:text('q'),customer:text('customer'),month:/^\d{4}-(0[1-9]|1[0-2])$/.test(text('month'))?text('month'):'',status:invoiceTabs.includes(text('status') as InvoiceTab)?text('status') as InvoiceTab:'all',page:Math.max(1,Math.min(1000000,Math.floor(Number(text('page')))||1)),size:[6,10,25,50].includes(size)?size:10,ascending:text('sort')==='asc'}
}
export const invoiceMoney=(n:number)=>Number(n||0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})
export function invoiceRemaining(i:InvoiceListRow){return Math.max(0,Number(i.total||0)-Number(i.amount_paid||0))}
export function invoicePaymentKind(i:InvoiceListRow):InvoiceTab {
 if(i.status==='draft'||i.status==='cancelled')return i.status
 if(invoiceRemaining(i)<0.005)return 'paid'
 return Number(i.amount_paid)>0?'partial':'unpaid'
}
export function invoiceOverdue(i:InvoiceListRow,today:string){return !['draft','cancelled'].includes(i.status)&&invoiceRemaining(i)>=0.005&&!!i.due_date&&i.due_date<today}
export const invoiceTabLabels:Record<InvoiceTab,string>={all:'الكل',paid:'مدفوعة',partial:'مدفوعة جزئياً',unpaid:'غير مدفوعة',overdue:'متأخرة',draft:'مسودات',cancelled:'ملغاة'}
export function invoiceListView(rows:InvoiceListRow[],filters:InvoiceFilters,today:string){
 const query=filters.q.trim().toLocaleLowerCase()
 const base=rows.filter(i=>(!query||`${i.invoice_number} ${i.customer_name||''} ${i.customer_phone||''}`.toLocaleLowerCase().includes(query))&&(!filters.customer||i.customer_id===filters.customer)&&(!filters.month||i.issue_date.startsWith(filters.month)))
 const counts=Object.fromEntries(invoiceTabs.map(tab=>[tab,base.filter(i=>tab==='all'||(tab==='overdue'?invoiceOverdue(i,today):invoicePaymentKind(i)===tab)).length])) as Record<InvoiceTab,number>
 const filtered=base.filter(i=>filters.status==='all'||(filters.status==='overdue'?invoiceOverdue(i,today):invoicePaymentKind(i)===filters.status)).sort((a,b)=>{const date=a.issue_date.localeCompare(b.issue_date)||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id);return filters.ascending?date:-date})
 const active=filtered.filter(i=>!['draft','cancelled'].includes(i.status))
 const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100
 const totals={total:round(active.reduce((s,i)=>s+Number(i.total||0),0)),paid:round(active.reduce((s,i)=>s+Number(i.amount_paid||0),0)),remaining:round(active.reduce((s,i)=>s+invoiceRemaining(i),0)),drafts:filtered.filter(i=>i.status==='draft').length,activeCount:active.length,paidCount:active.filter(i=>invoicePaymentKind(i)==='paid').length}
 const pages=Math.max(1,Math.ceil(filtered.length/filters.size)),page=Math.min(filters.page,pages)
 return {filtered,counts,totals,pages,page,visible:filtered.slice((page-1)*filters.size,page*filters.size)}
}
export function invoiceExportRows(rows:InvoiceListRow[],currency:string,today:string){return rows.map(i=>({'رقم الفاتورة':i.invoice_number,'الزبون':i.customer_name||'عميل نقدي','تاريخ الإصدار':i.issue_date,'تاريخ الاستحقاق':i.due_date||'','الإجمالي':Number(i.total||0),'المدفوع':Number(i.amount_paid||0),'المتبقي':invoiceRemaining(i),'العملة':currency,'الحالة':invoiceTabLabels[invoicePaymentKind(i)],'متأخرة':invoiceOverdue(i,today)?'نعم':'لا'}))}
