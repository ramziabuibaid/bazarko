'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Customer {
  id: string
  name: string
  phone: string | null
  email: string | null
  city: string | null
  balance: number
  total_orders: number
  customer_type: string
  is_active: boolean
  created_at: string
}

interface Props {
  customers: Customer[]
  currencyCode: string
  storeId: string
  activeType: string
  searchQuery: string
  sort: string
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  retail:    { label: 'تجزئة',   color: 'bg-slate-500/15 text-slate-400' },
  wholesale: { label: 'جملة',    color: 'bg-blue-500/15 text-blue-400' },
  vip:       { label: 'VIP',     color: 'bg-amber-500/15 text-amber-400' },
}

const TYPE_TABS = [
  { key: 'all',       label: 'الكل' },
  { key: 'retail',    label: 'تجزئة' },
  { key: 'wholesale', label: 'جملة' },
  { key: 'vip',       label: 'VIP' },
]

export default function CustomersTable({ customers, currencyCode, storeId, activeType, searchQuery, sort }: Props) {
  const router = useRouter()
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '', phone: '', email: '', city: '', address: '',
    customer_type: 'retail', notes: '', credit_limit: '0',
  })

  function buildUrl(params: Record<string, string>) {
    const sp = new URLSearchParams()
    if (activeType !== 'all') sp.set('type', activeType)
    if (searchQuery) sp.set('q', searchQuery)
    if (sort !== 'created_at') sp.set('sort', sort)
    for (const [k, v] of Object.entries(params)) {
      if (v && v !== 'all' && v !== 'created_at') sp.set(k, v)
      else sp.delete(k)
    }
    const s = sp.toString()
    return `/dashboard/customers${s ? `?${s}` : ''}`
  }

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value
    router.push(buildUrl({ q }))
  }

  async function addCustomer(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase.from('customers').insert({
      store_id: storeId,
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      city: form.city.trim() || null,
      address: form.address.trim() || null,
      customer_type: form.customer_type,
      notes: form.notes.trim() || null,
      credit_limit: parseFloat(form.credit_limit) || 0,
    })
    setSaving(false)
    if (!error) {
      setShowAdd(false)
      setForm({ name: '', phone: '', email: '', city: '', address: '', customer_type: 'retail', notes: '', credit_limit: '0' })
      router.refresh()
    }
  }

  return (
    <div className="space-y-3">
      {/* صف البحث وزر الإضافة */}
      <div className="flex gap-2">
        <form onSubmit={handleSearch} className="flex flex-1 gap-2">
          <input
            name="q"
            defaultValue={searchQuery}
            placeholder="ابحث بالاسم أو الهاتف..."
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
          />
          <button
            type="submit"
            className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
          >
            بحث
          </button>
        </form>
        <button
          onClick={() => setShowAdd(true)}
          className="shrink-0 flex items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm font-medium text-sky-400 hover:bg-sky-500/20 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          <span className="hidden sm:inline">زبون جديد</span>
          <span className="sm:hidden">جديد</span>
        </button>
      </div>

      {/* صف الفلاتر والترتيب */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 overflow-x-auto">
          {TYPE_TABS.map(tab => (
            <Link
              key={tab.key}
              href={buildUrl({ type: tab.key })}
              className={`shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                activeType === tab.key
                  ? 'bg-sky-500/15 text-sky-400'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
        <select
          value={sort}
          onChange={e => router.push(buildUrl({ sort: e.target.value }))}
          className="shrink-0 rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-300 outline-none"
        >
          <option value="created_at">الأحدث</option>
          <option value="balance">الأعلى ذمة</option>
          <option value="orders">الأكثر طلبيات</option>
        </select>
      </div>

      {/* الجدول */}
      {customers.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-white/3 py-16 text-center">
          <p className="text-4xl">👥</p>
          <p className="mt-3 text-slate-400">لا يوجد زبائن</p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-4 rounded-xl bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500"
          >
            أضف أول زبون
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/5">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 bg-white/3">
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الزبون</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الهاتف</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">النوع</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الطلبيات</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الذمة</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {customers.map(c => {
                const t = TYPE_LABELS[c.customer_type] ?? TYPE_LABELS.retail
                return (
                  <tr key={c.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{c.name}</p>
                      {c.city && <p className="text-xs text-slate-500">{c.city}</p>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300" dir="ltr">{c.phone ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${t.color}`}>
                        {t.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">{c.total_orders}</td>
                    <td className="px-4 py-3">
                      {c.balance > 0 ? (
                        <span className="text-sm font-semibold text-red-400" dir="ltr">
                          {c.balance.toLocaleString('ar')} {currencyCode}
                        </span>
                      ) : (
                        <span className="text-sm text-emerald-400">✓ مسدد</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/customers/${c.id}`}
                        className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
                      >
                        الملف
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal إضافة زبون */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="mb-5 text-lg font-semibold text-white">زبون جديد</h2>
            <form onSubmit={addCustomer} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-slate-400">الاسم *</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    required
                    placeholder="اسم الزبون"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">الهاتف</label>
                  <input
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="0591234567"
                    dir="ltr"
                    type="tel"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">المدينة</label>
                  <input
                    value={form.city}
                    onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    placeholder="رام الله"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">البريد الإلكتروني</label>
                  <input
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="email@example.com"
                    dir="ltr"
                    type="email"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">نوع الزبون</label>
                  <select
                    value={form.customer_type}
                    onChange={e => setForm(f => ({ ...f, customer_type: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none"
                  >
                    <option value="retail">تجزئة</option>
                    <option value="wholesale">جملة</option>
                    <option value="vip">VIP</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">حد الائتمان</label>
                  <input
                    value={form.credit_limit}
                    onChange={e => setForm(f => ({ ...f, credit_limit: e.target.value }))}
                    type="number"
                    min="0"
                    dir="ltr"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50"
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-slate-400">ملاحظات</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400 hover:text-white"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  {saving ? 'جاري الحفظ...' : 'إضافة الزبون'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
