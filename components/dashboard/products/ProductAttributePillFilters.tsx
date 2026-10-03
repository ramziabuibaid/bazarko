'use client'

import { useMemo, useState, useRef, useLayoutEffect, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { DirectoryProduct as Product } from '@/lib/products/directory'

export type ProductAttributeFilters = {
  type: string | null
  brand: string | null
  size: string | null
  color: string | null
}

type AttributeKey = keyof ProductAttributeFilters

const LABELS: Record<AttributeKey, string> = {
  type: 'النوع',
  brand: 'العلامة التجارية',
  size: 'الحجم',
  color: 'اللون',
}

const KEYS_ORDER: AttributeKey[] = ['type', 'brand', 'size', 'color']
const SEARCHABLE_KEYS = new Set<AttributeKey>(['type', 'brand'])

export function getProductSpecValue(p: Product, keyName: string): string {
  if (Array.isArray(p.specifications)) {
    const found = p.specifications.find(
      s => s && s.key && s.key.trim().toLowerCase() === keyName.toLowerCase()
    )
    if (found && found.value) return String(found.value).trim()
  }
  return ''
}

export function getProductType(p: Product): string {
  const fromSpec = getProductSpecValue(p, 'النوع')
  if (fromSpec) return fromSpec
  return p.categories?.name?.trim() || ''
}

export function getProductBrand(p: Product): string {
  const fromSpec = getProductSpecValue(p, 'العلامة التجارية')
  if (fromSpec) return fromSpec
  return p.brands?.name?.trim() || ''
}

export function getProductSize(p: Product): string {
  return getProductSpecValue(p, 'الحجم')
}

export function getProductColor(p: Product): string {
  return getProductSpecValue(p, 'اللون')
}

function getAttrValue(p: Product, key: AttributeKey): string {
  switch (key) {
    case 'type':
      return getProductType(p)
    case 'brand':
      return getProductBrand(p)
    case 'size':
      return getProductSize(p)
    case 'color':
      return getProductColor(p)
  }
}

/**
 * فلترة المنتجات ضمن النطاق الخاص بالحقل (تضييق الخيارات ديناميكياً)
 */
function productsInScopeForKey(all: Product[], key: AttributeKey, f: ProductAttributeFilters): Product[] {
  return all.filter(p => {
    if (key !== 'type' && f.type && getProductType(p) !== f.type) return false
    if (key !== 'brand' && f.brand && getProductBrand(p) !== f.brand) return false
    if (key !== 'size' && f.size && getProductSize(p) !== f.size) return false
    if (key !== 'color' && f.color && getProductColor(p) !== f.color) return false
    return true
  })
}

function collectUniqueScoped(
  scoped: Product[],
  read: (p: Product) => string,
  selectedForThisKey: string | null
): string[] {
  const set = new Set<string>()
  for (const p of scoped) {
    const v = read(p).trim()
    if (v) set.add(v)
  }
  const arr = [...set].sort((a, b) => a.localeCompare(b, 'ar', { sensitivity: 'base' }))
  if (selectedForThisKey && !arr.includes(selectedForThisKey)) {
    return [...arr, selectedForThisKey].sort((a, b) => a.localeCompare(b, 'ar', { sensitivity: 'base' }))
  }
  return arr
}

function optionMatchesQuery(option: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return option.toLowerCase().includes(q)
}

type MenuPos = { top: number; right: number; minWidth: number }
type OpenMenuState = { key: AttributeKey; pos: MenuPos }

function measureTrigger(el: HTMLButtonElement): MenuPos {
  const r = el.getBoundingClientRect()
  return {
    top: r.bottom + 6,
    right: window.innerWidth - r.right,
    minWidth: Math.max(200, r.width),
  }
}

interface Props {
  products: Product[]
  filters: ProductAttributeFilters
  onChange: (next: ProductAttributeFilters) => void
}

export default function ProductAttributePillFilters({ products, filters, onChange }: Props) {
  const [openMenu, setOpenMenu] = useState<OpenMenuState | null>(null)
  const [listSearch, setListSearch] = useState('')
  const [mounted, setMounted] = useState(false)
  const triggerRefs = useRef<Partial<Record<AttributeKey, HTMLButtonElement | null>>>({})
  const listSearchInputRef = useRef<HTMLInputElement>(null)

  const options = useMemo(
    () => ({
      type: collectUniqueScoped(productsInScopeForKey(products, 'type', filters), getProductType, filters.type),
      brand: collectUniqueScoped(productsInScopeForKey(products, 'brand', filters), getProductBrand, filters.brand),
      size: collectUniqueScoped(productsInScopeForKey(products, 'size', filters), getProductSize, filters.size),
      color: collectUniqueScoped(productsInScopeForKey(products, 'color', filters), getProductColor, filters.color),
    }),
    [products, filters.type, filters.brand, filters.size, filters.color]
  )

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setListSearch('')
  }, [openMenu?.key])

  const repositionOpenMenu = useCallback(() => {
    setOpenMenu(prev => {
      if (!prev) return prev
      const el = triggerRefs.current[prev.key]
      if (!el) return prev
      return { key: prev.key, pos: measureTrigger(el) }
    })
  }, [])

  useLayoutEffect(() => {
    if (!openMenu) return
    repositionOpenMenu()
    window.addEventListener('scroll', repositionOpenMenu, true)
    window.addEventListener('resize', repositionOpenMenu)
    return () => {
      window.removeEventListener('scroll', repositionOpenMenu, true)
      window.removeEventListener('resize', repositionOpenMenu)
    }
  }, [openMenu?.key, repositionOpenMenu])

  useLayoutEffect(() => {
    if (openMenu && SEARCHABLE_KEYS.has(openMenu.key)) {
      listSearchInputRef.current?.focus()
    }
  }, [openMenu?.key])

  const hasActive = !!(filters.type || filters.brand || filters.size || filters.color)

  const setField = useCallback(
    (key: AttributeKey, value: string | null) => {
      onChange({ ...filters, [key]: value })
      setOpenMenu(null)
    },
    [filters, onChange]
  )

  const clearAll = useCallback(() => {
    onChange({ type: null, size: null, brand: null, color: null })
    setOpenMenu(null)
  }, [onChange])

  const openOpts = openMenu ? options[openMenu.key] : []
  const openValue = openMenu ? filters[openMenu.key] : null
  const isSearchableOpen = openMenu ? SEARCHABLE_KEYS.has(openMenu.key) : false

  const filteredOpts = useMemo(() => {
    if (!openMenu) return []
    if (!SEARCHABLE_KEYS.has(openMenu.key)) return openOpts
    return openOpts.filter(o => optionMatchesQuery(o, listSearch))
  }, [openMenu, openOpts, listSearch])

  const portal =
    mounted && openMenu && typeof document !== 'undefined'
      ? createPortal(
          <>
            <div className="fixed inset-0 z-[220] bg-transparent" aria-hidden onClick={() => setOpenMenu(null)} />
            <div
              role="listbox"
              dir="rtl"
              className="fixed z-[230] flex max-h-[min(22rem,calc(100vh-6rem))] min-w-[200px] max-w-[min(100vw-1.5rem,320px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl backdrop-blur-md"
              style={{
                top: openMenu.pos.top,
                right: openMenu.pos.right,
                minWidth: Math.max(openMenu.pos.minWidth, isSearchableOpen ? 260 : 200),
              }}
              onClick={e => e.stopPropagation()}
            >
              {isSearchableOpen ? (
                <div className="shrink-0 border-b border-white/10 bg-slate-900/90 p-2.5">
                  <div className="relative">
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                      🔍
                    </span>
                    <input
                      ref={listSearchInputRef}
                      type="search"
                      value={listSearch}
                      onChange={e => setListSearch(e.target.value)}
                      placeholder="ابحث في القائمة..."
                      className="w-full rounded-xl border border-white/10 bg-slate-950 py-2 pr-8 pl-3 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                      dir="rtl"
                      autoComplete="off"
                      onKeyDown={e => e.stopPropagation()}
                    />
                  </div>
                </div>
              ) : null}
              <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
                {openOpts.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-slate-400">لا توجد قيم في القائمة</div>
                ) : filteredOpts.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-slate-400">لا توجد نتائج للبحث</div>
                ) : (
                  <ul className="py-0 space-y-0.5 px-1">
                    {filteredOpts.map(opt => (
                      <li key={opt}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={openValue === opt}
                          onClick={() => openMenu && setField(openMenu.key, opt)}
                          className={`flex w-full items-center justify-between px-3 py-2 text-right text-sm rounded-xl transition-colors ${
                            openValue === opt
                              ? 'bg-sky-500/20 font-bold text-sky-300'
                              : 'text-slate-200 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <span className="truncate" title={opt}>
                            {opt}
                          </span>
                          {openValue === opt && <span className="text-xs text-sky-400 mr-2">✓</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>,
          document.body
        )
      : null

  return (
    <div className="w-full min-w-0" dir="rtl">
      {portal}
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5">
          {KEYS_ORDER.map(key => {
            const value = filters[key]
            const isOpen = openMenu?.key === key
            const label = LABELS[key]

            return (
              <div key={key} className="relative shrink-0">
                <div
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs sm:text-sm font-medium transition-all ${
                    value
                      ? 'border-sky-500/40 bg-sky-500/15 text-sky-300 shadow-sm'
                      : 'border-white/10 bg-slate-900/80 text-slate-300 hover:border-white/20 hover:bg-slate-900 hover:text-white'
                  }`}
                >
                  <button
                    ref={el => {
                      triggerRefs.current[key] = el
                    }}
                    type="button"
                    onClick={() => {
                      if (isOpen) {
                        setOpenMenu(null)
                        return
                      }
                      if (typeof window === 'undefined') return
                      const el = triggerRefs.current[key]
                      if (!el) return
                      setOpenMenu({ key, pos: measureTrigger(el) })
                    }}
                    className="inline-flex max-w-[220px] items-center gap-1.5"
                  >
                    <span className="whitespace-nowrap">{label}</span>
                    {value ? (
                      <>
                        <span className="text-slate-500">|</span>
                        <span className="truncate font-bold text-sky-200" title={value}>
                          {value}
                        </span>
                      </>
                    ) : (
                      <span className="opacity-60 text-xs">＋</span>
                    )}
                  </button>
                  {value ? (
                    <button
                      type="button"
                      onClick={() => setField(key, null)}
                      className="shrink-0 rounded-full p-0.5 hover:bg-sky-500/30 text-sky-400 hover:text-sky-200 transition-colors"
                      aria-label={`إزالة تصفية ${label}`}
                      title={`إزالة تصفية ${label}`}
                    >
                      <span className="text-xs font-bold leading-none">✕</span>
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>

        {hasActive ? (
          <button
            type="button"
            onClick={clearAll}
            className="shrink-0 text-xs font-medium text-sky-400 hover:text-sky-300 hover:underline px-2 py-1"
          >
            مسح التصفية
          </button>
        ) : null}
      </div>
    </div>
  )
}
