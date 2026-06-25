'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface AttrValue { id: string; attribute_id: string; value: string; sort_order: number }
interface Attribute { id: string; name: string; sort_order: number; values: AttrValue[] }

export default function AttributesManager({ storeId, attributes }: { storeId: string; attributes: Attribute[] }) {
  const router = useRouter()
  const supabase = createClient()
  const [newAttr, setNewAttr] = useState('')
  const [busy, setBusy] = useState(false)
  const [valueInputs, setValueInputs] = useState<Record<string, string>>({})

  async function addAttribute(e: React.FormEvent) {
    e.preventDefault()
    const name = newAttr.trim()
    if (!name) return
    setBusy(true)
    await supabase.from('product_attributes').insert({
      store_id: storeId, name, sort_order: attributes.length,
    })
    setNewAttr('')
    setBusy(false)
    router.refresh()
  }

  async function deleteAttribute(id: string) {
    if (!confirm('حذف هذه الخاصية وكل قيمها وإسناداتها؟')) return
    setBusy(true)
    await supabase.from('product_attributes').delete().eq('id', id)
    setBusy(false)
    router.refresh()
  }

  async function addValue(attr: Attribute) {
    const value = (valueInputs[attr.id] ?? '').trim()
    if (!value) return
    setBusy(true)
    await supabase.from('product_attribute_values').insert({
      attribute_id: attr.id, store_id: storeId, value, sort_order: attr.values.length,
    })
    setValueInputs(v => ({ ...v, [attr.id]: '' }))
    setBusy(false)
    router.refresh()
  }

  async function deleteValue(id: string) {
    setBusy(true)
    await supabase.from('product_attribute_values').delete().eq('id', id)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="max-w-2xl space-y-5">
      {/* إضافة خاصية */}
      <form onSubmit={addAttribute} className="flex gap-2 rounded-2xl border border-white/5 bg-slate-900 p-4">
        <input
          value={newAttr}
          onChange={e => setNewAttr(e.target.value)}
          placeholder="اسم خاصية جديدة — مثل: اللون"
          className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
        />
        <button type="submit" disabled={busy || !newAttr.trim()}
          className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
          + إضافة
        </button>
      </form>

      {attributes.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-slate-900 py-12 text-center text-slate-500">
          لا توجد خصائص بعد — أضف أول خاصية (مثل: اللون أو المادة)
        </div>
      ) : (
        attributes.map(attr => (
          <div key={attr.id} className="rounded-2xl border border-white/5 bg-slate-900 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-white">{attr.name}</h3>
              <button onClick={() => deleteAttribute(attr.id)} disabled={busy}
                className="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                حذف الخاصية
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {attr.values.map(v => (
                <span key={v.id} className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-sm text-slate-200">
                  {v.value}
                  <button onClick={() => deleteValue(v.id)} disabled={busy}
                    className="text-slate-500 hover:text-red-400" aria-label="حذف">✕</button>
                </span>
              ))}
              {attr.values.length === 0 && (
                <span className="text-xs text-slate-600">لا قيم بعد</span>
              )}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={valueInputs[attr.id] ?? ''}
                onChange={e => setValueInputs(v => ({ ...v, [attr.id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addValue(attr) } }}
                placeholder="أضف قيمة — مثل: خشب"
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
              />
              <button onClick={() => addValue(attr)} disabled={busy || !(valueInputs[attr.id] ?? '').trim()}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50">
                + قيمة
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
