import {allRows} from '@/lib/dashboard/load-simple-dashboard'
import { redirect } from 'next/navigation'
import QuotationsList, {type QuoteRow} from '@/components/dashboard/quotations/QuotationsList'
import {businessDay} from '@/lib/dashboard/simple-metrics'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import FeatureGate from '@/components/dashboard/FeatureGate'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'

export const metadata = {
  title: 'عروض الأسعار — Bazarko ERP',
}

export default async function QuotationsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: quotations, error: quotationError }
  ] = await Promise.all([
    supabase.from('stores').select('id, name, currency_code, plan, subdomain, country_code').eq('id', storeId).single(),
    allRows<QuoteRow>((from,to)=>supabase.from('quotations').select('id, quotation_number, issue_date, valid_until, status, total_amount, currency, customer:customers(name, phone)').eq('store_id',storeId).order('issue_date',{ascending:false}).order('id').range(from,to)).then(data=>({data,error:null})).catch(()=>({data:null,error:true}))
  ])

  return <FeatureGate plan={store?.plan} featureName="عروض الأسعار الرسمية" featureDescription="إنشاء عروض رسمية وتحويلها إلى فواتير"><BackToDashboardButton href="/dashboard/sales" label="العودة إلى إدارة المبيعات"/><QuotationsList quotes={(quotations || []) as QuoteRow[]} today={businessDay().date} error={!!quotationError} storeInfo={store ? { subdomain: store.subdomain, country_code: store.country_code } : undefined}/></FeatureGate>
}
