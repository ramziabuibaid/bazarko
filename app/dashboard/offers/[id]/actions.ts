'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { sendOfferEmail } from '@/lib/email/offer-email'

interface SendResult {
  ok: boolean
  sent: number
  total: number
  error?: string
}

export async function sendOfferToCustomers(offerId: string): Promise<SendResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, sent: 0, total: 0, error: 'غير مصرّح' }

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return { ok: false, sent: 0, total: 0, error: 'لا يوجد متجر' }

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, subdomain, country_code, currency_code')
    .eq('id', storeId)
    .single()
  if (!store) return { ok: false, sent: 0, total: 0, error: 'لا يوجد متجر' }

  const { data: offer } = await supabase
    .from('offers')
    .select('id, title, description, ends_at, is_active, offer_items(offer_price, products(name, price, is_active))')
    .eq('id', offerId)
    .eq('store_id', store.id)
    .single()
  if (!offer) return { ok: false, sent: 0, total: 0, error: 'العرض غير موجود' }

  const items = ((offer.offer_items ?? []) as unknown as {
    offer_price: number
    products: { name: string; price: number; is_active: boolean } | null
  }[])
    .filter(i => i.products?.is_active)
    .map(i => ({ name: i.products!.name, price: i.products!.price, offer_price: i.offer_price }))

  if (!items.length) return { ok: false, sent: 0, total: 0, error: 'لا توجد منتجات نشطة في العرض' }

  const { data: customers } = await supabase
    .from('customers')
    .select('name, email')
    .eq('store_id', store.id)
    .not('email', 'is', null)
    .neq('email', '')

  const recipients = (customers ?? []) as { name: string; email: string }[]
  if (!recipients.length) return { ok: false, sent: 0, total: 0, error: 'لا يوجد زبائن لديهم إيميل' }

  const domain = process.env.NEXT_PUBLIC_DOMAIN ?? 'bazarko.app'
  const offerUrl = `https://${store.subdomain}.${store.country_code.toLowerCase()}.${domain}/offer/${offer.id}`

  // إرسال على دفعات صغيرة لتجنّب rate limit في Resend
  let sent = 0
  const BATCH = 5
  for (let i = 0; i < recipients.length; i += BATCH) {
    const batch = recipients.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(c => sendOfferEmail({
        to: c.email,
        customerName: c.name || 'عزيزي الزبون',
        storeName: store.name,
        offerTitle: offer.title,
        offerDescription: offer.description,
        endsAt: offer.ends_at,
        currencyCode: store.currency_code,
        offerUrl,
        items,
      }))
    )
    sent += results.filter(Boolean).length
  }

  return { ok: sent > 0, sent, total: recipients.length, error: sent === 0 ? 'فشل الإرسال — تأكد من RESEND_API_KEY' : undefined }
}
