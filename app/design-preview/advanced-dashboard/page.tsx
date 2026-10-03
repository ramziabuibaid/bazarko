import {notFound} from 'next/navigation'
import AdvancedDashboard from '@/components/dashboard/advanced/AdvancedDashboard'
import {businessDay} from '@/lib/dashboard/simple-metrics'
export default function Preview({searchParams}:{searchParams:{state?:string}}) {
 if(process.env.NODE_ENV!=='development') notFound()
 const store={name:'المنار - طولكرم',currency_code:'ILS',subdomain:'almanar',country_code:'PS',logo_url:null,phone:'0590000000',whatsapp:null,settings:{},plan:'free'}
 const data={sales:2450,unpaid:800,receipts:1800,payments:650,cashBalance:60400,cashName:'الصندوق الرئيسي',lowStock:3,productsCount:24,checks:2,accounts:8,customers:6,invoices:0,date:businessDay().date}
 const state=searchParams.state
 const display=state==='empty'?{...data,sales:0,unpaid:0,receipts:0,payments:0,cashBalance:null,cashName:null,lowStock:0,productsCount:0,checks:0,accounts:0,customers:0}:state==='error'?{...data,sales:null,unpaid:null,receipts:null,payments:null,cashBalance:null,lowStock:null,productsCount:null,checks:null,accounts:null,customers:null,invoices:null}:data
 return <main style={{background:'#061121',minHeight:'100vh',padding:'24px',fontFamily:'inherit'}}><p style={{color:'#91aac8',fontSize:12,marginBottom:16}}>معاينة التصميم · بيانات توضيحية فقط</p><AdvancedDashboard store={store} data={display} preview/></main>
}
