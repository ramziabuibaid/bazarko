import {notFound} from 'next/navigation'
import CustomerLedgerClient from '@/components/dashboard/customers/CustomerLedgerClient'
export default function Preview({searchParams}:{searchParams:{state?:string}}){
 if(process.env.NODE_ENV!=='development')notFound()
 const rows=[{id:'demo-1',name:'عميل توضيحي مدين',phone:'0590000000',city:'جنين',balance:350,customer_type:'retail',credit_limit:500},{id:'demo-2',name:'عميل توضيحي دائن',phone:null,city:'طولكرم',balance:-125,customer_type:'wholesale'},{id:'demo-3',name:'عميل متوازن',phone:null,city:'رام الله',balance:0,customer_type:'vip'}]
 return <main style={{background:'#071425',minHeight:'100vh',padding:24}}><p style={{color:'#94afce',fontSize:12,marginBottom:20}}>معاينة التصميم · بيانات توضيحية فقط</p><h1 style={{fontSize:28,fontWeight:750,color:'white',textAlign:'right',marginBottom:24}}>حسابات العملاء</h1><CustomerLedgerClient customers={searchParams.state?[]:rows} currencyCode="ILS" storeName="متجر توضيحي" loadError={searchParams.state==='error'} preview/></main>
}
