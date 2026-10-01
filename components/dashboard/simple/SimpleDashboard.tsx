import Link from 'next/link'
import type { SimpleDashboardData } from '@/lib/dashboard/load-simple-dashboard'
import { BUSINESS_TIME_ZONE } from '@/lib/dashboard/simple-metrics'
import DashboardRefresh from '@/components/dashboard/DashboardRefresh'
import Icon,{type IconName} from './Icons'
import StoreLink from './StoreLink'
import styles from './simple.module.css'

export interface SimpleStore {name:string;currency_code:string;subdomain:string;country_code:string;logo_url:string|null;phone:string|null;whatsapp:string|null;settings:Record<string,unknown>;plan:string}
const STATUSES:Record<string,{label:string;tone:string}>={pending:{label:'جديد',tone:'pink'},confirmed:{label:'مؤكد',tone:'blue'},processing:{label:'قيد التجهيز',tone:'amber'},ready:{label:'جاهز للتسليم',tone:'green'},shipped:{label:'تم الشحن',tone:'blue'},delivered:{label:'تم التسليم',tone:'green'},cancelled:{label:'ملغي',tone:'muted'},returned:{label:'مرتجع',tone:'pink'}}

export default function SimpleDashboard({store,data,preview=false}:{store:SimpleStore;data:SimpleDashboardData;preview?:boolean}) {
  const url=`https://${store.subdomain}.${process.env.NEXT_PUBLIC_DOMAIN||'bazarko.app'}`
  const currency=store.currency_code==='ILS'?'₪':store.currency_code
  const money=(value:number|null)=>value===null?'—':`${new Intl.NumberFormat('ar-u-nu-latn',{maximumFractionDigits:2}).format(value)} ${currency}`
  const metrics:{label:string;value:string;hint:string;icon:IconName;tone:string;href:string}[]=[
    {label:'طلبات تحتاج متابعة',value:data.pendingCount===null?'—':String(data.pendingCount),hint:'جديدة، قيد التجهيز أو التوصيل',icon:'orders',tone:'blue',href:'/dashboard/orders'},
    {label:'مبيعات اليوم',value:money(data.sales),hint:'فواتير صادرة وطلبات مؤكدة دون تكرار',icon:'sale',tone:'green',href:'/dashboard/accounting/invoices'},
    {label:'مبالغ لم تُقبض',value:money(data.unpaid),hint:'المتبقي على الفواتير والطلبات المؤكدة',icon:'wallet',tone:'amber',href:'/dashboard/customers'},
    {label:'مصاريف اليوم',value:money(data.expenses),hint:'سندات صرف مصنّفة، دون دفعات الموردين',icon:'expense',tone:'purple',href:'/dashboard/accounting/payments'},
  ]
  const setup=[{title:'إضافة أول منتج',description:'صورة واضحة وسعر ووصف لمنتجك.',done:data.productsCount!==null&&data.productsCount>0,href:'/dashboard/products/new'},
    {title:'اختيار صورة المتجر',description:'أضف شعاراً يميز مشروعك.',done:!!store.logo_url,href:'/dashboard/settings'},
    {title:'تجهيز وسيلة التواصل',description:'أضف رقم الهاتف أو الواتساب للزبائن.',done:!!(store.phone||store.whatsapp),href:'/dashboard/settings'},
    {title:'نسخ رابط متجرك',description:'شارك الرابط مع زبائنك لبدء استقبال الطلبات.',done:store.settings?.onboarding_store_link_copied===true,href:'#store-link'}]
  const completed=setup.filter(s=>s.done).length
  return <div className={styles.dashboard} dir="rtl">
    {preview&&<p className={styles.previewNote}>معاينة التصميم · بيانات توضيحية فقط</p>}
    <section className={styles.overview}>
      <div className={styles.greeting}><div><span className={styles.eyebrow}>{store.plan==='free'?'مساحة مشروعك · الخطة المجانية':'مساحة مشروعك'}</span><h1><span className={styles.sun}><Icon name="sun"/></span>أهلاً، {store.name}</h1><p>هذه أهم الأشياء التي تحتاج متابعتك اليوم.</p></div><div className={styles.date}><span>{new Date(data.loadedAt).toLocaleDateString('ar-u-nu-latn',{timeZone:BUSINESS_TIME_ZONE,weekday:'long',day:'numeric',month:'long'})}</span><DashboardRefresh loadedAt={data.loadedAt}/></div></div>
      {data.errors&&<p className={styles.error} role="alert">تعذر تحميل بعض البيانات. يظهر — مكان المؤشر غير المتاح؛ حاول تحديث الصفحة.</p>}
      <div className={styles.metrics}>{metrics.map(m=><Link key={m.label} href={m.href} className={`${styles.metric} ${styles[m.tone]}`}><span className={styles.metricIcon}><Icon name={m.icon}/></span><div><h2>{m.label}</h2><strong>{m.value}</strong><p>{m.hint}</p></div></Link>)}</div>
      <div className={styles.quickActions}><Link href="/dashboard/products/new" className={styles.add}><Icon name="plus"/>إضافة منتج</Link><Link href="/dashboard/accounting/invoices/new"><Icon name="sale"/>تسجيل بيع</Link><Link href="/dashboard/accounting/payments?new=1&purpose=expense"><Icon name="expense"/>تسجيل مصروف</Link><StoreLink url={url} compact preview={preview}/></div>
    </section>
    <div className={styles.lower}>
      <section className={styles.setup}><div className={styles.sectionTitle}><Icon name="check"/><h2>خطواتك الأولى</h2><span>{completed} / {setup.length}</span></div><p className={styles.subtitle}>جهّز متجرك خطوة بخطوة، وابدأ على راحتك.</p><div className={styles.progress} role="progressbar" aria-label="تجهيز المتجر" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={setup.length}><span style={{width:`${completed/setup.length*100}%`}}/></div><ul>{setup.map(s=><li key={s.title}><Link href={s.href}><span className={`${styles.stepCircle} ${s.done?styles.done:''}`}>{s.done?<Icon name="check"/>:null}</span><div><h3>{s.title}</h3><p>{s.description}</p></div><span className={styles.srOnly}>{s.done?'مكتمل':'غير مكتمل'}</span></Link></li>)}</ul><div id="store-link"><StoreLink url={url} preview={preview}/></div></section>
      <section className={styles.orders}><div className={styles.sectionTitle}><Icon name="box"/><h2>طلبات اليوم</h2><Link href={`/dashboard/orders?dateFrom=${data.date}&dateTo=${data.date}`}>عرض جميع الطلبات <Icon name="arrow"/></Link></div><p className={styles.subtitle}>أحدث الطلبات التي وصلت اليوم، بتوقيت فلسطين.</p>
        {data.orderError?<div className={styles.empty}><Icon name="orders"/><h3>تعذر تحميل الطلبات</h3><p>حاول تحديث الصفحة أو افتح قائمة الطلبات.</p><Link href="/dashboard/orders">فتح الطلبات ←</Link></div>:data.orders.length===0?<div className={styles.empty}><Icon name="store"/><h3>يوم جديد، وفرصة جديدة</h3><p>لا توجد طلبات اليوم بعد. شارك رابط متجرك ليستكشف زبائنك منتجاتك.</p><Link href="/dashboard/orders/new">تسجيل طلب جديد ←</Link></div>:<div className={styles.orderList}>{data.orders.map(order=>{
          const status=STATUSES[order.status]||{label:order.status,tone:'muted'}
          const first=order.order_items?.[0]
          return <article key={order.id} className={styles.order}><div className={styles.orderImage}>{first?.products?.thumbnail_url?<img src={first.products.thumbnail_url} alt={first.product_name} loading="lazy"/>:<Icon name="box"/>}</div><div className={styles.orderInfo}><h3>طلب <bdi>{order.order_number}</bdi></h3><p>من: {order.customer_name||'زبون المتجر'}</p><span>{first?`${first.quantity} × ${first.product_name}${order.order_items.length>1?` و${order.order_items.length-1} منتجات أخرى`:''}`:'تفاصيل الطلب متاحة للعرض'}</span></div><div className={styles.orderMeta}><span className={`${styles.badge} ${styles[status.tone]}`}>● {status.label}</span><small>{new Date(order.created_at).toLocaleTimeString('ar-u-nu-latn',{timeZone:BUSINESS_TIME_ZONE,hour:'2-digit',minute:'2-digit'})}</small><strong>{money(Number(order.total_amount))}</strong></div><Link className={styles.viewOrder} href={`/dashboard/orders/${order.id}`}>عرض الطلب</Link></article>
        })}</div>}
      </section>
    </div>
    <div className={styles.advanced}><div><Icon name="tools"/><div><strong>تحتاج أدوات إضافية؟</strong><p>المشتريات والمخزون والمحاسبة، حسب خطتك وصلاحياتك.</p></div></div><Link href="/dashboard?view=advanced">عرض الأدوات المتقدمة <Icon name="arrow"/></Link></div>
  </div>
}
