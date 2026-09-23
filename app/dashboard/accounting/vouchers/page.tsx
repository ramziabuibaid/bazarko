import { redirect } from 'next/navigation'

interface Props {
  searchParams: {
    type?: string
    new?: string
    id?: string
    [key: string]: string | undefined
  }
}

/**
 * موجه المسارات الذكي لسندات القبض والصرف
 * يقوم بإعادة التوجيه التلقائي للمسار المناسب مع الاحتفاظ بجميع المعاملات (query parameters)
 * لمنع ظهور خطأ 404 عند النقر على أي رابط قديم أو وصول مباشر
 */
export default function VouchersRouterPage({ searchParams }: Props) {
  const type = searchParams?.type || 'receipt'
  const isPayment = type === 'payment'
  
  // بناء معلمات الاستعلام الممررة
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams || {})) {
    if (key !== 'type' && value !== undefined) {
      params.set(key, value)
    }
  }

  const queryString = params.toString() ? `?${params.toString()}` : ''
  const targetPath = isPayment
    ? `/dashboard/accounting/payments${queryString}`
    : `/dashboard/accounting/receipts${queryString}`

  redirect(targetPath)
}
