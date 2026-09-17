import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import PrintButton from '@/components/dashboard/PrintButton'

export const metadata = {
  title: 'طباعة فاتورة نقطة البيع (POS) — Bazarko ERP',
}

export default async function OrderReceiptPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: order },
    { data: items }
  ] = await Promise.all([
    supabase.from('stores').select('*').eq('id', storeId).single(),
    supabase.from('orders').select('*, customer:customers(id, name, phone, balance)').eq('id', params.id).eq('store_id', storeId).single(),
    supabase.from('order_items').select('*').eq('order_id', params.id),
  ])

  if (!store || !order) notFound()

  const isCash = order.payment_method === 'cash'
  const isCredit = order.payment_method === 'credit'
  const isPaid = order.payment_status === 'paid' || ((order.amount_paid || 0) >= order.total_amount)
  const remaining = Math.max(0, order.total_amount - (order.amount_paid || 0))
  const changeGiven = isCash && (order.amount_paid || 0) > order.total_amount ? (order.amount_paid || 0) - order.total_amount : 0

  const PAYMENT_METHOD_NAMES: Record<string, { ar: string; en: string }> = {
    cash: { ar: 'نقداً', en: 'Cash' },
    credit: { ar: 'على الحساب (آجل)', en: 'On Account / Credit' },
    check: { ar: 'شيك بنكي', en: 'Cheque' },
    bank_transfer: { ar: 'تحويل بنكي', en: 'Bank Transfer' },
    card: { ar: 'بطاقة دفع', en: 'Card' },
    online: { ar: 'دفع إلكتروني', en: 'Online' },
  }

  const methodInfo = PAYMENT_METHOD_NAMES[order.payment_method] || {
    ar: order.payment_method,
    en: order.payment_method,
  }

  const fmt = (n: number) => Number(n || 0).toLocaleString('ar-u-nu-latn', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  const orderDate = new Date(order.created_at)
  const dateStr = orderDate.toLocaleDateString('ar-u-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const timeStr = orderDate.toLocaleTimeString('ar-u-nu-latn', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 text-black print:p-0 print:bg-white font-mono">
      {/* ── Toolbar (Hidden on print) ── */}
      <div className="mx-auto mb-6 flex max-w-xl items-center justify-between rounded-xl bg-slate-900 p-4 text-white shadow-lg print:hidden font-sans">
        <Link
          href={`/dashboard/orders/${order.id}`}
          className="flex items-center gap-1 text-xs font-bold text-slate-300 hover:text-white transition"
        >
          ← العودة للطلبية
        </Link>
        <div className="flex items-center gap-3">
          <PrintButton
            elementId="pos-thermal-receipt"
            format="thermal"
            filename={`receipt-${order.order_number}.pdf`}
            label="🖨️ طباعة الإيصال (Thermal / PDF)"
            className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition shadow"
          />
        </div>
      </div>

      {/* ── Thermal Receipt Layout (80mm) ── */}
      <div id="pos-thermal-receipt" className="mx-auto w-[80mm] max-w-full bg-white p-4 border border-slate-300 rounded-xl shadow-md print:border-none print:shadow-none print:w-[78mm] print:p-1">
        {/* Store Header */}
        <div className="text-center border-b-2 border-dashed border-black pb-3">
          {store.logo_url && (
            <img
              src={store.logo_url}
              alt={store.name}
              className="mx-auto mb-2 h-14 w-14 object-contain"
            />
          )}
          <h1 className="text-xl font-black tracking-tight">{store.name}</h1>
          {store.address && (
            <p className="text-xs font-sans mt-0.5 text-neutral-700">{store.address}</p>
          )}
          {store.phone && (
            <p className="text-xs font-sans text-neutral-700">هاتف: <span dir="ltr">{store.phone}</span></p>
          )}
          {store.tax_number && (
            <p className="text-[11px] font-sans text-neutral-600">الرقم الضريبي: {store.tax_number}</p>
          )}
          <div className="mt-2 inline-block rounded border border-black px-3 py-0.5 text-xs font-bold tracking-wider">
            فاتورة مبيعات نقطة البيع (POS)
          </div>
        </div>

        {/* Receipt Info */}
        <div className="border-b border-dashed border-black py-2.5 text-xs leading-relaxed">
          <div className="flex justify-between">
            <span>رقم الفاتورة:</span>
            <span className="font-bold" dir="ltr">{order.order_number}</span>
          </div>
          <div className="flex justify-between">
            <span>التاريخ:</span>
            <span>{dateStr}</span>
          </div>
          <div className="flex justify-between">
            <span>الوقت:</span>
            <span dir="ltr">{timeStr}</span>
          </div>
          <div className="flex justify-between border-t border-dotted border-gray-400 mt-1 pt-1">
            <span>العميل:</span>
            <span className="font-semibold">
              {order.customer_name || (isCredit ? 'عميل على الحساب' : 'زبون نقدي')}
            </span>
          </div>
          {order.customer_phone && (
            <div className="flex justify-between">
              <span>الهاتف:</span>
              <span dir="ltr">{order.customer_phone}</span>
            </div>
          )}
        </div>

        {/* Items List */}
        <div className="py-2.5 border-b border-dashed border-black text-xs">
          <div className="flex justify-between font-bold border-b border-black pb-1 mb-1">
            <span className="w-1/2 text-right">الصنف</span>
            <span className="w-1/6 text-center">الكمية</span>
            <span className="w-1/6 text-left">السعر</span>
            <span className="w-1/6 text-left">الإجمالي</span>
          </div>
          <div className="space-y-1.5 pt-1">
            {(items || []).map((item: any, idx: number) => (
              <div key={idx} className="flex justify-between items-start leading-tight">
                <span className="w-1/2 text-right font-sans font-medium text-[11px]">
                  {item.product_name}
                </span>
                <span className="w-1/6 text-center font-bold" dir="ltr">
                  {item.quantity}
                </span>
                <span className="w-1/6 text-left text-[11px]" dir="ltr">
                  {fmt(item.unit_price)}
                </span>
                <span className="w-1/6 text-left font-bold" dir="ltr">
                  {fmt(item.total_price)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Financial Summary */}
        <div className="py-2.5 border-b-2 border-dashed border-black text-xs space-y-1">
          <div className="flex justify-between">
            <span>المجموع الفرعي:</span>
            <span dir="ltr">{fmt(order.subtotal)} {store.currency_code}</span>
          </div>
          {Number(order.discount_amount || 0) > 0 && (
            <div className="flex justify-between text-neutral-800">
              <span>الخصم الممنوح:</span>
              <span dir="ltr">- {fmt(order.discount_amount)} {store.currency_code}</span>
            </div>
          )}
          <div className="flex justify-between font-black text-sm border-t border-black pt-1 mt-1">
            <span>المجموع الإجمالي:</span>
            <span dir="ltr">{fmt(order.total_amount)} {store.currency_code}</span>
          </div>
        </div>

        {/* Payment Details Box */}
        <div className="my-2.5 rounded-lg border-2 border-black bg-neutral-50 p-2.5 text-xs">
          <div className="flex items-center justify-between pb-1 border-b border-black mb-1.5">
            <span className="font-black uppercase tracking-wider">طريقة وحالة الدفع:</span>
            <span className="font-bold text-[11px] underline">
              {methodInfo.ar} / {methodInfo.en}
            </span>
          </div>

          {/* Payment Status Badges */}
          {isCash && isPaid && (
            <div className="my-1 rounded bg-black text-white text-center py-1.5 font-black text-xs tracking-wider">
              ✓ تم الدفع / مدفوعة نقداً (PAID CASH)
            </div>
          )}

          {isCredit && (
            <div className="my-1 rounded border-2 border-black bg-white text-center py-1.5 font-black text-xs tracking-wider">
              ⚠️ على الحساب (آجل وغير مدفوعة) / CREDIT ON ACCOUNT
            </div>
          )}

          {!isCash && !isCredit && (
            <div className="my-1 rounded bg-black text-white text-center py-1 font-black text-sm tracking-wider">
              ✓ {methodInfo.ar} / {isPaid ? 'PAID' : 'PENDING'}
            </div>
          )}

          <div className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between font-bold">
              <span>المبلغ المدفوع:</span>
              <span dir="ltr">{fmt(order.amount_paid || 0)} {store.currency_code}</span>
            </div>

            {changeGiven > 0 && (
              <div className="flex justify-between font-black text-sm text-neutral-900 border-t border-dotted border-black pt-1">
                <span>الباقي المُعاد للزبون:</span>
                <span dir="ltr">{fmt(changeGiven)} {store.currency_code}</span>
              </div>
            )}

            {remaining > 0 && (
              <div className="flex justify-between font-black text-sm text-black border-t border-dotted border-black pt-1">
                <span>المتبقي في الذمة:</span>
                <span dir="ltr">{fmt(remaining)} {store.currency_code}</span>
              </div>
            )}

            {order.customer && (
              <div className="flex justify-between text-[11px] text-neutral-700 border-t border-neutral-300 pt-0.5">
                <span>إجمالي رصيد العميل الحالي:</span>
                <span dir="ltr" className="font-bold">{fmt(order.customer.balance || 0)} {store.currency_code}</span>
              </div>
            )}
          </div>
        </div>

        {/* Barcode */}
        <div className="py-2 text-center">
          <div className="inline-block py-1">
            <div className="flex items-center justify-center gap-0.5 h-8">
              {[3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1, 3, 2, 4, 1, 2, 3, 1, 2, 4].map((w, idx) => (
                <div
                  key={idx}
                  className="bg-black h-full"
                  style={{ width: `${w}px` }}
                />
              ))}
            </div>
            <p className="font-mono text-[10px] tracking-widest mt-1" dir="ltr">
              *{order.order_number}*
            </p>
          </div>
        </div>

        {/* Footer Notice */}
        <div className="border-t-2 border-dashed border-black pt-2 text-center text-[10px] text-neutral-700 space-y-1">
          <p className="font-semibold">{store.pos_receipt_footer || 'شكراً لتعاملكم معنا ونسعد بزيارتكم دائماً'}</p>
          <p className="text-[9px]">البضاعة المباعة تستبدل خلال 3 أيام بشرط وجود الفاتورة وبحالتها الأصلية</p>
          <p className="text-[8px] text-neutral-500 font-sans mt-1">نظام Bazarko POS</p>
        </div>
      </div>
    </div>
  )
}
