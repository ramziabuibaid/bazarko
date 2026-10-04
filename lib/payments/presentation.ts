import {dateValid,receiptMethod,receiptMethods} from '../receipts/presentation'
export {receiptMethods as paymentMethods,receiptMethod as paymentMethod}
export interface Payment {id:string;voucher_number:string;date:string;created_at:string;amount:number;cash_amount:number|null;checks_amount:number|null;payment_method:string;party_name:string|null;supplier_id:string|null;description:string|null;reference:string|null;cash_box_id:string|null;purchase_invoice_id:string|null;journal_entry_id:string|null;postedJournalId:string|null;actualCash:number;movementCount:number;actualCheques?:number;chequeCount?:number;boxName?:string;purchaseNumber?:string}
export interface PaymentSupplier {id:string;name:string;phone:string|null;balance:number}
export interface PaymentPurchase {hasReturns?:boolean;id:string;supplier_id:string|null;invoice_number:string;invoice_date:string;total_amount:number;paid_amount:number;status:string;currency:string;journal_entry_id:string|null;postedJournalId:string|null}
export interface PaymentBox {id:string;name:string;balance:number}
export interface CashPaymentReview {partyType:'supplier'|'other';supplierId:string;partyName:string;date:string;amount:string;boxId:string;purchaseId:string;description:string;reference:string;debitAccountId:string}
const cents=(n:number)=>Math.round(Number(n)*100)
export function paymentNeedsReview(p:Payment){const chequeDeclared=Number(p.checks_amount??(receiptMethod(p.payment_method)==='cheque'?p.amount:0));const chequeMismatch=p.actualCheques!==undefined&&(!Number.isFinite(p.actualCheques)||!Number.isFinite(chequeDeclared)||Math.abs(chequeDeclared-p.actualCheques)>.005||(chequeDeclared>0&&!p.chequeCount)||(chequeDeclared===0&&!!p.chequeCount));const declared=Number(p.cash_amount??(receiptMethod(p.payment_method)==='cash'?p.amount:0));return chequeMismatch||!p.postedJournalId||receiptMethod(p.payment_method)==='unknown'||Number(p.amount)<=0||declared<0||Number(p.actualCash)<0||![p.amount,declared,p.actualCash].every(n=>Number.isFinite(Number(n)))||Math.abs(declared-Number(p.actualCash))>.005||(declared>0&&p.movementCount!==1)||(declared===0&&p.movementCount!==0)}
export function paymentView(rows:Payment[],f:{q:string;method:string;supplier:string;from:string;to:string;page:number;size:number}){
 const empty={filtered:[] as Payment[],rows:[] as Payment[],page:1,pages:1,total:0,cash:0,cheques:0,review:0}
 if(!dateValid(f.from)||!dateValid(f.to)||(f.from&&f.to&&f.from>f.to))return {...empty,error:'راجع فترة السندات؛ البداية لا تتجاوز النهاية'}
 const q=f.q.trim().toLowerCase(),filtered=rows.filter(p=>(!q||`${p.voucher_number} ${p.party_name||''} ${p.description||''} ${p.reference||''} ${p.purchaseNumber||''}`.toLowerCase().includes(q))&&(f.method==='all'||receiptMethod(p.payment_method)===f.method)&&(!f.supplier||p.supplier_id===f.supplier)&&(!f.from||p.date>=f.from)&&(!f.to||p.date<=f.to)).sort((a,b)=>b.date.localeCompare(a.date)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))
 const size=[10,25,50].includes(f.size)?f.size:10,pages=Math.max(1,Math.ceil(filtered.length/size)),page=Math.max(1,Math.min(pages,Number.isFinite(f.page)?Math.floor(f.page):1));let total=0,cash=0,cheques=0
 for(const p of filtered){if(Number.isFinite(Number(p.amount)))total+=cents(p.amount);if(Number.isFinite(Number(p.actualCash)))cash+=cents(p.actualCash);const checks=Number(p.checks_amount??(receiptMethod(p.payment_method)==='cheque'?p.amount:0));if(Number.isFinite(checks))cheques+=cents(checks)}
 return {error:null,filtered,rows:filtered.slice((page-1)*size,page*size),page,pages,total:total/100,cash:cash/100,cheques:cheques/100,review:filtered.filter(paymentNeedsReview).length}
}
export function validateCashPayment(input:CashPaymentReview,suppliers:PaymentSupplier[],purchases:PaymentPurchase[],boxes:PaymentBox[],accounts:{id:string}[],currency:string){
 if(!input.date||!dateValid(input.date))return 'أدخل تاريخاً صحيحاً للسند'
 if(!/^\d+(\.\d{1,2})?$/.test(input.amount)||!Number.isFinite(Number(input.amount))||Number(input.amount)<=0||Number(input.amount)>999999999)return 'أدخل مبلغاً موجباً بمنزلتين عشريتين كحد أقصى'
 const box=boxes.find(b=>b.id===input.boxId);if(!box)return 'اختر صندوقاً نقدياً مصرحاً بالصرف'
 if(!Number.isFinite(Number(box.balance)))return 'رصيد الصندوق يحتاج مراجعة'
 if(cents(Number(input.amount))>cents(box.balance))return 'المبلغ يتجاوز الرصيد النقدي الحالي للصندوق'
 if(!input.description.trim()||input.description.length>1000||input.reference.length>200)return 'أدخل البيان ضمن الحدود المسموحة'
 if(input.partyType==='supplier'){
 const supplier=suppliers.find(s=>s.id===input.supplierId);if(!supplier)return 'اختر مورداً مسجلاً من المتجر'
 if(!Number.isFinite(Number(supplier.balance)))return 'رصيد المورد يحتاج مراجعة'
 if(input.purchaseId){const p=purchases.find(p=>p.id===input.purchaseId&&p.supplier_id===input.supplierId&&p.status==='completed'&&!p.hasReturns&&p.currency===currency&&p.postedJournalId);if(!p)return 'الفاتورة لا تخص المورد أو غير معتمدة بعملة المتجر وقيد مرحّل'
 if(![p.total_amount,p.paid_amount].every(n=>Number.isFinite(Number(n)))||Number(p.total_amount)<=0||Number(p.paid_amount)<0||Number(p.paid_amount)>=Number(p.total_amount))return 'تسوية فاتورة الشراء تحتاج مراجعة'
 if(input.date<p.invoice_date)return 'تاريخ الصرف لا يسبق فاتورة الشراء'
 if(cents(Number(input.amount))>cents(Number(p.total_amount)-Number(p.paid_amount)))return 'المبلغ يتجاوز المتبقي على فاتورة الشراء'
 }
 }else if(input.partyType==='other'){if(input.supplierId||input.purchaseId)return 'الجهة الأخرى لا ترتبط بمورد أو فاتورة';if(!input.partyName.trim()||input.partyName.length>200)return 'أدخل اسم المستفيد';if(!accounts.some(a=>a.id===input.debitAccountId))return 'اختر حساب المصروف أو الأصل المقابل'}else return 'حدد نوع المستفيد'
 return null
}
