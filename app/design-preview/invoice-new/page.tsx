import {notFound} from 'next/navigation'
import NewInvoiceForm from '@/components/dashboard/accounting/NewInvoiceForm'
export default function Preview(){
 if(process.env.NODE_ENV!=='development')notFound()
 const products=[{id:'demo-cable',name:'كابل شحن',sku:'USB-1',barcode:'1000',price:35,cost_price:20,thumbnail_url:null},{id:'demo-charger',name:'شاحن سريع',sku:'USB-2',barcode:'1001',price:90,cost_price:50,thumbnail_url:null}]
 return <main style={{background:'#071425',minHeight:'100vh',padding:24}} dir="rtl"><p style={{color:'#9fb5cd',fontSize:12,marginBottom:12}}>معاينة · بيانات توضيحية فقط؛ الحفظ المالي معطل</p><h1 style={{fontSize:28,color:'white',fontWeight:800,marginBottom:24}}>فاتورة مبيعات جديدة</h1><NewInvoiceForm storeId="preview-invoice" userId="preview" storeName="متجر توضيحي" currencyCode="ILS" cashBoxes={[{id:'demo-box',name:'الصندوق التوضيحي'}]} previewData={{products,customers:[{id:'demo-customer',name:'زبون توضيحي',phone:null,balance:0}]}} prefill={{customerId:'demo-customer',customerName:'زبون توضيحي',customerPhone:'',discountAmount:10,items:[{product_id:'demo-cable',name:'كابل شحن',sku:'USB-1',quantity:2,unit_price:35,cost_price:20},{product_id:'demo-charger',name:'شاحن سريع',sku:'USB-2',quantity:1,unit_price:90,cost_price:50}]}}/></main>
}
