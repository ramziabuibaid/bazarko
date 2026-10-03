import {notFound} from 'next/navigation'
import QuotationsList from '@/components/dashboard/quotations/QuotationsList'
import CreateQuotationClient from '@/app/dashboard/quotations/new/CreateQuotationClient'
import {businessDay} from '@/lib/dashboard/simple-metrics'
export default function Preview({searchParams}:{searchParams:{view?:string}}){
 if(process.env.NODE_ENV!=='development')notFound()
 const today=businessDay().date
 const customers=[{id:'demo-customer',name:'عميل توضيحي',phone:'0590000000'}],products=[{id:'demo-product',name:'ثلاجة منزلية',price:3800}]
 return <main style={{background:'#071323',minHeight:'100vh',padding:24}}><p style={{color:'#9bb3cd',marginBottom:20}}>معاينة التصميم · بيانات توضيحية فقط</p>{searchParams.view==='new'?<CreateQuotationClient store={{id:'preview',name:'متجر توضيحي',currency_code:'ILS'}} customers={customers} products={products} preview/>:<QuotationsList today={today} quotes={[{id:'demo-quote',quotation_number:'QT-0010',issue_date:today,valid_until:today,status:'sent',total_amount:3800,currency:'ILS',customer:customers[0]}]}/>}</main>
}
