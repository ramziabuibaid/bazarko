'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface Props {
  storeId: string
  primaryCode: string
  secondaryCode: string
  rate: number | null
}

export default function ExchangeRateWidget({ storeId, primaryCode, secondaryCode, rate }: Props) {
  const router = useRouter()
  const [editing, setEditing]   = useState(false)
  const [input, setInput]       = useState(rate ? String(rate) : '')
  const [saving, setSaving]     = useState(false)

  // نعرض الاتجاه الذي يعطي رقماً >= 1
  function displayRate(r: number) {
    const [from, to, val] = r >= 1
      ? [primaryCode, secondaryCode, r]
      : [secondaryCode, primaryCode, 1 / r]
    const formatted = val >= 1000
      ? val.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 0 })
      : val.toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return `1 ${from} = ${formatted} ${to}`
  }

  async function save() {
    const val = parseFloat(input)
    if (!val || val <= 0) return
    setSaving(true)
    await createClient().from('stores').update({ exchange_rate: val }).eq('id', storeId)
    setSaving(false)
    setEditing(false)
    router.refresh()
  }

  return (
    <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-xl leading-none">💱</span>
          <div>
            <p className="text-xs text-slate-400">سعر الصرف — {primaryCode} / {secondaryCode}</p>
            {rate ? (
              <p className="mt-0.5 text-sm font-bold text-amber-300" dir="ltr">{displayRate(rate)}</p>
            ) : (
              <p className="mt-0.5 text-xs text-slate-500">لم يُحدَّد بعد</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            onClick={() => { setEditing(e => !e); setInput(rate ? String(rate) : '') }}
            className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20 transition-colors"
          >
            {editing ? 'إلغاء' : 'تحديث'}
          </button>
          <Link
            href="/dashboard/settings#currency"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            إعدادات
          </Link>
        </div>
      </div>

      {editing && (
        <div className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
              1 {primaryCode} =
            </span>
            <input
              type="number"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()}
              placeholder="0"
              step="any"
              min="0"
              dir="ltr"
              className="w-full rounded-xl border border-amber-500/30 bg-slate-900 py-2.5 pl-3 pr-20 text-sm text-white placeholder-slate-600 outline-none focus:border-amber-400/60"
            />
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-amber-400">
              {secondaryCode}
            </span>
          </div>
          <button
            onClick={save}
            disabled={saving || !input || parseFloat(input) <= 0}
            className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-40 transition-colors"
          >
            {saving ? '...' : 'حفظ'}
          </button>
        </div>
      )}
    </div>
  )
}
