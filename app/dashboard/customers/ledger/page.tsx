import { redirect } from 'next/navigation'

export const metadata = {
  title: 'حسابات ودليل العملاء — Bazarko ERP',
}

interface Props {
  searchParams?: {
    customer_id?: string
    q?: string
  }
}

export default function CustomerLedgerPage({ searchParams }: Props) {
  if (searchParams?.customer_id) {
    redirect(`/dashboard/customers/${searchParams.customer_id}`)
  }
  if (searchParams?.q) {
    redirect(`/dashboard/customers?q=${encodeURIComponent(searchParams.q)}`)
  }
  redirect('/dashboard/customers')
}
