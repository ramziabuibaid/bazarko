import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { extractNationalDigits, WhatsAppPrefix } from '@/lib/whatsapp/phone'

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    const body = await req.json()
    const { phone, customerId, prefix } = body as {
      phone?: string
      customerId?: string
      prefix: WhatsAppPrefix
    }

    if (!prefix || (prefix !== '972' && prefix !== '970')) {
      return NextResponse.json({ error: 'Invalid prefix. Must be 972 or 970.' }, { status: 400 })
    }

    const cleanPhone = extractNationalDigits(phone)

    // 1. If customerId provided, update customer directly
    if (customerId) {
      await supabase
        .from('customers')
        .update({ whatsapp_prefix: prefix, updated_at: new Date().toISOString() })
        .eq('id', customerId)
        .eq('store_id', storeId)
    }

    // 2. If phone is available, upsert phone_whatsapp_preferences
    if (cleanPhone) {
      await supabase
        .from('phone_whatsapp_preferences')
        .upsert(
          {
            store_id: storeId,
            phone_clean: cleanPhone,
            preferred_prefix: prefix,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'store_id, phone_clean' }
        )

      // Also update any matching customer records by phone if customerId was not passed
      if (!customerId) {
        await supabase
          .from('customers')
          .update({ whatsapp_prefix: prefix, updated_at: new Date().toISOString() })
          .eq('store_id', storeId)
          .or(`phone.ilike.%${cleanPhone}%,phone_alt.ilike.%${cleanPhone}%`)
      }
    }

    return NextResponse.json({ ok: true, prefix, phone: cleanPhone })
  } catch (err: any) {
    console.error('Error saving WhatsApp preference:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    const searchParams = req.nextUrl.searchParams
    const phone = searchParams.get('phone')
    const customerId = searchParams.get('customerId')

    let preferredPrefix: WhatsAppPrefix | null = null

    if (customerId) {
      const { data: cust } = await supabase
        .from('customers')
        .select('whatsapp_prefix')
        .eq('id', customerId)
        .eq('store_id', storeId)
        .single()
      if (cust?.whatsapp_prefix === '972' || cust?.whatsapp_prefix === '970') {
        preferredPrefix = cust.whatsapp_prefix as WhatsAppPrefix
      }
    }

    if (!preferredPrefix && phone) {
      const cleanPhone = extractNationalDigits(phone)
      if (cleanPhone) {
        const { data: pref } = await supabase
          .from('phone_whatsapp_preferences')
          .select('preferred_prefix')
          .eq('store_id', storeId)
          .eq('phone_clean', cleanPhone)
          .single()
        if (pref?.preferred_prefix === '972' || pref?.preferred_prefix === '970') {
          preferredPrefix = pref.preferred_prefix as WhatsAppPrefix
        }
      }
    }

    return NextResponse.json({ prefix: preferredPrefix })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
