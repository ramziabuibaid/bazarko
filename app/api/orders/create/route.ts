import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { sendPendingOrderEmail } from '@/lib/email/send-pending-order'

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    const body = await req.json()
    const key = req.headers.get('Idempotency-Key')
    if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
      return NextResponse.json({ error: 'معرف محاولة البيع مطلوب' }, { status: 400 })
    }
    const { data, error } = await supabase.rpc('create_pos_sale_atomic', { p_store: storeId, p_payload: body, p_key: key })
    if (error || !data?.orderId) {
      return NextResponse.json({ error: error?.code === 'P0001' || error?.code === '42501' ? error.message : 'تعذر حفظ البيع كاملاً' }, { status: error?.code === '42501' ? 403 : 400 })
    }
    await sendPendingOrderEmail(data.orderId).catch(error => console.error('Order email queue:', error))
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'بيانات البيع غير صالحة' }, { status: 400 })
  }
}
