import {allRows} from '@/lib/dashboard/load-simple-dashboard'
import type {CustomerItem} from '@/components/dashboard/customers/CustomerLedgerClient'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import CustomerLedgerClient from '@/components/dashboard/customers/CustomerLedgerClient'

export const metadata = {
  title: 'كشوف حسابات الزبائن — Bazarko ERP',
}

interface Props {
  searchParams?: {
    customer_id?: string
  }
}

export default async function CustomerLedgerPage({ searchParams }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, currency_code')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  const result=await allRows<CustomerItem>((from,to)=>supabase.from('customers').select('id, name, phone, city, balance, total_orders, customer_type, credit_limit, total_paid').eq('store_id',store.id).order('name').order('id').range(from,to)).then(data=>({data,error:false})).catch(()=>({data:[],error:true}))
  const customers=result.data

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
            <span>📋</span>
            <span>حسابات العملاء</span>
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-400">
            متابعة أرصدة وحركات جميع العملاء، الأرصدة الافتتاحية والتراكمية، الطباعة الرسمية والمشاركة الفورية
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/customers"
            className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition"
          >
            👥 دليل العملاء
          </Link>
        </div>
      </div>

      <CustomerLedgerClient
        loadError={result.error}
        customers={customers || []}
        currencyCode={store.currency_code || 'ILS'}
        storeName={store.name || 'Bazarko Store'}
        initialCustomerId={searchParams?.customer_id}
      />
    </div>
  )
}
