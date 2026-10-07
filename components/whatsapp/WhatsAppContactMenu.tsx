'use client'

import React, { useState, useEffect, useRef } from 'react'
import { extractNationalDigits, buildWhatsAppLink, WhatsAppPrefix } from '@/lib/whatsapp/phone'

export interface WhatsAppContactMenuProps {
  phone: string | null | undefined
  customerName?: string | null
  customerId?: string | null
  defaultPrefix?: WhatsAppPrefix | null
  message?: string
  label?: string
  variant?: 'button' | 'compact' | 'icon' | 'chips'
  className?: string
  buttonClassName?: string
  onOpened?: (prefix: WhatsAppPrefix) => void
}

export default function WhatsAppContactMenu({
  phone,
  customerName,
  customerId,
  defaultPrefix,
  message,
  label = 'واتساب',
  variant = 'button',
  className = '',
  buttonClassName = '',
  onOpened,
}: WhatsAppContactMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activePrefix, setActivePrefix] = useState<WhatsAppPrefix>('972')
  const [hasExplicitPreference, setHasExplicitPreference] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const cleanPhone = extractNationalDigits(phone)
  const storageKey = cleanPhone ? `bazarko_wa_pref_${cleanPhone}` : null

  // 1. Initialize preference from DB prop or localStorage
  useEffect(() => {
    if (defaultPrefix === '972' || defaultPrefix === '970') {
      setActivePrefix(defaultPrefix)
      setHasExplicitPreference(true)
      return
    }

    if (typeof window !== 'undefined' && storageKey) {
      const stored = localStorage.getItem(storageKey)
      if (stored === '972' || stored === '970') {
        setActivePrefix(stored as WhatsAppPrefix)
        setHasExplicitPreference(true)
      }
    }
  }, [defaultPrefix, storageKey])

  // 2. Listen to custom broadcast events for cross-component sync
  useEffect(() => {
    const handleSync = (e: Event) => {
      const custom = e as CustomEvent<{ phone: string; prefix: WhatsAppPrefix }>
      if (custom.detail && custom.detail.phone === cleanPhone) {
        setActivePrefix(custom.detail.prefix)
        setHasExplicitPreference(true)
      }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('bazarko-whatsapp-pref-change', handleSync)
      return () => window.removeEventListener('bazarko-whatsapp-pref-change', handleSync)
    }
  }, [cleanPhone])

  // 3. Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Action: Open WhatsApp with chosen prefix and save preference
  const handleSelectPrefix = (prefix: WhatsAppPrefix, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    setIsOpen(false)

    if (!cleanPhone) {
      // If no phone, just open WhatsApp with message if provided
      if (message) {
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`, '_blank')
      }
      return
    }

    // 1. Update state
    setActivePrefix(prefix)
    setHasExplicitPreference(true)

    // 2. Save to localStorage
    if (typeof window !== 'undefined' && storageKey) {
      localStorage.setItem(storageKey, prefix)
      window.dispatchEvent(
        new CustomEvent('bazarko-whatsapp-pref-change', {
          detail: { phone: cleanPhone, prefix },
        })
      )
    }

    // 3. Persist to database in background
    fetch('/api/whatsapp/preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: cleanPhone,
        customerId: customerId || undefined,
        prefix,
      }),
    }).catch(err => console.warn('Failed saving WhatsApp preference:', err))

    // 4. Open WhatsApp URL
    const url = buildWhatsAppLink(phone, prefix, message)
    window.open(url, '_blank')
    if (onOpened) onOpened(prefix)
  }

  if (!phone && !message) return null

  // Variant: Side-by-side chips
  if (variant === 'chips') {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`} dir="ltr">
        <button
          type="button"
          onClick={e => handleSelectPrefix('972', e)}
          title="محادثة عبر المقدمة +972 (الأكثر انتشاراً)"
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition shadow-xs ${
            activePrefix === '972' && hasExplicitPreference
              ? 'bg-emerald-500 text-slate-950 ring-1 ring-emerald-300 font-black'
              : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30'
          } ${buttonClassName}`}
        >
          <span>💬</span>
          <span>+972</span>
          {activePrefix === '972' && hasExplicitPreference && <span title="المعتمد الأخير">⭐</span>}
        </button>

        <button
          type="button"
          onClick={e => handleSelectPrefix('970', e)}
          title="محادثة عبر المقدمة الفلسطينية +970"
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition shadow-xs ${
            activePrefix === '970' && hasExplicitPreference
              ? 'bg-emerald-500 text-slate-950 ring-1 ring-emerald-300 font-black'
              : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30'
          } ${buttonClassName}`}
        >
          <span>💬</span>
          <span>+970</span>
          {activePrefix === '970' && hasExplicitPreference && <span title="المعتمد الأخير">⭐</span>}
        </button>
      </div>
    )
  }

  // Variant: Standard button or compact with popover dropdown
  return (
    <div className={`relative inline-block text-right ${className}`} ref={menuRef}>
      {variant === 'compact' ? (
        <button
          type="button"
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
            setIsOpen(prev => !prev)
          }}
          title={`تواصل عبر واتساب (+${activePrefix})`}
          className={`inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-1 text-xs font-bold text-emerald-400 transition shadow-xs ${buttonClassName}`}
        >
          <span>💬</span>
          <span className="font-mono text-[11px]">+{activePrefix}</span>
          <span className="text-[9px] opacity-70">▼</span>
        </button>
      ) : variant === 'icon' ? (
        <button
          type="button"
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
            setIsOpen(prev => !prev)
          }}
          title={`تواصل عبر واتساب (+${activePrefix})`}
          className={`inline-flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 transition shadow-xs ${buttonClassName}`}
        >
          <span className="text-sm">💬</span>
        </button>
      ) : (
        <div className="inline-flex rounded-xl shadow-xs overflow-hidden border border-emerald-500/30">
          <button
            type="button"
            onClick={e => handleSelectPrefix(activePrefix, e)}
            title={`إرسال واتساب مباشرة بالمقدمة المعتمدة (+${activePrefix})`}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition ${
              hasExplicitPreference
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300'
            } ${buttonClassName}`}
          >
            <span>💬</span>
            <span>{label}</span>
            <span className="font-mono text-[11px] opacity-90 dir-ltr" dir="ltr">(+{activePrefix})</span>
            {hasExplicitPreference && <span title="المقدمة المعتمدة لآخر مرة" className="text-[10px]">⭐</span>}
          </button>
          <button
            type="button"
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              setIsOpen(prev => !prev)
            }}
            title="اختيار مقدمة الاتصال (+972 أو +970)"
            className="px-2 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border-r border-emerald-500/30 flex items-center justify-center text-[10px] transition"
          >
            ▼
          </button>
        </div>
      )}

      {/* Popover Dropdown */}
      {isOpen && (
        <div
          className="absolute z-50 mt-1.5 min-w-[240px] w-max max-w-xs rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur-md p-2.5 shadow-2xl space-y-1.5 text-right font-sans select-none animate-in fade-in zoom-in-95 duration-100"
          style={{ right: 0 }}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-2 py-1 border-b border-white/10 pb-1.5">
            <p className="text-[11px] font-bold text-slate-300">خيارات الاتصال عبر واتساب</p>
            {phone && (
              <p className="font-mono text-[11px] text-sky-400 dir-ltr mt-0.5" dir="ltr">
                {phone}
              </p>
            )}
            {customerName && <p className="text-[10px] text-slate-400 truncate mt-0.5">{customerName}</p>}
          </div>

          <div className="space-y-1 pt-1">
            {/* Option 1: +972 */}
            <button
              type="button"
              onClick={e => handleSelectPrefix('972', e)}
              className={`w-full flex items-center justify-between p-2 rounded-lg text-xs font-bold transition text-right ${
                activePrefix === '972' && hasExplicitPreference
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'hover:bg-slate-800 text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">🇮🇱</span>
                <div>
                  <span className="font-mono font-bold text-white text-xs dir-ltr" dir="ltr">+972</span>
                  <p className="text-[10px] text-slate-400">الأكثر انتشاراً في فلسطين</p>
                </div>
              </div>
              {activePrefix === '972' && hasExplicitPreference ? (
                <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-500/30 text-emerald-300 px-1.5 py-0.5 rounded-md font-bold">
                  <span>✓</span> المعتمد الأخير
                </span>
              ) : (
                <span className="text-[10px] text-slate-500 hover:text-slate-300">محادثة</span>
              )}
            </button>

            {/* Option 2: +970 */}
            <button
              type="button"
              onClick={e => handleSelectPrefix('970', e)}
              className={`w-full flex items-center justify-between p-2 rounded-lg text-xs font-bold transition text-right ${
                activePrefix === '970' && hasExplicitPreference
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'hover:bg-slate-800 text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">🇵🇸</span>
                <div>
                  <span className="font-mono font-bold text-white text-xs dir-ltr" dir="ltr">+970</span>
                  <p className="text-[10px] text-slate-400">المقدمة الفلسطينية الرسمية</p>
                </div>
              </div>
              {activePrefix === '970' && hasExplicitPreference ? (
                <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-500/30 text-emerald-300 px-1.5 py-0.5 rounded-md font-bold">
                  <span>✓</span> المعتمد الأخير
                </span>
              ) : (
                <span className="text-[10px] text-slate-500 hover:text-slate-300">محادثة</span>
              )}
            </button>
          </div>

          <p className="px-2 pt-1 text-[9px] text-slate-400 leading-tight border-t border-white/5">
            💡 يتم تثبيت المقدمة التي تختارها تلقائياً لتظهر لجميع المستخدمين في المرات القادمة.
          </p>
        </div>
      )}
    </div>
  )
}
