import {notFound} from 'next/navigation'
import NewOrderForm,{type Product} from '@/components/dashboard/orders/NewOrderForm'
export default function Preview(){
 if(process.env.NODE_ENV!=='development')notFound()
 const names=['كابل شحن','شاحن سريع','سماعات لاسلكية','حامل هاتف','باور بانك','شاحن سيارة']
 const products:Product[]=names.map((name,i)=>({id:`demo-${i}`,name,price:[35,90,120,25,150,65][i],sku:`SKU-${i}`,barcode:`100${i}`,stock_available:[24,12,8,18,2,0][i],track_stock:true,thumbnail_url:null,category_id:i<2?'charging':'other'}))
 return <main style={{background:'#071425',padding:20,minHeight:'100vh'}}><p style={{color:'#9fb5cd',fontSize:12,marginBottom:20}}>نقطة البيع · معاينة ببيانات توضيحية فقط؛ الحفظ المالي معطل</p><NewOrderForm storeId="preview-pos" currencyCode="ILS" posPresentation previewCatalog={{products,categories:[{id:'charging',name:'شواحن وكابلات'},{id:'other',name:'إكسسوارات'}]}}/></main>
}
