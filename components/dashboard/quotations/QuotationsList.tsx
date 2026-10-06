'use client'
import {useState} from 'react'
import Link from 'next/link'
import {quoteExpired,quoteLabels,type QuoteStatus} from '@/lib/quotations/presentation'
import styles from './quotations.module.css'
export interface QuoteRow{id:string;quotation_number:string;issue_date:string;valid_until:string|null;status:string;total_amount:number;currency:string|null;customer:{name:string;phone:string|null}|null}
export default function QuotationsList({quotes,today,error=false,storeInfo}:{quotes:QuoteRow[];today:string;error?:boolean;storeInfo?:{subdomain?:string;country_code?:string}}){
 const [search,setSearch]=useState(''),[status,setStatus]=useState<QuoteStatus>('all'),[period,setPeriod]=useState(''),[page,setPage]=useState(1)
 const matches=quotes.filter(q=>(!search.trim()||`${q.quotation_number} ${q.customer?.name||''} ${q.customer?.phone||''}`.toLowerCase().includes(search.trim().toLowerCase()))&&(!period||q.issue_date.startsWith(period)))
 const filtered=matches.filter(q=>status==='all'||(status==='expired'?quoteExpired(q,today)||q.status==='expired':q.status===status))
 const pages=Math.max(1,Math.ceil(filtered.length/10)),current=Math.min(page,pages)
 const totals=new Map<string,number>(); filtered.filter(q=>q.status!=='draft').forEach(q=>{const c=q.currency||'ILS';totals.set(c,(totals.get(c)||0)+Number(q.total_amount))})
 const money=(n:number,c:string|null)=>`${Number(n).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})} ${c||'ILS'}`

 const getPublicUrl = (id: string) => {
   const country = storeInfo?.country_code ? storeInfo.country_code.toLowerCase() : 'ps'
   const sub = storeInfo?.subdomain || 'store'
   const origin = typeof window !== 'undefined' ? window.location.origin : ''
   return `${origin}/store/${country}/${sub}/quotation/${id}`
 }

 const sendWhatsApp = (q: QuoteRow) => {
   const url = getPublicUrl(q.id)
   const msg = `مرحباً ${q.customer?.name || 'عزيزنا العميل'}،\nيسرنا مشاركة عرض السعر رقم #${q.quotation_number} بقيمة ${money(q.total_amount, q.currency)}.\nيمكنك مراجعته مباشرة عبر الرابط:\n${url}`
   const phone = q.customer?.phone ? q.customer.phone.replace(/[^0-9]/g, '') : ''
   const wa = phone ? `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}` : `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`
   window.open(wa, '_blank')
 }

 return <div className={styles.page} dir="rtl"><header className={styles.header}><div><h1>عروض الأسعار الرسمية</h1><p>أصدر عروضك للزبائن والشركات، وتابع صلاحيتها وتحويلها إلى فواتير</p></div><Link className={styles.primary} href="/dashboard/quotations/new">＋ إنشاء عرض سعر جديد</Link></header>
 {error&&<p role="alert" className={styles.error}>تعذر تحميل عروض الأسعار. أعد تحميل الصفحة.</p>}
 <div className={styles.stats}><section><span>عدد عروض الأسعار حسب الفلاتر</span><strong>{error?'—':filtered.length}</strong></section><section><span>إجمالي العروض دون المسودات، حسب العملة</span><strong>{error?'—':totals.size?[...totals].map(([c,n])=><span key={c} dir="ltr">{money(n,c)} </span>):'0'}</strong></section></div>
 <div className={styles.panel}><div className={styles.filters}><input aria-label="البحث في عروض الأسعار" placeholder="ابحث بالعميل أو رقم العرض أو الهاتف…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/><label>الفترة <input aria-label="شهر الإصدار" type="month" value={period} onChange={e=>{setPeriod(e.target.value);setPage(1)}}/></label><button type="button" onClick={()=>{setSearch('');setPeriod('');setStatus('all');setPage(1)}}>مسح الفلاتر</button></div><div className={styles.tabs} aria-label="حالات عروض الأسعار">{(['all','sent','accepted','rejected','converted','expired','draft'] as QuoteStatus[]).map(s=><button key={s} aria-pressed={status===s} onClick={()=>{setStatus(s);setPage(1)}}>{s==='all'?'الكل':quoteLabels[s]} <span>{matches.filter(q=>s==='all'||(s==='expired'?quoteExpired(q,today)||q.status==='expired':q.status===s)).length}</span></button>)}</div></div>
 <div className={styles.tableWrap}><table><thead><tr>{['رقم العرض','تاريخ الإصدار','العميل','ساري حتى','الحالة','الإجمالي','الإجراءات'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{filtered.slice((current-1)*10,current*10).map(q=><tr key={q.id}><td><Link href={`/dashboard/quotations/print/${q.id}`}>{q.quotation_number}</Link></td><td>{q.issue_date}</td><td><strong>{q.customer?.name||'عميل عام'}</strong><small dir="ltr">{q.customer?.phone}</small></td><td>{q.valid_until||'—'}</td><td><span className={styles.badge}>{quoteLabels[q.status]||q.status}</span>{quoteExpired(q,today)&&q.status!=='expired'&&<small className={styles.expired}>منتهي الصلاحية</small>}</td><td dir="ltr">{money(q.total_amount,q.currency)}</td><td><div className={styles.rowActions}><Link href={`/dashboard/quotations/${q.id}/edit`} style={{color:'#38bdf8',fontWeight:'bold'}}>تعديل ✏️</Link><Link href={`/dashboard/quotations/print/${q.id}`}>عرض / طباعة</Link><button type="button" onClick={()=>sendWhatsApp(q)} title="إرسال الرابط للعميل عبر واتساب" style={{cursor:'pointer',border:'1px solid #10b981',color:'#34d399',padding:'6px 9px',borderRadius:'8px',background:'transparent',fontSize:'12px',fontWeight:'bold'}}>واتساب 💬</button>{['sent','accepted'].includes(q.status)&&!quoteExpired(q,today)&&<Link href={`/dashboard/accounting/invoices/new?from_quotation=${q.id}`} style={{color:'#a855f7',fontWeight:'bold'}}>تحويل لفاتورة</Link>}</div></td></tr>)}{!filtered.length&&<tr><td colSpan={7} className={styles.empty}>{error?'البيانات غير متاحة':'لا توجد عروض تطابق الفلاتر الحالية'}</td></tr>}</tbody></table></div>
 <footer className={styles.pagination}><span>عرض {filtered.length?((current-1)*10+1):0}–{Math.min(current*10,filtered.length)} من {filtered.length}</span><button disabled={current<=1} onClick={()=>setPage(current-1)}>السابق</button><span>{current} / {pages}</span><button disabled={current>=pages} onClick={()=>setPage(current+1)}>التالي</button></footer></div>
}
