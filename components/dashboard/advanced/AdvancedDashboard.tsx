import Link from 'next/link'
import Icon, {type IconName} from '../simple/Icons'
import StoreLink from '../simple/StoreLink'
import type {SimpleStore} from '../simple/SimpleDashboard'
import type {AdvancedData} from '@/lib/dashboard/load-advanced-dashboard'
import styles from './advanced.module.css'
export default function AdvancedDashboard({store,data,preview=false}:{store:SimpleStore;data:AdvancedData;preview?:boolean}) {
  const money=(value:number|null)=>value===null?'غير متاح':`${new Intl.NumberFormat('ar').format(value)} ${(store.currency_code==='ILS'?'₪':store.currency_code)}`
  const actions:{title:string;desc:string;icon:IconName;href:string}[]=[
    {title:'تسجيل بيع',desc:'فاتورة مبيعات جديدة',icon:'orders',href:'/dashboard/accounting/invoices/new'},
    {title:'تسجيل شراء',desc:'فاتورة مشتريات جديدة',icon:'sale',href:'/dashboard/purchases/new'},
    {title:'استلام دفعة',desc:'سند قبض',icon:'wallet',href:'/dashboard/accounting/receipts?new=1'},
    {title:'دفع مبلغ',desc:'سند صرف',icon:'expense',href:'/dashboard/accounting/payments?new=1'},
    {title:'المنتجات والمخزون',desc:'الأصناف والكميات',icon:'box',href:'/dashboard/products'},
  ]
  const steps=[{title:'إضافة المنتجات',done:data.productsCount!==null&&data.productsCount>0,href:'/dashboard/products/new'},
    {title:'تهيئة الحسابات والخزينة',done:data.accounts!==null&&data.accounts>0&&data.cashBalance!==null,href:'/dashboard/accounting/treasury'},
    {title:'إكمال بيانات المتجر',done:!!(store.phone||store.whatsapp),href:'/dashboard/settings'},
    {title:'إضافة الزبائن',done:data.customers!==null&&data.customers>0,href:'/dashboard/customers'},
    {title:'تسجيل أول فاتورة بيع',done:data.invoices!==null&&data.invoices>0,href:'/dashboard/accounting/invoices/new'}]
  const completed=steps.filter(s=>s.done).length, next=steps.find(s=>!s.done)
  const alerts=[{title:data.lowStock===null?'تعذر تحميل تنبيهات المخزون':data.lowStock?`${data.lowStock} منتجات وصلت إلى حد التنبيه`:'المخزون ضمن الحدود المحددة',desc:'راجع الكميات وحدود التنبيه لكل صنف',icon:'box' as IconName,href:'/dashboard/products'},
    {title:data.unpaid===null?'تعذر تحميل مستحقات العملاء':data.unpaid>0?`مبالغ مستحقة على العملاء: ${money(data.unpaid)}`:'لا توجد مبالغ متبقية على المبيعات',desc:'الفواتير الصادرة والطلبات المؤكدة دون احتساب مزدوج',icon:'users' as IconName,href:'/dashboard/accounting/invoices'},
    {title:data.checks===null?'تعذر تحميل الشيكات':data.checks?`${data.checks} شيكات تستحق خلال 7 أيام`:'لا توجد شيكات قريبة الاستحقاق',desc:'الشيكات الموجودة في المحفظة من اليوم',icon:'expense' as IconName,href:'/dashboard/accounting/treasury'}]
  return <div className={styles.page} dir="rtl">
    <header className={styles.heading}><span>{store.name}</span><h1>أهلاً بك، ماذا تريد أن تنجز اليوم؟</h1><p>كل عمليات مشروعك في مكان واحد</p></header>
    <nav className={styles.actions} aria-label="العمليات السريعة">{actions.map((a,i)=><Link key={a.title} href={a.href} className={styles.tile} data-tone={i}><Icon name={a.icon}/><strong>{a.title}</strong><small>{a.desc}</small><span className={styles.arrow}>←</span></Link>)}</nav>
    <section className={styles.movements}><div className={styles.panel}><h2><Icon name="sun"/>حركة اليوم <small>{data.date}</small></h2><div className={styles.metrics}>{[{label:'مبيعات اليوم',value:data.sales,icon:'orders' as IconName},{label:'مقبوضات اليوم',value:data.receipts,icon:'wallet' as IconName},{label:'مدفوعات اليوم',value:data.payments,icon:'expense' as IconName}].map((m,i)=><div key={m.label} data-tone={i}><Icon name={m.icon}/><span>{m.label}</span><strong>{money(m.value)}</strong><small>{i===0?'الفواتير الصادرة والطلبات المؤكدة':'السندات المسجلة بجميع طرق الدفع'}</small></div>)}</div></div>
      <div className={styles.panel}><h2><Icon name="wallet"/>الرصيد الحالي</h2><div className={styles.balance}><span>{data.cashName||'الصندوق الافتراضي'}</span><strong>{money(data.cashBalance)}</strong><small>{data.cashBalance===null?'هيّئ الصندوق أو تحقق من صلاحية الوصول':'رصيد الحساب المحاسبي للصندوق'}</small><Link href="/dashboard/accounting/treasury">عرض حركة الصندوق ←</Link></div></div></section>
    <section className={styles.lower}><div className={styles.panel}><h2><Icon name="bell"/>بحاجة لمتابعتك</h2><div className={styles.alerts}>{alerts.map((a,i)=><Link key={a.href} href={a.href} data-tone={i}><Icon name={a.icon}/><div><strong>{a.title}</strong><small>{a.desc}</small></div><span>عرض ←</span></Link>)}</div></div>
      <div className={styles.panel}><h2><Icon name="store"/>متجرك الإلكتروني</h2><div className={styles.storeArt} aria-hidden="true"/><h3>شارك منتجاتك مع زبائنك</h3><p>رابط واحد لعرض المنتجات واستقبال الطلبات</p>{store.subdomain?<div className={styles.share}><StoreLink url={`https://${store.subdomain}.${process.env.NEXT_PUBLIC_DOMAIN||'bazarko.app'}`} preview={preview}/></div>:<Link href="/dashboard/settings">إعداد رابط المتجر ←</Link>}</div></section>
    <details className={styles.setup}><summary><Icon name="settings"/><strong>أكمل تجهيز مشروعك</strong><span>{completed} من 5 خطوات مكتملة</span><progress value={completed} max={5}/></summary><div>{steps.map(s=><Link key={s.title} href={s.href}><span>{s.done?'✓':'○'}</span>{s.title}</Link>)}{next&&<Link className={styles.continue} href={next.href}>متابعة الإعداد: {next.title} ←</Link>}</div></details>
  </div>
}
