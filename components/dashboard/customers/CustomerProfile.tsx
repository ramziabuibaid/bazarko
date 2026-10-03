'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createVoucher } from '@/app/dashboard/accounting/vouchers/voucher-actions'
import CustomerShamelStatementView from './CustomerShamelStatementView'

interface LedgerEntry {
  id: string
  type: string
  date: string
  description: string
  debit: number
  credit: number
  balance: number
  reference_type: string | null
  created_at: string
}

interface Order {
  id: string
  order_number: string
  status: string
  total_amount: number
  amount_paid: number
  created_at: string
}

interface Customer {
  id: string
  name: string
  phone: string | null
  phone_alt: string | null
  email: string | null
  city: string | null
  address: string | null
  notes: string | null
  social_url: string | null
  balance: number
  credit_limit: number
  total_orders: number
  total_invoiced: number
  total_paid: number
  customer_type: string
  is_active: boolean
  shamel_code?: string | null
  last_order_at?: string | null
  last_payment_at?: string | null
}

interface Props {
  customer: Customer
  ledger: LedgerEntry[]
  orders: Order[]
  currencyCode: string
  storeId: string
  storeName?: string
}

const TYPE_LABELS: Record<string, string> = { retail: 'تجزئة', wholesale: 'جملة', vip: 'VIP' }
const ORDER_STATUS: Record<string, string> = {
  pending: 'معلق', confirmed: 'مؤكد', processing: 'قيد التجهيز',
  ready: 'جاهز', shipped: 'تم الشحن', delivered: 'مُسلّم', cancelled: 'ملغي',
}
const LEDGER_TYPE: Record<string, { label: string; color: string }> = {
  invoice:     { label: 'فاتورة',    color: 'text-red-400' },
  payment:     { label: 'دفعة',      color: 'text-emerald-400' },
  return:      { label: 'إرجاع',     color: 'text-emerald-400' },
  adjustment:  { label: 'تعديل',     color: 'text-yellow-400' },
  credit_note: { label: 'إشعار دائن', color: 'text-emerald-400' },
}

