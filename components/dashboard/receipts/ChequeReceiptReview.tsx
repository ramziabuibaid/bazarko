'use client'
import {useState,useEffect,useRef} from 'react'
import Link from 'next/link'
import {useRouter} from 'next/navigation'
import {createChequeReceipt} from '@/app/dashboard/accounting/receipts/receipt-action'
import {businessDay} from '@/lib/dashboard/simple-metrics'
import {type ReceiptCustomer,type ReceiptInvoice} from '@/lib/receipts/presentation'
import {emptyCheque,chequeTotals,validateChequeReview,type ChequeReview,type ReceiptCheque} from '@/lib/receipts/cheque-review'
import {PALESTINIAN_BANKS} from '@/lib/palestineBanks'
import s from '@/components/dashboard/accounting/invoices-list.module.css'
export default function ChequeReceiptReview({customers,invoices,cashBoxes,portfolios,creditAccounts,currency,storeId,preview,onBusyChange}:{storeId:string;preview:boolean;onBusyChange:(busy:boolean)=>void;customers:ReceiptCustomer[];invoices:ReceiptInvoice[];cashBoxes:{id:string;name:string}[];portfolios:{id:string;name:string}[];creditAccounts:{id:string;name:string;code:string}[];currency:string}){
 const today=businessDay().date,[input,setInput]=useState<ChequeReview>({partyType:'customer',customerId:'',partyName:'',date:today,amount:'0',boxId:'',invoiceId:'',description:'',reference:'',creditAccountId:'',method:'cheque',portfolioId:'',cheques:[emptyCheque(today)]}),[error,setError]=useState(''),[review,setReview]=useState(false);
 const [custQuery,setCustQuery]=useState(''),[showCustDropdown,setShowCustDropdown]=useState(false);
 const router=useRouter(),pending=useRef<{id:string;input:ChequeReview}|null>(null),flight=useRef(false);
 const [saving,setSaving]=useState(false),[uncertain,setUncertain]=useState(false),[saved,setSaved]=useState<{id:string;number:string}|null>(null);
 useEffect(()=>{onBusyChange(saving||uncertain)},[saving,uncertain,onBusyChange]);
 useEffect(()=>{if(preview||!storeId)return;try{const raw=sessionStorage.getItem(`cheque-receipt-pending:${storeId}`);if(!raw)return;const p=JSON.parse(raw);if(!/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(p.id)||!p.input||!['partyType','customerId','partyName','date','amount','boxId','invoiceId','description','reference','creditAccountId','method','portfolioId'].every(k=>typeof p.input[k]==='string')||!Array.isArray(p.input.cheques)||!p.input.cheques.length||!p.input.cheques.every((v:ReceiptCheque)=>['check_number','bank_name','branch_name','account_number','drawer_name','amount','issue_date','due_date'].every(k=>typeof v[k as keyof ReceiptCheque]==='string')))throw Error();pending.current=p;setInput(p.input);setUncertain(true);setReview(true);setError('يوجد طلب سابق غير مؤكد؛ أعد محاولة الطلب نفسه قبل تسجيل سند آخر')}catch{setUncertain(true);setError('تعذر قراءة الطلب السابق؛ تحقق من نتيجته قبل تسجيل سند آخر')}},[storeId,preview]);
 async function save(){if(flight.current||preview||!storeId)return;if(!pending.current){const message=validateChequeReview(input,customers,invoices,cashBoxes,portfolios,creditAccounts);if(message){setError(message);setReview(false);return}pending.current={id:crypto.randomUUID(),input:{...input,cheques:input.cheques.map(c=>({...c}))}}}flight.current=true;setSaving(true);setError('');
 try{try{sessionStorage.setItem(`cheque-receipt-pending:${storeId}`,JSON.stringify(pending.current))}catch{setError('تعذر حفظ معرف الطلب في المتصفح؛ لم يُرسل السند');return}
 const result=await createChequeReceipt(storeId,pending.current.id,pending.current.input);
 if(result.ok&&result.voucherId){setSaved({id:result.voucherId,number:result.voucherNumber||''});setUncertain(false);setReview(false);pending.current=null;try{sessionStorage.removeItem(`cheque-receipt-pending:${storeId}`)}catch{}router.refresh()}
 else{setError(result.error||'تعذر الحفظ');setUncertain(uncertain||!!result.uncertain);if(!uncertain&&!result.uncertain){pending.current=null;try{sessionStorage.removeItem(`cheque-receipt-pending:${storeId}`)}catch{}setReview(false);router.refresh()}}
 }catch{setUncertain(true);setError('تعذر تأكيد نتيجة الحفظ؛ أعد محاولة الطلب نفسه')}finally{flight.current=false;setSaving(false)}}
 const totals=chequeTotals(input),money=(n:number)=>Number.isFinite(n)?`${n.toFixed(2)} ${currency}`:'—',field='block w-full bg-slate-800 border border-slate-700 rounded-xl p-3 mt-2';
 function change(p:Partial<ChequeReview>){if(saving||uncertain||saved)return;pending.current=null;if(Object.entries(p).every(([key,value])=>input[key as keyof ChequeReview]===value))return;setInput(previous=>({...previous,...p}));setReview(false);setError('')}
 function cheque(index:number,p:Partial<ReceiptCheque>){change({cheques:input.cheques.map((c,i)=>i===index?{...c,...p}:c)})}

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

 const currentCustomer = customers.find(c => c.id === input.customerId);

 return <section className={`${s.panel} mt-5`} dir="rtl"><h2 className="text-2xl font-bold">سند قبض شيكات أو نقدي وشيكات</h2><p className={s.notice}>يحفظ السند والشيكات والقيد وتسوية العميل والفاتورة معاً. الجزء النقدي فقط يزيد الصندوق؛ تسوية الفاتورة بالشيك اسمية حتى تحصيله. التحصيل والإعادة من محفظة الشيكات، مع ربط تسوية العميل والفاتورة.</p><div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6"><form className="min-w-0 space-y-5" onSubmit={e=>{e.preventDefault();const message=validateChequeReview(input,customers,invoices,cashBoxes,portfolios,creditAccounts);setError(message||'');setReview(!message)}}>
 <fieldset disabled={saving||uncertain||!!saved} className="min-w-0 space-y-5"><div className={s.tabs}>{(['cheque','split'] as const).map(method=><button type="button" key={method} aria-pressed={input.method===method} onClick={()=>change({method,amount:method==='cheque'?'0':'',boxId:''})}>{method==='cheque'?'شيكات فقط':'نقدي + شيكات'}</button>)}</div>
 <div className="grid sm:grid-cols-2 gap-4"><label>تاريخ القبض<input type="date" aria-label="تاريخ قبض الشيكات" value={input.date} className={field} onChange={e=>change({date:e.target.value})} onBlur={e=>change({date:e.target.value})}/></label><div className="flex items-center gap-2 pt-6"><span className="text-sm font-semibold text-sky-400">سند قبض لعميل مسجل</span></div></div>
 
 <div className="relative">
   <label className="block text-sm font-medium mb-1">العميل المستلم منه *</label>
   {currentCustomer ? (
     <div className="flex items-center justify-between bg-slate-800 border border-sky-500/50 rounded-xl p-3">
       <div>
         <span className="font-bold text-white">{currentCustomer.name}</span>
         {currentCustomer.phone && <span className="text-xs text-slate-400 mr-2" dir="ltr">{currentCustomer.phone}</span>}
         <span className="text-xs text-amber-300 mr-3">الرصيد: {money(Number(currentCustomer.balance))}</span>
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

 <label className="block">محفظة الشيكات الواردة<select aria-label="محفظة قبض الشيكات" className={field} value={input.portfolioId} onChange={e=>change({portfolioId:e.target.value})}><option value="">اختر محفظة مصرحاً بها</option>{portfolios.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{!portfolios.length&&<p className="text-amber-300">لا توجد محفظة شيكات واردة نشطة بحساب مطابق وصلاحية قبض؛ راجع إعدادات الخزينة.</p>}
 {input.method==='split'&&<section className="border border-emerald-700 rounded-xl p-4 grid sm:grid-cols-2 gap-4"><label>الصندوق النقدي<select aria-label="صندوق القبض المختلط" className={field} value={input.boxId} onChange={e=>change({boxId:e.target.value})}><option value="">اختر الصندوق</option>{cashBoxes.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>الجزء النقدي<input aria-label="نقد القبض المختلط" inputMode="decimal" className={field} value={input.amount} onChange={e=>change({amount:e.target.value})}/></label></section>}
 <section className="space-y-4">
   <h3 className="font-bold text-purple-300">الشيكات المستلمة · العملة {currency} · دون تحويل عملات</h3>
   {input.cheques.map((c, i) => {
     const matchedBank = PALESTINIAN_BANKS.find(b => b.code === c.bank_code) || PALESTINIAN_BANKS.find(b => b.name === c.bank_name);
     const isKnownBank = !!matchedBank;
     return (
       <article key={i} className="border border-purple-700/60 bg-slate-800/40 rounded-xl p-4 space-y-4">
         <div className="flex justify-between items-center gap-4 border-b border-slate-700/60 pb-2">
           <div className="flex items-center gap-2">
             <span className="w-6 h-6 rounded-full bg-purple-600/30 text-purple-300 font-bold flex items-center justify-center text-xs">
               {i + 1}
             </span>
             <h4 className="font-bold text-white text-sm">الشيك {i + 1}</h4>
             {c.bank_code && (
               <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                 كود بنك: {c.bank_code} {c.branch_code ? `· فرع: ${c.branch_code}` : ''}
               </span>
             )}
           </div>
           <button
             type="button"
             disabled={input.cheques.length === 1}
             aria-label={`حذف الشيك ${i + 1}`}
             className="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-30 disabled:hover:text-rose-400 transition"
             onClick={() => change({ cheques: input.cheques.filter((_, n) => n !== i) })}
           >
             حذف الشيك
           </button>
         </div>

         {/* Bank & Bank Code */}
         <div className="grid sm:grid-cols-3 gap-4">
           <div className="sm:col-span-2">
             <label className="block text-xs font-semibold mb-1 text-slate-300">اسم البنك المسحوب عليه *</label>
             <select
               aria-label={`بنك الشيك ${i + 1}`}
               className={field}
               value={c.bank_code || (matchedBank ? matchedBank.code : (c.bank_name ? 'OTHER' : ''))}
               onChange={e => {
                 const val = e.target.value;
                 if (val === 'OTHER') {
                   cheque(i, { bank_name: '', bank_code: '', branch_name: '', branch_code: '' });
                 } else {
                   const b = PALESTINIAN_BANKS.find(x => x.code === val);
                   if (b) {
                     cheque(i, {
                       bank_name: b.name,
                       bank_code: b.code,
                       branch_name: '',
                       branch_code: ''
                     });
                   } else {
                     cheque(i, { bank_name: '', bank_code: '', branch_name: '', branch_code: '' });
                   }
                 }
               }}
             >
               <option value="">-- اختر البنك من دليل سلطة النقد --</option>
               {PALESTINIAN_BANKS.map(b => (
                 <option key={b.code} value={b.code}>
                   {b.name} (كود {b.code})
                 </option>
               ))}
               <option value="OTHER">-- بنك آخر / إدخال يدوي --</option>
             </select>
             {(!isKnownBank && (c.bank_name || c.bank_code === '')) && (
               <input
                 type="text"
                 placeholder="أدخل اسم البنك يدوياً"
                 value={c.bank_name}
                 onChange={e => cheque(i, { bank_name: e.target.value })}
                 className={`${field} mt-2`}
               />
             )}
           </div>

           <div>
             <label className="block text-xs font-semibold mb-1 text-slate-300">رقم/كود البنك</label>
             <input
               aria-label={`كود بنك الشيك ${i + 1}`}
               type="text"
               placeholder="كود البنك"
               value={c.bank_code || ''}
               readOnly={isKnownBank}
               onChange={e => cheque(i, { bank_code: e.target.value })}
               className={`${field} font-mono ${isKnownBank ? 'bg-slate-900 text-emerald-400 font-bold' : ''}`}
             />
           </div>
         </div>

         {/* Branch & Branch Code */}
         <div className="grid sm:grid-cols-3 gap-4">
           <div className="sm:col-span-2">
             <label className="block text-xs font-semibold mb-1 text-slate-300">فرع البنك</label>
             {matchedBank && matchedBank.branches.length > 0 ? (
               <select
                 aria-label={`فرع الشيك ${i + 1}`}
                 className={field}
                 value={c.branch_code || (matchedBank.branches.find(br => br.name === c.branch_name)?.code || '')}
                 onChange={e => {
                   const brCode = e.target.value;
                   if (brCode === 'OTHER') {
                     cheque(i, { branch_name: '', branch_code: '' });
                   } else {
                     const br = matchedBank.branches.find(x => x.code === brCode);
                     if (br) {
                       cheque(i, { branch_name: br.name, branch_code: br.code });
                     } else {
                       cheque(i, { branch_name: '', branch_code: '' });
                     }
                   }
                 }}
               >
                 <option value="">-- اختر فرع البنك --</option>
                 {matchedBank.branches.map(br => (
                   <option key={br.code} value={br.code}>
                     {br.name} (فرع {br.code})
                   </option>
                 ))}
                 <option value="OTHER">-- فرع آخر / إدخال يدوي --</option>
               </select>
             ) : (
               <input
                 aria-label={`فرع الشيك ${i + 1}`}
                 type="text"
                 placeholder="اسم الفرع (اختياري)"
                 value={c.branch_name}
                 onChange={e => cheque(i, { branch_name: e.target.value })}
                 className={field}
               />
             )}
             {matchedBank && !matchedBank.branches.some(br => br.code === c.branch_code) && c.branch_code === '' && c.branch_name && (
               <input
                 type="text"
                 placeholder="أدخل اسم الفرع يدوياً"
                 value={c.branch_name}
                 onChange={e => cheque(i, { branch_name: e.target.value })}
                 className={`${field} mt-2`}
               />
             )}
           </div>

           <div>
             <label className="block text-xs font-semibold mb-1 text-slate-300">رقم/كود الفرع</label>
             <input
               aria-label={`كود فرع الشيك ${i + 1}`}
               type="text"
               placeholder="كود الفرع"
               value={c.branch_code || ''}
               readOnly={!!(matchedBank && matchedBank.branches.some(br => br.code === c.branch_code))}
               onChange={e => cheque(i, { branch_code: e.target.value })}
               className={`${field} font-mono ${matchedBank && matchedBank.branches.some(br => br.code === c.branch_code) ? 'bg-slate-900 text-emerald-400 font-bold' : ''}`}
             />
           </div>
         </div>

         {/* Check Details */}
         <div className="grid sm:grid-cols-2 gap-4">
           <label>
             رقم الشيك *
             <input
               aria-label={`رقم الشيك ${i + 1}`}
               className={`${field} font-mono`}
               value={c.check_number}
               onChange={e => cheque(i, { check_number: e.target.value })}
             />
           </label>
           <label>
             قيمة الشيك *
             <input
               aria-label={`قيمة الشيك ${i + 1}`}
               className={`${field} font-mono font-bold text-purple-300`}
               inputMode="decimal"
               value={c.amount}
               onChange={e => cheque(i, { amount: e.target.value })}
             />
           </label>
           <label>
             رقم حساب الساحب *
             <input
               aria-label={`رقم حساب الساحب ${i + 1}`}
               className={`${field} font-mono`}
               value={c.account_number}
               onChange={e => cheque(i, { account_number: e.target.value })}
             />
           </label>
           <label>
             اسم الساحب (اختياري)
             <input
               aria-label={`اسم الساحب ${i + 1}`}
               className={field}
               value={c.drawer_name}
               onChange={e => cheque(i, { drawer_name: e.target.value })}
             />
           </label>
         </div>

         {/* Dates */}
         <div className="grid sm:grid-cols-2 gap-4">
           <label>
             تاريخ إصدار الشيك *
             <input
               aria-label={`تاريخ إصدار الشيك ${i + 1}`}
               type="date"
               className={field}
               value={c.issue_date}
               onChange={e => cheque(i, { issue_date: e.target.value })}
               onBlur={e => cheque(i, { issue_date: e.target.value })}
             />
           </label>
           <label>
             تاريخ استحقاق الشيك *
             <input
               aria-label={`تاريخ استحقاق الشيك ${i + 1}`}
               type="date"
               className={`${field} border-purple-500/50`}
               value={c.due_date}
               onChange={e => cheque(i, { due_date: e.target.value })}
               onBlur={e => cheque(i, { due_date: e.target.value })}
             />
           </label>
         </div>
       </article>
     );
   })}
   <button type="button" disabled={input.cheques.length>=50} className={s.primary} onClick={()=>change({cheques:[...input.cheques,emptyCheque(input.date)]})}>＋ إضافة شيك</button>
 </section>
 {input.customerId&&<label className="block">ربط فاتورة (تم تحديد الأقدم تلقائياً)<select aria-label="فاتورة قبض الشيكات" value={input.invoiceId} className={field} onChange={e=>change({invoiceId:e.target.value})}><option value="">على حساب العميل دون فاتورة</option>{invoices.filter(v=>v.customer_id===input.customerId&&Number(v.total)>Number(v.amount_paid)&&!['draft','cancelled'].includes(v.status)).sort((a,b)=>a.issue_date.localeCompare(b.issue_date)).map((v, idx)=><option key={v.id} value={v.id}>{v.invoice_number} · {v.issue_date} · متبقٍ {money(Number(v.total)-Number(v.amount_paid))}{idx===0?' (الأقدم)':''}</option>)}</select></label>}
 <label className="block">البيان<textarea aria-label="بيان قبض الشيكات" className={field} rows={3} maxLength={1000} value={input.description} onChange={e=>change({description:e.target.value})}/></label><label className="block">المرجع (اختياري)<input aria-label="مرجع قبض الشيكات" maxLength={200} className={field} value={input.reference} onChange={e=>change({reference:e.target.value})}/></label>{error&&<p role="alert" className={s.error}>{error}</p>}<button type="submit" className={s.primary}>مراجعة قبض الشيكات</button></fieldset></form>
 <aside className="min-w-0 border border-slate-700 rounded-xl p-5 bg-slate-900 self-start space-y-4"><h3 className="text-xl font-bold">ملخص السند</h3><p>المستلم منه: <strong>{currentCustomer?.name||'لم يُحدد'}</strong></p><p>الجزء النقدي: <strong>{money(totals.cash)}</strong></p><p>الشيكات الاسمية: <strong className="text-purple-300">{money(totals.cheques)}</strong></p><p>عدد الشيكات: {input.cheques.length}</p><p>إجمالي السند: <strong className="text-sky-300">{money(totals.total)}</strong></p><p className={s.notice}>يدخل الجزء النقدي فقط إلى الصندوق. تحفظ الشيكات في المحفظة عند تنفيذ الاعتماد؛ لا تصبح نقداً عند الاستلام.</p>{review&&!saving&&!uncertain&&!saved&&<p role="status" className={s.settled}>اجتاز السند المراجعة. لم تُحفظ شيكات أو سند ولم تتغير أرصدة.</p>}{error&&(saving||uncertain||saved)&&<p role="alert" className={s.error}>{error}</p>}{saved&&<p role="status" className={s.settled}>حُفظ السند {saved.number}. <Link href={`/dashboard/accounting/receipts/print/${saved.id}`}>عرض / طباعة</Link> · <Link href="/dashboard/cheques">محفظة الشيكات</Link></p>}<button type="button" onClick={save} disabled={preview||saving||!!saved||(!review&&!uncertain)||(!pending.current&&uncertain)} className="w-full bg-purple-600 rounded-xl p-3 disabled:opacity-40">{saving?'جارٍ حفظ السند…':uncertain?'إعادة محاولة الطلب نفسه':preview?'معاينة فقط — لا حفظ مالي':'اعتماد سند الشيكات والمختلط'}</button><p className={s.hint}>المرفقات والحفظ كمسودة غير متاحين في هذه المرحلة.</p></aside></div></section>
}
