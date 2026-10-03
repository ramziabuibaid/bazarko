import {notFound,redirect} from 'next/navigation'
import Link from 'next/link'
import {createClient} from '@/lib/supabase/server'
import {getStoreForUser} from '@/lib/supabase/getStore'
import InvoiceDocument from '@/components/dashboard/accounting/InvoiceDocument'
import PrintButton from '@/components/dashboard/PrintButton'
export const metadata={title:'طباعة فاتورة مبيعات — Bazarko'}
export default async function PrintInvoicePage({params}:{params:{id:string}}){
 const supabase=createClient(),{data:{user}}=await supabase.auth.getUser();if(!user)redirect('/login')
 const storeId=await getStoreForUser(supabase,user.id);if(!storeId)redirect('/onboarding')
 const [{data:store},{data:invoice,error:invoiceError}]=await Promise.all([supabase.from('stores').select('id,name,phone,logo_url,currency_code,address,tax_number').eq('id',storeId).single(),supabase.from('invoices').select('id,invoice_number,customer_name,customer_phone,customer_address,customer_id,issue_date,due_date,status,subtotal,discount_amount,total,amount_paid,payment_method,notes').eq('id',params.id).eq('store_id',storeId).maybeSingle()])
 if(invoiceError)throw new Error('تعذر تحميل الفاتورة');if(!store||!invoice)notFound()
 const {data:items,error}=await supabase.from('invoice_items').select('id,name,sku,quantity,unit_price,total').eq('invoice_id',invoice.id).order('id');if(error)throw new Error('تعذر تحميل بنود الفاتورة')
 return <main className="p-4 sm:p-8 print:p-0" dir="rtl"><nav className="flex flex-wrap gap-4 mb-5 print:hidden"><Link href={`/dashboard/accounting/invoices/${invoice.id}`}>← العودة للفاتورة</Link><PrintButton elementId="invoice-customer-document" filename={`invoice-${invoice.invoice_number}.pdf`} label="طباعة A4 / PDF"/></nav><div className="mx-auto max-w-4xl"><InvoiceDocument invoice={invoice} items={items||[]} storeName={store.name} storePhone={store.phone} storeLogo={store.logo_url} storeAddress={store.address} storeTaxNumber={store.tax_number} currencyCode={store.currency_code||'ILS'}/></div></main>
}
