import {notFound} from 'next/navigation'
import InvoicesList from '@/components/dashboard/accounting/InvoicesList'
import {businessDay} from '@/lib/dashboard/simple-metrics'
import {type InvoiceListRow} from '@/lib/invoices/list-presentation'
export default function Preview({searchParams}:{searchParams:Record<string,unknown>}){
 if(process.env.NODE_ENV!=='development')notFound()
 const today=businessDay().date
 const invoices:InvoiceListRow[]=Array.from({length:12},(_,i)=>({id:`demo-${i}`,invoice_number:`INV-${String(12-i).padStart(4,'0')}`,customer_id:i%2?'demo-company':'demo-customer',customer_name:i%2?'شركة توضيحية':'زبون توضيحي',customer_phone:null,issue_date:i<10?'2026-09-29':'2026-08-20',due_date:i%3===0?'2026-09-30':'2026-10-15',total:3800.25,amount_paid:i===10?0:i===11?0:i<6?3800.25:i<8?1200:0,status:i===10?'draft':i===11?'cancelled':i<6?'paid':i<8?'partial':'sent',created_at:`2026-09-29T${String(23-i).padStart(2,'0')}:00:00Z`,type:'sale'}))
 return <main style={{background:'#071425',padding:24,minHeight:'100vh'}}><p style={{color:'#9fb5cd',fontSize:12,marginBottom:18}}>معاينة · بيانات توضيحية فقط</p><InvoicesList invoices={searchParams.state?[]:invoices} currency="ILS" today={today} initial={searchParams} preview error={searchParams.state==='error'}/></main>
}
