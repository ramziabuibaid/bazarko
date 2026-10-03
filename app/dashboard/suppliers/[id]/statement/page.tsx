import {loadSupplier} from '@/lib/suppliers/load'
import Statement from '@/components/dashboard/suppliers/Statement'
export const metadata={title:'كشف حساب المورد — Bazarko'}
export default async function Page({params,searchParams}:{params:{id:string};searchParams?:{from?:string;to?:string;currency?:string}}){const data=await loadSupplier(params.id);return <div className="p-4 sm:p-6"><Statement {...data} initialFrom={searchParams?.from} initialTo={searchParams?.to} initialCurrency={searchParams?.currency}/></div>}
