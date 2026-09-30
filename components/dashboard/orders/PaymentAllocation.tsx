'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface SalePayment {
  method: 'cash' | 'bank_transfer' | 'check'
  amount: number
  cashBoxId?: string
  bankAccountId?: string
  confirmed?: boolean
  check?: { check_number: string; bank_name: string; due_date: string }
}

export default function PaymentAllocation({ storeId, total, value, onChange }: {
  storeId: string; total: number; value: SalePayment[] | null; onChange: (value: SalePayment[] | null) => void
}) {
  const [boxes, setBoxes] = useState<{ id: string; name: string }[]>([])
  const [banks, setBanks] = useState<{ id: string; bank_name: string; account_number: string }[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const client = createClient()
    Promise.all([
      client.from('cash_boxes').select('id,name').eq('store_id', storeId).eq('is_active', true),
      client.from('bank_accounts').select('id,bank_name,account_number').eq('store_id', storeId).eq('is_active', true),
    ]).then(([cash, bank]) => {
      if (!active) return
      if (cash.error || bank.error) { setError('تعذر تحميل الصناديق والبنوك'); return }
      setBoxes(cash.data || []); setBanks(bank.data || [])
    })
    return () => { active = false }
  }, [storeId])
  const update = (index: number, patch: Partial<SalePayment>) => onChange(value!.map((row, i) => i === index ? { ...row, ...patch } : row))
  const field = 'w-full rounded border border-white/10 bg-slate-950 p-2 text-xs text-white'
  return <div className="space-y-3 rounded-xl border border-white/10 p-3">
    <label className="flex gap-2 text-xs text-white"><input type="checkbox" checked={value !== null}
      onChange={e => onChange(e.target.checked ? [{ method: 'cash', amount: total }] : null)} />توزيع التسديد: نقد، بنك، شيكات أو آجل</label>
    {error && <p className="text-xs text-red-400">{error}</p>}
    {value !== null && <>
      <p className="text-xs text-slate-400">المتبقي يسجل على العميل المحدد. احذف جميع الدفعات للبيع الآجل بالكامل.</p>
      {value.map((payment, index) => <div className="space-y-2 border-t border-white/10 pt-2" key={index}>
        <select aria-label="وسيلة الدفع" className={field} value={payment.method}
          onChange={e => update(index, { method: e.target.value as SalePayment['method'], confirmed: false })}>
          <option value="cash">نقد</option><option value="bank_transfer">تحويل بنكي مؤكد</option><option value="check">شيك مقبوض</option>
        </select>
        <input aria-label="مبلغ الدفعة" className={field} type="number" min="0.01" step="0.01" value={payment.amount}
          onChange={e => update(index, { amount: Number(e.target.value) })} />
        {payment.method === 'cash' && <select aria-label="الصندوق" className={field} value={payment.cashBoxId || ''} onChange={e => update(index, { cashBoxId: e.target.value })}>
          <option value="">الصندوق الافتراضي المعتمد</option>{boxes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>}
        {payment.method === 'bank_transfer' && <>
          <select aria-label="الحساب البنكي" required className={field} value={payment.bankAccountId || ''} onChange={e => update(index, { bankAccountId: e.target.value })}>
            <option value="">اختر البنك</option>{banks.map(b => <option key={b.id} value={b.id}>{b.bank_name} — {b.account_number}</option>)}
          </select>
          <label className="text-xs text-slate-300"><input type="checkbox" checked={!!payment.confirmed} onChange={e => update(index, { confirmed: e.target.checked })} /> تحققت من وصول التحويل</label>
        </>}
        {payment.method === 'check' && (['check_number', 'bank_name', 'due_date'] as const).map(key => <input key={key}
          aria-label={key === 'check_number' ? 'رقم الشيك' : key === 'bank_name' ? 'بنك الشيك' : 'تاريخ الاستحقاق'} required
          placeholder={key === 'check_number' ? 'رقم الشيك' : 'اسم البنك'} type={key === 'due_date' ? 'date' : 'text'} className={field}
          value={payment.check?.[key] || ''} onChange={e => update(index, { check: { check_number: '', bank_name: '', due_date: '', ...payment.check, [key]: e.target.value } })} />)}
        <button type="button" className="text-xs text-red-400" onClick={() => onChange(value.filter((_, i) => i !== index))}>حذف الدفعة</button>
      </div>)}
      <button type="button" className="text-xs text-sky-400" onClick={() => onChange([...value, { method: 'cash', amount: Math.max(0, total - value.reduce((n, p) => n + p.amount, 0)) }])}>إضافة دفعة</button>
    </>}
  </div>
}
