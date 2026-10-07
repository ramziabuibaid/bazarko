'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { trackAction } from '@/lib/activity/track'
import WhatsAppContactMenu from '@/components/whatsapp/WhatsAppContactMenu'

interface OrderItem {
  id: string
  product_id: string | null
  product_name: string
  quantity: number
  unit_price: number
  total_price: number
}

interface Order {
  id: string
  order_number: string
  status: string
  payment_method: string
  payment_status: string | null
  subtotal: number
  shipping_amount: number | null
  discount_amount: number | null
  total_amount: number
  shipping_address: string | null
  shipping_city: string | null
  customer_notes: string | null
  internal_notes: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_id?: string | null
  created_at: string
  updated_at: string
}

interface Props {
  order: Order
  items: OrderItem[]
  currencyCode: string
  storeId: string
}

const STATUS_FLOW: Record<string, { label: string; color: string; next: string | null }> = {
  pending:    { label: 'معلق',          color: 'bg-yellow-500/15 text-yellow-400',  next: 'confirmed' },
  confirmed:  { label: 'مؤكد',         color: 'bg-sky-500/15 text-sky-400',        next: 'processing' },
  processing: { label: 'قيد التجهيز',  color: 'bg-purple-500/15 text-purple-400',  next: 'ready' },
  ready:      { label: 'جاهز للشحن',   color: 'bg-orange-500/15 text-orange-400',  next: 'shipped' },
  shipped:    { label: 'تم الشحن',     color: 'bg-blue-500/15 text-blue-400',      next: 'delivered' },
  delivered:  { label: 'مُسلّم',       color: 'bg-emerald-500/15 text-emerald-400', next: null },
  cancelled:  { label: 'ملغي',         color: 'bg-red-500/15 text-red-400',        next: null },
  returned:   { label: 'مُرتجع',       color: 'bg-rose-500/15 text-rose-400',      next: null },
}

