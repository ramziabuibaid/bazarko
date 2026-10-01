'use client'
import {useState} from 'react'
import SimpleSidebar from '@/components/dashboard/simple/SimpleSidebar'
import MobileBottomNav from '@/components/dashboard/MobileBottomNav'
import styles from '@/components/dashboard/simple/simple.module.css'
export default function PreviewShell({store,children,topbar}:{store:{name:string;plan:string};children:React.ReactNode;topbar:React.ReactNode}){
  const [collapsed,setCollapsed]=useState(false)
  const [mobileOpen,setMobileOpen]=useState(false)
  return <div className={styles.previewShell}>{mobileOpen&&<div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={()=>setMobileOpen(false)}/>}<SimpleSidebar store={store} isCollapsed={collapsed} onToggleCollapse={()=>setCollapsed(s=>!s)} mobileOpen={mobileOpen} onMobileClose={()=>setMobileOpen(false)}/><div className={`${styles.previewMain} pb-16 lg:pb-0`}><header className={`flex h-14 items-center gap-3 px-4 border-b ${styles.lightHeader}`}><button className="bg-transparent border-0 text-slate-500 lg:hidden" aria-label="فتح القائمة" onClick={()=>setMobileOpen(true)}>☰</button>{topbar}</header>{children}</div><MobileBottomNav simple onMore={()=>setMobileOpen(true)}/></div>
}
