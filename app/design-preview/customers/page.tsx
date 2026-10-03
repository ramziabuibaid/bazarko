import {notFound} from 'next/navigation'
import CustomerDirectory from '@/components/dashboard/customers/CustomerDirectory'
import {businessDay} from '@/lib/dashboard/simple-metrics'
export default function Preview({searchParams}:{searchParams:{state?:string}}){
 if(process.env.NODE_ENV!=='development')notFound()
 const date=businessDay().date
 const customers=[{id:'demo-1',name:'زبون توضيحي',phone:'0590000000',email:null,city:'جنين',address:null,notes:null,social_url:null,credit_limit:500,balance:0,total_orders:0,customer_type:'retail',is_active:true,created_at:`${date}T09:00:00Z`},{id:'demo-2',name:'شركة توضيحية',phone:'0591111111',email:null,city:'طولكرم',address:null,notes:null,social_url:null,credit_limit:500,balance:350,total_orders:3,customer_type:'wholesale',is_active:true,created_at:'2026-09-14T09:00:00Z'},{id:'demo-3',name:'زبون برصيد دائن',phone:null,email:'demo@example.com',city:'جنين',address:null,notes:null,social_url:null,credit_limit:0,balance:-125,total_orders:1,customer_type:'vip',is_active:true,created_at:'2026-09-10T09:00:00Z'}]
 return <main style={{background:'#071425',padding:24,minHeight:'100vh'}}><p style={{color:'#9fb5cd',fontSize:12,marginBottom:20}}>معاينة التصميم · بيانات توضيحية فقط</p><CustomerDirectory customers={searchParams.state?[]:customers} date={date} currencyCode="ILS" storeId="preview" lastOrderDates={{'demo-2':`${date}T09:00:00Z`}} loadError={searchParams.state==='error'} preview/></main>
}
