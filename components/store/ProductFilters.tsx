'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface AttrValue { id: string; value: string }
interface Attribute { id: string; name: string; values: AttrValue[] }

interface Props {
  attributes: Attribute[]
  selected: string[]
  min: string
  max: string
  basePath: string
  category?: string
  q?: string
  sort?: string
  currencyCode: string
}

export default function ProductFilters({
  attributes, selected, min, max, basePath, category, q, sort, currencyCode,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set(selected))
  const [minV, setMinV] = useState(min)
  const [maxV, setMaxV] = useState(max)

  const activeCount = selected.length + (min ? 1 : 0) + (max ? 1 : 0)
  const hasAnyFilter = attributes.length > 0 || true // price always available

  function toggle(id: string) {
    setSel(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function buildUrl(values: Set<string>, mn: string, mx: string) {
    const p = new URLSearchParams()
    if (category) p.set('category', category)
    if (q) p.set('q', q)
    if (sort) p.set('sort', sort)
    if (values.size) p.set('v', [...values].join(','))
    if (mn) p.set('min', mn)
    if (mx) p.set('max', mx)
    const qs = p.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  function apply() {
    router.push(buildUrl(sel, minV.trim(), maxV.trim()))
    setOpen(false)
  }

  function clearAll() {
    setSel(new Set())
    setMinV('')
    setMaxV('')
    const p = new URLSearchParams()
    if (category) p.set('category', category)
    if (q) p.set('q', q)
    if (sort) p.set('sort', sort)
    const qs = p.toString()
    router.push(qs ? `${basePath}?${qs}` : basePath)
    setOpen(false)
  }

  if (!hasAnyFilter) return null

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
      >
        <span>⚙️ الفلاتر</span>
        {activeCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-900 px-1 text-[11px] font-bold text-white dark:bg-white dark:text-gray-900">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-5 rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
          {/* السعر */}
          <div>
            <p className="mb-2 text-sm font-medium text-gray-900 dark:text-white">السعر ({currencyCode})</p>
            <div className="flex items-center gap-2">
              <input
                value={minV} onChange={e => setMinV(e.target.value)} type="number" min="0" placeholder="من"
                dir="ltr"
                className="w-28 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
              <span className="text-gray-400">—</span>
              <input
                value={maxV} onChange={e => setMaxV(e.target.value)} type="number" min="0" placeholder="إلى"
                dir="ltr"
                className="w-28 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </div>
          </div>

          {/* الخصائص */}
          {attributes.map(attr => (
            <div key={attr.id}>
              <p className="mb-2 text-sm font-medium text-gray-900 dark:text-white">{attr.name}</p>
              <div className="flex flex-wrap gap-2">
                {attr.values.map(v => {
                  const active = sel.has(v.id)
                  return (
                    <button
                      key={v.id}
                      onClick={() => toggle(v.id)}
                      className={`rounded-full px-3 py-1.5 text-sm transition ${
                        active
                          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                          : 'border border-gray-200 bg-white text-gray-700 hover:border-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'
                      }`}
                    >
                      {active && '✓ '}{v.value}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="flex gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
            <button onClick={apply}
              className="flex-1 rounded-xl bg-gray-900 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-gray-900">
              تطبيق الفلاتر
            </button>
            {activeCount > 0 && (
              <button onClick={clearAll}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                مسح
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
