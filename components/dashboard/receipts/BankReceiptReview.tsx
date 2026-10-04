'use client'
import {useState,useEffect,useRef} from 'react'
import Link from 'next/link'
import ReceiptAttachments from './ReceiptAttachments'
import {useRouter} from 'next/navigation'
import {createBankReceipt} from '@/app/dashboard/accounting/receipts/receipt-action'
import {businessDay} from '@/lib/dashboard/simple-metrics'
import {type ReceiptCustomer,type ReceiptInvoice} from '@/lib/receipts/presentation'
import {validateBankReview,validateReceiptFiles,type BankReview,type ReceiptBank} from '@/lib/receipts/bank-review'
import s from '@/components/dashboard/accounting/invoices-list.module.css'
export default function BankReceiptReview({banks,customers,invoices,creditAccounts,currency,storeId,preview,onBusyChange}:{storeId:string;preview:boolean;onBusyChange:(busy:boolean)=>void;banks:ReceiptBank[];customers:ReceiptCustomer[];invoices:ReceiptInvoice[];creditAccounts:{id:string;name:string;code:string}[];currency:string}){
 const [input,setInput]=useState<BankReview>({partyType:'customer',customerId:'',partyName:'',date:businessDay().date,amount:'',bankId:'',invoiceId:'',description:'',reference:'',creditAccountId:''}),[files,setFiles]=useState<File[]>([]),[review,setReview]=useState(false),[error,setError]=useState('');
 const [custQuery,setCustQuery]=useState(''),[showCustDropdown,setShowCustDropdown]=useState(false);
 const router=useRouter(),pending=useRef<{id:string;input:BankReview;fileNames?:string[]}|null>(null),flight=useRef(false);
 const [saving,setSaving]=useState(false),[uncertain,setUncertain]=useState(false),[saved,setSaved]=useState<{id:string;number:string}|null>(null);
 useEffect(()=>{onBusyChange(saving||uncertain)},[saving,uncertain,onBusyChange]);
 useEffect(()=>{if(preview||!storeId)return;try{const raw=sessionStorage.getItem(`bank-receipt-pending:${storeId}`);if(!raw)return;const p=JSON.parse(raw);if(!/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(p.id)||!p.input||!['partyType','customerId','partyName','date','amount','bankId','invoiceId','description','reference','creditAccountId'].every(k=>typeof p.input[k]==='string'))throw Error();pending.current=p;setInput(p.input);setUncertain(true);setReview(true);setError('طلب سابق غير مؤكد؛ أعد محاولة الطلب نفسه قبل إدخال سند آخر. إذا كنت اخترت مرفقات، أعد اختيارها بعد تأكيد السند')}catch{setUncertain(true);setError('تعذر قراءة طلب القبض السابق؛ تحقق من نتيجته قبل تسجيل سند آخر')}},[storeId,preview]);
 async function save(){if(flight.current||preview||!storeId)return;if(!pending.current){const message=validateBankReview(input,files,customers,invoices,banks,creditAccounts,currency);if(message){setError(message);setReview(false);return}pending.current={id:crypto.randomUUID(),input:{...input},fileNames:files.map(f=>f.name)}}flight.current=true;setSaving(true);setError('');
 try{try{sessionStorage.setItem(`bank-receipt-pending:${storeId}`,JSON.stringify(pending.current))}catch{setError('تعذر حفظ معرف الطلب في المتصفح؛ لم يُرسل السند');return}
 const result=await createBankReceipt(storeId,pending.current.id,pending.current.input);
 if(result.ok&&result.voucherId){setSaved({id:result.voucherId,number:result.voucherNumber||''});setUncertain(false);setReview(false);pending.current=null;try{sessionStorage.removeItem(`bank-receipt-pending:${storeId}`)}catch{}router.refresh()}
 else{setError(result.error||'تعذر الحفظ');setUncertain(uncertain||!!result.uncertain);if(!uncertain&&!result.uncertain){pending.current=null;try{sessionStorage.removeItem(`bank-receipt-pending:${storeId}`)}catch{}setReview(false);router.refresh()}}
 }catch{setUncertain(true);setError('تعذر تأكيد نتيجة الحفظ؛ أعد محاولة الطلب نفسه')}finally{flight.current=false;setSaving(false)}}
 const field='block w-full rounded-xl p-3 mt-2 bg-slate-800 border border-slate-700',bank=banks.find(b=>b.id===input.bankId),customer=customers.find(c=>c.id===input.customerId),invoice=invoices.find(i=>i.id===input.invoiceId),money=(n:number)=>`${Number.isFinite(n)?n.toFixed(2):'—'} ${currency}`;
 function change(p:Partial<BankReview>){if(saving||uncertain||saved)return;pending.current=null;if(Object.entries(p).every(([k,v])=>input[k as keyof BankReview]===v))return;setInput(v=>({...v,...p}));setReview(false);setError('')}

 const filteredCustomers = (() => {
   const q = custQuery.trim();
   if (!q) return customers.slice(0, 15);
   const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
   return customers.filter(c => {
     const str = `${c.name} ${c.phone || ''}`.toLowerCase();
     return tokens.every(t => str.includes(t));
   }).slice(0, 20);
 })();

 function selectCustomer(c: ReceiptCustomer) {
   const custInvs = invoices
     .filter(i => i.customer_id === c.id && !['draft', 'cancelled'].includes(i.status) && Number(i.total) > Number(i.amount_paid))
     .sort((a, b) => a.issue_date.localeCompare(b.issue_date));
   const oldest = custInvs[0];
   change({
     customerId: c.id,
     partyName: c.name,
     invoiceId: oldest ? oldest.id : ''
   });
   setCustQuery('');
   setShowCustDropdown(false);
 }

 return <section className={`${s.panel} mt-5`} dir="rtl"><h2 className="text-2xl font-bold">سند قبض بنكي</h2><p className={s.notice}>راجع التحويل قبل الاعتماد. يحفظ السند والبنك والقيد والعميل والفاتورة معاً. يُحفظ السند أولاً، ثم ترفع المرفقات الخاصة في خطوة مستقلة. فشل الرفع لا يلغي السند ولا يكرر القبض.</p><div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6"><form className="space-y-5 min-w-0" onSubmit={e=>{e.preventDefault();const message=validateBankReview(input,files,customers,invoices,banks,creditAccounts,currency);setError(message||'');setReview(!message)}}><fieldset disabled={saving||uncertain||!!saved} className="space-y-5 min-w-0"><div className="grid sm:grid-cols-2 gap-4"><label>تاريخ القبض<input aria-label="تاريخ القبض البنكي" type="date" value={input.date} className={field} onChange={e=>change({date:e.target.value})} onBlur={e=>change({date:e.target.value})}/></label><label>مبلغ التحويل<input aria-label="مبلغ القبض البنكي" inputMode="decimal" className={field} value={input.amount} onChange={e=>change({amount:e.target.value})}/></label></div>
 
 <div className="relative">
   <label className="block text-sm font-medium mb-1">العميل المستلم منه *</label>
   {customer ? (
     <div className="flex items-center justify-between bg-slate-800 border border-sky-500/50 rounded-xl p-3">
       <div>
         <span className="font-bold text-white">{customer.name}</span>
         {customer.phone && <span className="text-xs text-slate-400 mr-2" dir="ltr">{customer.phone}</span>}
         <span className="text-xs text-amber-300 mr-3">الرصيد: {money(Number(customer.balance))}</span>
       </div>
       <button type="button" onClick={() => { change({ customerId: '', partyName: '', invoiceId: '' }); setShowCustDropdown(true); }} className="text-xs text-sky-400 hover:underline">تغيير العميل</button>
     </div>
   ) : (
     <div>
       <input
         type="text"
         placeholder="ابحث باسم الزبون أو الهاتف (بحث ذكي متعدد الكلمات)..."
         value={custQuery}
         onFocus={() => setShowCustDropdown(true)}
         onChange={e => { setCustQuery(e.target.value); setShowCustDropdown(true); }}
         className={field}
       />
       {showCustDropdown && (
         <div className="absolute z-20 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-slate-800 border border-slate-700 rounded-xl shadow-2xl divide-y divide-slate-700/50">
           {filteredCustomers.length > 0 ? (
             filteredCustomers.map(c => (
               <button
                 key={c.id}
                 type="button"
                 onClick={() => selectCustomer(c)}
                 className="w-full text-right p-3 hover:bg-slate-700 flex items-center justify-between transition-colors"
               >
                 <div>
                   <div className="font-semibold text-white">{c.name}</div>
                   {c.phone && <div className="text-xs text-slate-400" dir="ltr">{c.phone}</div>}
                 </div>
                 <span className="text-xs font-semibold text-amber-300">{money(Number(c.balance))}</span>
               </button>
             ))
           ) : (
             <div className="p-4 text-center text-sm text-slate-400">لا يوجد عميل مطابق للبحث</div>
           )}
         </div>
       )}
     </div>
   )}
 </div>

 <label className="block">الحساب البنكي المستلم<select aria-label="حساب القبض البنكي" className={field} value={input.bankId} onChange={e=>change({bankId:e.target.value})}><option value="">اختر حساباً بعملة {currency}</option>{banks.map(b=><option key={b.id} value={b.id}>{b.bank_name} — {b.account_number}</option>)}</select></label>{!banks.length&&<p className="text-amber-300">لا يوجد حساب بنكي نشط بحساب محاسبي مطابق وصلاحية مناسبة. راجع إعدادات البنك.</p>}
 {input.customerId&&<label className="block">ربط فاتورة (تم تحديد الأقدم تلقائياً)<select aria-label="فاتورة القبض البنكي" value={input.invoiceId} className={field} onChange={e=>change({invoiceId:e.target.value})}><option value="">على حساب العميل دون فاتورة</option>{invoices.filter(i=>i.customer_id===input.customerId&&!['draft','cancelled'].includes(i.status)&&Number(i.total)>Number(i.amount_paid)).sort((a,b)=>a.issue_date.localeCompare(b.issue_date)).map((i, idx)=><option key={i.id} value={i.id}>{i.invoice_number} · {i.issue_date} · متبقٍ {money(Number(i.total)-Number(i.amount_paid))}{idx===0?' (الأقدم)':''}</option>)}</select></label>}
 <label className="block">مرجع التحويل البنكي<input aria-label="مرجع القبض البنكي" maxLength={200} className={field} value={input.reference} onChange={e=>change({reference:e.target.value})}/></label><label className="block">البيان<textarea aria-label="بيان القبض البنكي" maxLength={1000} rows={3} className={field} value={input.description} onChange={e=>change({description:e.target.value})}/></label>
 <section className="border border-slate-700 rounded-xl p-4 space-y-3"><h3 className="font-bold">اختيار مرفقات التحويل</h3><p className={s.hint}>PDF، JPG، PNG، WebP · خمسة ملفات كحد أقصى · 5 ميغابايت للملف و15 ميغابايت إجمالاً. تُرفع الملفات بعد حفظ السند من قسم المرفقات الخاصة. اختيار الملفات وحده لا يرفعها. عند إغلاق الصفحة أعد اختيار الملفات لاستكمال الرفع.</p><input aria-label="مرفقات القبض البنكي" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple className="max-w-full" onChange={e=>{const selected=Array.from(e.target.files||[]),next=[...files,...selected],message=validateReceiptFiles(next);setReview(false);setError(message||'');if(!message)setFiles(next);e.target.value=''}}/>{files.map((f,i)=><div key={`${f.name}-${i}`} className="flex justify-between gap-3 min-w-0"><span className="break-all">{f.name} · {(f.size/1024).toFixed(1)} KB</span><button type="button" aria-label={`إزالة المرفق ${i+1}`} onClick={()=>{setFiles(v=>v.filter((_,n)=>n!==i));setReview(false);setError('')}}>إزالة</button></div>)}</section>{error&&<p role="alert" className={s.error}>{error}</p>}<button type="submit" className={s.primary}>مراجعة القبض البنكي</button></fieldset></form>
 <aside className="min-w-0 self-start bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4"><h3 className="text-xl font-bold">ملخص التحويل</h3><strong className="text-3xl text-sky-300 block">{money(Number(input.amount||0))}</strong><p>المستلم منه: {customer?.name||'لم يُحدد'}</p><p>البنك: {bank?`${bank.bank_name} — ${bank.account_number}`:'لم يُحدد'}</p><p>الفاتورة: {invoice?.invoice_number||'دون ربط'}</p><p>المرجع: {input.reference||'لم يُحدد'}</p><p>المرفقات المختارة: {files.length} · {saved?'راجع حالة المرفقات في القسم التالي':'لم تُرفع'}</p><p className={s.notice}>التحويل البنكي لا ينشئ حركة صندوق نقدي. القبض دون فاتورة قد ينشئ رصيداً دائناً للعميل.</p>{review&&!saving&&!uncertain&&!saved&&<p role="status" className={s.settled}>اجتاز التحويل المراجعة. لم يُحفظ سند ولم تُرفع ملفات ولم تتغير أرصدة.</p>}{error&&(saving||uncertain||saved)&&<p role="alert" className={s.error}>{error}</p>}{saved&&<p role="status" className={s.settled}>حُفظ السند {saved.number}. <Link href={`/dashboard/accounting/receipts/print/${saved.id}`}>عرض / طباعة</Link></p>}{files.length>0&&!saved&&<p className="text-amber-300">حفظ السند لا يرفع الملفات؛ استكمل رفعها بعد الحفظ.</p>}<button type="button" onClick={save} disabled={preview||saving||!!saved||(!review&&!uncertain)||(!pending.current&&uncertain)} className="w-full rounded-xl p-3 bg-sky-500 font-bold disabled:opacity-40">{preview?'معاينة فقط — لا حفظ مالي':saving?'جارٍ حفظ السند…':uncertain?'إعادة محاولة الطلب نفسه':files.length?'حفظ السند ثم استكمال المرفقات':'اعتماد سند القبض البنكي'}</button></aside></div>{saved&&<div className="mt-5"><ReceiptAttachments storeId={storeId} voucherId={saved.id} initialFiles={files} onBusyChange={onBusyChange}/></div>}</section>
}
