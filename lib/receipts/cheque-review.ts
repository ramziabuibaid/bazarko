import {dateValid,validateCashReview,type ReceiptCustomer,type ReceiptInvoice,type CashReview} from './presentation'
export interface ReceiptCheque {check_number:string;bank_name:string;branch_name:string;account_number:string;drawer_name:string;amount:string;issue_date:string;due_date:string}
export interface ChequeReview extends CashReview {method:'cheque'|'split';portfolioId:string;cheques:ReceiptCheque[]}
export function emptyCheque(date:string):ReceiptCheque{return {check_number:'',bank_name:'',branch_name:'',account_number:'',drawer_name:'',amount:'',issue_date:date,due_date:''}}
export function chequeTotals(input:ChequeReview){const cheques=input.cheques.reduce((n,c)=>n+Math.round(Number(c.amount||0)*100),0),cash=input.method==='split'?Math.round(Number(input.amount||0)*100):0;return {cash:cash/100,cheques:cheques/100,total:(cash+cheques)/100}}
export function validateChequeReview(input:ChequeReview,customers:ReceiptCustomer[],invoices:ReceiptInvoice[],boxes:{id:string}[],portfolios:{id:string}[],accounts:{id:string}[]){
 if(!['cheque','split'].includes(input.method))return 'اختر شيكات أو قبضاً مختلطاً';
 if(!portfolios.some(p=>p.id===input.portfolioId))return 'اختر محفظة شيكات واردة مصرحاً بها';
 if(!Array.isArray(input.cheques)||input.cheques.length<1||input.cheques.length>50)return 'أضف من شيك واحد إلى 50 شيكاً';
 const keys=new Set<string>(),numbers=new Set<string>();for(const [i,c] of input.cheques.entries()){
 const prefix=`الشيك ${i+1}: `;if(!c.check_number.trim()||c.check_number.length>100||!c.bank_name.trim()||c.bank_name.length>200||!c.account_number.trim()||c.account_number.length>100)return prefix+'أدخل رقم الشيك والبنك ورقم الحساب ضمن الحدود';
 if(c.branch_name.length>200||c.drawer_name.length>200)return prefix+'اسم الفرع أو الساحب يتجاوز الحد';
 const key=[c.check_number,c.bank_name,c.account_number].map(v=>v.trim().toLowerCase()).join('|');if(keys.has(key))return prefix+'الشيك مكرر في السند';keys.add(key);if(numbers.has(c.check_number.trim()))return prefix+'رقم الشيك مكرر داخل السند';numbers.add(c.check_number.trim());
 if(!/^\d+(\.\d{1,2})?$/.test(c.amount)||!Number.isFinite(Number(c.amount))||Number(c.amount)<=0||Number(c.amount)>999999999)return prefix+'أدخل قيمة موجبة بمنزلتين عشريتين';
 if(!c.issue_date||!c.due_date||!dateValid(c.issue_date)||!dateValid(c.due_date)||c.due_date<c.issue_date||c.issue_date>input.date)return prefix+'راجع الإصدار والاستحقاق؛ الإصدار لا يتجاوز تاريخ القبض';
 }
 if(input.method==='cheque'&&!['0','0.00',''].includes(input.amount))return 'قبض الشيكات لا يتضمن مبلغاً نقدياً';
 if(input.method==='split'&&(!/^\d+(\.\d{1,2})?$/.test(input.amount)||!Number.isFinite(Number(input.amount))||Number(input.amount)<=0))return 'القبض المختلط يتطلب جزءاً نقدياً موجباً';
 const totals=chequeTotals(input);if(!Number.isFinite(totals.total)||totals.total>999999999)return 'إجمالي السند خارج الحدود';
 // Reuse party/date/invoice validation with total nominal settlement. Pure cheque needs no cash box.
 return validateCashReview({...input,amount:totals.total.toFixed(2),boxId:input.method==='cheque'?input.portfolioId:input.boxId},customers,invoices,input.method==='cheque'?portfolios:boxes,accounts)
}
