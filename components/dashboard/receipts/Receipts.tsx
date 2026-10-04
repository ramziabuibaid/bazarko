'use client'
import {useState,useRef,useEffect} from 'react'
import {useRouter} from 'next/navigation'
import {createCashReceipt,updateReceiptAction,deleteReceiptAction} from '@/app/dashboard/accounting/receipts/receipt-action'
import Link from 'next/link'
import BankReceiptReview from './BankReceiptReview'
import {type ReceiptBank} from '@/lib/receipts/bank-review'
import ChequeReceiptReview from './ChequeReceiptReview'
import {businessDay} from '@/lib/dashboard/simple-metrics'
import {declaredCash,receiptView,receiptMethods,receiptMethod,receiptNeedsReview,validateCashReview,type Receipt,type ReceiptCustomer,type ReceiptInvoice,type CashReview} from '@/lib/receipts/presentation'
import s from '@/components/dashboard/accounting/invoices-list.module.css'

export default function Receipts({receipts,customers,invoices,cashBoxes,creditAccounts,currency,banks=[],portfolios=[],storeId='',preview=false,initialCustomer=''}:{banks?:ReceiptBank[];portfolios?:{id:string;name:string}[];storeId?:string;preview?:boolean;initialCustomer?:string;receipts:Receipt[];customers:ReceiptCustomer[];invoices:ReceiptInvoice[];cashBoxes:{id:string;name:string}[];creditAccounts:{id:string;name:string;code:string}[];currency:string}){
 const [bankOpen,setBankOpen]=useState(false),[bankBusy,setBankBusy]=useState(false);
 useEffect(()=>{if(preview)return;try{if(sessionStorage.getItem(`bank-receipt-pending:${storeId}`)){setBankOpen(true);setOpen(false);setChequeOpen(false);setBankBusy(true)}}catch{setBankOpen(true);setOpen(false);setChequeOpen(false);setBankBusy(true)}},[storeId,preview]);
 const [chequeOpen,setChequeOpen]=useState(false),[chequeBusy,setChequeBusy]=useState(false),[ready,setReady]=useState(preview);
 useEffect(()=>{if(preview)return;try{if(sessionStorage.getItem(`cheque-receipt-pending:${storeId}`)){setChequeOpen(true);setOpen(false);setChequeBusy(true)}}catch{setChequeOpen(true);setOpen(false);setChequeBusy(true)}finally{setReady(true)}},[storeId,preview]);
 const [q,setQ]=useState(''),[method,setMethod]=useState('all'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[page,setPage]=useState(1),[size,setSize]=useState(10);
 const [open,setOpen]=useState(!!initialCustomer),[message,setMessage]=useState(''),[review,setReview]=useState(false);
 const [isEditing,setIsEditing]=useState(false),[editingVoucherId,setEditingVoucherId]=useState<string|null>(null);
 const [customerQuery,setCustomerQuery]=useState(''),[showCustomerDropdown,setShowCustomerDropdown]=useState(false);
 const [form,setForm]=useState<CashReview>({partyType:'customer',customerId:initialCustomer,partyName:'',date:businessDay().date,amount:'',boxId:cashBoxes[0]?.id||'',invoiceId:'',description:'',reference:'',creditAccountId:''});
 const router=useRouter(),pending=useRef<{id:string;input:CashReview}|null>(null),inFlight=useRef(false);
 const [saving,setSaving]=useState(false),[deleting,setDeleting]=useState(false),[uncertain,setUncertain]=useState(false),[saved,setSaved]=useState<{id:string;number:string}|null>(null);

 async function handleDeleteReceipt(){
   if(!isEditing||!editingVoucherId||!storeId||deleting)return;
   if(!window.confirm('هل أنت متأكد من رغبتك في حذف سند القبض نهائياً؟ سيتم عكس جميع الآثار المالية والمحاسبية ورصيد العميل والفاتورة وحركة الصندوق.')) return;
   setDeleting(true);setMessage('');
   try{
     const res=await deleteReceiptAction(storeId,editingVoucherId);
     if(res.ok){
       setIsEditing(false);setEditingVoucherId(null);setOpen(false);
       router.refresh();
     }else{
       setMessage(res.error||'تعذر حذف سند القبض');
     }
   }catch(e:any){
     setMessage(e?.message||'حدث خطأ أثناء حذف السند');
   }finally{
     setDeleting(false);
   }
 }

 useEffect(()=>{
   if(initialCustomer){
     const c=customers.find(item=>item.id===initialCustomer);
     if(c)selectCustomer(c);
   }
 },[initialCustomer]);

 useEffect(()=>{if(preview||!storeId)return;try{const raw=sessionStorage.getItem(`cash-receipt-pending:${storeId}`);if(!raw)return;const p=JSON.parse(raw);if(!/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(p.id)||!p.input||!['partyType','customerId','partyName','date','amount','boxId','invoiceId','description','reference','creditAccountId'].every(k=>typeof p.input[k]==='string'))throw Error('invalid pending');pending.current=p;setForm(p.input);setOpen(true);setUncertain(true);setReview(true);setMessage('يوجد طلب سابق لم تتأكد نتيجته؛ أعد محاولة الطلب نفسه قبل إدخال سند آخر')}catch{setMessage('تعذر قراءة طلب القبض السابق؛ تحقق من النتيجة قبل تسجيل سند آخر');setUncertain(true);setOpen(true)}},[storeId,preview]);

 async function save(){
   if(inFlight.current||preview||!storeId)return;
   if(isEditing&&editingVoucherId){
     const error=validateCashReview(form,customers,invoices,cashBoxes,creditAccounts);
     if(error){setMessage(error);setReview(false);return}
     inFlight.current=true;setSaving(true);setMessage('');
     try{
       const result=await updateReceiptAction(storeId,editingVoucherId,form);
       if(result.ok){
         setSaved({id:editingVoucherId,number:''});
         setIsEditing(false);setEditingVoucherId(null);
         setOpen(false);setReview(false);
         router.refresh();
       }else{
         setMessage(result.error||'تعذر تعديل السند');
       }
     }catch(e:any){
       setMessage(e?.message||'حدث خطأ أثناء تعديل السند');
     }finally{
       inFlight.current=false;setSaving(false);
     }
     return;
   }

   if(!pending.current){
     const error=validateCashReview(form,customers,invoices,cashBoxes,creditAccounts);
     if(error){setMessage(error);setReview(false);return}
     pending.current={id:crypto.randomUUID(),input:{...form}}
   }
   inFlight.current=true;setSaving(true);setMessage('');
   try{
     try{sessionStorage.setItem(`cash-receipt-pending:${storeId}`,JSON.stringify(pending.current))}catch{setMessage('تعذر حفظ معرف الطلب في المتصفح؛ لم يُرسل السند. فعّل التخزين ثم أعد المحاولة');return}
     const result=await createCashReceipt(storeId,pending.current.id,pending.current.input);
     if(result.ok&&result.voucherId){
       setSaved({id:result.voucherId,number:result.voucherNumber||''});
       setUncertain(false);setReview(false);pending.current=null;
       try{sessionStorage.removeItem(`cash-receipt-pending:${storeId}`)}catch{}
       router.refresh()
     }else{
       setMessage(result.error||'تعذر الحفظ');
       setUncertain(uncertain||!!result.uncertain);
       if(!uncertain&&!result.uncertain){
         pending.current=null;
         try{sessionStorage.removeItem(`cash-receipt-pending:${storeId}`)}catch{}
         setReview(false);router.refresh()
       }
     }
   }catch{
     setUncertain(true);setMessage('تعذر تأكيد نتيجة الحفظ؛ أعد محاولة الطلب نفسه')
   }finally{
     inFlight.current=false;setSaving(false)
   }
 }

 const view=receiptView(receipts,q,method,from,to,page,size);
 const customer=customers.find(c=>c.id===form.customerId);
 const invoice=invoices.find(i=>i.id===form.invoiceId);
 const box=cashBoxes.find(b=>b.id===form.boxId);
 const money=(n:number)=>`${n.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency}`;

 function change<K extends keyof CashReview>(field:K,value:CashReview[K]){
   if(saving||uncertain||saved)return;
   pending.current=null;
   setForm({...form,[field]:value,...(field==='customerId'?{invoiceId:''}:{})});
   setReview(false);setMessage('')
 }

 const filteredCustomers=(()=>{
   const q=customerQuery.trim();
   if(!q)return customers.slice(0,15);
   const tokens=q.toLowerCase().split(/\s+/).filter(Boolean);
   return customers.filter(c=>{
     const str=`${c.name} ${c.phone||''}`.toLowerCase();
     return tokens.every(t=>str.includes(t));
   }).slice(0,20);
 })();

 function selectCustomer(c:ReceiptCustomer){
   const custInvs=invoices
     .filter(i=>i.customer_id===c.id&&!['draft','cancelled'].includes(i.status)&&Number(i.total)>Number(i.amount_paid))
     .sort((a,b)=>a.issue_date.localeCompare(b.issue_date));
   const oldest=custInvs[0];
   change('customerId',c.id);
   change('partyName',c.name);
   if(oldest){
     change('invoiceId',oldest.id);
     if(!form.amount){
       change('amount',String(Math.max(0,Number(oldest.total)-Number(oldest.amount_paid))));
     }
   }else{
     change('invoiceId','');
   }
   setCustomerQuery('');
   setShowCustomerDropdown(false);
 }

 function openCreateModal(){
   if(saved)setForm({...form,amount:'',invoiceId:'',description:'',reference:'',date:businessDay().date});
   setSaved(null);setIsEditing(false);setEditingVoucherId(null);
   setBankOpen(false);setChequeOpen(false);setOpen(true);setReview(false);setMessage('');
 }

 function openEditModal(v:Receipt){
   setBankOpen(false);setChequeOpen(false);
   setIsEditing(true);setEditingVoucherId(v.id);
   setSaved(null);setUncertain(false);setReview(false);setMessage('');
   setForm({
     partyType:'customer',
     customerId:v.customer_id||'',
     partyName:v.party_name||'',
     date:v.date,
     amount:String(v.amount),
     boxId:v.cash_box_id||cashBoxes[0]?.id||'',
     invoiceId:v.invoice_id||'',
     description:v.description||'',
     reference:v.reference||'',
     creditAccountId:''
   });
   setOpen(true);
 }

 return <main className={s.page} dir="rtl">
   <Link href="/dashboard/accounting-hub" className={s.back}>← الإدارة المالية والمحاسبية</Link>
   <header className={s.header}>
     <div>
       <h1>سندات القبض</h1>
       <p>المبالغ المسجلة ووسائل القبض وروابط المستندات</p>
     </div>
     <div className={s.buttons}>
       <button className={s.primary} disabled={!ready||saving||uncertain||chequeBusy||bankBusy} onClick={openCreateModal}>＋ سند قبض نقدي جديد</button>
       <button disabled={!ready||saving||uncertain||chequeBusy||bankBusy} onClick={()=>{setBankOpen(false);setOpen(false);setChequeOpen(!chequeOpen)}}>{chequeOpen?'إغلاق مراجعة الشيكات':'＋ قبض شيكات / مختلط'}</button>
       <button disabled={!ready||saving||uncertain||chequeBusy||bankBusy} onClick={()=>{setOpen(false);setChequeOpen(false);setBankOpen(!bankOpen)}}>{bankOpen?'إغلاق مراجعة البنك':'＋ قبض بنكي'}</button>
     </div>
   </header>

   <p className={s.notice}>يحفظ القبض النقدي والسند وحركة الصندوق والقيد وذمة العميل وتحصيل الفاتورة معاً. يحفظ قبض الشيكات والمختلط ذرياً؛ قيمة الشيك اسمية ولا تزيد النقد. التحصيل والإعادة من محفظة الشيكات، مع ربط تسوية العميل والفاتورة. يحفظ القبض البنكي ذرياً، ثم ترفع المرفقات الخاصة من السند المحفوظ؛ إعادة رفع المرفق لا تكرر القبض.</p>

   <section className={s.stats}>{[['إجمالي السندات',money(view.total)],['عدد السندات',String(view.filtered.length)],['قبض نقدي مسجل بالصناديق',money(view.cash)],['شيكات اسمية في السندات',money(view.cheques)]].map(([label,value])=><article key={label} className={s.stat}><div><span>{label}</span><strong>{view.error?'—':value}</strong><small>حسب الفلاتر · الشيكات لا تعني تحصيلاً نقدياً</small></div></article>)}</section>

   <section className={s.panel}><div className={s.filters}><input aria-label="بحث سندات القبض" value={q} onChange={e=>{setQ(e.target.value);setPage(1)}} placeholder="رقم السند أو المستلم منه أو البيان أو المرجع…"/><label>من تاريخ<input aria-label="بداية فترة السندات" type="date" value={from} onBlur={e=>{setFrom(e.target.value);setPage(1)}} onChange={e=>{setFrom(e.target.value);setPage(1)}}/></label><label>إلى تاريخ<input aria-label="نهاية فترة السندات" type="date" value={to} onBlur={e=>{setTo(e.target.value);setPage(1)}} onChange={e=>{setTo(e.target.value);setPage(1)}}/></label><button onClick={()=>{setQ('');setMethod('all');setFrom('');setTo('');setPage(1)}}>مسح الفلاتر</button></div><div className={s.tabs}>{[['all','الكل'],...Object.entries(receiptMethods)].map(([value,label])=><button key={value} aria-pressed={method===value} onClick={()=>{setMethod(value);setPage(1)}}>{label}</button>)}</div></section>

   {view.error?<p role="alert" className={s.error}>{view.error}</p>:<>{view.review>0&&<p className={s.notice}>{view.review} سند يحتاج مراجعة ربط القيد أو مطابقة الحركة النقدية. لا تُغيّر الأرصدة تلقائياً.</p>}<div className={s.tableWrap}><table><thead><tr>{['رقم السند','التاريخ','المستلم منه','طريقة القبض','البيان','المبلغ','القيد والمطابقة','الإجراءات والمستندات'].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{view.rows.map(v=><tr key={v.id}><td className={s.number}>{v.voucher_number}</td><td>{v.date}</td><td>{v.customer_id?<Link href={`/dashboard/customers/${v.customer_id}`} className="hover:text-sky-400 hover:underline transition-colors font-semibold block">{v.party_name||'عميل مسجل'}</Link>:(v.party_name||'غير مسجل')}{v.supplier_id&&<small>مورد · {v.purchase_return_id?'استرداد مرتبط بمرتجع':'راجع مصدر القبض'}</small>}</td><td><span className={`${s.badge} ${receiptMethod(v.payment_method)==='cash'?s.paid:s.partial}`}>{receiptMethods[receiptMethod(v.payment_method)]}</span>{v.chequeCount>0&&<small>{v.chequeCount} شيك مرتبط · القيمة اسمية</small>}</td><td>{v.description||'—'}{v.reference&&<small>{v.reference}</small>}</td><td>{money(Number(v.amount))}</td><td>{receiptNeedsReview(v)?<span className="text-amber-300">يحتاج مراجعة</span>:<span className="text-emerald-300">{declaredCash(v)>0?'قيد مرحّل · النقد مطابق':'قيد مرحّل · سند غير نقدي'}</span>}</td><td><div className={s.rowActions}>{receiptMethod(v.payment_method)==='cash'&&<button type="button" onClick={()=>openEditModal(v)} className="bg-amber-600/20 text-amber-300 hover:bg-amber-600/30 font-semibold px-2.5 py-1.5 rounded-lg border border-amber-500/40 text-xs transition-colors">تعديل</button>}<Link href={`/dashboard/accounting/receipts/print/${v.id}`}>عرض / طباعة</Link>{v.postedJournalId&&<Link href={`/dashboard/accounting/journal/print/${v.postedJournalId}`}>القيد</Link>}{v.invoice_id&&<Link href={`/dashboard/accounting/invoices/${v.invoice_id}`}>الفاتورة</Link>}{v.purchase_return_id&&<Link href={`/dashboard/purchases/returns/print/${v.purchase_return_id}`}>المرتجع</Link>}</div></td></tr>)}{!view.rows.length&&<tr><td colSpan={8} className={s.empty}>{receipts.length?'لا توجد سندات تطابق الفلاتر':'لا توجد سندات قبض مسجلة'}</td></tr>}</tbody></table></div><div className={s.pagination}><label>لكل صفحة <select aria-label="عدد السندات في الصفحة" value={size} onChange={e=>{setSize(Number(e.target.value));setPage(1)}}>{[10,25,50].map(n=><option key={n}>{n}</option>)}</select></label><span>الصفحة {view.page} من {view.pages} · {view.filtered.length} سند</span><div><button disabled={view.page===1} onClick={()=>setPage(view.page-1)}>السابق</button><button disabled={view.page===view.pages} onClick={()=>setPage(view.page+1)}>التالي</button></div></div></>}

   {saved&&<p role="status" className={s.notice}>حُفظت بيانات السند {saved.number} وجميع آثاره المالية بنجاح. {saved.id&&<Link href={`/dashboard/accounting/receipts/print/${saved.id}`}>عرض السند / الطباعة</Link>}</p>}
   {uncertain&&<p role="alert" className={s.notice}>{message||'نتيجة الحفظ غير مؤكدة؛ أعد محاولة الطلب نفسه. لا تنشئ سنداً بديلاً.'}</p>}

   {bankOpen&&!saving&&!uncertain&&!chequeBusy&&<BankReceiptReview storeId={storeId} preview={preview} onBusyChange={setBankBusy} banks={banks} customers={customers} invoices={invoices} creditAccounts={creditAccounts} currency={currency}/>}
   {chequeOpen&&!bankBusy&&<ChequeReceiptReview storeId={storeId} preview={preview} onBusyChange={setChequeBusy} customers={customers} invoices={invoices} cashBoxes={cashBoxes} portfolios={portfolios} creditAccounts={creditAccounts} currency={currency}/>}

   {/* نافذة عائمة (Modal Dialog) لإنشاء وتعديل سند القبض النقدي */}
   {open&&!chequeBusy&&!bankBusy&&ready&&(
     <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
       <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 my-8 overflow-hidden max-h-[90vh] flex flex-col">
         <div className="flex justify-between items-center pb-4 border-b border-slate-800">
           <div>
             <h2 className="text-2xl font-bold text-white">{isEditing?'تعديل سند القبض النقدي':'سند قبض نقدي جديد'}</h2>
             <p className="text-sm text-slate-400 mt-1">{isEditing?'تعديل السند يعيد ضبط القيود المحاسبية ورصيد العميل والفاتورة وحركة الصندوق بدقة':'راجع البيانات قبل الاعتماد. السند دائماً مخصص لزبون مسجل.'}</p>
           </div>
           <button aria-label="إغلاق نموذج القبض" disabled={saving||uncertain} onClick={()=>setOpen(false)} className="text-slate-400 hover:text-white text-2xl font-bold w-10 h-10 rounded-xl hover:bg-slate-800 flex items-center justify-center transition-colors">×</button>
         </div>

         <div className="overflow-y-auto flex-1 pr-1 pl-1 py-4">
           <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)] gap-6">
             <form onSubmit={e=>{e.preventDefault();const error=validateCashReview(form,customers,invoices,cashBoxes,creditAccounts);setMessage(error||'');setReview(!error)}} className="space-y-4 min-w-0">
               <fieldset disabled={saving||uncertain||!!saved} className="space-y-4 min-w-0">
                 <div className="flex items-center gap-2">
                   <span className="px-3 py-1 rounded-full text-xs font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">عميل مسجل فقط</span>
                   <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">طريقة القبض: نقدي</span>
                 </div>

                 <div className="grid sm:grid-cols-2 gap-4">
                   <label className="block text-sm font-medium text-slate-300">
                     تاريخ السند *
                     <input aria-label="تاريخ سند القبض" type="date" value={form.date} onBlur={e=>change('date',e.target.value)} onChange={e=>change('date',e.target.value)} className="block w-full bg-slate-800 border border-slate-700 rounded-xl p-3 mt-1.5 text-white outline-none focus:border-sky-500"/>
                   </label>
                   <label className="block text-sm font-medium text-slate-300">
                     المبلغ النقدي *
                     <input aria-label="مبلغ القبض النقدي" inputMode="decimal" value={form.amount} onChange={e=>change('amount',e.target.value)} className="block w-full bg-slate-800 border border-slate-700 rounded-xl p-3 mt-1.5 text-white outline-none focus:border-sky-500 font-bold" placeholder={`0.00 ${currency}`}/>
                   </label>
                 </div>

                 {/* البحث الذكي عن الزبون */}
                 <div className="relative">
                   <label className="block text-sm font-medium text-slate-300 mb-1">العميل المستلم منه *</label>
                   {customer ? (
                     <div className="flex items-center justify-between bg-slate-800 border border-sky-500/50 rounded-xl p-3">
                       <div>
                         <span className="font-bold text-white">{customer.name}</span>
                         {customer.phone && <span className="text-xs text-slate-400 mr-2" dir="ltr">{customer.phone}</span>}
                         <span className="text-xs text-amber-300 mr-3">الرصيد: {money(Number(customer.balance))}</span>
                       </div>
                       <button type="button" onClick={()=>{change('customerId','');change('invoiceId','');setShowCustomerDropdown(true)}} className="text-xs text-sky-400 hover:underline">تغيير العميل</button>
                     </div>
                   ) : (
                     <div>
                       <input
                         type="text"
                         placeholder="ابحث باسم الزبون أو الهاتف (بحث ذكي متعدد الكلمات)..."
                         value={customerQuery}
                         onFocus={()=>setShowCustomerDropdown(true)}
                         onChange={e=>{setCustomerQuery(e.target.value);setShowCustomerDropdown(true)}}
                         className="block w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white outline-none focus:border-sky-500"
                       />
                       {showCustomerDropdown && (
                         <div className="absolute z-20 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-slate-800 border border-slate-700 rounded-xl shadow-2xl divide-y divide-slate-700/50">
                           {filteredCustomers.length > 0 ? (
                             filteredCustomers.map(c=>(
                               <button
                                 key={c.id}
                                 type="button"
                                 onClick={()=>selectCustomer(c)}
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

                 <label className="block text-sm font-medium text-slate-300">
                   الصندوق المستهدف *
                   <select aria-label="صندوق القبض النقدي" value={form.boxId} onChange={e=>change('boxId',e.target.value)} className="block w-full bg-slate-800 border border-slate-700 rounded-xl p-3 mt-1.5 text-white outline-none focus:border-sky-500">
                     <option value="">اختر صندوقاً مصرحاً به</option>
                     {cashBoxes.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}
                   </select>
                 </label>
                 {!cashBoxes.length&&<p className="text-amber-300 text-xs">لا يوجد صندوق نقدي نشط ذو حساب مطابق وصلاحية قبض. راجع إعدادات الخزينة.</p>}

                 {/* اختيار الفاتورة المتاحة للزبون - مع تحديد الأقدم تلقائياً */}
                 {form.customerId&&(
                   <div>
                     <label className="block text-sm font-medium text-slate-300 mb-1">
                       ربط فاتورة (تم تحديد الفاتورة الأقدم تلقائياً)
                     </label>
                     <select aria-label="فاتورة القبض" value={form.invoiceId} onChange={e=>change('invoiceId',e.target.value)} className="block w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white outline-none focus:border-sky-500">
                       <option value="">قبض على حساب العميل دون ربط فاتورة</option>
                       {invoices
                         .filter(i=>(i.customer_id===form.customerId||(isEditing&&i.id===form.invoiceId))&&!['draft','cancelled'].includes(i.status)&&(Number(i.total)>Number(i.amount_paid)||(isEditing&&i.id===form.invoiceId)))
                         .sort((a,b)=>a.issue_date.localeCompare(b.issue_date))
                         .map((i,idx)=>(
                           <option key={i.id} value={i.id}>
                             {i.invoice_number} · تاريخ {i.issue_date} · متبقٍ {money(Number(i.total)-Number(i.amount_paid))}{idx===0?' (الأقدم)':''}
                           </option>
                         ))}
                     </select>
                   </div>
                 )}

                 <label className="block text-sm font-medium text-slate-300">
                   البيان / الشرح *
                   <textarea aria-label="بيان سند القبض" maxLength={1000} rows={2} value={form.description} onChange={e=>change('description',e.target.value)} className="block w-full bg-slate-800 border border-slate-700 rounded-xl p-3 mt-1.5 text-white outline-none focus:border-sky-500" placeholder="مثال: دفعة نقدية على الحساب / تسوية فاتورة..."/>
                 </label>

                 <label className="block text-sm font-medium text-slate-300">
                   رقم مرجع (اختياري)
                   <input aria-label="مرجع سند القبض" maxLength={200} value={form.reference} onChange={e=>change('reference',e.target.value)} className="block w-full bg-slate-800 border border-slate-700 rounded-xl p-3 mt-1.5 text-white outline-none focus:border-sky-500" placeholder="رقم إيصال يدوي، رقم شيك، مرجع خارجي..."/>
                 </label>

                 {message&&<p role="alert" className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 p-3 rounded-xl">{message}</p>}

                 <div className="flex gap-3 pt-2">
                   <button className="flex-1 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold p-3 rounded-xl transition-colors" type="submit">
                     {isEditing?'مراجعة تعديل السند':'مراجعة سند القبض'}
                   </button>
                   <button type="button" onClick={()=>setOpen(false)} className="px-5 py-3 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors">
                     إلغاء
                   </button>
                 </div>
               </fieldset>
             </form>

             <aside className="border border-slate-700 rounded-xl p-5 bg-slate-950/60 self-start space-y-4">
               <h3 className="text-lg font-bold text-white">{isEditing?'ملخص تعديل السند':'ملخص سند القبض'}</h3>
               <strong className="block text-3xl text-sky-300 break-words">{money(Number.isFinite(Number(form.amount))?Number(form.amount):0)}</strong>
               <div className="space-y-2 text-sm text-slate-300 divide-y divide-slate-800">
                 <div className="pt-2 flex justify-between"><span>المستلم منه:</span><strong className="text-white">{customer?.name||'لم يُحدد'}</strong></div>
                 <div className="pt-2 flex justify-between"><span>الصندوق:</span><strong className="text-white">{box?.name||'لم يُحدد'}</strong></div>
                 <div className="pt-2 flex justify-between"><span>الفاتورة:</span><strong className="text-white">{invoice?.invoice_number||(form.invoiceId?'فاتورة مرتبطة':'دون ربط')}</strong></div>
                 {customer&&<div className="pt-2 text-xs text-amber-300">رصيد العميل الحالي: {money(Number(customer.balance))}</div>}
               </div>

               {review&&!uncertain&&!saving&&!saved&&(
                 <p role="status" className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 p-3 rounded-xl">
                   {isEditing?'تمت مراجعة التعديل. اضغط تأكيد التعديل لتحديث السند وجميع آثاره المالية.':'تمت مراجعة القبض النقدي. لم يُحفظ سند بعد؛ اضغط اعتماد سند القبض.'}
                 </p>
               )}

               <button
                 type="button"
                 disabled={preview||saving||deleting||!!saved||(!review&&!uncertain)}
                 onClick={save}
                 className="w-full rounded-xl p-3 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold disabled:opacity-40 transition-colors shadow-lg"
               >
                 {saving?'جارٍ معالجة السند…':deleting?'جارٍ حذف السند…':uncertain?'إعادة محاولة الطلب نفسه':preview?'معاينة فقط':isEditing?'تأكيد وتطبيق تعديل السند':'اعتماد سند القبض'}
               </button>

               {isEditing&&(
                 <button
                   type="button"
                   disabled={preview||saving||deleting}
                   onClick={handleDeleteReceipt}
                   className="w-full rounded-xl p-2.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
                 >
                   <span>🗑️</span>
                   <span>{deleting?'جارٍ حذف السند...':'حذف سند القبض نهائياً'}</span>
                 </button>
               )}

               <p className="text-xs text-slate-400 leading-relaxed">
                 {isEditing?'تعديل السند يعكس الأثر السابق بدقة ويطبق المبلغ والفاتورة الجديدة على كشف الحساب والقيود. يمكنك أيضاً حذف السند لعكسه بالكامل.':'القبض النقدي يرحّل قيد المحاسبة ويخصم من الفاتورة ويعدل رصيد العميل فورياً.'}
               </p>
             </aside>
           </div>
         </div>
       </div>
     </div>
   )}
 </main>
}
