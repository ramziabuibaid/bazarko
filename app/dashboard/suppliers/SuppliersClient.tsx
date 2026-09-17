'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'

interface Supplier {
  id: string
  store_id: string
  name: string
  phone: string | null
  address: string | null
  balance: number
  notes: string | null
  created_at: string
}

interface Props {
  store: { id: string; name: string; currency_code: string }
  initialSuppliers: Supplier[]
}

export default function SuppliersClient({ store, initialSuppliers }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers)
  const [showAddModal, setShowAddModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    address: '',
    opening_balance: '0',
    notes: '',
  })

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      setError('يرجى إدخال اسم المورد')
      return
    }

    setLoading(true)
    setError('')

    try {
      const openBal = Number(formData.opening_balance) || 0

      const { data: newSupp, error: insertErr } = await supabase
        .from('suppliers')
        .insert({
          store_id: store.id,
          name: formData.name.trim(),
          phone: formData.phone.trim() || null,
          address: formData.address.trim() || null,
          balance: openBal,
          notes: formData.notes.trim() || null,
        })
        .select('*')
        .single()

      if (insertErr) throw insertErr

      setSuppliers(prev => [...prev, newSupp].sort((a, b) => a.name.localeCompare(b.name)))
      setShowAddModal(false)
      setFormData({
        name: '',
        phone: '',
        address: '',
        opening_balance: '0',
        notes: '',
      })
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'فشل حفظ المورد')
    } finally {
      setLoading(false)
    }
  }

  const filteredSuppliers = suppliers.filter(s => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return s.name.toLowerCase().includes(q) || (s.phone || '').includes(q) || (s.address || '').toLowerCase().includes(q)
  })

  const totalBalanceDue = suppliers.reduce((sum, s) => sum + Number(s.balance || 0), 0)

  return (
    <div className="space-y-6">
      {/* ── Back to Purchases Hub ── */}
      <div>
        <BackToDashboardButton href="/dashboard/purchases-hub" label="العودة إلى لوحة إدارة المشتريات" />
      </div>

      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>👥</span> دليل الموردين والشركات الموردة (Suppliers)
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            إدارة بيانات الموردين، متابعة الأرصدة الدائنة، واستخراج كشوف الحسابات
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/purchases"
            className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
          >
            📦 فواتير المشتريات
          </Link>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-400 transition"
          >
            ➕ إضافة مورد جديد
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">إجمالي مستحقات الموردين (الأرصدة)</p>
          <p className="mt-2 text-2xl font-black text-rose-400 font-mono">
            {totalBalanceDue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}{' '}
            <span className="text-xs text-slate-400">₪</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{suppliers.length} مورد مسجل</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">طرق السداد المتاحة</p>
          <p className="mt-2 text-base font-bold text-emerald-400">نقد / شيكات / سندات صرف</p>
          <p className="mt-1 text-xs text-slate-500">تسوية فورية مع محفظة الشيكات وسندات الصرف</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">الربط المحاسبي</p>
          <p className="mt-2 text-base font-bold text-purple-400">2101 — ذمم الموردين والدائنون</p>
          <p className="mt-1 text-xs text-slate-500">أثر مباشر على ميزان المراجعة وقائمة المركز المالي</p>
        </div>
      </div>

      {/* ── Search & Filter ── */}
      <div className="relative w-full sm:w-80">
        <input
          type="text"
          placeholder="بحث باسم المورد أو رقم الهاتف..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-right text-xs text-white placeholder-slate-500 outline-none focus:border-sky-500"
        />
      </div>

      {/* ── Suppliers Grid ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredSuppliers.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-white/10 bg-slate-900 p-12 text-center text-slate-500">
            <p className="text-4xl mb-3">👥</p>
            <p className="text-base font-bold text-white">لا يوجد موردون مسجلون</p>
            <p className="mt-1 text-xs text-slate-400">أضف الموردين لتسجيل المشتريات ومتابعة الدفعات</p>
          </div>
        ) : (
          filteredSuppliers.map(supplier => (
            <div
              key={supplier.id}
              className="flex flex-col justify-between rounded-2xl border border-white/10 bg-slate-900 p-5 hover:border-sky-500/40 transition shadow-lg"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-white">{supplier.name}</h3>
                    {supplier.phone && <p className="text-xs text-slate-400 mt-0.5" dir="ltr">{supplier.phone}</p>}
                    {supplier.address && <p className="text-[11px] text-slate-500 mt-0.5">{supplier.address}</p>}
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
                    supplier.balance > 0 ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  }`}>
                    {supplier.balance > 0 ? 'مستحق له' : 'خالص'}
                  </span>
                </div>

                <div className="mt-4 border-t border-white/5 pt-3">
                  <p className="text-[11px] text-slate-400">الرصيد المستحق الحالي</p>
                  <p className="mt-1 text-2xl font-black text-white font-mono">
                    {Number(supplier.balance).toLocaleString('en-GB', { minimumFractionDigits: 2 })}{' '}
                    <span className="text-xs text-slate-400">₪</span>
                  </p>
                </div>
              </div>

              <div className="mt-5 flex gap-2 border-t border-white/10 pt-3">
                <Link
                  href={`/dashboard/purchases/new?supplier_id=${supplier.id}`}
                  className="flex-1 rounded-xl bg-sky-500/10 py-2 text-center text-xs font-bold text-sky-400 hover:bg-sky-500/20 transition"
                >
                  ➕ شراء جديد
                </Link>
                <Link
                  href={`/dashboard/suppliers/${supplier.id}/statement/print`}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-slate-300 hover:text-white transition text-xs font-bold flex items-center gap-1"
                >
                  🖨️ كشف الحساب
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Modal: إضافة مورد جديد ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>➕</span> إضافة مورد جديد
            </h2>

            {error && <div className="mt-3 rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">{error}</div>}

            <form onSubmit={handleCreateSupplier} className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">اسم المورد / الشركة الموردة *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="مثال: شركة القدس للتجارة والتوريدات"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">رقم الهاتف / واتساب</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="059xxxxxxx"
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">الرصيد الافتتاحي (دين سابق)</label>
                  <input
                    type="number"
                    step="any"
                    value={formData.opening_balance}
                    onChange={e => setFormData({ ...formData, opening_balance: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">العنوان / المدينة</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={e => setFormData({ ...formData, address: e.target.value })}
                  placeholder="مثال: نابلس — شارع حيفا"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">ملاحظات</label>
                <textarea
                  rows={2}
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-bold text-slate-400 hover:bg-slate-800 transition"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded-xl bg-sky-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-sky-400 transition disabled:opacity-50"
                >
                  {loading ? 'جارٍ الحفظ...' : 'حفظ المورد'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