export default function CustomerProfile({ customer, ledger, orders, currencyCode, storeId, storeName = 'متجر بازاركو' }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<'shamel' | 'ledger' | 'orders' | 'info'>(customer.shamel_code ? 'shamel' : 'ledger')
  const [showPayment, setShowPayment] = useState(false)
  const [payForm, setPayForm] = useState({ amount: '', method: 'cash', notes: '' })
  const [paying, setSaving] = useState(false)
  const [payError, setPayError] = useState('')

  // تعديل بيانات الزبون
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({
    name: customer.name,
    phone: customer.phone ?? '',
    phone_alt: customer.phone_alt ?? '',
    email: customer.email ?? '',
    city: customer.city ?? '',
    address: customer.address ?? '',
    notes: customer.notes ?? '',
    customer_type: customer.customer_type,
    credit_limit: String(customer.credit_limit ?? 0),
    social_url: customer.social_url ?? '',
  })
  const [saving, setSavingEdit] = useState(false)

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseFloat(payForm.amount)
    if (!amount || amount <= 0) { setPayError('أدخل مبلغاً صحيحاً'); return }
    setSaving(true)
    setPayError('')

    try {
      const res = await createVoucher({
        type: 'receipt',
        date: new Date().toISOString().split('T')[0],
        payment_method: 'cash',
        amount,
        cash_amount: amount,
        customer_id: customer.id,
        party_name: customer.name,
        category: 'تحصيل ذمة عميل',
        description: payForm.notes?.trim() || `سند قبض / تحصيل دفعة من العميل ${customer.name}`,
      })

      if (!res.success) {
        setPayError(res.error || 'فشل تسجيل سند القبض')
        setSaving(false)
        return
      }

      setSaving(false)
      setShowPayment(false)
      setPayForm({ amount: '', method: 'cash', notes: '' })
      router.refresh()
    } catch (err: any) {
      setPayError(err?.message || 'حدث خطأ غير متوقع أثناء تسجيل السند')
      setSaving(false)
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    setSavingEdit(true)
    await createClient().from('customers').update({
      name: editForm.name.trim(),
      phone: editForm.phone.trim() || null,
      phone_alt: editForm.phone_alt.trim() || null,
      email: editForm.email.trim() || null,
      city: editForm.city.trim() || null,
      address: editForm.address.trim() || null,
      notes: editForm.notes.trim() || null,
      customer_type: editForm.customer_type,
      credit_limit: parseFloat(editForm.credit_limit) || 0,
      social_url: editForm.social_url.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', customer.id)
    setSavingEdit(false)
    setEditMode(false)
    router.refresh()
  }

  function handlePrint() {
    window.print()
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">

      {/* ── العمود الجانبي ── */}
      <div className="space-y-5">
        {/* بطاقة الزبون */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-500/15 text-2xl">
                👤
              </div>
              <h2 className="mt-3 text-lg font-bold text-white">{customer.name}</h2>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <span className="inline-block rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-400">
                  {TYPE_LABELS[customer.customer_type] ?? customer.customer_type}
                </span>
                {customer.shamel_code && (
                  <span className="inline-block rounded-full bg-sky-500/15 border border-sky-500/30 px-2.5 py-0.5 text-xs font-mono font-bold text-sky-400">
                    رقم الشامل: {customer.shamel_code}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => setEditMode(true)}
              className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/10 hover:text-white"
            >
              تعديل
            </button>
          </div>

          <div className="mt-4 space-y-2 border-t border-white/5 pt-4 text-sm">
            {customer.phone && (
              <div className="flex items-center gap-2">
                <a
                  href={`tel:${customer.phone}`}
                  className="flex flex-1 items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                  dir="ltr"
                >
                  <span>📞</span> {customer.phone}
                </a>
                <a
                  href={`https://wa.me/${customer.phone.replace(/\D/g, '')}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2 text-emerald-400 hover:bg-emerald-500/25 transition-colors"
                >
                  <span>💬</span> واتساب
                </a>
              </div>
            )}
            {customer.phone_alt && (
              <a href={`tel:${customer.phone_alt}`} className="flex items-center gap-2 text-slate-400 hover:text-white" dir="ltr">
                <span className="text-slate-500">📞</span> {customer.phone_alt}
              </a>
            )}
            {customer.email && (
              <p className="flex items-center gap-2 text-slate-300" dir="ltr">
                <span className="text-slate-500">✉️</span> {customer.email}
              </p>
            )}
            {customer.city && (
              <p className="flex items-center gap-2 text-slate-300">
                <span className="text-slate-500">📍</span> {customer.city}
              </p>
            )}
            {customer.social_url && (
              <a
                href={customer.social_url}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sky-400 hover:underline"
                dir="ltr"
              >
                <span>🔗</span>
                <span className="truncate">
                  {customer.social_url.includes('instagram') ? 'إنستغرام' : customer.social_url.includes('facebook') ? 'فيسبوك' : 'حساب التواصل'}
                </span>
              </a>
            )}
          </div>

          {customer.notes && (
            <p className="mt-4 rounded-xl bg-white/3 px-3 py-2 text-xs text-slate-400">{customer.notes}</p>
          )}
        </div>

        {/* ملخص مالي */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <h3 className="mb-4 font-semibold text-white">الملخص المالي</h3>
          <div className="space-y-3">
            {[
              { label: 'إجمالي الطلبيات', value: customer.total_orders, unit: 'طلبية' },
              { label: 'إجمالي المشتريات', value: `${(customer.total_invoiced ?? 0).toLocaleString('ar-u-nu-latn')}`, unit: currencyCode },
              { label: 'إجمالي المدفوع', value: `${(customer.total_paid ?? 0).toLocaleString('ar-u-nu-latn')}`, unit: currencyCode, color: 'text-emerald-400' },
            ].map(item => (
              <div key={item.label} className="flex justify-between text-sm">
                <span className="text-slate-400">{item.label}</span>
                <span className={item.color ?? 'text-white'} dir="ltr">{item.value} {item.unit}</span>
              </div>
            ))}
            {customer.last_order_at && (
              <div className="flex justify-between text-xs text-slate-300">
                <span className="text-slate-400">آخر فاتورة / طلبية:</span>
                <span dir="ltr">{new Date(customer.last_order_at).toLocaleDateString('ar-u-nu-latn')}</span>
              </div>
            )}
            {customer.last_payment_at && (
              <div className="flex justify-between text-xs text-emerald-400">
                <span className="text-slate-400">آخر دفعة / سند قبض:</span>
                <span dir="ltr">{new Date(customer.last_payment_at).toLocaleDateString('ar-u-nu-latn')}</span>
              </div>
            )}
            <div className="border-t border-white/10 pt-3 flex justify-between font-semibold">
              <span className="text-slate-300">الذمة الحالية</span>
              <span className={customer.balance > 0 ? 'text-red-400' : 'text-emerald-400'} dir="ltr">
                {customer.balance > 0 ? `${customer.balance.toLocaleString('ar-u-nu-latn')} ${currencyCode}` : '✓ مسدد'}
              </span>
            </div>
          </div>

          {customer.balance > 0 && (
            <button
              onClick={() => router.push(`/dashboard/accounting/receipts?customer_id=${customer.id}`)}
              className="mt-4 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              💵 تسجيل دفعة
            </button>
          )}

          {/* إجراءات سريعة */}
          <div className="mt-2 grid grid-cols-2 gap-2">
            {customer.balance > 0 && customer.phone && (
              <a
                href={`https://wa.me/${customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
                  `مرحباً ${customer.name}،\nنذكّركم بأن الذمة المستحقة لدينا هي ${customer.balance.toLocaleString('ar-u-nu-latn')} ${currencyCode}.\nشكراً لتعاونكم 🙏`
                )}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/15 py-2.5 text-sm text-emerald-400 hover:bg-emerald-500/25"
              >
                💬 تذكير واتساب
              </a>
            )}
            <Link
              href={`/dashboard/accounting/invoices?customer=${customer.id}`}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 py-2.5 text-sm text-slate-300 hover:bg-white/5"
            >
              📄 عرض الفواتير
            </Link>
            <button
              onClick={handlePrint}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 py-2.5 text-sm text-slate-300 hover:bg-white/5"
            >
              🖨️ كشف الحساب
            </button>
          </div>
        </div>
      </div>

      {/* ── العمود الرئيسي ── */}
      <div className="lg:col-span-2">
        {/* تبويبات */}
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-white/5 bg-white/3 p-1">
          {customer.shamel_code && (
            <button
              type="button"
              onClick={() => setTab('shamel')}
              className={`flex-1 min-w-[140px] rounded-lg py-2.5 px-3 text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
                tab === 'shamel'
                  ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/30'
                  : 'text-sky-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>🏛️ كشف حساب الشامل</span>
              <span className="font-mono text-[10px] bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-400/40 font-bold">
                {customer.shamel_code}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setTab('ledger')}
            className={`flex-1 min-w-[120px] rounded-lg py-2.5 px-3 text-xs sm:text-sm font-medium transition-all ${
              tab === 'ledger'
                ? 'bg-slate-700 text-white shadow'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            📒 كشف حساب بازاركو
          </button>

          <button
            type="button"
            onClick={() => setTab('orders')}
            className={`flex-1 min-w-[100px] rounded-lg py-2.5 px-3 text-xs sm:text-sm font-medium transition-all ${
              tab === 'orders'
                ? 'bg-slate-700 text-white shadow'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            📦 طلبيات المتجر ({orders.length})
          </button>
        </div>

        {/* 1. كشف حساب الشامل المحاسبي */}
        {tab === 'shamel' && customer.shamel_code && (
          <CustomerShamelStatementView
            customerCode={customer.shamel_code}
            customerName={customer.name}
            storeName={storeName}
            currencyCode={currencyCode}
          />
        )}

        {/* 2. كشف حساب بازاركو */}
        {tab === 'ledger' && (
          <div id="print-area" className="overflow-hidden rounded-2xl border border-white/5">
            {/* رأس الطباعة — يظهر فقط عند الطباعة */}
            <div className="hidden print:block mb-4 text-center">
              <h2 className="text-xl font-bold">كشف حساب الزبون</h2>
              <p className="text-lg font-semibold mt-1">{customer.name}</p>
              {customer.phone && <p dir="ltr">{customer.phone}</p>}
              <p className="mt-2 text-sm text-gray-500">تاريخ الطباعة: {new Date().toLocaleDateString('ar-u-nu-latn')}</p>
            </div>

            {ledger.length === 0 ? (
              <div className="py-12 text-center text-slate-500">لا توجد حركات مالية مسجلة في بازاركو بعد</div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm print:min-w-0">
                <thead>
                  <tr className="border-b border-white/5 bg-white/3 print:bg-gray-100">
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">التاريخ</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">البيان</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-red-400">مدين</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-emerald-400">دائن</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">الرصيد</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 print:divide-gray-200">
                  {ledger.map(entry => {
                    const lt = LEDGER_TYPE[entry.type] ?? { label: entry.type, color: 'text-white' }
                    return (
                      <tr key={entry.id} className="hover:bg-white/3 print:hover:bg-transparent">
                        <td className="px-4 py-3 text-slate-400 print:text-gray-600">
                          {new Date(entry.date).toLocaleDateString('ar-u-nu-latn')}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-white print:text-gray-900">{entry.description}</p>
                          <span className={`text-xs ${lt.color}`}>{lt.label}</span>
                        </td>
                        <td className="px-4 py-3 text-left font-medium text-red-400 print:text-red-600" dir="ltr">
                          {entry.debit > 0 ? entry.debit.toLocaleString('ar-u-nu-latn') : '—'}
                        </td>
                        <td className="px-4 py-3 text-left font-medium text-emerald-400 print:text-emerald-600" dir="ltr">
                          {entry.credit > 0 ? entry.credit.toLocaleString('ar-u-nu-latn') : '—'}
                        </td>
                        <td className="px-4 py-3 text-left font-semibold text-white print:text-gray-900" dir="ltr">
                          {entry.balance.toLocaleString('ar-u-nu-latn')} {currencyCode}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-white/10 bg-white/3 print:border-gray-400 print:bg-gray-50">
                    <td colSpan={4} className="px-4 py-3 font-bold text-white print:text-gray-900">
                      الرصيد الحالي
                    </td>
                    <td className={`px-4 py-3 text-left font-bold text-lg ${customer.balance > 0 ? 'text-red-400' : 'text-emerald-400'}`} dir="ltr">
                      {customer.balance.toLocaleString('ar-u-nu-latn')} {currencyCode}
                    </td>
                  </tr>
                </tfoot>
              </table>
              </div>
            )}
          </div>
        )}

        {/* 3. الطلبيات */}
        {tab === 'orders' && (
          <div className="overflow-hidden rounded-2xl border border-white/5">
            {orders.length === 0 ? (
              <div className="py-12 text-center text-slate-500">لا توجد طلبيات</div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm print:min-w-0">
                <thead>
                  <tr className="border-b border-white/5 bg-white/3">
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">رقم الطلبية</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الحالة</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">الإجمالي</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">المدفوع</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">التاريخ</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {orders.map(order => (
                    <tr key={order.id} className="hover:bg-white/3">
                      <td className="px-4 py-3 font-mono text-white" dir="ltr">{order.order_number}</td>
                      <td className="px-4 py-3 text-slate-300">{ORDER_STATUS[order.status] ?? order.status}</td>
                      <td className="px-4 py-3 text-left text-white" dir="ltr">
                        {order.total_amount.toLocaleString('ar-u-nu-latn')} {currencyCode}
                      </td>
                      <td className="px-4 py-3 text-left text-emerald-400" dir="ltr">
                        {order.amount_paid.toLocaleString('ar-u-nu-latn')}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {new Date(order.created_at).toLocaleDateString('ar-u-nu-latn')}
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/orders/${order.id}`} className="text-xs text-sky-400 hover:underline">
                          فتح
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal تسجيل دفعة */}
      {showPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowPayment(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-semibold text-white">تسجيل دفعة</h2>
            <p className="mb-5 text-sm text-slate-400">
              الذمة الحالية: <span className="text-red-400 font-semibold">{customer.balance.toLocaleString('ar-u-nu-latn')} {currencyCode}</span>
            </p>
            <form onSubmit={recordPayment} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-slate-400">المبلغ المدفوع *</label>
                <input
                  value={payForm.amount}
                  onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={customer.balance}
                  placeholder={`0 — ${customer.balance.toLocaleString('ar-u-nu-latn')}`}
                  dir="ltr"
                  required
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500/50"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-400">طريقة الدفع</label>
                <select
                  value={payForm.method}
                  onChange={e => setPayForm(f => ({ ...f, method: e.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm text-white outline-none"
                >
                  <option value="cash">نقداً</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                  <option value="check">شيك</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-400">ملاحظة (اختياري)</label>
                <input
                  value={payForm.notes}
                  onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="تسديد فاتورة / دفعة جزئية..."
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                />
              </div>
              {payError && <p className="text-sm text-red-400">{payError}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowPayment(false)}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400 hover:text-white">
                  إلغاء
                </button>
                <button type="submit" disabled={paying}
                  className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                  {paying ? '...' : 'تسجيل الدفعة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal تعديل الزبون */}
      {editMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setEditMode(false)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="mb-5 text-lg font-semibold text-white">تعديل بيانات الزبون</h2>
            <form onSubmit={saveEdit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-slate-400">الاسم *</label>
                  <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    required className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">الهاتف</label>
                  <input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                    dir="ltr" type="tel"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">هاتف بديل</label>
                  <input value={editForm.phone_alt} onChange={e => setEditForm(f => ({ ...f, phone_alt: e.target.value }))}
                    dir="ltr" type="tel"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">البريد</label>
                  <input value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                    dir="ltr" type="email"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">المدينة</label>
                  <input value={editForm.city} onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">نوع الزبون</label>
                  <select value={editForm.customer_type} onChange={e => setEditForm(f => ({ ...f, customer_type: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none">
                    <option value="retail">تجزئة</option>
                    <option value="wholesale">جملة</option>
                    <option value="vip">VIP</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-slate-400">إنستغرام / فيسبوك</label>
                  <input value={editForm.social_url} onChange={e => setEditForm(f => ({ ...f, social_url: e.target.value }))}
                    dir="ltr" type="url" placeholder="https://instagram.com/username"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50" />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-slate-400">ملاحظات</label>
                  <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditMode(false)}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400 hover:text-white">إلغاء</button>
                <button type="submit" disabled={saving}
                  className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                  {saving ? '...' : 'حفظ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
