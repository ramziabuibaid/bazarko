import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const key = req.headers.get('Idempotency-Key')
    if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
      return NextResponse.json({ error: 'معرف محاولة الطلب مطلوب' }, { status: 400 })
    }
    const { data, error } = await createAdminClient().rpc('create_storefront_order_atomic', {
      p_payload: body, p_key: key,
    })
    if (error || !data?.orderId) {
      return NextResponse.json({ error: error?.code === 'P0001' ? error.message : 'تعذر حفظ الطلب كاملاً' }, { status: error?.code === 'P0001' ? 400 : 500 })
    }
    return NextResponse.json({ orderId: data.orderId })
  } catch {
    return NextResponse.json({ error: 'بيانات الطلب غير صالحة' }, { status: 400 })
  }
}
