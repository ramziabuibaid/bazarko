'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/Confirm'
import { updatePOStatus, deletePurchaseOrder, convertPOToPurchaseInvoice } from './po-actions'

interface POItem {
  id: string
  item_name: string
  quantity: number
  unit_price: number
  total: number
}

interface PurchaseOrder {
  id: string
  order_number: string
  supplier_id: string | null
  issue_date: string
  expected_date: string | null
  status: 'draft' | 'sent' | 'confirmed' | 'received' | 'cancelled'
  subtotal: number
  discount_amount: number
  total: number
  notes: string | null
  converted_invoice_id: string | null
  supplier?: { id: string; name: string; phone: string | null } | null
  items?: POItem[]
}

interface Props {
  store: { id: string; name: string; currency_code: string }
  initialOrders: PurchaseOrder[]
}

const STATUS_CONFIG: Record<string, { label: string; color: string; border: string }> = {
  draft:     { label: 'مسودة (Draft)',     color: 'bg-slate-800 text-slate-300', border: 'border-white/10' },
  sent:      { label: 'مرسل للمورد (Sent)', color: 'bg-sky-500/15 text-sky-400', border: 'border-sky-500/30' },
  confirmed: { label: 'مؤكد من المورد',   color: 'bg-indigo-500/15 text-indigo-400', border: 'border-indigo-500/30' },
  received:  { label: 'مستلم ومحول لفاتورة', color: 'bg-emerald-500/15 text-emerald-400', border: 'border-emerald-500/30' },
  cancelled: { label: 'ملغي (Cancelled)', color: 'bg-rose-500/15 text-rose-400', border: 'border-rose-500/30' },
}

