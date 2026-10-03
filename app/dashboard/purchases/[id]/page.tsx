import {loadPurchaseDetail} from '@/lib/purchases/load-detail'
import PurchaseDetail from '@/components/dashboard/purchases/PurchaseDetail'
export const metadata={title:'تفاصيل فاتورة مشتريات — Bazarko'}
export default async function Page({params}:{params:{id:string}}){return <PurchaseDetail {...await loadPurchaseDetail(params.id)}/>}
