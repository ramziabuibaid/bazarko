import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import CartClient from '@/components/store/CartClient'

interface Props {
  params: { country: string; subdomain: string }
}

export default async function CartPage({ params }: Props) {
  const supabase = createClient()

  const { data: store } = await supabase
    .from('stores')
    .select('currency_code, secondary_currency_code, exchange_rate, prefer_secondary')
    .eq('subdomain', params.subdomain)
    .eq('country_code', params.country.toUpperCase())
    .eq('status', 'active')
    .single()

  if (!store) notFound()

  return (
    <CartClient
      country={params.country}
      subdomain={params.subdomain}
      currencyCode={store.currency_code}
      secondaryCurrencyCode={store.secondary_currency_code ?? null}
      exchangeRate={store.exchange_rate ?? null}
      preferSecondary={store.prefer_secondary ?? false}
    />
  )
}
