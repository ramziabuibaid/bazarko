'use client'
import Link from 'next/link'
import type {DashNotification} from '@/components/dashboard/DashboardTopbar'
import Icon from './Icons'
import styles from './simple.module.css'
export default function SimpleTopbar({name,notifications}:{name:string;notifications:DashNotification[]}) {
  return <div className={styles.topbar}><span className={styles.topbarName}>مساحة مشروعك</span><div className={styles.topbarEnd}><details className={styles.notifications}><summary aria-label="الإشعارات"><Icon name="bell"/>{notifications.length>0&&<span>{notifications.length}</span>}</summary><div><strong>تنبيهات تحتاج متابعتك</strong>{notifications.length?notifications.map(n=><Link href={n.href} key={n.href}>{n.text}</Link>):<p>لا توجد تنبيهات حالياً.</p>}</div></details><span className={styles.avatar} aria-hidden="true">{name.charAt(0)}</span><strong>{name}</strong></div></div>
}
