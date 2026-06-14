import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import StoreHeader from '@/components/store/StoreHeader'
import StoreFooter from '@/components/store/StoreFooter'
import CartToast from '@/components/store/CartToast'
import WishlistClient from '@/components/store/WishlistClient'

interface Props {
  params: { country: string; subdomain: string }
}

export default async function WishlistPage({ params }: Props) {
  const supabase = createClient()

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, logo_url, phone, whatsapp, email, city, address, map_url, currency_code, country_code, secondary_currency_code, exchange_rate, prefer_secondary, header_theme, instagram, facebook, tiktok, telegram, business_hours, footer_settings, description')
    .eq('subdomain', params.subdomain)
    .eq('country_code', params.country.toUpperCase())
    .eq('status', 'active')
    .single()

  if (!store) notFound()

  return (
    <div className="min-h-screen bg-white transition-colors dark:bg-gray-950" dir="rtl">
      <StoreHeader store={store} country={params.country} subdomain={params.subdomain} />
      <WishlistClient
        country={params.country}
        subdomain={params.subdomain}
        currencyCode={store.currency_code}
        secondaryCurrencyCode={store.secondary_currency_code ?? null}
        exchangeRate={store.exchange_rate ?? null}
        preferSecondary={store.prefer_secondary ?? false}
      />
      <StoreFooter store={store} country={params.country} subdomain={params.subdomain} />
      <CartToast country={params.country} subdomain={params.subdomain} />
    </div>
  )
}
