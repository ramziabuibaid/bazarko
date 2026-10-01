'use client'
import Link from 'next/link'
import {usePathname,useRouter} from 'next/navigation'
import BazarkoLogo from '@/components/ui/BazarkoLogo'
import {createClient} from '@/lib/supabase/client'
import Icon,{type IconName} from './Icons'
import styles from './simple.module.css'

export default function SimpleSidebar({store,isCollapsed,onToggleCollapse,mobileOpen,onMobileClose}:{store:{name:string;plan:string};isCollapsed:boolean;onToggleCollapse:()=>void;mobileOpen:boolean;onMobileClose:()=>void}) {
  const pathname=usePathname(),router=useRouter()
  const items:{label:string;href:string;icon:IconName}[]=[{label:'الرئيسية',href:'/dashboard',icon:'home'},{label:'الطلبات',href:'/dashboard/orders',icon:'orders'},{label:'المنتجات',href:'/dashboard/products',icon:'box'},{label:'الزبائن',href:'/dashboard/customers',icon:'users'},{label:'المصاريف',href:'/dashboard/accounting/payments',icon:'expense'},{label:'متجري',href:'/dashboard/store-hub',icon:'store'}]
  async function logout(){const {error}=await createClient().auth.signOut();if(!error){router.push('/login');router.refresh()}}
  return <aside className={`${styles.sidebar} ${isCollapsed?styles.collapsed:''} ${mobileOpen?styles.mobileOpen:''}`} aria-label="قائمة مشروعك">
    <div className={styles.brand}><BazarkoLogo size={isCollapsed?'sm':'lg'} showText={!isCollapsed||mobileOpen} variant="vector"/>{!isCollapsed&&<p>{store.name}</p>}<button className={styles.closeMenu} onClick={onMobileClose} aria-label="إغلاق القائمة">×</button></div>
    <nav>{items.map(item=>{const active=item.href==='/dashboard'?(pathname==='/dashboard'||pathname==='/design-preview/simple-dashboard'):pathname.startsWith(item.href);return <Link href={item.href} key={item.href} onClick={onMobileClose} title={item.label} className={active?styles.navActive:''} aria-current={active?'page':undefined}><Icon name={item.icon}/><span>{item.label}</span></Link>})}</nav>
    <div className={styles.sidebarBottom}><span className={styles.planLabel}>{store.plan==='free'?'الخطة المجانية':'أدوات مشروعك'}</span><Link href="/dashboard/settings" title="الإعدادات" onClick={onMobileClose}><Icon name="settings"/><span>الإعدادات</span></Link><Link href="/dashboard?view=advanced" title="الأدوات المتقدمة" onClick={onMobileClose}><Icon name="tools"/><span>الأدوات المتقدمة</span></Link><button onClick={logout} title="تسجيل الخروج"><span aria-hidden="true">↪</span><span>تسجيل الخروج</span></button><button className={styles.collapseMenu} onClick={onToggleCollapse} title="تغيير حجم القائمة"><Icon name="arrow"/><span>طي القائمة</span></button></div>
  </aside>
}