const NEXT_LABELS: Record<string, string> = {
  confirmed:  'تأكيد الطلب',
  processing: 'بدء التجهيز',
  ready:      'تحديد كـ "جاهز للشحن"',
  shipped:    'تحديد كـ "تم الشحن"',
  delivered:  'تحديد كـ "مُسلّم"',
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'نقداً عند الاستلام',
  bank_transfer: 'تحويل بنكي',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ar-u-nu-latn', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function OrderDetail({ order, items, currencyCode, storeId }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState(order.status)
  const [notes, setNotes] = useState(order.internal_notes ?? '')
  const [updating, setUpdating] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)
  const [error, setError] = useState('')

  const st = STATUS_FLOW[status] ?? { label: status, color: 'bg-white/10 text-white', next: null }
  const nextStatus = st.next

  async function advanceStatus() {
    if (!nextStatus) return
    setUpdating(true)
    setError('')
    const supabase = createClient()
    const { error: err } = await supabase
      .from('orders')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', order.id)

    if (err) {
      setError('حدث خطأ أثناء التحديث')
    } else {
      trackAction(storeId, {
        action: 'status_change', entityType: 'order',
        entityId: order.id, entityLabel: order.order_number,
        details: { from: status, to: nextStatus },
      })
      setStatus(nextStatus)
      router.refresh()
    }
    setUpdating(false)
  }

  async function cancelOrder() {
    if (!confirm('هل أنت متأكد من إلغاء هذه الطلبية؟')) return
    setUpdating(true)
    const supabase = createClient()
    await supabase
      .from('orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', order.id)
    trackAction(storeId, {
      action: 'status_change', entityType: 'order',
      entityId: order.id, entityLabel: order.order_number,
      details: { from: status, to: 'cancelled' },
    })
    setStatus('cancelled')
    router.refresh()
    setUpdating(false)
  }

  async function saveNotes() {
    setSavingNotes(true)
    const supabase = createClient()
    await supabase
      .from('orders')
      .update({ internal_notes: notes })
      .eq('id', order.id)
    setSavingNotes(false)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* العمود الرئيسي */}
      <div className="space-y-5 lg:col-span-2">

        {/* عناصر الطلب */}
        <div className="rounded-2xl border border-white/5 bg-slate-900">
          <div className="border-b border-white/5 px-5 py-4">
            <h2 className="font-semibold text-white">عناصر الطلب</h2>
          </div>
          <div className="divide-y divide-white/5">
            {items.map(item => (
              <div key={item.id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-white">{item.product_name}</p>
                  <p className="text-xs text-slate-400">
                    {item.unit_price.toLocaleString('ar-u-nu-latn')} {currencyCode} × {item.quantity}
                  </p>
                </div>
                <span className="text-sm font-semibold text-white">
                  {item.total_price.toLocaleString('ar-u-nu-latn')} {currencyCode}
                </span>
              </div>
            ))}
          </div>

          {/* الملخص المالي */}
          <div className="border-t border-white/5 px-5 py-4 space-y-2">
            <div className="flex justify-between text-sm text-slate-400">
              <span>المجموع الجزئي</span>
              <span>{order.subtotal.toLocaleString('ar-u-nu-latn')} {currencyCode}</span>
            </div>
            {(order.shipping_amount ?? 0) > 0 && (
              <div className="flex justify-between text-sm text-slate-400">
                <span>الشحن</span>
                <span>{(order.shipping_amount ?? 0).toLocaleString('ar-u-nu-latn')} {currencyCode}</span>
              </div>
            )}
            {(order.discount_amount ?? 0) > 0 && (
              <div className="flex justify-between text-sm text-emerald-400">
                <span>الخصم</span>
                <span>- {(order.discount_amount ?? 0).toLocaleString('ar-u-nu-latn')} {currencyCode}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-white/5 pt-2 font-semibold text-white">
              <span>الإجمالي</span>
              <span>{order.total_amount.toLocaleString('ar-u-nu-latn')} {currencyCode}</span>
            </div>
          </div>
        </div>

        {/* ملاحظات الزبون */}
        {order.customer_notes && (
          <div className="rounded-2xl border border-white/5 bg-slate-900 px-5 py-4">
            <h2 className="mb-2 font-semibold text-white">ملاحظات الزبون</h2>
            <p className="text-sm text-slate-300">{order.customer_notes}</p>
          </div>
        )}

        {/* ملاحظات داخلية */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 px-5 py-4">
          <h2 className="mb-3 font-semibold text-white">ملاحظات داخلية</h2>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="ملاحظات للفريق الداخلي (لا يراها الزبون)..."
            rows={3}
            className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
          />
          <button
            onClick={saveNotes}
            disabled={savingNotes}
            className="mt-2 rounded-lg bg-white/5 px-4 py-2 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-50"
          >
            {savingNotes ? 'جاري الحفظ...' : 'حفظ الملاحظة'}
          </button>
        </div>
      </div>

      {/* العمود الجانبي */}
      <div className="space-y-5">

        {/* حالة الطلب */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 px-5 py-5">
          <h2 className="mb-4 font-semibold text-white">حالة الطلب</h2>

          <span className={`inline-flex rounded-full px-3 py-1.5 text-sm font-medium ${st.color}`}>
            {st.label}
          </span>

          {error && (
            <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
          )}

          <div className="mt-4 space-y-2">
            {nextStatus && (
              <button
                onClick={advanceStatus}
                disabled={updating}
                className="w-full rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {updating ? 'جاري التحديث...' : (NEXT_LABELS[nextStatus] ?? nextStatus)}
              </button>
            )}
            {status !== 'cancelled' && status !== 'delivered' && (
              <button
                onClick={cancelOrder}
                disabled={updating}
                className="w-full rounded-xl border border-red-500/30 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                إلغاء الطلب
              </button>
            )}

            <Link
              href={`/dashboard/orders/receipt/${order.id}`}
              target="_blank"
              className="flex items-center justify-center gap-2 w-full rounded-xl bg-slate-800 border border-white/10 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition"
            >
              <span>🧾</span> طباعة إيصال نقطة البيع (POS)
            </Link>
          </div>

          <div className="mt-4 space-y-1.5 border-t border-white/5 pt-4">
            <p className="text-xs text-slate-500">
              <span className="text-slate-400">طريقة الدفع: </span>
              {PAYMENT_LABELS[order.payment_method] ?? order.payment_method}
            </p>
            <p className="text-xs text-slate-500">
              <span className="text-slate-400">تاريخ الطلب: </span>
              {formatDate(order.created_at)}
            </p>
          </div>
        </div>

        {/* بيانات الزبون */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 px-5 py-5">
          <h2 className="mb-4 font-semibold text-white">بيانات الزبون</h2>
          <div className="space-y-2">
            {order.customer_name && (
              <p className="text-sm text-white">{order.customer_name}</p>
            )}
            {order.customer_phone && (
              <a
                href={`tel:${order.customer_phone}`}
                className="block text-sm text-sky-400 hover:underline"
                dir="ltr"
              >
                {order.customer_phone}
              </a>
            )}
            {order.customer_phone && (
              <div className="pt-1">
                <WhatsAppContactMenu
                  phone={order.customer_phone}
                  customerId={order.customer_id}
                  customerName={order.customer_name}
                  message={`مرحباً ${order.customer_name || ''}، بخصوص طلبكم رقم #${order.order_number}...`}
                  label="تواصل عبر واتساب"
                  variant="button"
                  className="w-full"
                  buttonClassName="w-full justify-center py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-sm font-semibold text-emerald-400"
                />
              </div>
            )}
          </div>
        </div>

        {/* عنوان التوصيل */}
        {(order.shipping_city || order.shipping_address) && (
          <div className="rounded-2xl border border-white/5 bg-slate-900 px-5 py-5">
            <h2 className="mb-3 font-semibold text-white">عنوان التوصيل</h2>
            <div className="space-y-1 text-sm text-slate-300">
              {order.shipping_city && <p>{order.shipping_city}</p>}
              {order.shipping_address && <p>{order.shipping_address}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
