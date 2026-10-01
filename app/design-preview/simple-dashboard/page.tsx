import {notFound} from 'next/navigation'
import SimpleDashboard from '@/components/dashboard/simple/SimpleDashboard'
import SimpleTopbar from '@/components/dashboard/simple/SimpleTopbar'
import PreviewShell from './preview-shell'
import {businessDay} from '@/lib/dashboard/simple-metrics'

export default function PreviewPage({searchParams}:{searchParams:{state?:string}}) {
  if(process.env.NODE_ENV!=='development') notFound()
  const now=new Date(),day=businessDay(now)
  const store={name:'مشروع سارة',currency_code:'ILS',subdomain:'sara-bakery',country_code:'PS',logo_url:'/images/landing/home-business-hero-v1.webp',phone:'',whatsapp:'',settings:{business_type:'home',dashboard_mode:'simple'},plan:'free'}
  const data={loadedAt:now.toISOString(),date:day.date,pendingCount:3,sales:850,unpaid:200,expenses:120,productsCount:4,errors:false,orderError:false,orders:[
    {id:'preview-1',order_number:'1004',customer_name:'منى أحمد',status:'pending',total_amount:90,created_at:now.toISOString(),order_items:[{product_name:'صندوق كوكيز بالشوكولاتة',quantity:2,products:null}]},
    {id:'preview-2',order_number:'1003',customer_name:'ريم خالد',status:'processing',total_amount:140,created_at:now.toISOString(),order_items:[{product_name:'كيكة فانيلا صغيرة',quantity:1,products:null}]},
    {id:'preview-3',order_number:'1002',customer_name:'نورة عبدالله',status:'ready',total_amount:60,created_at:now.toISOString(),order_items:[{product_name:'كوكيز مشكّل',quantity:12,products:null}]},
  ]}
  const previewData = searchParams.state === 'empty' ? {...data,orders:[],pendingCount:0,sales:0,unpaid:0,expenses:0,productsCount:0} : searchParams.state === 'error' ? {...data,orders:[],pendingCount:null,sales:null,unpaid:null,expenses:null,productsCount:null,errors:true,orderError:true} : data
  return <PreviewShell store={store} topbar={<SimpleTopbar name={store.name} notifications={[]}/>}><SimpleDashboard store={store} data={previewData} preview/></PreviewShell>
}
