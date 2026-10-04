import {dateValid} from '../receipts/presentation'
import {validateCashPayment,type CashPaymentReview,type PaymentSupplier,type PaymentPurchase,type PaymentBox} from './presentation'
export interface PaymentBank {id:string;bank_name:string;account_number:string;currency:string}
export interface PaymentPortfolio {id:string;name:string;type:'checks_received'|'checks_issued';account_id:string}
export interface EndorsableCheque {id:string;check_number:string;bank_name:string;account_number:string|null;amount:number;currency:string;issue_date:string;due_date:string;cashbox_id:string;receipt_portfolio_account_id:string|null;receipt_settlement_active:boolean|null;type:string;status:string;voucher_id:string|null;postedReceipt:boolean;receivedDate:string;payment_voucher_id?:string|null}
export interface IssuedIdentity {check_number:string;bank_name:string;account_number:string|null}
export interface PaymentCheque {source:'issue'|'endorse';bankId:string;checkId:string;number:string;amount:string;issueDate:string;dueDate:string}
export interface ChequePaymentReview extends CashPaymentReview {method:'cheque'|'split';issuedPortfolioId:string;cheques:PaymentCheque[]}
export function emptyPaymentCheque(date:string):PaymentCheque{return {source:'issue',bankId:'',checkId:'',number:'',amount:'',issueDate:date,dueDate:''}}
const identity=(number:string,bank:string,account:string|null)=>[number,bank,account||''].map(x=>x.trim().toLowerCase()).join('|')
export function endorsableCheque(c:EndorsableCheque,portfolios:PaymentPortfolio[],currency:string,date:string){return c.type==='received'&&c.status==='in_portfolio'&&c.receipt_settlement_active===true&&!c.payment_voucher_id&&!!c.voucher_id&&c.postedReceipt&&!!c.check_number.trim()&&!!c.bank_name.trim()&&!!c.account_number?.trim()&&!!c.receivedDate&&dateValid(c.receivedDate)&&c.receivedDate<=date&&c.currency===currency&&Number.isFinite(Number(c.amount))&&Number(c.amount)>0&&Number(c.amount)<=999999999&&Math.abs(Number(c.amount)*100-Math.round(Number(c.amount)*100))<0.00001&&!!c.issue_date&&!!c.due_date&&dateValid(c.issue_date)&&dateValid(c.due_date)&&c.issue_date<=date&&c.due_date>=c.issue_date&&portfolios.some(p=>p.id===c.cashbox_id&&p.type==='checks_received'&&p.account_id===c.receipt_portfolio_account_id)}
export function chequePaymentTotals(input:ChequePaymentReview,incoming:EndorsableCheque[]){const cheques=input.cheques.reduce((sum,c)=>sum+Math.round(Number(c.source==='endorse'?incoming.find(x=>x.id===c.checkId)?.amount??0:c.amount||0)*100),0),cash=input.method==='split'?Math.round(Number(input.amount||0)*100):0;return {cash:cash/100,cheques:cheques/100,total:(cash+cheques)/100}}
export function validateChequePayment(input:ChequePaymentReview,suppliers:PaymentSupplier[],purchases:PaymentPurchase[],boxes:PaymentBox[],accounts:{id:string}[],banks:PaymentBank[],portfolios:PaymentPortfolio[],incoming:EndorsableCheque[],issued:IssuedIdentity[],currency:string){
 if(!['cheque','split'].includes(input.method))return 'اختر صرف شيكات أو صرفاً مختلطاً'
 if(!input.date||!dateValid(input.date))return 'أدخل تاريخاً صحيحاً للسند'
 if(!Array.isArray(input.cheques)||input.cheques.length<1||input.cheques.length>50)return 'أضف من شيك واحد إلى 50 شيكاً'
 if(input.method==='cheque'&&!['','0','0.00'].includes(input.amount))return 'صرف الشيكات لا يتضمن مبلغاً نقدياً'
 if(input.method==='split'&&(!/^\d+(\.\d{1,2})?$/.test(input.amount)||!Number.isFinite(Number(input.amount))||Number(input.amount)<=0))return 'الصرف المختلط يحتاج جزءاً نقدياً موجباً'
 const keys=new Set<string>(),selected=new Set<string>(),numbers=new Set<string>();for(const [i,c] of input.cheques.entries()){
 const prefix=`الشيك ${i+1}: `;let key:string;
 if(c.source==='issue'){
 const bank=banks.find(b=>b.id===c.bankId&&b.currency===currency);if(!bank||!bank.bank_name.trim()||!bank.account_number?.trim())return prefix+'اختر حساباً بنكياً نشطاً بعملة المتجر وبيانات مكتملة'
 if(!portfolios.some(p=>p.id===input.issuedPortfolioId&&p.type==='checks_issued'))return 'اختر محفظة شيكات صادرة مصرحاً بالصرف'
 if(!c.number.trim()||c.number.length>100)return prefix+'أدخل رقم الشيك ضمن الحدود'
 if(!/^\d+(\.\d{1,2})?$/.test(c.amount)||!Number.isFinite(Number(c.amount))||Number(c.amount)<=0||Number(c.amount)>999999999)return prefix+'أدخل قيمة موجبة بمنزلتين عشريتين'
 if(!c.issueDate||!c.dueDate||!dateValid(c.issueDate)||!dateValid(c.dueDate)||c.issueDate>input.date||c.dueDate<c.issueDate)return prefix+'راجع تاريخ الإصدار والاستحقاق'
 key=identity(c.number,bank.bank_name,bank.account_number);if(issued.some(x=>x.check_number.trim().toLowerCase()===c.number.trim().toLowerCase()&&x.bank_name.trim().toLowerCase()===bank.bank_name.trim().toLowerCase()))return prefix+'هذا الرقم صادر مسبقاً لدى البنك نفسه';if(numbers.has(c.number.trim().toLowerCase()))return prefix+'رقم الشيك مكرر داخل السند';numbers.add(c.number.trim().toLowerCase())
 }else if(c.source==='endorse'){
 if(input.partyType!=='supplier')return 'التظهير متاح لمورد مسجل فقط في هذه المرحلة'
 const check=incoming.find(x=>x.id===c.checkId);if(!check||!endorsableCheque(check,portfolios,currency,input.date))return prefix+'اختر شيك قبض مرتبطاً ومتاحاً من محفظة مصرح بها'
 if(selected.has(check.id))return prefix+'الشيك الوارد مختار أكثر من مرة';selected.add(check.id);key=identity(check.check_number,check.bank_name,check.account_number)
 }else return prefix+'حدد مصدر الشيك'
 if(keys.has(key))return prefix+'بيانات الشيك مكررة داخل السند';keys.add(key)
 }
 const totals=chequePaymentTotals(input,incoming);if(!Number.isFinite(totals.total)||totals.total<=0||totals.total>999999999)return 'إجمالي السند خارج الحدود'
 if(input.method==='split'){const box=boxes.find(b=>b.id===input.boxId);if(!box)return 'اختر صندوقاً نقدياً مصرحاً بالصرف';if(!Number.isFinite(Number(box.balance))||Math.round(totals.cash*100)>Math.round(Number(box.balance)*100))return 'الجزء النقدي يتجاوز رصيد الصندوق أو الرصيد يحتاج مراجعة'}
 // Validate party and invoice using the whole settlement; cash sufficiency uses only the cash component above.
 return validateCashPayment({...input,amount:totals.total.toFixed(2),boxId:'review-total'},suppliers,purchases,[{id:'review-total',name:'',balance:totals.total}],accounts,currency)
}
