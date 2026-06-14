'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

interface Props {
  images: string[]
  name: string
}

export default function ProductImageGallery({ images, name }: Props) {
  const [current, setCurrent]       = useState(0)
  const [lightbox, setLightbox]     = useState(false)
  const [zoom, setZoom]             = useState(false)
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 })
  const [panOffset, setPanOffset]   = useState({ x: 0, y: 0 })

  // ─── swipe state ────────────────────────────────────────────
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const panStart    = useRef<{ x: number; y: number } | null>(null)
  const isDragging  = useRef(false)
  const lastTap     = useRef(0)

  const total = images.length

  const prev = useCallback(() => {
    setZoom(false); setPanOffset({ x: 0, y: 0 })
    setCurrent(c => (c - 1 + total) % total)
  }, [total])

  const next = useCallback(() => {
    setZoom(false); setPanOffset({ x: 0, y: 0 })
    setCurrent(c => (c + 1) % total)
  }, [total])

  const openLightbox = (idx: number) => {
    setCurrent(idx); setZoom(false); setPanOffset({ x: 0, y: 0 })
    setLightbox(true)
  }

  const closeLightbox = () => {
    setLightbox(false); setZoom(false); setPanOffset({ x: 0, y: 0 })
  }

  // إغلاق بـ Esc وتنقل بالأسهم
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox()
      if (e.key === 'ArrowLeft')  next()
      if (e.key === 'ArrowRight') prev()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [lightbox, next, prev])

  // ─── swipe handlers (gallery + lightbox) ────────────────────
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    isDragging.current  = false
    if (zoom) panStart.current = { x: e.touches[0].clientX - panOffset.x, y: e.touches[0].clientY - panOffset.y }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (zoom && panStart.current) {
      setPanOffset({
        x: e.touches[0].clientX - panStart.current.x,
        y: e.touches[0].clientY - panStart.current.y,
      })
      isDragging.current = true
      return
    }
    if (touchStartX.current === null || touchStartY.current === null) return
    const dx = Math.abs(e.touches[0].clientX - touchStartX.current)
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current)
    if (dx > dy && dx > 8) isDragging.current = true
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (!isDragging.current && zoom) return
    if (isDragging.current && zoom) { isDragging.current = false; return }
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(dx) > 50) { dx < 0 ? next() : prev() }
    touchStartX.current = null
    isDragging.current  = false
  }

  // ─── double-tap to zoom ──────────────────────────────────────
  function handleTap(e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) {
    if (!lightbox) return
    if (isDragging.current) return
    const now = Date.now()
    if (now - lastTap.current < 300) {
      // double tap/click
      if (!zoom) {
        const rect = (e.target as HTMLElement).closest('.lb-img-wrap')?.getBoundingClientRect()
        const clientX = 'touches' in e ? e.changedTouches[0].clientX : (e as React.MouseEvent).clientX
        const clientY = 'touches' in e ? e.changedTouches[0].clientY : (e as React.MouseEvent).clientY
        if (rect) {
          setZoomOrigin({
            x: ((clientX - rect.left) / rect.width)  * 100,
            y: ((clientY - rect.top)  / rect.height) * 100,
          })
        }
        setPanOffset({ x: 0, y: 0 })
        setZoom(true)
      } else {
        setZoom(false); setPanOffset({ x: 0, y: 0 })
      }
      lastTap.current = 0
    } else {
      lastTap.current = now
    }
  }

  if (!images.length) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-2xl bg-gray-50 text-6xl text-gray-200 dark:bg-gray-900 dark:text-gray-700">
        🛍️
      </div>
    )
  }

  return (
    <>
      {/* ── معرض الصور ── */}
      <div className="space-y-3">
        {/* الصورة الرئيسية */}
        <div
          className="relative aspect-square cursor-zoom-in overflow-hidden rounded-2xl bg-gray-50 dark:bg-gray-900"
          onClick={() => openLightbox(current)}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <img
            src={images[current]}
            alt={name}
            className="h-full w-full object-cover transition-opacity duration-200"
          />

          {/* شارة التكبير */}
          <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-black/40 px-2.5 py-1 text-xs text-white backdrop-blur-sm">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
            تكبير
          </div>

          {/* أسهم التنقل على الصورة (إن كان يوجد أكثر من صورة) */}
          {total > 1 && (
            <>
              <button
                onClick={e => { e.stopPropagation(); prev() }}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-gray-700 shadow backdrop-blur-sm transition hover:bg-white dark:bg-gray-900/80 dark:text-white"
              >
                ›
              </button>
              <button
                onClick={e => { e.stopPropagation(); next() }}
                className="absolute left-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-gray-700 shadow backdrop-blur-sm transition hover:bg-white dark:bg-gray-900/80 dark:text-white"
              >
                ‹
              </button>

              {/* نقاط التنقل */}
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
                {images.map((_, i) => (
                  <button
                    key={i}
                    onClick={e => { e.stopPropagation(); setCurrent(i) }}
                    className={`h-1.5 rounded-full transition-all ${
                      i === current ? 'w-4 bg-white' : 'w-1.5 bg-white/50'
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* الصور المصغرة */}
        {images.length > 1 && (
          <div className="grid grid-cols-5 gap-2">
            {images.map((img, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`aspect-square overflow-hidden rounded-xl transition ${
                  i === current
                    ? 'ring-2 ring-gray-900 ring-offset-1 dark:ring-white dark:ring-offset-gray-950'
                    : 'opacity-60 hover:opacity-100'
                }`}
              >
                <img src={img} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Lightbox ── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={e => { handleTap(e); onTouchEnd(e) }}
          onClick={e => { if (e.target === e.currentTarget) closeLightbox() }}
        >
          {/* شريط علوي */}
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
            <span className="text-sm text-white/60">{current + 1} / {total}</span>
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/40">
                {zoom ? 'اضغط مرتين للخروج من الزوم' : 'اضغط مرتين للتكبير'}
              </span>
              <button
                onClick={closeLightbox}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          {/* الصورة */}
          <div
            className={`lb-img-wrap relative flex h-full w-full items-center justify-center ${
              zoom ? 'cursor-zoom-out' : 'cursor-zoom-in'
            }`}
            onClick={handleTap}
          >
            <img
              src={images[current]}
              alt={name}
              draggable={false}
              className="max-h-full max-w-full select-none object-contain transition-transform duration-200"
              style={zoom ? {
                transform: `scale(2.5) translate(${(50 - zoomOrigin.x) * 0.4 + panOffset.x / 5}px, ${(50 - zoomOrigin.y) * 0.4 + panOffset.y / 5}px)`,
              } : {
                transform: 'scale(1)',
              }}
            />
          </div>

          {/* أسهم التنقل */}
          {total > 1 && (
            <>
              <button
                onClick={prev}
                className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20"
              >
                ›
              </button>
              <button
                onClick={next}
                className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20"
              >
                ‹
              </button>
            </>
          )}

          {/* الصور المصغرة في الأسفل */}
          {total > 1 && (
            <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center gap-2 bg-gradient-to-t from-black/60 to-transparent pb-4 pt-6 px-4 overflow-x-auto scrollbar-none">
              {images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => { setCurrent(i); setZoom(false); setPanOffset({ x: 0, y: 0 }) }}
                  className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg transition ${
                    i === current ? 'ring-2 ring-white' : 'opacity-50 hover:opacity-80'
                  }`}
                >
                  <img src={img} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