export default function PurchaseOrdersClient({ store, initialOrders }: Props) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()

  const [orders, setOrders] = useState<PurchaseOrder[]>(initialOrders)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [convertingId, setConvertingId] = useState<string | null>(null)

  const fmt = (n: number) => Number(n || 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const currency = store.currency_code || 'ILS'

  const filteredOrders = orders.filter(o => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      o.order_number.toLowerCase().includes(q) ||
      (o.supplier?.name && o.supplier.name.toLowerCase().includes(q))
    )
  })

  // تحويل أمر الشراء إلى فاتورة مشتريات
  const handleConvert = async (po: PurchaseOrder) => {
    const isConfirmed = await confirm({
      title: 'تحويل أمر الشراء إلى فاتورة مشتريات',
      message: `هل أنت متأكد من رغبتك في تحويل أمر الشراء رقم #${po.order_number} إلى فاتورة مشتريات فعلية؟ سيتم إدخال الكميات للمخزن وتسجيل الذمة على حساب المورد.`,
      confirmLabel: 'نعم، قم بالتحويل الآن',
      cancelLabel: 'إلغاء',
    })

    if (!isConfirmed) return

    setConvertingId(po.id)
    try {
      const res = await convertPOToPurchaseInvoice(po.id)
      if (!res.ok) {
        toast(res.error || 'فشل تحويل أمر الشراء', 'error')
        return
      }

      toast('تم تحويل أمر الشراء إلى فاتورة مشتريات بنجاح! تم تحديث المخزون وحساب المورد', 'success')
      router.refresh()
    } catch {
      toast('حدث خطأ أثناء التحويل', 'error')
    } finally {
      setConvertingId(null)
    }
  }

  // حذف أمر الشراء
  const handleDelete = async (po: PurchaseOrder) => {
    if (po.converted_invoice_id) {
      toast('لا يمكن حذف أمر شراء تم تحويله لفاتورة مشتريات', 'error')
      return
    }

    const isConfirmed = await confirm({
      title: 'حذف أمر الشراء',
      message: `هل تريد حذف أمر الشراء رقم #${po.order_number} نهائياً؟`,
      confirmLabel: 'حذف',
      cancelLabel: 'إلغاء',
      danger: true,
    })

    if (!isConfirmed) return

    const res = await deletePurchaseOrder(po.id)
    if (!res.ok) {
      toast(res.error || 'فشل حذف أمر الشراء', 'error')
      return
    }

    toast('تم حذف أمر الشراء بنجاح', 'success')
    setOrders(prev => prev.filter(o => o.id !== po.id))
  }

  // تغيير الحالة
  const handleStatusChange = async (poId: string, newStatus: any) => {
    const res = await updatePOStatus(poId, newStatus)
    if (res.ok) {
      setOrders(prev => prev.map(o => o.id === poId ? { ...o, status: newStatus } : o))
      toast('تم تحديث حالة أمر الشراء', 'success')
    } else {
      toast(res.error || 'فشل تحديث الحالة', 'error')
    }
  }

  const totalAmount = filteredOrders.reduce((sum, o) => sum + Number(o.total || 0), 0)

  return (
    <div className="space-y-5">
      {/* ── بطاقات الإحصاءات السريعة ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-4">
          <p className="text-xs font-bold text-slate-400">إجمالي أوامر الشراء</p>
          <p className="mt-1 text-2xl font-black text-white font-mono">{orders.length}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">بقيمة إجمالية {fmt(totalAmount)} {currency}</p>
        </div>

        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4">
          <p className="text-xs font-bold text-sky-400">أوامر معلقة بانتظار التسليم</p>
          <p className="mt-1 text-2xl font-black text-sky-400 font-mono">
            {orders.filter(o => o.status === 'sent' || o.status === 'confirmed').length}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">مرسلة أو مؤكدة من الموردين</p>
        </div>

        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="text-xs font-bold text-emerald-400">أوامر تم استلامها وتحويلها لفواتير</p>
          <p className="mt-1 text-2xl font-black text-emerald-400 font-mono">
            {orders.filter(o => o.status === 'received' || o.converted_invoice_id).length}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">تم إدخال بضاعتها للمخزن</p>
        </div>
      </div>

      {/* ── شريط الفلاتر والبحث ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 border border-white/10 p-3 rounded-2xl">
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs pb-1 sm:pb-0">
          {[
            { id: 'all', label: 'الكل' },
            { id: 'draft', label: 'مسودة' },
            { id: 'sent', label: 'مرسل' },
            { id: 'confirmed', label: 'مؤكد' },
            { id: 'received', label: 'مستلم/محول' },
            { id: 'cancelled', label: 'ملغي' },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`shrink-0 px-3 py-1.5 rounded-xl font-bold transition ${
                statusFilter === tab.id
                  ? 'bg-sky-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="🔍 ابحث برقم الأمر أو المورد..."
            className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {/* ── جدول أوامر الشراء ── */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-slate-800/60 text-slate-400 font-bold">
                <th className="p-3.5">رقم أمر الشراء</th>
                <th className="p-3.5">المورد</th>
                <th className="p-3.5">تاريخ الإصدار</th>
                <th className="p-3.5">التسليم المتوقع</th>
                <th className="p-3.5 text-center">الأصناف</th>
                <th className="p-3.5">الحالة</th>
                <th className="p-3.5 text-left">الإجمالي</th>
                <th className="p-3.5 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-200">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-slate-500">
                    لا توجد أوامر شراء مطابقة
                  </td>
                </tr>
              ) : (
                filteredOrders.map(po => {
                  const cfg = STATUS_CONFIG[po.status] || STATUS_CONFIG.draft
                  const isConverted = !!po.converted_invoice_id || po.status === 'received'

                  return (
                    <tr key={po.id} className="hover:bg-slate-800/40 transition">
                      <td className="p-3.5 font-mono font-bold text-sky-400">
                        <Link href={`/dashboard/purchases/orders/${po.id}/print`} className="hover:underline">
                          #{po.order_number}
                        </Link>
                      </td>

                      <td className="p-3.5">
                        <p className="font-bold text-white">{po.supplier?.name || 'مورد عام'}</p>
                        {po.supplier?.phone && (
                          <p className="text-[10px] text-slate-400 font-mono" dir="ltr">{po.supplier.phone}</p>
                        )}
                      </td>

                      <td className="p-3.5 font-mono text-slate-300">
                        {po.issue_date}
                      </td>

                      <td className="p-3.5 font-mono text-slate-400">
                        {po.expected_date || '—'}
                      </td>

                      <td className="p-3.5 text-center font-mono font-bold text-slate-300">
                        {po.items?.length || 0}
                      </td>

                      <td className="p-3.5">
                        <select
                          value={po.status}
                          disabled={isConverted}
                          onChange={e => handleStatusChange(po.id, e.target.value)}
                          className={`rounded-lg border px-2 py-1 text-[11px] font-bold outline-none cursor-pointer disabled:cursor-not-allowed ${cfg.color} ${cfg.border} bg-slate-900`}
                        >
                          <option value="draft">مسودة</option>
                          <option value="sent">مرسل</option>
                          <option value="confirmed">مؤكد</option>
                          <option value="received">مستلم / محول</option>
                          <option value="cancelled">ملغي</option>
                        </select>
                      </td>

                      <td className="p-3.5 text-left font-mono font-black text-white" dir="ltr">
                        {fmt(po.total)} {currency}
                      </td>

                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* زر التحويل لفاتورة مشتريات */}
                          {!isConverted && (
                            <button
                              type="button"
                              onClick={() => handleConvert(po)}
                              disabled={convertingId === po.id}
                              title="تحويل أمر الشراء إلى فاتورة مشتريات وتحديث المخزون"
                              className="rounded-lg bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-1 text-xs font-bold text-emerald-300 hover:bg-emerald-500 hover:text-slate-950 transition flex items-center gap-1"
                            >
                              <span>⚡</span>
                              <span>{convertingId === po.id ? 'جاري التحويل...' : 'تحويل لفاتورة'}</span>
                            </button>
                          )}

                          {isConverted && po.converted_invoice_id && (
                            <Link
                              href={`/dashboard/purchases`}
                              className="rounded-lg bg-slate-800 border border-white/10 px-2.5 py-1 text-[11px] font-bold text-emerald-400 hover:text-white transition"
                            >
                              ✓ تم التحويل
                            </Link>
                          )}

                          {/* طباعة أمر الشراء */}
                          <button
                            type="button"
                            title="طباعة أمر الشراء للمورد"
                            onClick={() => window.open(`/dashboard/purchases/orders/${po.id}/print`, '_blank')}
                            className="rounded-lg border border-white/10 bg-slate-800 p-1.5 text-slate-300 hover:text-white transition"
                          >
                            🖨️
                          </button>

                          {/* حذف */}
                          {!isConverted && (
                            <button
                              type="button"
                              title="حذف أمر الشراء"
                              onClick={() => handleDelete(po)}
                              className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-1.5 text-rose-400 hover:bg-rose-500 hover:text-white transition"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
